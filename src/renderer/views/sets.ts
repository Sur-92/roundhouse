import { escapeHtml, on } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import type { Collection, TrainSet } from '@shared/types'

export async function renderSets(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <h2>Sets</h2>
        <div class="filters">
          <label class="field-inline">
            <span class="field-label">Collection</span>
            <select id="filter-collection">
              <option value="">All</option>
            </select>
          </label>
          <button class="btn primary" data-action="new" disabled title="Pick a collection above">New set</button>
        </div>
      </header>
      <div class="list" id="list"></div>
    </section>
  `

  const filterEl = el.querySelector<HTMLSelectElement>('#filter-collection')!
  const newBtn = el.querySelector<HTMLButtonElement>('[data-action="new"]')!
  const list = el.querySelector<HTMLDivElement>('#list')!

  const collections = await window.roundhouse.collections.list()
  const collectionsById = new Map<number, Collection>()
  for (const c of collections) collectionsById.set(c.id, c)
  filterEl.innerHTML += collections.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')

  const updateNewBtn = (): void => {
    const cid = Number(filterEl.value)
    newBtn.disabled = !cid
    newBtn.title = cid ? '' : 'Pick a collection above'
  }

  filterEl.addEventListener('change', () => {
    updateNewBtn()
    void refresh()
  })

  newBtn.addEventListener('click', async () => {
    const cid = Number(filterEl.value)
    if (!cid) return
    if (await openSetDialog(undefined, cid)) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="edit"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const s = await window.roundhouse.sets.get(id)
    if (!s) return
    if (await openSetDialog(s, s.collection_id)) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="delete"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const s = await window.roundhouse.sets.get(id)
    if (!s) return
    const ok = await confirmDialog(
      `Delete "${s.name}"? Items in this set will be kept but un-assigned from the set.`,
      { title: 'Delete set?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.sets.delete(id)
      await refresh()
    }
  })

  const refresh = async (): Promise<void> => {
    const cid = filterEl.value ? Number(filterEl.value) : undefined
    const sets = await window.roundhouse.sets.list(cid)
    if (!sets.length) {
      list.innerHTML = `<p class="empty">${cid ? 'No sets in this collection yet.' : 'No sets yet.'}</p>`
      return
    }
    list.innerHTML = (await Promise.all(sets.map((s) => renderSetCard(s, collectionsById)))).join('')
  }

  updateNewBtn()
  await refresh()
}

async function renderSetCard(s: TrainSet, collectionsById: Map<number, Collection>): Promise<string> {
  const items = await window.roundhouse.items.list({ setId: s.id })
  const collection = collectionsById.get(s.collection_id)
  return `
    <article class="card card-link">
      <a class="card-body" href="#/sets/${s.id}">
        <h3>${escapeHtml(s.name)}</h3>
        <p class="card-meta">
          ${collection ? `<span>${escapeHtml(collection.name)}</span>` : ''}
          ${s.scale ? `<span class="chip">${escapeHtml(s.scale)}</span>` : ''}
          ${s.manufacturer ? `<span>${escapeHtml(s.manufacturer)}</span>` : ''}
        </p>
        ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
        <p class="card-meta">${items.length} item${items.length === 1 ? '' : 's'}</p>
      </a>
      <div class="card-actions">
        <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit">✎</button>
        <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete">🗑</button>
      </div>
    </article>`
}
