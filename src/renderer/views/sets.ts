import { escapeHtml } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import { wireRowTable, setRowHtml, setTableHead } from '../lib/rows'
import type { Collection } from '@shared/types'

export async function renderSets(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div class="title-row">
          <h2>Trains</h2>
          <nav class="subnav" aria-label="Trains views">
            <a href="#/items" class="subnav-link" data-subnav="items">Items</a>
            <a href="#/sets" class="subnav-link active" data-subnav="sets">Sets</a>
          </nav>
        </div>
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
      <div class="table-wrap">
        <table class="rh-table" id="rows">
          ${setTableHead(true)}
          <tbody></tbody>
        </table>
      </div>
    </section>
  `

  const filterEl = el.querySelector<HTMLSelectElement>('#filter-collection')!
  const newBtn = el.querySelector<HTMLButtonElement>('[data-action="new"]')!
  const table = el.querySelector<HTMLTableElement>('#rows')!
  const tbody = table.querySelector('tbody')!

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

  wireRowTable(table, {
    'edit-set': async (id) => {
      const s = await window.roundhouse.sets.get(id)
      if (!s) return
      if (await openSetDialog(s, s.collection_id)) await refresh()
    },
    'delete-set': async (id) => {
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
    }
  })

  const refresh = async (): Promise<void> => {
    const cid = filterEl.value ? Number(filterEl.value) : undefined
    const sets = await window.roundhouse.sets.list(cid)
    if (!sets.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-row">${cid ? 'No sets in this collection yet.' : 'No sets yet.'}</td></tr>`
      return
    }
    const rows = await Promise.all(
      sets.map(async (s) => {
        const items = await window.roundhouse.items.list({ setId: s.id })
        return setRowHtml(s, { itemCount: items.length, collection: collectionsById.get(s.collection_id) })
      })
    )
    tbody.innerHTML = rows.join('')
  }

  updateNewBtn()
  await refresh()
}
