import { escapeHtml } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openSetDialog } from './collection-detail'
import { wireRowTable, bookRowHtml, bookTableHead } from '../lib/rows'

/**
 * Coin "Books" — a Book is just a Set whose collection is the coins
 * collection. The schema (sets.collection_id, items.set_id) already
 * supports the relationship; this view re-skins it with coin-collector
 * terminology so users see "Books" everywhere instead of "Sets".
 *
 * The trains-side equivalent is `views/sets.ts` (kind-agnostic, lists
 * across all collections). This page is hard-scoped to the coin
 * collection so the user doesn't have to filter every visit.
 */
export async function renderBooks(el: HTMLElement): Promise<void> {
  const collection = await window.roundhouse.collections.getByKind('coins')
  if (!collection) {
    el.innerHTML = `
      <section class="panel">
        <h2>Coins</h2>
        <p class="muted">No coin collection found yet — restart Roundhouse and the migration runner will create one.</p>
      </section>`
    return
  }
  const collectionId = collection.id

  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div class="title-row">
          <h2>Coins</h2>
          <nav class="subnav" aria-label="Coins views">
            <a href="#/coins" class="subnav-link" data-coinview="">All</a>
            <a href="#/coins" class="subnav-link" data-coinview="mints">Mints</a>
            <a href="#/coins" class="subnav-link" data-coinview="proofs">Proofs</a>
            <a href="#/books" class="subnav-link active" data-coinview="books">Books</a>
          </nav>
        </div>
        <div class="head-actions">
          <button class="btn primary" data-action="new">New book</button>
        </div>
      </header>
      <p class="muted small">Books are groupings of coins (Whitman folders, Dansco albums, custom sets, etc.). Add a book here, then assign coins to it from the coin's edit dialog.</p>
      <div class="table-wrap">
        <table class="rh-table" id="rows">
          ${bookTableHead()}
          <tbody></tbody>
        </table>
      </div>
    </section>
  `

  // The sub-nav All/Mints/Proofs links route to /coins; persist the
  // view choice so /coins picks it up.
  el.querySelectorAll<HTMLAnchorElement>('[data-coinview]').forEach((link) => {
    link.addEventListener('click', () => {
      const view = link.dataset['coinview'] || ''
      sessionStorage.setItem('coins.view', view)
    })
  })

  const table = el.querySelector<HTMLTableElement>('#rows')!
  const tbody = table.querySelector('tbody')!

  el.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openSetDialog(undefined, collectionId, 'coins')) await refresh()
  })

  wireRowTable(table, {
    'edit-set': async (id) => {
      const s = await window.roundhouse.sets.get(id)
      if (!s) return
      if (await openSetDialog(s, s.collection_id, 'coins')) await refresh()
    },
    'delete-set': async (id) => {
      const s = await window.roundhouse.sets.get(id)
      if (!s) return
      const ok = await confirmDialog(
        `Delete book "${s.name}"? Coins in this book will be kept but un-assigned.`,
        { title: 'Delete book?', destructive: true }
      )
      if (ok) {
        await window.roundhouse.sets.delete(id)
        await refresh()
      }
    }
  })

  const refresh = async (): Promise<void> => {
    const sets = await window.roundhouse.sets.list(collectionId)
    if (!sets.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No books yet. Click "New book" to create one.</td></tr>`
      return
    }
    const rows = await Promise.all(
      sets.map(async (s) => {
        const items = await window.roundhouse.items.list({ setId: s.id })
        return bookRowHtml(s, { itemCount: items.length })
      })
    )
    tbody.innerHTML = rows.join('')
  }

  await refresh()
}
