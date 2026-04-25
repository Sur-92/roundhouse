import { escapeHtml, on } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm, SCALE_OPTIONS } from '../lib/forms'
import { navigate } from '../router'
import type { TrainSet, TrainSetInput } from '@shared/types'

export async function renderCollectionDetail(el: HTMLElement, params: Record<string, string>): Promise<void> {
  const id = Number(params['id'])
  const collection = await window.roundhouse.collections.get(id)
  if (!collection) {
    el.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No collection with id ${id}.</p></section>`
    return
  }

  el.innerHTML = `
    <nav class="breadcrumb">
      <a href="#/collections">Collections</a>
      <span class="sep">›</span>
      <span>${escapeHtml(collection.name)}</span>
    </nav>
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>${escapeHtml(collection.name)}</h2>
          ${collection.description ? `<p class="muted">${escapeHtml(collection.description)}</p>` : ''}
        </div>
        <button class="btn primary" data-action="new-set">New set</button>
      </header>
      <div class="list" id="set-list"></div>
    </section>
  `

  const list = el.querySelector<HTMLDivElement>('#set-list')!

  const refresh = async (): Promise<void> => {
    const sets = await window.roundhouse.sets.list(id)
    if (!sets.length) {
      list.innerHTML = `<p class="empty">No sets in this collection yet.</p>`
      return
    }
    const cards = await Promise.all(
      sets.map(async (s) => {
        const items = await window.roundhouse.items.list({ setId: s.id })
        return `
          <article class="card card-link">
            <a class="card-body" href="#/sets/${s.id}">
              <h3>${escapeHtml(s.name)}</h3>
              <p class="card-meta">
                ${s.scale ? `<span class="chip">${escapeHtml(s.scale)}</span>` : ''}
                ${s.manufacturer ? `<span>${escapeHtml(s.manufacturer)}</span>` : ''}
                ${s.era ? `<span>${escapeHtml(s.era)}</span>` : ''}
              </p>
              ${s.description ? `<p>${escapeHtml(s.description)}</p>` : ''}
              <p class="card-meta">${items.length} item${items.length === 1 ? '' : 's'}</p>
            </a>
            <div class="card-actions">
              <button class="icon-btn" data-action="edit" data-id="${s.id}" title="Edit">✎</button>
              <button class="icon-btn danger" data-action="delete" data-id="${s.id}" title="Delete">🗑</button>
            </div>
          </article>`
      })
    )
    list.innerHTML = cards.join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="new-set"]')!.addEventListener('click', async () => {
    if (await openSetDialog(undefined, id)) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="edit"]', 'click', async (_e, btn) => {
    const setId = Number(btn.dataset['id'])
    const s = await window.roundhouse.sets.get(setId)
    if (s && (await openSetDialog(s, id))) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="delete"]', 'click', async (_e, btn) => {
    const setId = Number(btn.dataset['id'])
    const s = await window.roundhouse.sets.get(setId)
    if (!s) return
    const ok = await confirmDialog(
      `Delete "${s.name}"? Items in this set will be kept but un-assigned from the set.`,
      { title: 'Delete set?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.sets.delete(setId)
      await refresh()
    }
  })

  // Allow keyboard nav: pressing Enter on focused card → open
  void navigate
  await refresh()
}

export async function openSetDialog(existing: TrainSet | undefined, collectionId: number): Promise<boolean> {
  const body = document.createElement('form')
  body.className = 'rh-form'
  body.innerHTML = `
    <div class="rh-form-grid">
      ${fieldHtml({ label: 'Name', name: 'name', value: existing?.name, required: true, span: 2 })}
      ${fieldHtml({ label: 'Manufacturer', name: 'manufacturer', value: existing?.manufacturer })}
      ${fieldHtml({ label: 'Scale', name: 'scale', type: 'select', value: existing?.scale, options: SCALE_OPTIONS })}
      ${fieldHtml({ label: 'Era', name: 'era', value: existing?.era, placeholder: 'e.g. III, 1945–1970' })}
      ${fieldHtml({ label: 'Description', name: 'description', type: 'textarea', value: existing?.description, span: 2 })}
      ${fieldHtml({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, span: 2 })}
    </div>
  `

  return openDialog({
    title: existing ? 'Edit set' : 'New set',
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body) as unknown as Partial<TrainSetInput>
      const payload: TrainSetInput = {
        collection_id: collectionId,
        name: (data.name as string | null) ?? '',
        description: (data.description ?? null) as string | null,
        scale: (data.scale ?? null) as TrainSetInput['scale'],
        manufacturer: (data.manufacturer ?? null) as string | null,
        era: (data.era ?? null) as string | null,
        notes: (data.notes ?? null) as string | null
      }
      if (existing) await window.roundhouse.sets.update(existing.id, payload)
      else await window.roundhouse.sets.create(payload)
      return true
    }
  })
}
