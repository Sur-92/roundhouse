import { escapeHtml, fmtCents, fmtDate, typeLabel } from './dom'
import type { CollectionKind, Item, TrainSet, Collection } from '@shared/types'

/**
 * Wire up row navigation and per-row action delegation on a <table> element.
 * - Clicks on rows with [data-href] navigate, unless the click landed in
 *   a button or in [data-no-nav].
 * - Buttons with [data-action] are forwarded to the supplied handlers.
 */
export function wireRowTable(
  table: HTMLTableElement,
  handlers: Record<string, (id: number, btn: HTMLButtonElement) => void | Promise<void>>
): void {
  table.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    const btn = target.closest<HTMLButtonElement>('button[data-action]')
    if (btn && table.contains(btn)) {
      e.preventDefault()
      e.stopPropagation()
      const action = btn.dataset['action']
      const id = Number(btn.dataset['id'])
      const handler = action ? handlers[action] : undefined
      handler?.(id, btn)
      return
    }

    const row = target.closest<HTMLTableRowElement>('tr[data-href]')
    if (row && !target.closest('[data-no-nav]')) {
      const href = row.dataset['href']
      if (href) window.location.hash = href
    }
  })
}

// ─── Train items table ────────────────────────────────────

interface RowOpts {
  /** When true, include an extra "remove from set/book" action button
   *  before the delete button. Used in set-detail / book-detail so the
   *  user can pull an item out without erasing it from the collection. */
  removeFromSet?: boolean
  /** Singular noun for the "remove" tooltip. Default 'set'. */
  removeNoun?: string
}

function removeFromSetButtonHtml(item: Item, opts?: RowOpts): string {
  if (!opts?.removeFromSet) return ''
  const noun = opts.removeNoun ?? 'set'
  return `<button class="icon-btn" data-action="remove-from-set" data-id="${item.id}" title="Remove from ${escapeHtml(noun)} (does NOT delete the ${escapeHtml(noun === 'book' ? 'coin' : 'item')})">↩︎</button>`
}

export function trainItemRowHtml(item: Item, opts?: RowOpts): string {
  const thumb = item.primary_photo_path
    ? `<img class="row-thumb" src="${window.roundhouse.photos.url(item.primary_photo_path)}" alt="" loading="lazy" />`
    : `<span class="row-thumb-empty" title="No photo">📷</span>`
  return `
    <tr data-href="/items/${item.id}">
      <td class="col-thumb" data-no-nav>${thumb}</td>
      <td class="col-name">${escapeHtml(item.name)}</td>
      <td><span class="chip chip-type">${escapeHtml(typeLabel(item.type))}</span></td>
      <td class="col-center">${item.scale ? `<span class="chip">${escapeHtml(item.scale)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${item.manufacturer ? escapeHtml(item.manufacturer) : '<span class="muted">—</span>'}</td>
      <td class="col-mono">${item.model_number ? escapeHtml(item.model_number) : '<span class="muted">—</span>'}</td>
      <td class="col-date">${item.purchase_date ? fmtDate(item.purchase_date) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${item.purchase_price_cents != null ? fmtCents(item.purchase_price_cents) : '<span class="muted">—</span>'}</td>
      <td class="col-actions" data-no-nav>
        ${removeFromSetButtonHtml(item, opts)}
        <button class="icon-btn danger" data-action="delete-item" data-id="${item.id}" title="Delete">🗑</button>
      </td>
    </tr>`
}

export const TRAIN_ITEM_TABLE_HEAD = `
  <thead>
    <tr>
      <th class="col-thumb"></th>
      <th class="col-name">Name</th>
      <th>Type</th>
      <th class="col-center">Scale</th>
      <th>Manufacturer</th>
      <th>Model #</th>
      <th class="col-date">Purchased</th>
      <th class="col-num">Price</th>
      <th class="col-actions"></th>
    </tr>
  </thead>`

// ─── Coin items table ─────────────────────────────────────

export function coinItemRowHtml(item: Item, opts?: RowOpts): string {
  const thumb = item.primary_photo_path
    ? `<img class="row-thumb" src="${window.roundhouse.photos.url(item.primary_photo_path)}" alt="" loading="lazy" />`
    : `<span class="row-thumb-empty" title="No photo">🪙</span>`
  const totalCents = item.current_value_cents != null ? item.current_value_cents * (item.quantity || 1) : null
  const faceDisplay = item.face_value != null
    ? `${item.face_value}${item.denomination ? ' ' + escapeHtml(item.denomination) : ''}`
    : (item.denomination ? escapeHtml(item.denomination) : '')
  return `
    <tr data-href="/items/${item.id}">
      <td class="col-thumb" data-no-nav>${thumb}</td>
      <td class="col-name">${escapeHtml(item.name)}</td>
      <td><span class="chip chip-type">${escapeHtml(typeLabel(item.type))}</span></td>
      <td>${item.country ? escapeHtml(item.country) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${item.year != null ? String(item.year) : '<span class="muted">—</span>'}</td>
      <td>${faceDisplay || '<span class="muted">—</span>'}</td>
      <td class="col-mono">${item.mint_mark ? escapeHtml(item.mint_mark) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${item.quantity || 1}</td>
      <td class="col-num">${item.current_value_cents != null ? fmtCents(item.current_value_cents) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${totalCents != null ? fmtCents(totalCents) : '<span class="muted">—</span>'}</td>
      <td class="col-actions" data-no-nav>
        ${removeFromSetButtonHtml(item, opts)}
        <button class="icon-btn danger" data-action="delete-item" data-id="${item.id}" title="Delete">🗑</button>
      </td>
    </tr>`
}

export const COIN_ITEM_TABLE_HEAD = `
  <thead>
    <tr>
      <th class="col-thumb"></th>
      <th class="col-name">Name</th>
      <th>Type</th>
      <th>Country</th>
      <th class="col-num">Year</th>
      <th>Denomination</th>
      <th>Mint</th>
      <th class="col-num">Qty</th>
      <th class="col-num">Value</th>
      <th class="col-num">Total</th>
      <th class="col-actions"></th>
    </tr>
  </thead>`

// Backwards-compat exports (existing callers): default to train layout
export const itemRowHtml = trainItemRowHtml
export const ITEM_TABLE_HEAD = TRAIN_ITEM_TABLE_HEAD

/** Pick the right row-renderer + table-head pair for a collection kind. */
export function rowsForKind(
  kind: CollectionKind,
  rowOpts?: RowOpts
): {
  head: string
  row: (item: Item) => string
  colspan: number
} {
  if (kind === 'coins') {
    return { head: COIN_ITEM_TABLE_HEAD, row: (item) => coinItemRowHtml(item, rowOpts), colspan: 11 }
  }
  return { head: TRAIN_ITEM_TABLE_HEAD, row: (item) => trainItemRowHtml(item, rowOpts), colspan: 9 }
}

export function setRowHtml(s: TrainSet, opts: { itemCount: number; collection?: Collection }): string {
  return `
    <tr data-href="/sets/${s.id}">
      <td class="col-name">${escapeHtml(s.name)}</td>
      ${opts.collection !== undefined ? `<td>${opts.collection ? escapeHtml(opts.collection.name) : '<span class="muted">—</span>'}</td>` : ''}
      <td class="col-center">${s.scale ? `<span class="chip">${escapeHtml(s.scale)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${s.manufacturer ? escapeHtml(s.manufacturer) : '<span class="muted">—</span>'}</td>
      <td>${s.era ? escapeHtml(s.era) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${opts.itemCount}</td>
      <td class="col-actions" data-no-nav>
        <button class="icon-btn" data-action="edit-set" data-id="${s.id}" title="Edit">✎</button>
        <button class="icon-btn danger" data-action="delete-set" data-id="${s.id}" title="Delete">🗑</button>
      </td>
    </tr>`
}

export function setTableHead(showCollection: boolean): string {
  return `
    <thead>
      <tr>
        <th class="col-name">Name</th>
        ${showCollection ? '<th>Collection</th>' : ''}
        <th class="col-center">Scale</th>
        <th>Manufacturer</th>
        <th>Era</th>
        <th class="col-num">Items</th>
        <th class="col-actions"></th>
      </tr>
    </thead>`
}

/** Coin-Books variant: the train-shaped Scale/Mfr/Era columns are
 *  irrelevant, so books use Name / Description / Items / Actions. */
export function bookRowHtml(s: TrainSet, opts: { itemCount: number }): string {
  return `
    <tr data-href="/sets/${s.id}">
      <td class="col-name">${escapeHtml(s.name)}</td>
      <td>${s.description ? escapeHtml(s.description) : '<span class="muted">—</span>'}</td>
      <td class="col-num">${opts.itemCount}</td>
      <td class="col-actions" data-no-nav>
        <button class="icon-btn" data-action="edit-set" data-id="${s.id}" title="Edit">✎</button>
        <button class="icon-btn danger" data-action="delete-set" data-id="${s.id}" title="Delete">🗑</button>
      </td>
    </tr>`
}

export function bookTableHead(): string {
  return `
    <thead>
      <tr>
        <th class="col-name">Name</th>
        <th>Description</th>
        <th class="col-num">Coins</th>
        <th class="col-actions"></th>
      </tr>
    </thead>`
}
