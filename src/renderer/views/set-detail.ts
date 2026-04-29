import { escapeHtml } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import { openItemDialog } from './items'
import { wireRowTable, itemRowHtml, ITEM_TABLE_HEAD } from '../lib/rows'

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
      <div class="table-wrap">
        <table class="rh-table" id="rows">
          ${ITEM_TABLE_HEAD}
          <tbody></tbody>
        </table>
      </div>
    </section>
  `

  const table = el.querySelector<HTMLTableElement>('#rows')!
  const tbody = table.querySelector('tbody')!

  const refresh = async (): Promise<void> => {
    const items = await window.roundhouse.items.list({ setId: id })
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-row">No items in this set yet.</td></tr>`
      return
    }
    tbody.innerHTML = items.map(itemRowHtml).join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="edit-set"]')!.addEventListener('click', async () => {
    if (await openSetDialog(set, set.collection_id)) {
      await renderSetDetail(el, params)
    }
  })

  el.querySelector<HTMLButtonElement>('[data-action="new-item"]')!.addEventListener('click', async () => {
    if (await openItemDialog(undefined, { setId: id, scale: set.scale })) await refresh()
  })

  wireRowTable(table, {
    'delete-item': async (itemId) => {
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
    }
  })

  await refresh()
}
