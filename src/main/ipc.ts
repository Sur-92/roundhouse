import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { getDb } from './db'
import * as photos from './photos'
import { getFeedbackStatus, listFeedbackIssues, createFeedbackIssue } from './feedback'
import type {
  Collection, CollectionInput,
  TrainSet, TrainSetInput,
  Item, ItemInput, ItemFilter,
  ItemPhoto,
  FeedbackInput
} from '@shared/types'

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
}
