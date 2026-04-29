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
  mfg: 'manufacturer',
  manufacturer: 'manufacturer',
  model: 'model_number',
  model_number: 'model_number',
  road: 'road_name',
  road_name: 'road_name',
  name: 'name',
  type: 'type',
  scale: 'scale',
  condition: 'condition',
  source: 'source',
  era: 'era',
  year: 'year',
  notes: 'notes',
  // Pseudo-fields handled specially (see buildSearchClauses).
  photos: '__photos__'
}

// The fuzzy bare-search hits all of these. SQL injection is impossible
// here because we never interpolate user input — all column names below
// are hard-coded and values flow through prepared-statement bindings.
const FUZZY_COLUMNS = ['name', 'manufacturer', 'model_number', 'notes'] as const

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

  const colon = s.indexOf(':')
  if (colon === -1) {
    return { negate, value: s }
  }
  const fieldRaw = s.slice(0, colon).trim().toLowerCase()
  const value = s.slice(colon + 1)
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
