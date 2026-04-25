import { escapeHtml, on } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import type { Collection, CollectionInput } from '@shared/types'

export async function renderCollections(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <h2>Collections</h2>
        <button class="btn primary" data-action="new">New collection</button>
      </header>
      <div class="list" id="list"></div>
    </section>
  `

  const list = el.querySelector<HTMLDivElement>('#list')!

  const refresh = async (): Promise<void> => {
    const all = await window.roundhouse.collections.list()
    if (!all.length) {
      list.innerHTML = `<p class="empty">No collections yet. Create your first one to get started.</p>`
      return
    }

    const cards = await Promise.all(
      all.map(async (c) => {
        const sets = await window.roundhouse.sets.list(c.id)
        return `
          <article class="card card-link" data-id="${c.id}">
            <a class="card-body" href="#/collections/${c.id}">
              <h3>${escapeHtml(c.name)}</h3>
              ${c.description ? `<p>${escapeHtml(c.description)}</p>` : '<p class="muted">No description</p>'}
              <p class="card-meta">${sets.length} set${sets.length === 1 ? '' : 's'}</p>
            </a>
            <div class="card-actions">
              <button class="icon-btn" data-action="edit" data-id="${c.id}" title="Edit">✎</button>
              <button class="icon-btn danger" data-action="delete" data-id="${c.id}" title="Delete">🗑</button>
            </div>
          </article>`
      })
    )
    list.innerHTML = cards.join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openCollectionDialog()) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="edit"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const c = await window.roundhouse.collections.get(id)
    if (c && (await openCollectionDialog(c))) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="delete"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const c = await window.roundhouse.collections.get(id)
    if (!c) return
    const ok = await confirmDialog(
      `Delete "${c.name}"? All sets in this collection will also be deleted, but their items will be kept and unassigned.`,
      { title: 'Delete collection?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.collections.delete(id)
      await refresh()
    }
  })

  await refresh()
}

async function openCollectionDialog(existing?: Collection): Promise<boolean> {
  const body = document.createElement('form')
  body.className = 'rh-form'
  body.innerHTML = `
    <div class="rh-form-grid">
      ${fieldHtml({ label: 'Name', name: 'name', value: existing?.name, required: true, span: 2 })}
      ${fieldHtml({ label: 'Description', name: 'description', type: 'textarea', value: existing?.description, span: 2 })}
    </div>
  `

  return openDialog({
    title: existing ? 'Edit collection' : 'New collection',
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body) as unknown as CollectionInput
      if (existing) await window.roundhouse.collections.update(existing.id, data)
      else await window.roundhouse.collections.create(data)
      return true
    }
  })
}
