import { escapeHtml, on, typeLabel, fmtCents } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import { openItemDialog } from './items'
import type { Item } from '@shared/types'

export async function renderSetDetail(el: HTMLElement, params: Record<string, string>): Promise<void> {
  const id = Number(params['id'])
  const set = await window.roundhouse.sets.get(id)
  if (!set) {
    el.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No set with id ${id}.</p></section>`
    return
  }
  const collection = await window.roundhouse.collections.get(set.collection_id)

  el.innerHTML = `
    <nav class="breadcrumb">
      <a href="#/collections">Collections</a>
      <span class="sep">›</span>
      ${collection ? `<a href="#/collections/${collection.id}">${escapeHtml(collection.name)}</a><span class="sep">›</span>` : ''}
      <span>${escapeHtml(set.name)}</span>
    </nav>
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>${escapeHtml(set.name)}</h2>
          <p class="card-meta">
            ${set.scale ? `<span class="chip">${escapeHtml(set.scale)}</span>` : ''}
            ${set.manufacturer ? `<span>${escapeHtml(set.manufacturer)}</span>` : ''}
            ${set.era ? `<span>${escapeHtml(set.era)}</span>` : ''}
          </p>
          ${set.description ? `<p class="muted">${escapeHtml(set.description)}</p>` : ''}
        </div>
        <div class="head-actions">
          <button class="btn" data-action="edit-set">Edit set</button>
          <button class="btn primary" data-action="new-item">New item</button>
        </div>
      </header>
      <div class="list" id="item-list"></div>
    </section>
  `

  const list = el.querySelector<HTMLDivElement>('#item-list')!

  const refresh = async (): Promise<void> => {
    const items = await window.roundhouse.items.list({ setId: id })
    if (!items.length) {
      list.innerHTML = `<p class="empty">No items in this set yet.</p>`
      return
    }
    list.innerHTML = items.map(renderItemCard).join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="edit-set"]')!.addEventListener('click', async () => {
    if (await openSetDialog(set, set.collection_id)) {
      await renderSetDetail(el, params) // re-render
    }
  })

  el.querySelector<HTMLButtonElement>('[data-action="new-item"]')!.addEventListener('click', async () => {
    if (await openItemDialog(undefined, { setId: id, scale: set.scale })) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="delete"]', 'click', async (_e, btn) => {
    const itemId = Number(btn.dataset['id'])
    const item = await window.roundhouse.items.get(itemId)
    if (!item) return
    const ok = await confirmDialog(
      `Delete "${item.name}"? All photos for this item will also be deleted.`,
      { title: 'Delete item?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.items.delete(itemId)
      await refresh()
    }
  })

  await refresh()
}

function renderItemCard(item: Item): string {
  return `
    <article class="card card-link">
      <a class="card-body" href="#/items/${item.id}">
        <h3>${escapeHtml(item.name)}</h3>
        <p class="card-meta">
          <span class="chip chip-type">${escapeHtml(typeLabel(item.type))}</span>
          ${item.scale ? `<span class="chip">${escapeHtml(item.scale)}</span>` : ''}
          ${item.manufacturer ? `<span>${escapeHtml(item.manufacturer)}</span>` : ''}
          ${item.model_number ? `<span>#${escapeHtml(item.model_number)}</span>` : ''}
        </p>
        ${item.road_name ? `<p>${escapeHtml(item.road_name)}</p>` : ''}
        ${item.current_value_cents != null ? `<p class="card-meta">Value: ${fmtCents(item.current_value_cents)}</p>` : ''}
      </a>
      <div class="card-actions">
        <button class="icon-btn danger" data-action="delete" data-id="${item.id}" title="Delete">🗑</button>
      </div>
    </article>`
}
