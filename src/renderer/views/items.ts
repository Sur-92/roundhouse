import { escapeHtml, fmtCents, fmtDate, typeLabel, conditionLabel } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import { loadLookups, lookupOptions, lookupLabel } from '../lib/lookups'
import { wireRowTable, itemRowHtml, ITEM_TABLE_HEAD } from '../lib/rows'
import { buildCsv } from '../lib/csv'
import type { Item, ItemInput, ItemType, Scale, ItemFilter, TrainSet } from '@shared/types'

export async function renderItems(el: HTMLElement): Promise<void> {
  await loadLookups()
  const typeOptions = lookupOptions('type')
  const scaleOptions = lookupOptions('scale', { includeBlank: false })

  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <h2>Items</h2>
        <div class="head-actions">
          <button class="btn" data-action="export-csv" title="Export current list to CSV">📊 Export CSV</button>
          <button class="btn" data-action="print" title="Print current list">🖨 Print</button>
          <button class="btn primary" data-action="new">New item</button>
        </div>
      </header>
      <div class="filters no-print">
        <label class="field-inline filter-search">
          <span class="field-label">
            Search
            <button type="button" class="help-dot" popovertarget="search-help" aria-label="Search syntax help">?</button>
          </span>
          <input id="f-search" type="search" placeholder="Name, manufacturer, model #…  (try mfg: for blank manufacturer)" />
        </label>
        <label class="field-inline">
          <span class="field-label">Type</span>
          <select id="f-type">
            <option value="">All</option>
            ${typeOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label class="field-inline">
          <span class="field-label">Scale</span>
          <select id="f-scale">
            <option value="">All</option>
            ${scaleOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <div class="filters-summary" id="summary"></div>
      </div>
      <header class="print-header" id="print-header"></header>

      <div id="search-help" popover="auto" class="help-popover">
        <header class="help-popover-head">
          <h3>Search tips</h3>
          <button type="button" class="icon-btn" popovertarget="search-help" popovertargetaction="hide" aria-label="Close">×</button>
        </header>
        <p class="help-popover-lede">Type words to search by name, manufacturer, model number, and notes. The patterns below let you go further.</p>

        <h4>Restrict to a field</h4>
        <ul class="help-list">
          <li><code>mfg:bachmann</code><span class="help-desc">manufacturer contains <em>bachmann</em></span></li>
          <li><code>scale:HO</code><span class="help-desc">only HO scale</span></li>
          <li><code>type:locomotive</code><span class="help-desc">only locomotives</span></li>
          <li><code>year:1985</code><span class="help-desc">items from 1985</span></li>
        </ul>

        <h4>Find items missing a value</h4>
        <ul class="help-list">
          <li><code>mfg:</code><span class="help-desc">manufacturer is blank</span></li>
          <li><code>year:</code><span class="help-desc">no year recorded</span></li>
          <li><code>scale:</code><span class="help-desc">no scale assigned</span></li>
        </ul>

        <h4>Exclude with a minus</h4>
        <ul class="help-list">
          <li><code>-bachmann</code><span class="help-desc">exclude items matching <em>bachmann</em></span></li>
          <li><code>-mfg:bachmann</code><span class="help-desc">exclude Bachmann manufacturer</span></li>
          <li><code>-mfg:</code><span class="help-desc">only items that have a manufacturer</span></li>
        </ul>

        <h4>Combine</h4>
        <ul class="help-list">
          <li><code>scale:HO -mfg:</code><span class="help-desc">HO items with no manufacturer</span></li>
          <li><code>"box car" -bachmann</code><span class="help-desc">phrase, excluding Bachmann</span></li>
        </ul>

        <h4>Available fields</h4>
        <p class="help-desc">name, mfg, model, scale, type, condition, source, road, era, year, notes</p>
      </div>

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
  const fSearch = el.querySelector<HTMLInputElement>('#f-search')!
  const fType = el.querySelector<HTMLSelectElement>('#f-type')!
  const fScale = el.querySelector<HTMLSelectElement>('#f-scale')!
  const summary = el.querySelector<HTMLDivElement>('#summary')!
  const printHeader = el.querySelector<HTMLElement>('#print-header')!

  // Cache the latest filter result so Print/Export operate on what's
  // currently displayed without a redundant DB round-trip.
  let lastItems: Item[] = []
  let lastFilterDescription = ''

  const buildFilter = (): ItemFilter => {
    const filter: ItemFilter = {}
    if (fSearch.value.trim()) filter.search = fSearch.value.trim()
    if (fType.value) filter.type = fType.value as ItemType
    if (fScale.value) filter.scale = fScale.value as Scale
    return filter
  }

  const describeFilter = (filter: ItemFilter): string => {
    const parts: string[] = []
    if (filter.search) parts.push(`search “${filter.search}”`)
    if (filter.type) parts.push(`type ${lookupLabel('type', filter.type) || filter.type}`)
    if (filter.scale) parts.push(`scale ${lookupLabel('scale', filter.scale) || filter.scale}`)
    return parts.length ? `Filtered by: ${parts.join(', ')}` : 'All items'
  }

  const refresh = async (): Promise<void> => {
    const filter = buildFilter()
    const items = await window.roundhouse.items.list(filter)
    lastItems = items
    lastFilterDescription = describeFilter(filter)

    const total = items.reduce((sum, i) => sum + (i.purchase_price_cents ?? 0), 0)
    const summaryText = items.length
      ? `${items.length} item${items.length === 1 ? '' : 's'} · ${fmtCents(total)} purchased`
      : '0 items'
    summary.textContent = summaryText

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    printHeader.innerHTML = `
      <h2>Roundhouse — Items</h2>
      <p class="print-meta">${escapeHtml(lastFilterDescription)} · ${escapeHtml(summaryText)} · printed ${escapeHtml(today)}</p>
    `

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No items match.</td></tr>`
      return
    }
    tbody.innerHTML = items.map(itemRowHtml).join('')
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

  el.querySelector<HTMLButtonElement>('[data-action="print"]')!.addEventListener('click', () => {
    void window.roundhouse.print.current()
  })

  el.querySelector<HTMLButtonElement>('[data-action="export-csv"]')!.addEventListener('click', async () => {
    const csv = buildItemsCsv(lastItems)
    const stamp = new Date().toISOString().slice(0, 10)
    const path = await window.roundhouse.files.saveCsv(`roundhouse-items-${stamp}.csv`, csv)
    if (path) console.log('Exported items CSV →', path)
  })

  wireRowTable(table, {
    'delete-item': async (id) => {
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
    }
  })

  await refresh()
}

function buildItemsCsv(items: Item[]): string {
  const header = [
    'Name', 'Type', 'Scale', 'Manufacturer', 'Model #', 'Road name', 'Era', 'Year',
    'Condition', 'Original box', 'Purchase date', 'Purchase price', 'Current value',
    'Source', 'Storage location', 'Notes'
  ]
  const rows = items.map((i) => [
    i.name,
    typeLabel(i.type),
    i.scale ?? '',
    i.manufacturer ?? '',
    i.model_number ?? '',
    i.road_name ?? '',
    i.era ?? '',
    i.year ?? '',
    i.condition ? conditionLabel(i.condition) : '',
    i.original_box == null ? '' : i.original_box ? 'Yes' : 'No',
    i.purchase_date ? fmtDate(i.purchase_date) : '',
    i.purchase_price_cents != null ? (i.purchase_price_cents / 100).toFixed(2) : '',
    i.current_value_cents != null ? (i.current_value_cents / 100).toFixed(2) : '',
    i.source ?? '',
    i.storage_location ?? '',
    i.notes ?? ''
  ])
  return buildCsv(header, rows)
}

export async function openItemDialog(
  existing?: Item,
  defaults?: { setId?: number | null; scale?: Scale | null }
): Promise<boolean> {
  await loadLookups()
  const typeOptions = lookupOptions('type')
  const scaleOptions = lookupOptions('scale', { includeBlank: true })
  const conditionOptions = lookupOptions('condition', { includeBlank: true })

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
      ${fieldHtml({ label: 'Type', name: 'type', type: 'select', value: existing?.type ?? typeOptions[0]?.value ?? '', options: typeOptions, required: true })}
      <label class="field" for="f-set_id">
        <span class="field-label">Set</span>
        <select id="f-set_id" name="set_id">${setOptionsHtml}</select>
      </label>
      ${fieldHtml({ label: 'Manufacturer', name: 'manufacturer', value: existing?.manufacturer })}
      ${fieldHtml({ label: 'Model number', name: 'model_number', value: existing?.model_number })}
      ${fieldHtml({ label: 'Scale', name: 'scale', type: 'select', value: existing?.scale ?? defaults?.scale ?? '', options: scaleOptions })}
      ${fieldHtml({ label: 'Road name', name: 'road_name', value: existing?.road_name, placeholder: 'e.g. Union Pacific' })}
      ${fieldHtml({ label: 'Era', name: 'era', value: existing?.era, placeholder: 'e.g. III' })}
      ${fieldHtml({ label: 'Year', name: 'year', type: 'number', value: existing?.year })}
      ${fieldHtml({ label: 'Condition', name: 'condition', type: 'select', value: existing?.condition, options: conditionOptions })}
      ${fieldHtml({ label: 'Original box', name: 'original_box', type: 'checkbox', value: existing?.original_box ? '1' : '' })}
      ${fieldHtml({ label: 'Purchase date', name: 'purchase_date', type: 'date', value: existing?.purchase_date })}
      ${fieldHtml({ label: 'Purchase price', name: 'purchase_price_cents', type: 'currency', value: existing?.purchase_price_cents != null ? (existing.purchase_price_cents / 100).toFixed(2) : '' })}
      ${fieldHtml({ label: 'Current value', name: 'current_value_cents', type: 'currency', value: existing?.current_value_cents != null ? (existing.current_value_cents / 100).toFixed(2) : '' })}
      ${fieldHtml({ label: 'Source', name: 'source', value: existing?.source, placeholder: 'e.g. eBay, Facebook, gift' })}
      ${fieldHtml({ label: 'Storage location', name: 'storage_location', value: existing?.storage_location })}
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
        source: data['source'] as string | null,
        notes: data['notes'] as string | null
      }
      if (existing) await window.roundhouse.items.update(existing.id, payload)
      else await window.roundhouse.items.create(payload)
      return true
    }
  })
}
