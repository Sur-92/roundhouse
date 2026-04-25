import { escapeHtml, on, typeLabel, fmtCents } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm, SCALE_OPTIONS, TYPE_OPTIONS, CONDITION_OPTIONS } from '../lib/forms'
import type { Item, ItemInput, ItemType, Scale, ItemFilter, TrainSet } from '@shared/types'

export async function renderItems(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <h2>Items</h2>
        <button class="btn primary" data-action="new">New item</button>
      </header>
      <div class="filters">
        <label class="field-inline">
          <span class="field-label">Search</span>
          <input id="f-search" type="search" placeholder="Name, manufacturer, model #…" />
        </label>
        <label class="field-inline">
          <span class="field-label">Type</span>
          <select id="f-type">
            <option value="">All</option>
            ${TYPE_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field-inline">
          <span class="field-label">Scale</span>
          <select id="f-scale">
            ${SCALE_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.value === '' ? 'All' : o.label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="list" id="list"></div>
    </section>
  `

  const list = el.querySelector<HTMLDivElement>('#list')!
  const fSearch = el.querySelector<HTMLInputElement>('#f-search')!
  const fType = el.querySelector<HTMLSelectElement>('#f-type')!
  const fScale = el.querySelector<HTMLSelectElement>('#f-scale')!

  const refresh = async (): Promise<void> => {
    const filter: ItemFilter = {}
    if (fSearch.value.trim()) filter.search = fSearch.value.trim()
    if (fType.value) filter.type = fType.value as ItemType
    if (fScale.value) filter.scale = fScale.value as Scale
    const items = await window.roundhouse.items.list(filter)
    if (!items.length) {
      list.innerHTML = `<p class="empty">No items match.</p>`
      return
    }
    list.innerHTML = items.map(renderItemCard).join('')
  }

  let searchTimer: number | undefined
  fSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => void refresh(), 200)
  })
  fType.addEventListener('change', () => void refresh())
  fScale.addEventListener('change', () => void refresh())

  el.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openItemDialog()) await refresh()
  })

  on<HTMLButtonElement>(list, '[data-action="delete"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const item = await window.roundhouse.items.get(id)
    if (!item) return
    const ok = await confirmDialog(
      `Delete "${item.name}"? All photos for this item will also be deleted.`,
      { title: 'Delete item?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.items.delete(id)
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

export async function openItemDialog(
  existing?: Item,
  defaults?: { setId?: number | null; scale?: Scale | null }
): Promise<boolean> {
  // Build set options grouped by collection.
  const collections = await window.roundhouse.collections.list()
  const allSets = await window.roundhouse.sets.list()
  const setsByCollection = new Map<number, TrainSet[]>()
  for (const s of allSets) {
    const arr = setsByCollection.get(s.collection_id) ?? []
    arr.push(s)
    setsByCollection.set(s.collection_id, arr)
  }

  const currentSetId = existing?.set_id ?? defaults?.setId ?? ''
  const setOptionsHtml = `
    <option value=""${currentSetId === '' || currentSetId == null ? ' selected' : ''}>— No set —</option>
    ${collections
      .map((c) => {
        const sets = setsByCollection.get(c.id) ?? []
        if (!sets.length) return ''
        return `<optgroup label="${escapeHtml(c.name)}">${sets
          .map(
            (s) =>
              `<option value="${s.id}"${Number(currentSetId) === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`
          )
          .join('')}</optgroup>`
      })
      .join('')}
  `

  const body = document.createElement('form')
  body.className = 'rh-form'
  body.innerHTML = `
    <div class="rh-form-grid">
      ${fieldHtml({ label: 'Name', name: 'name', value: existing?.name, required: true, span: 2 })}
      ${fieldHtml({ label: 'Type', name: 'type', type: 'select', value: existing?.type ?? 'locomotive', options: TYPE_OPTIONS, required: true })}
      <label class="field" for="f-set_id">
        <span class="field-label">Set</span>
        <select id="f-set_id" name="set_id">${setOptionsHtml}</select>
      </label>
      ${fieldHtml({ label: 'Manufacturer', name: 'manufacturer', value: existing?.manufacturer })}
      ${fieldHtml({ label: 'Model number', name: 'model_number', value: existing?.model_number })}
      ${fieldHtml({ label: 'Scale', name: 'scale', type: 'select', value: existing?.scale ?? defaults?.scale ?? '', options: SCALE_OPTIONS })}
      ${fieldHtml({ label: 'Road name', name: 'road_name', value: existing?.road_name, placeholder: 'e.g. Union Pacific' })}
      ${fieldHtml({ label: 'Era', name: 'era', value: existing?.era, placeholder: 'e.g. III' })}
      ${fieldHtml({ label: 'Year', name: 'year', type: 'number', value: existing?.year })}
      ${fieldHtml({ label: 'Condition', name: 'condition', type: 'select', value: existing?.condition, options: CONDITION_OPTIONS })}
      ${fieldHtml({ label: 'Original box', name: 'original_box', type: 'checkbox', value: existing?.original_box ? '1' : '' })}
      ${fieldHtml({ label: 'Purchase date', name: 'purchase_date', type: 'date', value: existing?.purchase_date })}
      ${fieldHtml({ label: 'Purchase price', name: 'purchase_price_cents', type: 'currency', value: existing?.purchase_price_cents != null ? (existing.purchase_price_cents / 100).toFixed(2) : '' })}
      ${fieldHtml({ label: 'Current value', name: 'current_value_cents', type: 'currency', value: existing?.current_value_cents != null ? (existing.current_value_cents / 100).toFixed(2) : '' })}
      ${fieldHtml({ label: 'Storage location', name: 'storage_location', value: existing?.storage_location, span: 2 })}
      ${fieldHtml({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, span: 2 })}
    </div>
  `

  return openDialog({
    title: existing ? 'Edit item' : 'New item',
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body, ['purchase_price_cents', 'current_value_cents'])
      const payload: ItemInput = {
        set_id: data['set_id'] != null ? Number(data['set_id']) : null,
        type: (data['type'] as ItemType) || 'other',
        name: String(data['name'] ?? ''),
        manufacturer: data['manufacturer'] as string | null,
        model_number: data['model_number'] as string | null,
        scale: (data['scale'] as Scale | null) ?? null,
        road_name: data['road_name'] as string | null,
        era: data['era'] as string | null,
        year: data['year'] != null ? Number(data['year']) : null,
        condition: (data['condition'] as ItemInput['condition']) ?? null,
        original_box: data['original_box'] === 1 ? 1 : data['original_box'] === 0 ? 0 : null,
        purchase_date: data['purchase_date'] as string | null,
        purchase_price_cents: data['purchase_price_cents'] as number | null,
        current_value_cents: data['current_value_cents'] as number | null,
        storage_location: data['storage_location'] as string | null,
        notes: data['notes'] as string | null
      }
      if (existing) await window.roundhouse.items.update(existing.id, payload)
      else await window.roundhouse.items.create(payload)
      return true
    }
  })
}
