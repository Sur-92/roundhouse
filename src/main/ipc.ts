import { ipcMain, dialog, BrowserWindow, app, clipboard, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'node:fs'
import { getDb } from './db'
import * as photos from './photos'
import { getFeedbackStatus, listFeedbackIssues, createFeedbackIssue } from './feedback'
import { getEbayStatus, searchForItem as ebaySearchForItem } from './ebay'
import { shell } from 'electron'
import { buildSearchClauses } from './search'
import { diagLog, getDiagLogPath, openDiagLogInEditor, resetDiagLog } from './diag'
import { importTrainsXlsx, importCoinsXlsx, type ImportResult } from './import-xlsx'
import { createBackup, type BackupResult } from './backup'
import type {
  FindReplaceOptions, FindReplaceResult, FindReplaceField, FindReplaceMatch
} from '@shared/types'
import type {
  Collection, CollectionInput, CollectionKind,
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

const COLLECTION_FIELDS = ['name', 'description', 'kind'] as const
const SET_FIELDS = ['collection_id', 'name', 'description', 'scale', 'manufacturer', 'era', 'notes'] as const
const ITEM_FIELDS = [
  'set_id', 'collection_id', 'type', 'name',
  // Train fields
  'manufacturer', 'model_number', 'scale', 'road_name', 'era',
  // Coin fields
  'country', 'face_value', 'denomination', 'mint_mark', 'quantity',
  // Shared
  'year', 'condition', 'original_box',
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
  ipcMain.handle('collections:list', (_e, kind?: CollectionKind) => {
    if (kind) {
      return db.prepare('SELECT * FROM collections WHERE kind = ? ORDER BY name').all(kind) as Collection[]
    }
    return db.prepare('SELECT * FROM collections ORDER BY kind, name').all() as Collection[]
  })

  ipcMain.handle('collections:get', (_e, id: number) =>
    (db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as Collection | undefined) ?? null
  )

  ipcMain.handle('collections:getByKind', (_e, kind: CollectionKind) => {
    return (db.prepare('SELECT * FROM collections WHERE kind = ? ORDER BY id LIMIT 1').get(kind) as Collection | undefined) ?? null
  })

  ipcMain.handle('collections:create', (_e, input: CollectionInput) => {
    const r = db.prepare('INSERT INTO collections (name, description, kind) VALUES (?, ?, ?)')
      .run(input.name, input.description, input.kind || 'trains')
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
      // Match items linked directly to the collection OR via a set in it.
      where.push('(i.collection_id = ? OR i.set_id IN (SELECT id FROM sets WHERE collection_id = ?))')
      params.push(filter.collectionId, filter.collectionId)
    }
    if (filter.collectionKind) {
      where.push('i.collection_id IN (SELECT id FROM collections WHERE kind = ?)')
      params.push(filter.collectionKind)
    }
    if (filter.type) { where.push('i.type = ?'); params.push(filter.type) }
    if (filter.scale) { where.push('i.scale = ?'); params.push(filter.scale) }
    if (filter.country) { where.push('i.country = ?'); params.push(filter.country) }
    if (filter.hasPhotos === true) {
      where.push('EXISTS (SELECT 1 FROM item_photos WHERE item_id = i.id)')
    } else if (filter.hasPhotos === false) {
      where.push('NOT EXISTS (SELECT 1 FROM item_photos WHERE item_id = i.id)')
    }
    if (filter.search) {
      // Smart-search syntax: bare terms, field:value, field: (blank),
      // and -negation. Implementation in src/main/search.ts.
      for (const frag of buildSearchClauses(filter.search)) {
        // Re-prefix unqualified column names with the table alias 'i.'
        // so the JOIN-style filters above don't clash with anything.
        where.push(frag.sql.replace(/(^|\W)(name|manufacturer|model_number|notes|type|scale|condition|source|era|year|road_name)\b/g, '$1i.$2'))
        params.push(...frag.params)
      }
    }

    const sql = `
      SELECT i.*,
        (SELECT file_path FROM item_photos
          WHERE item_id = i.id AND media_type = 'photo'
          ORDER BY is_primary DESC, display_order ASC, id ASC
          LIMIT 1) AS primary_photo_path
      FROM items i${where.length ? ' WHERE ' + where.join(' AND ') : ''}
      ORDER BY i.name`
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
    db.prepare(
      'SELECT * FROM item_photos WHERE item_id = ? ORDER BY is_primary DESC, display_order, id'
    ).all(itemId) as ItemPhoto[]
  )

  ipcMain.handle('photos:add', async (e: IpcMainInvokeEvent, itemId: number) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return [] as ItemPhoto[]
    const result = await dialog.showOpenDialog(win, {
      title: 'Add photos or videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Photos & videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
        { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return [] as ItemPhoto[]

    // Bucket each file by extension so we tag it with the right
    // media_type. Anything we don't recognize falls back to 'photo'
    // (the historic default) so unexpected inputs don't get lost.
    const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v'])
    const created: ItemPhoto[] = []
    const insertMedia = db.prepare(
      'INSERT INTO item_photos (item_id, file_path, display_order, media_type) VALUES (?, ?, ?, ?)'
    )
    const nextOrder = db.prepare(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS n FROM item_photos WHERE item_id = ?'
    )
    const fetch = db.prepare('SELECT * FROM item_photos WHERE id = ?')

    for (const src of result.filePaths) {
      const ext = (src.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase()
      const mediaType = VIDEO_EXTS.has(ext) ? 'video' : 'photo'
      const rel = photos.importPhoto(itemId, src)
      const order = (nextOrder.get(itemId) as { n: number }).n
      const r = insertMedia.run(itemId, rel, order, mediaType)
      created.push(fetch.get(r.lastInsertRowid) as ItemPhoto)
    }
    return created
  })

  ipcMain.handle('photos:delete', (_e, photoId: number) => {
    const photo = db.prepare('SELECT * FROM item_photos WHERE id = ?').get(photoId) as ItemPhoto | undefined
    if (!photo) return
    photos.deletePhoto(photo.file_path)
    db.prepare('DELETE FROM item_photos WHERE id = ?').run(photoId)
    // If we deleted the primary, promote the next earliest photo of that item.
    if (photo.is_primary) {
      const next = db.prepare(
        'SELECT id FROM item_photos WHERE item_id = ? ORDER BY display_order, id LIMIT 1'
      ).get(photo.item_id) as { id: number } | undefined
      if (next) db.prepare('UPDATE item_photos SET is_primary = 1 WHERE id = ?').run(next.id)
    }
  })

  ipcMain.handle('photos:setCaption', (_e, photoId: number, caption: string | null) => {
    const c = caption == null ? null : String(caption).trim() || null
    db.prepare('UPDATE item_photos SET caption = ? WHERE id = ?').run(c, photoId)
    return db.prepare('SELECT * FROM item_photos WHERE id = ?').get(photoId) as ItemPhoto
  })

  ipcMain.handle('photos:setPrimary', (_e, itemId: number, photoId: number) => {
    const tx = db.transaction(() => {
      db.prepare('UPDATE item_photos SET is_primary = 0 WHERE item_id = ? AND id <> ?').run(itemId, photoId)
      db.prepare('UPDATE item_photos SET is_primary = 1 WHERE item_id = ? AND id = ?').run(itemId, photoId)
    })
    tx()
  })

  ipcMain.handle('photos:reorder', (_e, itemId: number, orderedIds: number[]) => {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return
    const upd = db.prepare('UPDATE item_photos SET display_order = ? WHERE id = ? AND item_id = ?')
    const tx = db.transaction(() => {
      orderedIds.forEach((id, idx) => upd.run(idx, id, itemId))
    })
    tx()
  })


  // ─── Feedback (GitHub Issues) ────────────────────────
  ipcMain.handle('feedback:status', () => getFeedbackStatus())
  ipcMain.handle('feedback:list', async () => listFeedbackIssues())
  ipcMain.handle('feedback:create', async (_e, input: FeedbackInput) => createFeedbackIssue(input))

  // ─── Lookups (Type / Scale / Condition, per CollectionKind) ──
  ipcMain.handle('lookups:list', (_e, kind: LookupKind, collectionKind: CollectionKind) => {
    const t = lookupTable(kind)
    return db.prepare(
      `SELECT * FROM ${t} WHERE kind = ? ORDER BY sort_order, label`
    ).all(collectionKind) as LookupRow[]
  })

  ipcMain.handle('lookups:create', (_e, kind: LookupKind, collectionKind: CollectionKind, input: LookupInput) => {
    const t = lookupTable(kind)
    const value = String(input.value ?? '').trim()
    const label = String(input.label ?? value).trim() || value
    if (!value) throw new Error('Value is required')
    // Default sort_order: max + 10 within this collectionKind so user-added rows append after system rows.
    const next = (db.prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM ${t} WHERE kind = ?`
    ).get(collectionKind) as { n: number }).n
    const sort = input.sort_order != null ? Number(input.sort_order) : next
    const r = db.prepare(
      `INSERT INTO ${t} (kind, value, label, sort_order, is_system) VALUES (?, ?, ?, ?, 0)`
    ).run(collectionKind, value, label, sort)
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

  ipcMain.handle('lookups:reorder', (_e, kind: LookupKind, orderedIds: number[]) => {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return
    const t = lookupTable(kind)
    const upd = db.prepare(`UPDATE ${t} SET sort_order = ? WHERE id = ?`)
    const tx = db.transaction(() => {
      // Spread by 10s so manual edits / inserts between rows still fit later.
      orderedIds.forEach((id, idx) => upd.run((idx + 1) * 10, id))
    })
    tx()
  })

  // ─── Import (.xlsx → items) ──────────────────────────
  // Lets a fresh user bring their existing inventory in via the GUI:
  // file picker → parse → bulk-insert into the kind's collection. The
  // collection itself is auto-created at migration time.
  ipcMain.handle('import:fromXlsx', async (e: IpcMainInvokeEvent, kind: CollectionKind): Promise<ImportResult & { canceled?: boolean }> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: kind === 'trains' ? 'Import trains from Excel' : 'Import coins from Excel',
      filters: [
        { name: 'Excel workbook', extensions: ['xlsx'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) {
      return { inserted: 0, skipped: 0, warnings: [], canceled: true }
    }
    const filePath = result.filePaths[0]!

    // Resolve target collection (one per kind).
    const collection = db.prepare('SELECT id FROM collections WHERE kind = ? ORDER BY id LIMIT 1').get(kind) as { id: number } | undefined
    if (!collection) {
      throw new Error(`No collection found for kind=${kind}. Restart Roundhouse to let the migration runner create it.`)
    }

    diagLog(`[import] starting ${kind} xlsx import from ${filePath} → collection_id=${collection.id}`)
    try {
      const r = kind === 'coins'
        ? await importCoinsXlsx(db, filePath, collection.id)
        : await importTrainsXlsx(db, filePath, collection.id)
      diagLog(`[import] done: inserted=${r.inserted} skipped=${r.skipped} warnings=${r.warnings.length}`)
      return r
    } catch (err) {
      diagLog(`[import] FAILED: ${String(err)}`)
      throw err
    }
  })

  // ─── Files (export) ──────────────────────────────────
  ipcMain.handle('files:saveCsv', async (e: IpcMainInvokeEvent, defaultName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      title: 'Export to CSV',
      defaultPath: defaultName.endsWith('.csv') ? defaultName : `${defaultName}.csv`,
      filters: [
        { name: 'CSV', extensions: ['csv'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      diagLog('[csv] saveCsv canceled by user')
      return null
    }
    try {
      // BOM lets Excel detect UTF-8 correctly when opening directly.
      // Content is built in the renderer with CRLF line endings.
      writeFileSync(result.filePath, '﻿' + content, 'utf8')
      diagLog(`[csv] wrote ${content.length} bytes (+BOM) to ${result.filePath}`)
      return result.filePath
    } catch (err) {
      diagLog(`[csv] FAILED writing ${result.filePath}: ${String(err)}`)
      throw err
    }
  })

  // Reveal an arbitrary file in the OS file manager (Explorer on
  // Windows, Finder on macOS). Used as a follow-up after CSV export
  // and Backup so the user can confirm the file landed.
  ipcMain.handle('files:showInFolder', (_e, filePath: string) => {
    try {
      shell.showItemInFolder(filePath)
    } catch (err) {
      diagLog(`[files] showItemInFolder failed for ${filePath}: ${String(err)}`)
    }
  })

  // ─── Backup (DB + media → portable .zip) ─────────────
  ipcMain.handle('backup:create', async (e: IpcMainInvokeEvent): Promise<BackupResult & { canceled?: boolean }> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save Roundhouse Backup',
      defaultPath: `Roundhouse-Backup-${stamp}.zip`,
      filters: [
        { name: 'Zip archive', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      return { zipPath: '', sizeBytes: 0, itemCount: 0, photoCount: 0, videoCount: 0, durationMs: 0, canceled: true }
    }
    diagLog(`[backup] starting → ${result.filePath}`)
    return createBackup(result.filePath)
  })

  // ─── Find & Replace (data tool — resolves #18) ────────
  // Bulk-edit a text column on items. Preview first (apply: false)
  // returns count + up to 20 samples; Apply (apply: true) runs the
  // UPDATE in a transaction. Field name is allowlisted to prevent
  // arbitrary-column writes.
  ipcMain.handle('data:findReplace', (_e, opts: FindReplaceOptions): FindReplaceResult => {
    const ALLOWED_FIELDS: readonly FindReplaceField[] = [
      'name', 'source', 'notes', 'storage_location',
      'manufacturer', 'model_number', 'road_name', 'era',
      'country', 'denomination', 'mint_mark'
    ]
    if (!ALLOWED_FIELDS.includes(opts.field)) {
      throw new Error(`Find & Replace: field "${opts.field}" is not editable.`)
    }
    if (typeof opts.find !== 'string' || opts.find.length === 0) {
      throw new Error('Find & Replace: "find" must be a non-empty string.')
    }
    if (typeof opts.replace !== 'string') {
      throw new Error('Find & Replace: "replace" must be a string (empty string is OK).')
    }

    const col = opts.field // safe — allowlisted

    // Build the WHERE clause. SQL-pushable cases first (substring/whole);
    // regex falls back to fetch-then-filter in JS.
    const whereParts: string[] = []
    const whereParams: unknown[] = []
    if (opts.scope === 'trains' || opts.scope === 'coins') {
      whereParts.push('collection_id IN (SELECT id FROM collections WHERE kind = ?)')
      whereParams.push(opts.scope)
    }
    whereParts.push(`${col} IS NOT NULL AND ${col} <> ''`)

    let jsFilter: ((value: string) => boolean) | null = null
    let jsReplace: ((value: string) => string) | null = null

    if (opts.matchType === 'regex') {
      let re: RegExp
      try {
        re = new RegExp(opts.find, opts.caseSensitive ? 'g' : 'gi')
      } catch (err) {
        throw new Error(`Find & Replace: invalid regex — ${String(err)}`)
      }
      jsFilter = (v) => { re.lastIndex = 0; return re.test(v) }
      jsReplace = (v) => v.replace(re, opts.replace)
    } else if (opts.matchType === 'whole') {
      if (opts.caseSensitive) {
        whereParts.push(`${col} = ?`)
        whereParams.push(opts.find)
      } else {
        whereParts.push(`LOWER(${col}) = LOWER(?)`)
        whereParams.push(opts.find)
      }
      jsReplace = () => opts.replace // whole-field replace = the replacement string verbatim
    } else {
      // substring (default)
      if (opts.caseSensitive) {
        // SQLite GLOB is case-sensitive; need to escape * ? [ ] in user input.
        const glob = '*' + opts.find.replace(/[*?[\]]/g, '[$&]') + '*'
        whereParts.push(`${col} GLOB ?`)
        whereParams.push(glob)
      } else {
        // SQLite LIKE is case-insensitive for ASCII by default.
        const like = '%' + opts.find.replace(/[%_\\]/g, '\\$&') + '%'
        whereParts.push(`${col} LIKE ? ESCAPE '\\'`)
        whereParams.push(like)
      }
      jsReplace = (v) => {
        if (opts.caseSensitive) return v.split(opts.find).join(opts.replace)
        // Case-insensitive substring replace.
        const re = new RegExp(opts.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        return v.replace(re, opts.replace)
      }
    }

    const whereSql = whereParts.join(' AND ')
    const selectSql = `SELECT id, name, ${col} AS field_value FROM items WHERE ${whereSql} ORDER BY id`

    type Row = { id: number; name: string; field_value: string }
    let rows = db.prepare(selectSql).all(...whereParams) as Row[]

    // Apply JS-side filter if regex.
    if (jsFilter) rows = rows.filter((r) => jsFilter!(r.field_value))

    const matchCount = rows.length
    const samples: FindReplaceMatch[] = rows.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      before: r.field_value,
      after: jsReplace!(r.field_value)
    }))

    if (!opts.apply) {
      diagLog(`[findReplace] preview: field=${col} scope=${opts.scope} type=${opts.matchType} matched=${matchCount}`)
      return { matchCount, samples, applied: false }
    }

    // Apply: compute the new value per matched row and UPDATE in a transaction.
    diagLog(`[findReplace] applying: field=${col} scope=${opts.scope} type=${opts.matchType} matched=${matchCount}`)
    const update = db.prepare(`UPDATE items SET ${col} = ? WHERE id = ?`)
    const txn = db.transaction(() => {
      for (const r of rows) {
        const next = jsReplace!(r.field_value)
        if (next !== r.field_value) update.run(next, r.id)
      }
    })
    txn()
    return { matchCount, samples, applied: true }
  })

  ipcMain.handle('print:current', (e: IpcMainInvokeEvent) => {
    e.sender.print({ silent: false, printBackground: false })
  })

  // ─── App ─────────────────────────────────────────────
  ipcMain.handle('app:version', () => app.getVersion())

  // ─── Clipboard (Windows paste rescue) ────────────────
  // Electron's clipboard module is privileged and reads the actual OS
  // clipboard regardless of how Chromium's renderer-side sandbox handles
  // the paste flow. Fixes Windows-specific paste failure from rich
  // sources (ChatGPT, eBay) where Chromium's default paste path is
  // unreliable.
  ipcMain.handle('clipboard:readText', () => {
    try {
      const text = clipboard.readText()
      diagLog(`clipboard.readText() → ${text.length} chars [main]`)
      return text
    } catch (err) {
      diagLog(`clipboard.readText() THREW: ${String(err)} [main]`)
      throw err
    }
  })

  // ─── Diagnostic log ──────────────────────────────────
  ipcMain.handle('diag:log', (_e, msg: string) => {
    diagLog(`[renderer] ${msg}`)
  })
  ipcMain.handle('diag:openLog', () => openDiagLogInEditor())
  ipcMain.handle('diag:reset', () => { resetDiagLog() })
  ipcMain.handle('diag:path', () => getDiagLogPath())

  // ─── eBay (Browse API integration) ───────────────────
  ipcMain.handle('ebay:status', () => getEbayStatus())

  ipcMain.handle('ebay:searchForItem', async (_e, itemId: number, opts?: { force?: boolean }) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId) as Item | undefined
    if (!item) throw new Error(`No item with id ${itemId}`)
    return ebaySearchForItem(item, opts)
  })

  ipcMain.handle('ebay:openListing', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\/[^/]*ebay\.com\//.test(url)) {
      throw new Error('Refusing to open non-eBay URL')
    }
    await shell.openExternal(url)
  })
}
