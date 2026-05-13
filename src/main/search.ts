/**
 * Tiny smart-search parser for the Items list filter.
 *
 * Grammar (informal):
 *   query   = term (WS term)*
 *   term    = ['-'] (field-token | bare-token)
 *   field-token = field ':' value      → restrict to that column
 *               | field ':'             → column is blank/null
 *   bare-token  = quoted | unquoted    → fuzzy match across name+mfg+model+notes
 *   quoted      = '"' ... '"'           → preserves spaces
 *
 * Examples:
 *   bachmann              → fuzzy match
 *   mfg:bachmann          → manufacturer contains 'bachmann'
 *   mfg:                  → manufacturer is blank
 *   -mfg:                 → manufacturer is set
 *   "box car"             → fuzzy match the phrase 'box car'
 *   scale:HO -mfg:        → HO scale items missing a manufacturer
 */

const FIELD_ALIAS: Record<string, string> = {
  // Trains
  mfg: 'manufacturer',
  manufacturer: 'manufacturer',
  model: 'model_number',
  model_number: 'model_number',
  road: 'road_name',
  road_name: 'road_name',
  scale: 'scale',
  era: 'era',
  // Coins
  country: 'country',
  denomination: 'denomination',
  denom: 'denomination',
  mint: 'mint_mark',
  mint_mark: 'mint_mark',
  qty: 'quantity',
  quantity: 'quantity',
  // Shared
  name: 'name',
  type: 'type',
  condition: 'condition',
  source: 'source',
  year: 'year',
  notes: 'notes',
  storage: 'storage_location',
  storage_location: 'storage_location',
  // Pseudo-fields handled specially (see buildSearchClauses).
  photos: '__photos__'
}

// The fuzzy bare-search hits all of these. Columns that are always
// NULL on one kind (manufacturer on coins, country on trains) just
// no-op — LIKE against NULL is unknown, never matches. SQL injection
// is impossible here because we never interpolate user input — column
// names are hard-coded and values flow through prepared-statement
// bindings.
const FUZZY_COLUMNS = [
  'name',
  'manufacturer', 'model_number', 'road_name',
  'country', 'denomination', 'mint_mark',
  'notes', 'source'
] as const

interface ParsedToken {
  negate: boolean
  /** When undefined this is a fuzzy match across FUZZY_COLUMNS. */
  field?: string
  /** When undefined we're checking whether the column is blank. */
  value?: string
}

function tokenize(input: string): string[] {
  const out: string[] = []
  let buf = ''
  let inQuote = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (c === '"') {
      inQuote = !inQuote
      continue
    }
    if (!inQuote && /\s/.test(c)) {
      if (buf) { out.push(buf); buf = '' }
      continue
    }
    buf += c
  }
  if (buf) out.push(buf)
  return out
}

function parseToken(raw: string): ParsedToken | null {
  if (!raw) return null
  let s = raw
  let negate = false
  if (s.startsWith('-')) {
    negate = true
    s = s.slice(1)
  }
  if (!s) return null

  // Accept either : or = as the field separator — the Surface user
  // habitually types `source=HeritCoin` which is a natural mental model
  // (assignment syntax). Whichever appears earlier wins, so `key:val=ish`
  // still parses as field=`key`, value=`val=ish`.
  const colon = s.indexOf(':')
  const equal = s.indexOf('=')
  const sep = colon === -1 ? equal : (equal === -1 ? colon : Math.min(colon, equal))
  if (sep === -1) {
    return { negate, value: s }
  }
  const fieldRaw = s.slice(0, sep).trim().toLowerCase()
  const value = s.slice(sep + 1)
  const field = FIELD_ALIAS[fieldRaw]
  if (!field) {
    // Unknown field — fall back to a fuzzy match on the whole token so
    // typos like 'mfgr:bachmann' still find something rather than silently
    // returning nothing.
    return { negate, value: s }
  }
  return { negate, field, value: value || undefined }
}

export interface SearchFragment {
  /** SQL clause to AND into the WHERE. */
  sql: string
  params: unknown[]
}

export function buildSearchClauses(query: string): SearchFragment[] {
  const out: SearchFragment[] = []
  const tokens = tokenize(query).map(parseToken).filter((t): t is ParsedToken => !!t)

  for (const tok of tokens) {
    // Pseudo-field 'photos' — exists check on item_photos table.
    if (tok.field === '__photos__') {
      const has = 'EXISTS (SELECT 1 FROM item_photos WHERE item_id = i.id)'
      const lacks = 'NOT EXISTS (SELECT 1 FROM item_photos WHERE item_id = i.id)'
      if (tok.value === undefined) {
        out.push({ sql: tok.negate ? has : lacks, params: [] })
      } else {
        // photos:something is meaningless — fall back to "has photos".
        out.push({ sql: tok.negate ? lacks : has, params: [] })
      }
      continue
    }

    if (tok.field === undefined) {
      // Fuzzy across multiple columns. Each column gets its own LIKE.
      const likes = FUZZY_COLUMNS.map((c) => `${c} LIKE ?`).join(' OR ')
      const params = FUZZY_COLUMNS.map(() => `%${tok.value}%`)
      out.push({
        sql: tok.negate ? `NOT (${likes})` : `(${likes})`,
        params
      })
      continue
    }

    // Field-scoped: empty test or substring test.
    if (tok.value === undefined) {
      // field is blank
      const blank = `(${tok.field} IS NULL OR ${tok.field} = '')`
      const notBlank = `(${tok.field} IS NOT NULL AND ${tok.field} <> '')`
      out.push({ sql: tok.negate ? notBlank : blank, params: [] })
      continue
    }

    // field contains substring (case-insensitive thanks to SQLite's
    // default LIKE behavior on ASCII).
    const like = `${tok.field} LIKE ?`
    const notLike = `(${tok.field} IS NULL OR ${tok.field} NOT LIKE ?)`
    out.push({
      sql: tok.negate ? notLike : like,
      params: [`%${tok.value}%`]
    })
  }

  return out
}
