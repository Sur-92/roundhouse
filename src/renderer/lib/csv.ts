/** RFC 4180-style CSV cell + row helpers. */

export function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

/** Build a full CSV string from an array of rows, with a header. */
export function buildCsv(header: string[], rows: unknown[][]): string {
  const lines = [csvRow(header)]
  for (const r of rows) lines.push(csvRow(r))
  // CRLF line endings — what Excel expects on Windows.
  return lines.join('\r\n') + '\r\n'
}
