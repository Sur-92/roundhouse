/**
 * Fractional number parsing + display for the coin Face value field
 * (issue #12 — Surface user wanted "1/2" and ".5" to both work, since
 * real coins have fractional face values: half dollar, quarter, dime).
 *
 * Parser accepts:
 *   - blank / null              → null
 *   - decimals: "0.5", ".5", "1.25"
 *   - whole numbers: "1", "25", "1000"
 *   - simple fractions: "1/2", "3/4", "1/100"
 *   - mixed: "1 1/2", "2 3/4"
 *   - unicode glyphs: "½", "¼", "¾", "⅓", "⅔", "⅛"…
 *   - mixed unicode: "1 ½", "2 ¾"
 *
 * Returns null for anything unparseable so the caller can flag invalid
 * input. (Don't throw — the calling form treats null as "rejected".)
 */

const VULGAR_FRACTION_VALUE: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅐': 1 / 7,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  '⅑': 1 / 9,
  '⅒': 0.1
}

export function parseFractional(input: unknown): number | null {
  if (input == null) return null
  const raw = String(input).trim()
  if (!raw) return null

  // Replace unicode vulgar fractions with their decimal value, preserving
  // any leading whole-number prefix (e.g. "1 ½" → "1 0.5", "1½" → "1 0.5").
  let s = raw
  for (const [glyph, val] of Object.entries(VULGAR_FRACTION_VALUE)) {
    if (s.includes(glyph)) {
      s = s.replace(new RegExp(glyph, 'g'), ` ${val}`)
    }
  }
  s = s.trim().replace(/\s+/g, ' ')

  // Mixed "W N/D" form, e.g. "1 1/2" → 1 + 1/2 = 1.5
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (mixed) {
    const whole = Number(mixed[1])
    const num = Number(mixed[2])
    const den = Number(mixed[3])
    if (den === 0) return null
    return whole + num / den
  }

  // Mixed "W <decimal>" form left over from the glyph substitution,
  // e.g. "1 0.5" → 1.5
  const mixedDec = /^(\d+)\s+(\d*\.?\d+)$/.exec(s)
  if (mixedDec) {
    return Number(mixedDec[1]) + Number(mixedDec[2])
  }

  // Plain "N/D"
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(s)
  if (frac) {
    const num = Number(frac[1])
    const den = Number(frac[2])
    if (den === 0) return null
    return num / den
  }

  // Plain decimal / integer
  if (/^-?\d*\.?\d+$/.test(s)) {
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  return null
}

/**
 * Pretty-display a face_value number. Common collector-friendly
 * fractions (½, ¼, ¾, ⅓, ⅔, eighths) get rendered with the glyph for
 * readability. Anything else falls back to a plain decimal.
 *
 * Threshold of 1e-4 because 1/3 ≈ 0.333… stored as 0.333 vs 0.3333.
 */
const COMMON_FRACTIONS: Array<[number, string]> = [
  [1 / 2,  '½'],
  [1 / 3,  '⅓'], [2 / 3,  '⅔'],
  [1 / 4,  '¼'], [3 / 4,  '¾'],
  [1 / 5,  '⅕'], [2 / 5,  '⅖'], [3 / 5,  '⅗'], [4 / 5,  '⅘'],
  [1 / 6,  '⅙'], [5 / 6,  '⅚'],
  [1 / 8,  '⅛'], [3 / 8,  '⅜'], [5 / 8,  '⅝'], [7 / 8,  '⅞'],
  [1 / 10, '⅒']
]
const EPS = 1e-4

export function formatFractional(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  if (n === 0) return '0'

  const whole = Math.floor(Math.abs(n))
  const frac = Math.abs(n) - whole
  const sign = n < 0 ? '-' : ''

  if (frac < EPS) return `${sign}${whole}`

  for (const [val, glyph] of COMMON_FRACTIONS) {
    if (Math.abs(frac - val) < EPS) {
      return whole === 0 ? `${sign}${glyph}` : `${sign}${whole} ${glyph}`
    }
  }

  // Not a "nice" fraction — fall back to a trimmed decimal.
  // Render up to 4 places, strip trailing zeros.
  const dec = Math.abs(n).toFixed(4).replace(/\.?0+$/, '')
  return `${sign}${dec}`
}
