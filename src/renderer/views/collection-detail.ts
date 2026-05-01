import { escapeHtml } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm, SCALE_OPTIONS } from '../lib/forms'
import { wireRowTable, setRowHtml, setTableHead } from '../lib/rows'
import type { TrainSet, TrainSetInput } from '@shared/types'

export async function renderCollectionDetail(el: HTMLElement, params: Record<string, string>): Promise<void> {
  const id = Number(params['id'])
  const collection = await window.roundhouse.collections.get(id)
  if (!collection) {
    el.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No collection with id ${id}.</p></section>`
    return
  }

  // Apply the navy theme when viewing a coin collection.
  document.body.classList.toggle('theme-coins', collection.kind === 'coins')

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
      <div class="table-wrap">
        <table class="rh-table" id="rows">
          ${setTableHead(false)}
          <tbody></tbody>
        </table>
      </div>
    </section>
  `

  const table = el.querySelector<HTMLTableElement>('#rows')!
  const tbody = table.querySelector('tbody')!

  const refresh = async (): Promise<void> => {
    const sets = await window.roundhouse.sets.list(id)
    if (!sets.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No sets in this collection yet.</td></tr>`
      return
    }
    const rows = await Promise.all(
      sets.map(async (s) => {
        const items = await window.roundhouse.items.list({ setId: s.id })
        return setRowHtml(s, { itemCount: items.length })
      })
    )
    tbody.innerHTML = rows.join('')
  }

  el.querySelector<HTMLButtonElement>('[data-action="new-set"]')!.addEventListener('click', async () => {
    if (await openSetDialog(undefined, id)) await refresh()
  })

  wireRowTable(table, {
    'edit-set': async (setId) => {
      const s = await window.roundhouse.sets.get(setId)
      if (s && (await openSetDialog(s, id))) await refresh()
    },
    'delete-set': async (setId) => {
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
    }
  })

  await refresh()
}

export async function openSetDialog(
  existing: TrainSet | undefined,
  collectionId: number,
  kind: 'trains' | 'coins' = 'trains'
): Promise<boolean> {
  const body = document.createElement('form')
  body.className = 'rh-form'

  if (kind === 'coins') {
    // Coin "Books" — just a name + description grouping, no scale/mfr.
    body.innerHTML = `
      <div class="rh-form-grid">
        ${fieldHtml({ label: 'Name', name: 'name', value: existing?.name, required: true, span: 2, placeholder: 'e.g. Lincoln Cents (Whitman)' })}
        ${fieldHtml({ label: 'Description', name: 'description', type: 'textarea', value: existing?.description, span: 2, placeholder: 'What is this book? (optional)' })}
        ${fieldHtml({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, span: 2 })}
      </div>
    `
  } else {
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
  }

  const noun = kind === 'coins' ? 'book' : 'set'

  return openDialog({
    title: existing ? `Edit ${noun}` : `New ${noun}`,
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body) as unknown as Partial<TrainSetInput>
      const payload: TrainSetInput = {
        collection_id: collectionId,
        name: (data.name as string | null) ?? '',
        description: (data.description ?? null) as string | null,
        scale: kind === 'coins' ? null : ((data.scale ?? null) as TrainSetInput['scale']),
        manufacturer: kind === 'coins' ? null : ((data.manufacturer ?? null) as string | null),
        era: kind === 'coins' ? null : ((data.era ?? null) as string | null),
        notes: (data.notes ?? null) as string | null
      }
      if (existing) await window.roundhouse.sets.update(existing.id, payload)
      else await window.roundhouse.sets.create(payload)
      return true
    }
  })
}
