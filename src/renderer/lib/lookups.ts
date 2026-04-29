import type { LookupKind, LookupRow } from '@shared/types'

/**
 * Renderer-side cache for the type / scale / condition lookup tables.
 *
 * Most rendering paths need a synchronous "value → label" mapping
 * (chips inside table rows, detail readouts, etc.) but the data lives
 * on the main process via IPC. This module fetches all three lookup
 * lists once on app start, caches them, and exposes synchronous getters.
 *
 * Settings page calls loadLookups({ force: true }) after a CRUD so all
 * subsequent renders see the new label.
 */

interface Cache {
  type: LookupRow[]
  scale: LookupRow[]
  condition: LookupRow[]
}

let cache: Cache | null = null
let loading: Promise<void> | null = null

export async function loadLookups(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && cache) return
  if (!opts.force && loading) {
    await loading
    return
  }
  loading = (async () => {
    const [type, scale, condition] = await Promise.all([
      window.roundhouse.lookups.list('type'),
      window.roundhouse.lookups.list('scale'),
      window.roundhouse.lookups.list('condition')
    ])
    cache = { type, scale, condition }
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

export function getLookups(kind: LookupKind): LookupRow[] {
  return cache?.[kind] ?? []
}

export function lookupLabel(kind: LookupKind, value: string | null | undefined): string {
  if (!value) return ''
  const rows = cache?.[kind] ?? []
  return rows.find((r) => r.value === value)?.label ?? value
}

/** Convert a lookup table to the {value,label} shape fieldHtml type=select expects. */
export function lookupOptions(
  kind: LookupKind,
  opts: { includeBlank?: boolean } = {}
): Array<{ value: string; label: string }> {
  const rows = cache?.[kind] ?? []
  const options = rows.map((r) => ({ value: r.value, label: r.label }))
  if (opts.includeBlank) return [{ value: '', label: '—' }, ...options]
  return options
}
