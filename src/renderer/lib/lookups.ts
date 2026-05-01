import type { CollectionKind, LookupKind, LookupRow } from '@shared/types'

/**
 * Renderer-side cache for the type / scale / condition lookup tables,
 * keyed by collection kind (trains | coins).
 *
 * Most rendering paths need a synchronous "value → label" mapping
 * (chips inside table rows, detail readouts, etc.) but the data lives
 * on the main process via IPC. This module fetches both kinds × all
 * three lookup lists once on app start, caches them, and exposes
 * synchronous getters.
 *
 * Settings page calls loadLookups({ force: true }) after a CRUD so all
 * subsequent renders see the new label.
 */

type LookupBundle = {
  type: LookupRow[]
  scale: LookupRow[]
  condition: LookupRow[]
}

interface Cache {
  trains: LookupBundle
  coins: LookupBundle
}

let cache: Cache | null = null
let loading: Promise<void> | null = null

async function loadOne(collectionKind: CollectionKind): Promise<LookupBundle> {
  const [type, scale, condition] = await Promise.all([
    window.roundhouse.lookups.list('type', collectionKind),
    window.roundhouse.lookups.list('scale', collectionKind),
    window.roundhouse.lookups.list('condition', collectionKind)
  ])
  return { type, scale, condition }
}

export async function loadLookups(opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && cache) return
  if (!opts.force && loading) {
    await loading
    return
  }
  loading = (async () => {
    const [trains, coins] = await Promise.all([loadOne('trains'), loadOne('coins')])
    cache = { trains, coins }
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

export function getLookups(collectionKind: CollectionKind, kind: LookupKind): LookupRow[] {
  return cache?.[collectionKind]?.[kind] ?? []
}

/** Look up a label by value, searching both kinds (useful when chip
 *  rendering doesn't know the item's collection kind directly). */
export function lookupLabel(kind: LookupKind, value: string | null | undefined): string {
  if (!value) return ''
  if (!cache) return value
  const all = [...cache.trains[kind], ...cache.coins[kind]]
  return all.find((r) => r.value === value)?.label ?? value
}

/** Look up a label scoped to a specific collection kind. */
export function lookupLabelForKind(
  collectionKind: CollectionKind,
  kind: LookupKind,
  value: string | null | undefined
): string {
  if (!value) return ''
  const rows = cache?.[collectionKind]?.[kind] ?? []
  return rows.find((r) => r.value === value)?.label ?? value
}

/** Convert a lookup table to the {value,label} shape fieldHtml type=select expects. */
export function lookupOptions(
  collectionKind: CollectionKind,
  kind: LookupKind,
  opts: { includeBlank?: boolean } = {}
): Array<{ value: string; label: string }> {
  const rows = cache?.[collectionKind]?.[kind] ?? []
  const options = rows.map((r) => ({ value: r.value, label: r.label }))
  if (opts.includeBlank) return [{ value: '', label: '—' }, ...options]
  return options
}
