/**
 * In-app .xlsx importers for trains and coins. Mirrors the column
 * mapping logic from scripts/import_xlsx.py and scripts/import_coins.py
 * so a brand-new user (no Python, no shell) can bring their existing
 * inventory in via the GUI.
 *
 * Each import:
 *   1. Parses the first worksheet of the workbook
 *   2. Walks data rows (skipping headers / totals)
 *   3. Maps each row onto the items insert shape
 *   4. Inserts everything in a single transaction
 *
 * The functions DON'T create the collection — they expect a target
 * collection_id (one already exists per kind from the migration).
 *
 * They return an `ImportResult` so the renderer can show a summary
 * dialog ("Inserted 412 items, skipped 3 blank rows").
 */

import ExcelJS from 'exceljs'
import type Database from 'better-sqlite3'
import { diagLog } from './diag'

export interface ImportResult {
  inserted: number
  skipped: number
  warnings: string[]
}

/**
 * Sanity caps. The Surface user once reported a "small Excel file"
 * importing 1M+ records, almost certainly because the sheet's bounds
 * were silently enormous (a formula or fill-down on a detected column
 * passes the per-row skip check). These caps make that failure mode
 * loud + safe instead of catastrophic.
 */
const MAX_SHEET_ROWS = 100_000   // Refuse upfront — likely a malformed sheet
const MAX_INSERTS = 50_000        // Abort mid-import; the txn rolls back

class ImportLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportLimitError' }
}

/**
 * Cheaply read just the data-row count of the first worksheet without
 * parsing the file twice. Used by the IPC layer to prompt the user
 * before committing to a large import.
 */
export async function peekXlsxRowCount(filePath: string): Promise<number> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) return 0
  // actualRowCount counts rows with cell values (vs rowCount which is
  // the max touched index). Subtract 1 for the header row.
  return Math.max(0, ws.actualRowCount - 1)
}

function logSheetBounds(ws: ExcelJS.Worksheet, label: string): void {
  // ws.lastRow is the row object for the last used row; .number is its
  // index. actualRowCount counts rows with cell values; rowCount is the
  // max index touched (including blanks). Big mismatches between the
  // two are a tell that the sheet has phantom-formatting rows.
  const last = ws.lastRow?.number ?? 0
  diagLog(
    `[import] sheet bounds (${label}): rowCount=${ws.rowCount} actualRowCount=${ws.actualRowCount} lastRow.number=${last}`
  )
}

// ─── Trains ──────────────────────────────────────────────────────

const VALID_SCALES = new Set(['Z', 'N', 'HO', 'OO', 'S', 'O', 'G'])

function mapScale(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const up = s.toUpperCase()
  if (VALID_SCALES.has(up)) return up
  if (['N/A', 'ALL', 'ANY'].includes(up)) return null
  // 1/43, 1/64, ON30, etc. — keep raw, the Settings page accepts custom scales
  return s
}

function mapTrainType(itemName: string): string {
  if (!itemName) return 'other'
  const prefix = (itemName.split(' - ', 1)[0] ?? '').trim().toLowerCase()
  if (prefix === 'rs' || prefix.startsWith('rs ')) return 'rolling_stock'
  if (prefix.startsWith('locomotive')) return 'locomotive'
  if (prefix.startsWith('track')) return 'track'
  if (prefix.startsWith('accessor')) return 'accessory'
  if (prefix.startsWith('building') || prefix.includes('structure') || prefix.includes('sturcture')) return 'building'
  if (['toy truck', 'truck', 'ahl', 'hartoy'].includes(prefix)) return 'accessory'
  if (prefix.startsWith('transformer') || prefix.startsWith('tools')) return 'accessory'
  if (prefix.startsWith('trolley')) return 'rolling_stock'
  if (
    prefix.startsWith('puzzle') ||
    prefix.startsWith('coin bank') ||
    prefix.startsWith('train set') ||
    prefix.startsWith('book') ||
    prefix.startsWith('repairs') ||
    prefix.startsWith('lot') ||
    prefix.startsWith('misc')
  ) {
    return 'other'
  }
  return 'other'
}

function clean(v: unknown): string | null {
  if (v == null) return null
  // ExcelJS may return rich-text or hyperlink objects; coerce sensibly.
  let s: string
  if (typeof v === 'object' && v !== null) {
    if ('text' in v && typeof (v as { text: unknown }).text === 'string') {
      s = (v as { text: string }).text
    } else if ('result' in v) {
      s = String((v as { result: unknown }).result ?? '')
    } else {
      s = String(v)
    }
  } else {
    s = String(v)
  }
  s = s.trim()
  if (!s || s === '?' || s === '-') return null
  return s
}

function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(/[$,]/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toCents(v: unknown): number | null {
  const n = toNumber(v)
  return n == null ? null : Math.round(n * 100)
}

function toIsoDate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  return s || null
}

/**
 * Train import. Expected sheet shape (one of the columns near the
 * front; we tolerate variation by name-matching the header row):
 *   Scale | Mfg | Number | Item | Source | Purchased | Price | Color | Notes
 */
export async function importTrainsXlsx(
  db: Database.Database,
  filePath: string,
  collectionId: number
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) {
    return { inserted: 0, skipped: 0, warnings: ['No worksheet found in file.'] }
  }
  logSheetBounds(ws, 'trains')
  if (ws.rowCount > MAX_SHEET_ROWS) {
    return {
      inserted: 0,
      skipped: 0,
      warnings: [
        `This worksheet reports ${ws.rowCount.toLocaleString()} rows — that's almost certainly wrong (the file probably has hidden blank-but-formatted rows extending way past your data). Open the file in Excel, select rows below your last real data row, delete them, save, and try again.`
      ]
    }
  }

  // Detect column indexes from header row. Default fallback is the
  // legacy column order from the Python script.
  const header = ws.getRow(1).values as unknown[]
  const idx = headerIndex(header, {
    scale:     ['scale'],
    mfg:       ['mfg', 'manufacturer'],
    number:    ['number', 'model #', 'model number', 'model_no', 'model'],
    item:      ['item', 'description', 'name'],
    source:    ['source', 'where bought'],
    purchased: ['purchased', 'date', 'purchase date'],
    price:     ['price', 'cost', 'paid'],
    color:     ['color', 'road name', 'road'],
    notes:     ['notes', 'comment', 'comments']
  }, {
    scale: 1, mfg: 2, number: 3, item: 4, source: 5, purchased: 6, price: 7, color: 8, notes: 9
  })

  const insertSql = `
    INSERT INTO items (
      collection_id, type, name,
      manufacturer, model_number, scale, road_name,
      condition, original_box,
      purchase_date, purchase_price_cents,
      source, notes, quantity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `
  const insert = db.prepare(insertSql)

  let inserted = 0
  let skipped = 0
  const warnings: string[] = []

  const txn = db.transaction(() => {
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 1) return // header (and any phantom row 0)
      if (inserted >= MAX_INSERTS) {
        throw new ImportLimitError(
          `Aborted at ${MAX_INSERTS.toLocaleString()} inserts — the sheet appears to have far more data rows than expected (last row processed: ${rowNumber}). The transaction was rolled back; no items were added. Check the file for a column with fill-down values extending past your real data.`
        )
      }
      const cells = row.values as unknown[]
      const itemRaw = clean(cells[idx.item])
      if (!itemRaw) {
        skipped += 1
        return
      }
      const scale = mapScale(cells[idx.scale])
      const mfg = clean(cells[idx.mfg])
      const number = clean(cells[idx.number])
      const source = clean(cells[idx.source])
      const purchased = toIsoDate(cells[idx.purchased])
      const price = toCents(cells[idx.price])
      const color = clean(cells[idx.color])
      const notes = clean(cells[idx.notes])
      const type = mapTrainType(itemRaw)
      // The "Item" column often carries a "Type - Name" prefix; strip
      // it for the visible name so the Type chip carries that signal.
      const cleanedName = itemRaw.includes(' - ')
        ? itemRaw.split(' - ').slice(1).join(' - ').trim() || itemRaw
        : itemRaw

      insert.run(
        collectionId, type, cleanedName,
        mfg, number, scale, color,
        null, null,
        purchased, price,
        source, notes
      )
      inserted += 1
      if (inserted % 500 === 0) {
        diagLog(`[import] trains progress: ${inserted} inserted at row ${rowNumber}`)
      }
    })
  })

  try {
    txn()
  } catch (err) {
    if (err instanceof ImportLimitError) {
      diagLog(`[import] trains aborted: ${err.message}`)
      return { inserted: 0, skipped: 0, warnings: [err.message] }
    }
    throw err
  }

  if (inserted === 0) {
    warnings.push('No data rows recognized. Make sure the first sheet has an "Item" column with item names.')
  }
  return { inserted, skipped, warnings }
}

// ─── Coins ───────────────────────────────────────────────────────

const COIN_COND_MAP: Record<string, string> = {
  'poor': 'poor', 'p-1': 'poor',
  'fair': 'fair', 'fr-2': 'fair',
  'about good': 'about_good', 'ag-3': 'about_good',
  'good': 'good', 'g-4': 'good', 'g-6': 'good',
  'very good': 'very_good', 'vg-8': 'very_good', 'vg-10': 'very_good',
  'fine': 'fine', 'f-12': 'fine', 'f-15': 'fine',
  'very fine': 'very_fine', 'vf-20': 'very_fine', 'vf-35': 'very_fine',
  'extremely fine': 'extremely_fine', 'ef-40': 'extremely_fine', 'ef-45': 'extremely_fine',
  'about uncirculated': 'about_uncirculated', 'au-50': 'about_uncirculated', 'au-58': 'about_uncirculated',
  'mint': 'mint_state', 'mint state': 'mint_state',
  'uncirculated': 'mint_state', 'unc': 'mint_state',
  'ms-60': 'mint_state', 'ms-65': 'mint_state', 'ms-70': 'mint_state',
  'proof': 'proof', 'pr-60': 'proof', 'pr-70': 'proof'
}

function mapCoinCondition(raw: unknown): string | null {
  const s = clean(raw)
  if (s == null) return null
  return COIN_COND_MAP[s.toLowerCase()] ?? s
}

function mapCoinType(raw: unknown): string {
  const s = (clean(raw) || '').toLowerCase()
  if (s.startsWith('bill')) return 'bill'
  return 'coin'
}

function synthesizeCoinName(
  country: string | null,
  faceValue: number | null,
  denomination: string | null,
  year: number | null,
  mint: string | null
): string {
  const parts: string[] = []
  if (year != null) parts.push(String(year))
  if (country) parts.push(country)
  if (faceValue != null) {
    parts.push(Number.isInteger(faceValue) ? String(faceValue) : String(faceValue))
  }
  if (denomination) parts.push(denomination)
  if (mint) parts.push(`(${mint})`)
  return parts.join(' ') || '(unnamed coin)'
}

/**
 * Coin import. Expected sheet shape:
 *   Type | Country | Currency | Denomination | Year | Mint | Condition |
 *   Quantity | Value | Total | Comment
 *
 * Note: "Currency" in the source spreadsheet holds the *numeric face
 * value*; "Denomination" holds the unit name (Dollar, Pesos…).
 */
export async function importCoinsXlsx(
  db: Database.Database,
  filePath: string,
  collectionId: number
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  if (!ws) {
    return { inserted: 0, skipped: 0, warnings: ['No worksheet found in file.'] }
  }
  logSheetBounds(ws, 'coins')
  if (ws.rowCount > MAX_SHEET_ROWS) {
    return {
      inserted: 0,
      skipped: 0,
      warnings: [
        `This worksheet reports ${ws.rowCount.toLocaleString()} rows — that's almost certainly wrong (the file probably has hidden blank-but-formatted rows extending way past your data). Open the file in Excel, select rows below your last real data row, delete them, save, and try again.`
      ]
    }
  }

  const header = ws.getRow(1).values as unknown[]
  const idx = headerIndex(header, {
    type:         ['type'],
    country:      ['country'],
    currency:     ['currency', 'face value', 'face'],
    denomination: ['denomination', 'denom', 'unit'],
    year:         ['year'],
    mint:         ['mint', 'mint mark'],
    condition:    ['condition', 'grade'],
    quantity:     ['quantity', 'qty', 'count'],
    value:        ['value', 'current value'],
    total:        ['total'],
    comment:      ['comment', 'notes', 'comments']
  }, {
    type: 1, country: 2, currency: 3, denomination: 4, year: 5,
    mint: 6, condition: 7, quantity: 8, value: 9, total: 10, comment: 11
  })

  const insertSql = `
    INSERT INTO items (
      collection_id, type, name,
      country, face_value, denomination, mint_mark, quantity,
      year, condition,
      current_value_cents, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  const insert = db.prepare(insertSql)

  let inserted = 0
  let skipped = 0
  const warnings: string[] = []

  const txn = db.transaction(() => {
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= 1) return // header (and any phantom row 0)
      if (inserted >= MAX_INSERTS) {
        throw new ImportLimitError(
          `Aborted at ${MAX_INSERTS.toLocaleString()} inserts — the sheet appears to have far more data rows than expected (last row processed: ${rowNumber}). The transaction was rolled back; no coins were added. Check the file for a column with fill-down values extending past your real data.`
        )
      }
      const cells = row.values as unknown[]
      const country = clean(cells[idx.country])
      const typeRaw = cells[idx.type]
      // Treat row as data if it has Type or Country populated.
      if (!country && !clean(typeRaw)) {
        skipped += 1
        return
      }
      const t = mapCoinType(typeRaw)
      const faceValue = toNumber(cells[idx.currency])
      const denomination = clean(cells[idx.denomination])
      const yearRaw = toNumber(cells[idx.year])
      const year = yearRaw != null ? Math.trunc(yearRaw) : null
      const mint = clean(cells[idx.mint])
      const condition = mapCoinCondition(cells[idx.condition])
      const qtyRaw = toNumber(cells[idx.quantity])
      const qty = qtyRaw != null ? Math.max(1, Math.trunc(qtyRaw)) : 1
      const valueCents = toCents(cells[idx.value])
      const notes = clean(cells[idx.comment])
      const name = synthesizeCoinName(country, faceValue, denomination, year, mint)

      insert.run(
        collectionId, t, name,
        country, faceValue, denomination, mint, qty,
        year, condition,
        valueCents, notes
      )
      inserted += 1
      if (inserted % 500 === 0) {
        diagLog(`[import] coins progress: ${inserted} inserted at row ${rowNumber}`)
      }
    })
  })

  try {
    txn()
  } catch (err) {
    if (err instanceof ImportLimitError) {
      diagLog(`[import] coins aborted: ${err.message}`)
      return { inserted: 0, skipped: 0, warnings: [err.message] }
    }
    throw err
  }

  if (inserted === 0) {
    warnings.push('No data rows recognized. Make sure the first sheet has Country and/or Type columns populated.')
  }
  return { inserted, skipped, warnings }
}

// ─── Header detection helper ────────────────────────────────────

/**
 * Map a header row into a {column-name → ExcelJS-row-index} record.
 * `aliases[col]` is a list of header text variants (lowercased, trimmed)
 * that map to that column. `defaults` is the fallback 1-based index when
 * no header matches — keeps legacy spreadsheets without proper headers
 * working.
 */
function headerIndex<T extends string>(
  headerRow: unknown[],
  aliases: Record<T, string[]>,
  defaults: Record<T, number>
): Record<T, number> {
  const out = { ...defaults }
  for (let i = 1; i < headerRow.length; i += 1) {
    const cell = headerRow[i]
    if (cell == null) continue
    const normalized = String(cell).trim().toLowerCase()
    if (!normalized) continue
    for (const [col, names] of Object.entries(aliases) as [T, string[]][]) {
      if (names.includes(normalized)) {
        out[col] = i
        break
      }
    }
  }
  return out
}
