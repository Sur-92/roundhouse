import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getDb } from './db'
import * as photos from './photos'
import { getFeedbackStatus, listFeedbackIssues, createFeedbackIssue } from './feedback'
import type {
  Collection, CollectionInput,
  TrainSet, TrainSetInput,
  Item, ItemInput, ItemFilter,
  ItemPhoto,
  FeedbackInput,
  LookupKind, LookupInput, LookupRow
} from '@shared/types'

const LOOKUP_TABLE: Record<LookupKind, string> = {
  type: 'item_types',
  scale: 'item_scales',
  condition: 'item_conditions'
}

function lookupTable(kind: LookupKind): string {
  const t = LOOKUP_TABLE[kind]
  if (!t) throw new Error(`Unknown lookup kind: ${kind}`)
  return t
}

const COLLECTION_FIELDS = ['name', 'description'] as const
const SET_FIELDS = ['collection_id', 'name', 'description', 'scale', 'manufacturer', 'era', 'notes'] as const
const ITEM_FIELDS = [
  'set_id', 'type', 'name', 'manufacturer', 'model_number', 'scale',
  'road_name', 'era', 'year', 'condition', 'original_box',
  'purchase_date', 'purchase_price_cents', 'current_value_cents',
  'storage_location', 'source', 'notes'
] as const

function buildUpdate<T extends Record<string, unknown>>(
  table: string,
  allowed: readonly string[],
  id: number,
  patch: Partial<T>
): { sql: string; values: unknown[] } | null {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k))
  if (!keys.length) return null
  const setClause = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => (patch as Record<string, unknown>)[k])
  return { sql: `UPDATE ${table} SET ${setClause} WHERE id = ?`, values: [...values, id] }
}

export function registerIpc(): void {
  const db = getDb()

  // ─── Collections ─────────────────────────────────────────────
  ipcMain.handle('collections:list', () =>
    db.prepare('SELECT * FROM collections ORDER BY name').all() as Collection[]
  )

  ipcMain.handle('collections:get', (_e, id: number) =>
    (db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as Collection | undefined) ?? null
  )

  ipcMain.handle('collections:create', (_e, input: CollectionInput) => {
    const r = db.prepare('INSERT INTO collections (name, description) VALUES (?, ?)')
      .run(input.name, input.description)
    return db.prepare('SELECT * FROM collections WHERE id = ?').get(r.lastInsertRowid) as Collection
  })

  ipcMain.handle('collections:update', (_e, id: number, patch: Partial<CollectionInput>) => {
    const upd = buildUpdate('collections', COLLECTION_FIELDS, id, patch)
    if (upd) db.prepare(upd.sql).run(...upd.values)
    return db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as Collection
  })

  ipcMain.handle('collections:delete', (_e, id: number) => {
    db.prepare('DELETE FROM collections WHERE id = ?').run(id)
  })

  // ─── Sets ────────────────────────────────────────────────────
  ipcMain.handle('sets:list', (_e, collectionId?: number) => {
    if (collectionId != null) {
      return db.prepare('SELECT * FROM sets WHERE collection_id = ? ORDER BY name').all(collectionId) as TrainSet[]
    }
    return db.prepare('SELECT * FROM sets ORDER BY name').all() as TrainSet[]
  })

  ipcMain.handle('sets:get', (_e, id: number) =>
    (db.prepare('SELECT * FROM sets WHERE id = ?').get(id) as TrainSet | undefined) ?? null
  )

  ipcMain.handle('sets:create', (_e, input: TrainSetInput) => {
    const r = db.prepare(
      `INSERT INTO sets (collection_id, name, description, scale, manufacturer, era, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.collection_id, input.name, input.description,
      input.scale, input.manufacturer, input.era, input.notes
    )
    return db.prepare('SELECT * FROM sets WHERE id = ?').get(r.lastInsertRowid) as TrainSet
  })

  ipcMain.handle('sets:update', (_e, id: number, patch: Partial<TrainSetInput>) => {
    const upd = buildUpdate('sets', SET_FIELDS, id, patch)
    if (upd) db.prepare(upd.sql).run(...upd.values)
    return db.prepare('SELECT * FROM sets WHERE id = ?').get(id) as TrainSet
  })

  ipcMain.handle('sets:delete', (_e, id: number) => {
    db.prepare('DELETE FROM sets WHERE id = ?').run(id)
  })

  // ─── Items ───────────────────────────────────────────────────
  ipcMain.handle('items:list', (_e, filter: ItemFilter = {}) => {
    const where: string[] = []
    const params: unknown[] = []

    if (filter.setId != null) { where.push('i.set_id = ?'); params.push(filter.setId) }
    if (filter.collectionId != null) {
      where.push('i.set_id IN (SELECT id FROM sets WHERE collection_id = ?)')
      params.push(filter.collectionId)
    }
    if (filter.type) { where.push('i.type = ?'); params.push(filter.type) }
    if (filter.scale) { where.push('i.scale = ?'); params.push(filter.scale) }
    if (filter.search) {
      where.push('(i.name LIKE ? OR i.manufacturer LIKE ? OR i.model_number LIKE ? OR i.notes LIKE ?)')
      const q = `%${filter.search}%`
      params.push(q, q, q, q)
    }

    const sql = `SELECT i.* FROM items i${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY i.name`
    return db.prepare(sql).all(...params) as Item[]
  })

  ipcMain.handle('items:get', (_e, id: number) =>
    (db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item | undefined) ?? null
  )

  ipcMain.handle('items:distinctValues', (_e, field: 'type' | 'scale' | 'condition') => {
    if (!['type', 'scale', 'condition'].includes(field)) return [] as string[]
    const rows = db.prepare(
      `SELECT DISTINCT ${field} AS v FROM items WHERE ${field} IS NOT NULL AND ${field} <> '' ORDER BY ${field}`
    ).all() as { v: string }[]
    return rows.map((r) => r.v)
  })

  ipcMain.handle('items:create', (_e, input: ItemInput) => {
    const cols = ITEM_FIELDS.join(', ')
    const placeholders = ITEM_FIELDS.map(() => '?').join(', ')
    const values = ITEM_FIELDS.map((f) => (input as Record<string, unknown>)[f] ?? null)
    const r = db.prepare(`INSERT INTO items (${cols}) VALUES (${placeholders})`).run(...values)
    return db.prepare('SELECT * FROM items WHERE id = ?').get(r.lastInsertRowid) as Item
  })

  ipcMain.handle('items:update', (_e, id: number, patch: Partial<ItemInput>) => {
    const upd = buildUpdate('items', ITEM_FIELDS, id, patch)
    if (upd) db.prepare(upd.sql).run(...upd.values)
    return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Item
  })

  ipcMain.handle('items:delete', (_e, id: number) => {
    // Photo files for this item are removed first; rows cascade via FK.
    const rows = db.prepare('SELECT file_path FROM item_photos WHERE item_id = ?').all(id) as { file_path: string }[]
    for (const r of rows) photos.deletePhoto(r.file_path)
    db.prepare('DELETE FROM items WHERE id = ?').run(id)
  })

  // ─── Photos ──────────────────────────────────────────────────
  ipcMain.handle('photos:listForItem', (_e, itemId: number) =>
    db.prepare('SELECT * FROM item_photos WHERE item_id = ? ORDER BY display_order, id').all(itemId) as ItemPhoto[]
  )

  ipcMain.handle('photos:add', async (e: IpcMainInvokeEvent, itemId: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return [] as ItemPhoto[]
    const result = await dialog.showOpenDialog(win, {
      title: 'Add photos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
    })
    if (result.canceled || !result.filePaths.length) return [] as ItemPhoto[]

    const created: ItemPhoto[] = []
    const insertPhoto = db.prepare(
      'INSERT INTO item_photos (item_id, file_path, display_order) VALUES (?, ?, ?)'
    )
    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM item_photos WHERE item_id = ?'
    )
    const fetch = db.prepare('SELECT * FROM item_photos WHERE id = ?')

    for (const src of result.filePaths) {
      const rel = photos.importPhoto(itemId, src)
      const order = (nextOrder.get(itemId) as { n: number }).n
      const r = insertPhoto.run(itemId, rel, order)
      created.push(fetch.get(r.lastInsertRowid) as ItemPhoto)
    }
    return created
  })

  ipcMain.handle('photos:delete', (_e, photoId: number) => {
    const photo = db.prepare('SELECT * FROM item_photos WHERE id = ?').get(photoId) as ItemPhoto | undefined
    if (!photo) return
    photos.deletePhoto(photo.file_path)
    db.prepare('DELETE FROM item_photos WHERE id = ?').run(photoId)
  })

  // ─── Feedback (GitHub Issues) ────────────────────────
  ipcMain.handle('feedback:status', () => getFeedbackStatus())
  ipcMain.handle('feedback:list', async () => listFeedbackIssues())
  ipcMain.handle('feedback:create', async (_e, input: FeedbackInput) => createFeedbackIssue(input))

  // ─── Lookups (Type / Scale / Condition) ──────────────
  ipcMain.handle('lookups:list', (_e, kind: LookupKind) => {
    const t = lookupTable(kind)
    return db.prepare(`SELECT * FROM ${t} ORDER BY sort_order, label`).all() as LookupRow[]
  })

  ipcMain.handle('lookups:create', (_e, kind: LookupKind, input: LookupInput) => {
    const t = lookupTable(kind)
    const value = String(input.value ?? '').trim()
    const label = String(input.label ?? value).trim() || value
    if (!value) throw new Error('Value is required')
    // Default sort_order: max + 10 so user-added rows append after system rows.
    const next = (db.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM ${t}`).get() as { n: number }).n
    const sort = input.sort_order != null ? Number(input.sort_order) : next
    const r = db.prepare(`INSERT INTO ${t} (value, label, sort_order, is_system) VALUES (?, ?, ?, 0)`)
      .run(value, label, sort)
    return db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(r.lastInsertRowid) as LookupRow
  })

  ipcMain.handle('lookups:update', (_e, kind: LookupKind, id: number, patch: Partial<LookupInput>) => {
    const t = lookupTable(kind)
    const existing = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as LookupRow | undefined
    if (!existing) throw new Error(`No ${kind} with id ${id}`)
    // System rows: only label/sort_order may change. value is locked so existing items don't drift.
    const label = patch.label != null ? String(patch.label).trim() : existing.label
    const sort = patch.sort_order != null ? Number(patch.sort_order) : existing.sort_order
    const value = existing.is_system ? existing.value
      : (patch.value != null ? String(patch.value).trim() : existing.value)
    if (!value || !label) throw new Error('Value and label are required')
    db.prepare(`UPDATE ${t} SET value = ?, label = ?, sort_order = ? WHERE id = ?`)
      .run(value, label, sort, id)
    return db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as LookupRow
  })

  ipcMain.handle('lookups:delete', (_e, kind: LookupKind, id: number) => {
    const t = lookupTable(kind)
    const row = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(id) as LookupRow | undefined
    if (!row) return
    if (row.is_system) throw new Error(`Cannot delete the built-in "${row.label}" — only user-added rows can be removed.`)
    db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id)
  })
}
