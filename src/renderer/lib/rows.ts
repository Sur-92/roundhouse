import { escapeHtml, fmtCents, fmtDate, typeLabel } from './dom'
import type { Item, TrainSet, Collection } from '@shared/types'

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

export function itemRowHtml(item: Item): string {
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
        <button class="icon-btn danger" data-action="delete-item" data-id="${item.id}" title="Delete">🗑</button>
      </td>
    </tr>`
}

export const ITEM_TABLE_HEAD = `
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
