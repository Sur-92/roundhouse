import { escapeHtml } from '../lib/dom'
import { confirmDialog, openDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import { openItemDialog } from './items'
import { loadLookups } from '../lib/lookups'
import { wireRowTable, rowsForKind } from '../lib/rows'
import type { Item } from '@shared/types'

export async function renderSetDetail(el: HTMLElement, params: Record<string, string>): Promise<void> {
  const id = Number(params['id'])
  const set = await window.roundhouse.sets.get(id)
  if (!set) {
    el.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No set with id ${id}.</p></section>`
    return
  }
  const collection = await window.roundhouse.collections.get(set.collection_id)
  const kind = collection?.kind ?? 'trains'
  const noun = kind === 'coins' ? 'book' : 'set'

  // Apply the coins theme on coin-book detail pages too (router only
  // sets it for routes whose tab is '/coins'; this route's tab is
  // '/sets', so we have to re-toggle once we know the kind).
  document.body.classList.toggle('theme-coins', kind === 'coins')

  // Re-activate the correct top-nav tab. /sets/:id is registered with
  // tab='/sets' which doesn't exist in the top nav, so nothing gets
  // highlighted by default.
  const correctTab = kind === 'coins' ? '/coins' : '/trains'
  document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset['route'] === correctTab)
  })

  // Load lookups so the item rows render type/condition labels properly.
  await loadLookups()
  const tableShape = rowsForKind(kind, {
    removeFromSet: true,
    removeNoun: kind === 'coins' ? 'book' : 'set'
  })

  el.innerHTML = `
    <nav class="breadcrumb">
      ${kind === 'coins'
        ? '<a href="#/coins">Coins</a><span class="sep">›</span><a href="#/books">Books</a>'
        : '<a href="#/items">Trains</a><span class="sep">›</span><a href="#/sets">Sets</a>'
      }
      <span class="sep">›</span>
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
          <button class="btn" data-action="edit-set">Edit ${escapeHtml(noun)}</button>
          <button class="btn" data-action="add-existing">${escapeHtml(kind === 'coins' ? 'Add existing coins' : 'Add existing items')}</button>
          <button class="btn primary" data-action="new-item">${escapeHtml(kind === 'coins' ? 'New coin/bill' : 'New item')}</button>
        </div>
      </header>
      <div class="table-wrap">
        <table class="rh-table" id="rows">
          ${tableShape.head}
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
      tbody.innerHTML = `<tr><td colspan="${tableShape.colspan}" class="empty-row">No ${kind === 'coins' ? 'coins' : 'items'} in this ${noun} yet.</td></tr>`
      return
    }
    tbody.innerHTML = items.map(tableShape.row).join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="edit-set"]')!.addEventListener('click', async () => {
    if (await openSetDialog(set, set.collection_id, kind)) {
      await renderSetDetail(el, params)
    }
  })

  el.querySelector<HTMLButtonElement>('[data-action="new-item"]')!.addEventListener('click', async () => {
    if (await openItemDialog(kind, undefined, { setId: id, scale: set.scale, collectionId: set.collection_id })) await refresh()
  })

  el.querySelector<HTMLButtonElement>('[data-action="add-existing"]')!.addEventListener('click', async () => {
    const moved = await openAddExistingDialog(set.collection_id, id, set.name, kind)
    if (moved > 0) await refresh()
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
    },
    'remove-from-set': async (itemId) => {
      // Pull the item out of this set/book WITHOUT deleting it. The
      // item still exists in the collection — only set_id is cleared.
      await window.roundhouse.items.update(itemId, { set_id: null })
      await refresh()
    }
  })

  await refresh()
}

/**
 * Quick-add picker: shows every item in this collection as a checkbox
 * row (sorted by name) with a search filter at the top. Items already
 * in the target set are tagged and skipped. On submit, sets set_id on
 * each chosen item to the target set, and returns the count moved.
 */
async function openAddExistingDialog(
  collectionId: number,
  targetSetId: number,
  targetSetName: string,
  kind: 'trains' | 'coins'
): Promise<number> {
  const allItems = await window.roundhouse.items.list({ collectionId })
  // Already in this book → treat as ineligible (the user can pick
  // them, but the operation is a no-op so we tag them visually).
  const sorted = [...allItems].sort((a, b) => a.name.localeCompare(b.name))
  const noun = kind === 'coins' ? 'coin' : 'item'
  const Noun = kind === 'coins' ? 'Book' : 'Set'

  const body = document.createElement('div')
  body.className = 'rh-form'
  body.innerHTML = `
    <p class="muted small">Pick ${escapeHtml(noun)}s to add to <strong>${escapeHtml(targetSetName)}</strong>. Search filters the list as you type. ${kind === 'coins' ? 'Coins' : 'Items'} already in this ${escapeHtml(kind === 'coins' ? 'book' : 'set')} are dimmed.</p>
    <label class="field">
      <span class="field-label">Search</span>
      <input type="search" id="add-existing-search" placeholder="Filter by name, country, year, manufacturer…" />
    </label>
    <div class="add-existing-toolbar">
      <button type="button" class="btn small" data-action="check-all">Check all visible</button>
      <button type="button" class="btn small" data-action="check-none">Uncheck all</button>
      <span class="muted small" id="add-existing-count">0 selected</span>
    </div>
    <div class="add-existing-list" id="add-existing-list"></div>
  `

  const search = body.querySelector<HTMLInputElement>('#add-existing-search')!
  const list = body.querySelector<HTMLElement>('#add-existing-list')!
  const countEl = body.querySelector<HTMLElement>('#add-existing-count')!

  const itemSecondaryHtml = (it: Item): string => {
    if (kind === 'coins') {
      const bits: string[] = []
      if (it.country) bits.push(it.country)
      if (it.year != null) bits.push(String(it.year))
      if (it.denomination) bits.push(it.denomination)
      if (it.face_value != null) bits.push(`${it.face_value}`)
      return bits.join(' · ')
    }
    const bits: string[] = []
    if (it.manufacturer) bits.push(it.manufacturer)
    if (it.scale) bits.push(it.scale)
    if (it.model_number) bits.push(`#${it.model_number}`)
    return bits.join(' · ')
  }

  const renderRows = (filter: string): void => {
    const q = filter.trim().toLowerCase()
    const visible = sorted.filter((it) => {
      if (!q) return true
      const hay = [it.name, it.country, it.manufacturer, it.scale, it.model_number, it.denomination, it.year]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
    if (!visible.length) {
      list.innerHTML = `<p class="muted">No ${noun}s match.</p>`
      return
    }
    list.innerHTML = visible.map((it) => {
      const inThis = it.set_id === targetSetId
      const secondary = itemSecondaryHtml(it)
      return `
        <label class="add-existing-row${inThis ? ' is-already' : ''}">
          <input type="checkbox" data-id="${it.id}" ${inThis ? 'disabled' : ''} />
          <span class="add-existing-name">${escapeHtml(it.name)}</span>
          ${secondary ? `<span class="muted small">${escapeHtml(secondary)}</span>` : ''}
          ${inThis ? `<span class="chip small">already in this ${escapeHtml(kind === 'coins' ? 'book' : 'set')}</span>` : ''}
        </label>`
    }).join('')
  }

  const updateCount = (): void => {
    const n = body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]:checked').length
    countEl.textContent = `${n} selected`
  }

  search.addEventListener('input', () => {
    renderRows(search.value)
    updateCount()
  })
  list.addEventListener('change', updateCount)

  body.querySelector<HTMLButtonElement>('[data-action="check-all"]')!.addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]:not([disabled])').forEach((cb) => { cb.checked = true })
    updateCount()
  })
  body.querySelector<HTMLButtonElement>('[data-action="check-none"]')!.addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]').forEach((cb) => { cb.checked = false })
    updateCount()
  })

  renderRows('')

  let movedCount = 0

  await openDialog({
    title: `Add to ${Noun}: ${targetSetName}`,
    body,
    submitLabel: 'Add selected',
    onSubmit: async () => {
      const selected = Array.from(body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]:checked'))
        .map((cb) => Number(cb.dataset['id']))
        .filter((n) => Number.isFinite(n) && n > 0)
      if (!selected.length) return false // keep dialog open if nothing picked
      await Promise.all(selected.map((id) => window.roundhouse.items.update(id, { set_id: targetSetId })))
      movedCount = selected.length
      return true
    }
  })

  return movedCount
}
