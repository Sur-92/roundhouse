import { escapeHtml, fmtCents, fmtDate, typeLabel, conditionLabel } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import { loadLookups, lookupOptions, lookupLabel } from '../lib/lookups'
import { openConditionHelp } from '../lib/condition-help'
import { wireRowTable, rowsForKind } from '../lib/rows'
import { buildCsv } from '../lib/csv'
import type { CollectionKind, Item, ItemInput, ItemType, Scale, ItemFilter, TrainSet } from '@shared/types'

/**
 * Kind-aware items list view.
 *
 * Routes:
 *   /trains → renderItemsForKind(el, 'trains')
 *   /coins  → renderItemsForKind(el, 'coins')
 *
 * The list columns, filter bar, item-create form, and CSV export all
 * adapt to the collection kind. Each kind has its own collection (one
 * for trains, one for coins) which is set up by the migration runner.
 */
export async function renderItemsForKind(el: HTMLElement, kind: CollectionKind): Promise<void> {
  await loadLookups()

  // Resolve the collection id for this kind (one per kind).
  const collection = await window.roundhouse.collections.getByKind(kind)
  const collectionId = collection?.id ?? null

  const typeOptions = lookupOptions(kind, 'type')
  const scaleOptions = kind === 'trains' ? lookupOptions(kind, 'scale') : []
  const tableShape = rowsForKind(kind)
  const title = kind === 'trains' ? 'Trains' : 'Coins'
  const newLabel = kind === 'trains' ? 'New item' : 'New coin/bill'

  // Coin list adds a Country filter; trains list adds a Scale filter.
  const extraFilter = kind === 'coins'
    ? `
      <label class="field-inline">
        <span class="field-label">Country</span>
        <select id="f-country">
          <option value="">All</option>
        </select>
      </label>`
    : `
      <label class="field-inline">
        <span class="field-label">Scale</span>
        <select id="f-scale">
          <option value="">All</option>
          ${scaleOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </label>`

  // Sub-nav, kind-specific.
  //   Trains: Items / Sets — Sets is the grouped-by-set view.
  //   Coins:  All / Mints / Proofs / Books — All/Mints/Proofs are
  //           in-page filters over the coin list; Books navigates to
  //           the /books page (coin sets, re-skinned as Books).
  type CoinView = '' | 'mints' | 'proofs'
  let coinView: CoinView = (() => {
    const v = sessionStorage.getItem('coins.view') ?? ''
    return v === 'mints' || v === 'proofs' ? v : ''
  })()

  const coinSubNavHtml = (): string => `
    <nav class="subnav" aria-label="Coins views">
      <a href="#" class="subnav-link ${coinView === '' ? 'active' : ''}" data-coinview="">All</a>
      <a href="#" class="subnav-link ${coinView === 'mints' ? 'active' : ''}" data-coinview="mints">Mints</a>
      <a href="#" class="subnav-link ${coinView === 'proofs' ? 'active' : ''}" data-coinview="proofs">Proofs</a>
      <a href="#/books" class="subnav-link" data-coinview="books">Books</a>
    </nav>`

  const subNav = kind === 'trains'
    ? `
      <nav class="subnav" aria-label="Trains views">
        <a href="#/items" class="subnav-link active" data-subnav="items">Items</a>
        <a href="#/sets" class="subnav-link" data-subnav="sets">Sets</a>
      </nav>`
    : coinSubNavHtml()

  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div class="title-row">
          <h2>${escapeHtml(title)}</h2>
          ${subNav}
        </div>
        <div class="head-actions">
          <button class="btn" data-action="import-xlsx" title="Import items from an Excel spreadsheet">📥 Import Excel</button>
          <button class="btn" data-action="export-csv" title="Export current list to CSV">📊 Export CSV</button>
          <button class="btn" data-action="print" title="Print current list">🖨 Print</button>
          <button class="btn primary" data-action="new">${escapeHtml(newLabel)}</button>
        </div>
      </header>
      <div class="filters no-print">
        <label class="field-inline filter-search">
          <span class="field-label">Search</span>
          <input id="f-search" type="search" placeholder="Search this collection…" />
        </label>
        <label class="field-inline">
          <span class="field-label">Type</span>
          <select id="f-type">
            <option value="">All</option>
            ${typeOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        ${extraFilter}
        <div class="filters-summary" id="summary"></div>
      </div>
      <header class="print-header" id="print-header"></header>
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
  const fSearch = el.querySelector<HTMLInputElement>('#f-search')!
  const fType = el.querySelector<HTMLSelectElement>('#f-type')!
  const fScale = el.querySelector<HTMLSelectElement>('#f-scale')
  const fCountry = el.querySelector<HTMLSelectElement>('#f-country')
  const summary = el.querySelector<HTMLDivElement>('#summary')!
  const printHeader = el.querySelector<HTMLElement>('#print-header')!

  // Pre-fill search if Home routed us here with a saved query.
  const seeded = sessionStorage.getItem('items.search')
  if (seeded) {
    fSearch.value = seeded
    sessionStorage.removeItem('items.search')
  }

  // Populate the country filter from distinct country values in this
  // collection. (Coins only.)
  if (fCountry && collectionId != null) {
    const items = await window.roundhouse.items.list({ collectionId, collectionKind: kind })
    const countries = Array.from(
      new Set(items.map((i) => i.country).filter((c): c is string => !!c && c.length > 0))
    ).sort()
    fCountry.innerHTML += countries
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('')
  }

  let lastItems: Item[] = []
  let lastFilterDescription = ''

  const buildFilter = (): ItemFilter => {
    const filter: ItemFilter = { collectionKind: kind }
    if (collectionId != null) filter.collectionId = collectionId
    if (fSearch.value.trim()) filter.search = fSearch.value.trim()
    if (fType.value) filter.type = fType.value as ItemType
    if (fScale && fScale.value) filter.scale = fScale.value as Scale
    if (fCountry && fCountry.value) filter.country = fCountry.value
    return filter
  }

  const describeFilter = (filter: ItemFilter): string => {
    const parts: string[] = []
    if (filter.search) parts.push(`search “${filter.search}”`)
    if (filter.type) parts.push(`type ${lookupLabel('type', filter.type) || filter.type}`)
    if (filter.scale) parts.push(`scale ${lookupLabel('scale', filter.scale) || filter.scale}`)
    if (filter.country) parts.push(`country ${filter.country}`)
    return parts.length ? `Filtered by: ${parts.join(', ')}` : `All ${title.toLowerCase()}`
  }

  const applyCoinView = (rows: Item[]): Item[] => {
    if (kind !== 'coins' || !coinView) return rows
    if (coinView === 'mints') return rows.filter((i) => i.mint_mark != null && i.mint_mark.trim() !== '')
    if (coinView === 'proofs') return rows.filter((i) => (i.condition || '').toLowerCase() === 'proof')
    return rows
  }

  const refresh = async (): Promise<void> => {
    const filter = buildFilter()
    const fetched = await window.roundhouse.items.list(filter)
    const items = applyCoinView(fetched)
    lastItems = items
    lastFilterDescription = describeFilter(filter) + (coinView ? ` · view: ${coinView}` : '')

    const totalCents = items.reduce(
      (sum, i) => sum + (i.purchase_price_cents ?? 0),
      0
    )
    const valueCents = items.reduce(
      (sum, i) => sum + ((i.current_value_cents ?? 0) * (i.quantity || 1)),
      0
    )
    const summaryText = items.length
      ? kind === 'coins'
        ? `${items.length.toLocaleString()} record${items.length === 1 ? '' : 's'} · ${fmtCents(valueCents)} current value`
        : `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'} · ${fmtCents(totalCents)} purchased`
      : `0 ${kind === 'coins' ? 'records' : 'items'}`
    summary.textContent = summaryText

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    printHeader.innerHTML = `
      <h2>Roundhouse — ${escapeHtml(title)}</h2>
      <p class="print-meta">${escapeHtml(lastFilterDescription)} · ${escapeHtml(summaryText)} · printed ${escapeHtml(today)}</p>
    `

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="${tableShape.colspan}" class="empty-row">No items match.</td></tr>`
      return
    }
    tbody.innerHTML = items.map(tableShape.row).join('')
  }

  let searchTimer: number | undefined
  fSearch.addEventListener('input', () => {
    window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => void refresh(), 200)
  })
  fType.addEventListener('change', () => void refresh())
  fScale?.addEventListener('change', () => void refresh())
  fCountry?.addEventListener('change', () => void refresh())

  // Coins sub-nav (All / Mints / Proofs / Books). All/Mints/Proofs are
  // in-page filters; Books navigates away to /books and is left alone
  // here so the default link nav fires.
  if (kind === 'coins') {
    el.querySelectorAll<HTMLAnchorElement>('[data-coinview]').forEach((link) => {
      const view = link.dataset['coinview'] || ''
      if (view === 'books') return // real navigation, don't intercept
      link.addEventListener('click', (e) => {
        e.preventDefault()
        const next = view as CoinView
        if (next === coinView) return
        coinView = next
        sessionStorage.setItem('coins.view', coinView)
        // Re-render active state without a full re-route.
        el.querySelectorAll<HTMLElement>('[data-coinview]').forEach((a) => {
          if (a.dataset['coinview'] === 'books') return
          a.classList.toggle('active', a.dataset['coinview'] === coinView)
        })
        void refresh()
      })
    })
  }

  el.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openItemDialog(kind, undefined, { collectionId })) await refresh()
  })

  el.querySelector<HTMLButtonElement>('[data-action="print"]')!.addEventListener('click', () => {
    void window.roundhouse.print.current()
  })

  el.querySelector<HTMLButtonElement>('[data-action="export-csv"]')!.addEventListener('click', async () => {
    const csv = kind === 'coins' ? buildCoinsCsv(lastItems) : buildTrainsCsv(lastItems)
    const stamp = new Date().toISOString().slice(0, 10)
    let path: string | null = null
    try {
      path = await window.roundhouse.files.saveCsv(`roundhouse-${kind}-${stamp}.csv`, csv)
    } catch (err) {
      await openDialog({
        title: 'CSV export failed',
        body: `<p class="dialog-message">${escapeHtml(String(err))}</p><p class="dialog-message muted small">If this keeps happening, try saving to a different folder (e.g. your Documents directory).</p>`,
        submitLabel: 'OK',
        cancelLabel: 'Close'
      })
      return
    }
    if (!path) return // user canceled
    const ok = await openDialog({
      title: 'CSV exported',
      body: `<p class="dialog-message">Saved <strong>${lastItems.length.toLocaleString()}</strong> ${kind === 'coins' ? 'records' : 'items'} to:</p><p class="dialog-message muted small" style="word-break:break-all">${escapeHtml(path)}</p>`,
      submitLabel: 'Show in folder',
      cancelLabel: 'Done'
    })
    if (ok) await window.roundhouse.files.showInFolder(path)
  })

  el.querySelector<HTMLButtonElement>('[data-action="import-xlsx"]')!.addEventListener('click', async () => {
    const expectedHeaders = kind === 'coins'
      ? 'Type · Country · Currency · Denomination · Year · Mint · Condition · Quantity · Value · Comment'
      : 'Scale · Mfg · Number · Item · Source · Purchased · Price · Color · Notes'
    const ok = await openDialog({
      title: `Import ${kind} from Excel`,
      body: `
        <p class="dialog-message">Pick an .xlsx file. The first worksheet should have these columns (any order, header names are auto-detected):</p>
        <p class="dialog-message"><strong>${escapeHtml(expectedHeaders)}</strong></p>
        <p class="dialog-message muted">Rows with no item name (or for coins, no Type/Country) are skipped. Existing items in this collection are <em>not</em> replaced — new rows are appended.</p>
      `,
      submitLabel: 'Pick file…',
      cancelLabel: 'Cancel'
    })
    if (!ok) return

    try {
      const result = await window.roundhouse.import.fromXlsx(kind)
      if (result.canceled) return
      const lines: string[] = [`Inserted ${result.inserted.toLocaleString()} ${kind === 'coins' ? 'coin/bill records' : 'items'}.`]
      if (result.skipped > 0) lines.push(`Skipped ${result.skipped.toLocaleString()} blank rows.`)
      if (result.warnings.length) lines.push('', ...result.warnings)
      await openDialog({
        title: 'Import complete',
        body: `<p class="dialog-message">${lines.map((l) => escapeHtml(l)).join('<br>')}</p>`,
        submitLabel: 'OK',
        cancelLabel: 'Close'
      })
      await refresh()
    } catch (err) {
      await openDialog({
        title: 'Import failed',
        body: `<p class="dialog-message">${escapeHtml(String(err))}</p>`,
        submitLabel: 'OK',
        cancelLabel: 'Close'
      })
    }
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

// Backwards-compat alias for older routes that called renderItems(el).
export async function renderItems(el: HTMLElement): Promise<void> {
  return renderItemsForKind(el, 'trains')
}

function buildTrainsCsv(items: Item[]): string {
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

function buildCoinsCsv(items: Item[]): string {
  const header = [
    'Name', 'Type', 'Country', 'Year', 'Face value', 'Denomination', 'Mint', 'Condition',
    'Quantity', 'Value (each)', 'Total value', 'Purchase date', 'Purchase price',
    'Source', 'Storage location', 'Notes'
  ]
  const rows = items.map((i) => {
    const qty = i.quantity || 1
    const total = i.current_value_cents != null ? (i.current_value_cents * qty / 100).toFixed(2) : ''
    return [
      i.name,
      typeLabel(i.type),
      i.country ?? '',
      i.year ?? '',
      i.face_value ?? '',
      i.denomination ?? '',
      i.mint_mark ?? '',
      i.condition ? conditionLabel(i.condition) : '',
      qty,
      i.current_value_cents != null ? (i.current_value_cents / 100).toFixed(2) : '',
      total,
      i.purchase_date ? fmtDate(i.purchase_date) : '',
      i.purchase_price_cents != null ? (i.purchase_price_cents / 100).toFixed(2) : '',
      i.source ?? '',
      i.storage_location ?? '',
      i.notes ?? ''
    ]
  })
  return buildCsv(header, rows)
}

// ─── Item dialog (kind-aware) ──────────────────────────────────

export async function openItemDialog(
  kind: CollectionKind,
  existing?: Item,
  defaults?: { setId?: number | null; scale?: Scale | null; collectionId?: number | null }
): Promise<boolean> {
  await loadLookups()
  const typeOptions = lookupOptions(kind, 'type')
  const scaleOptions = kind === 'trains' ? lookupOptions(kind, 'scale', { includeBlank: true }) : []
  const conditionOptions = lookupOptions(kind, 'condition', { includeBlank: true })

  const collectionId = existing?.collection_id ?? defaults?.collectionId ?? null

  const body = document.createElement('form')
  body.className = 'rh-form'

  const conditionField = `
    <label class="field" for="f-condition">
      <span class="field-label">
        Condition
        <button type="button" class="help-dot" data-action="condition-help" aria-label="Condition grading help">?</button>
      </span>
      <select id="f-condition" name="condition">
        ${conditionOptions.map((o) => `<option value="${escapeHtml(o.value)}"${o.value === (existing?.condition ?? '') ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    </label>`

  const sharedTail = `
    ${conditionField}
    ${fieldHtml({ label: 'Purchase date', name: 'purchase_date', type: 'date', value: existing?.purchase_date })}
    ${fieldHtml({ label: 'Purchase price', name: 'purchase_price_cents', type: 'currency', value: existing?.purchase_price_cents != null ? (existing.purchase_price_cents / 100).toFixed(2) : '' })}
    ${fieldHtml({ label: 'Current value', name: 'current_value_cents', type: 'currency', value: existing?.current_value_cents != null ? (existing.current_value_cents / 100).toFixed(2) : '' })}
    ${fieldHtml({ label: 'Source', name: 'source', value: existing?.source, placeholder: 'e.g. eBay, Facebook, gift' })}
    ${fieldHtml({ label: 'Storage location', name: 'storage_location', value: existing?.storage_location })}
    ${fieldHtml({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, span: 2 })}`

  if (kind === 'coins') {
    // Coin "books" — sets in the coin collection. Optional: items can
    // belong to no book.
    const coinCollection = await window.roundhouse.collections.getByKind('coins')
    const coinBooks = coinCollection ? await window.roundhouse.sets.list(coinCollection.id) : []
    const currentSetId = existing?.set_id ?? defaults?.setId ?? ''
    const bookOptionsHtml = `
      <option value=""${currentSetId === '' || currentSetId == null ? ' selected' : ''}>— No book —</option>
      ${coinBooks
        .map((s) => `<option value="${s.id}"${Number(currentSetId) === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
        .join('')}
    `

    body.innerHTML = `
      <div class="rh-form-grid">
        ${fieldHtml({ label: 'Name', name: 'name', value: existing?.name, required: true, span: 2, placeholder: 'e.g. 1898 Morgan Silver Dollar' })}
        ${fieldHtml({ label: 'Type', name: 'type', type: 'select', value: existing?.type ?? typeOptions[0]?.value ?? 'coin', options: typeOptions, required: true })}
        <label class="field" for="f-set_id">
          <span class="field-label">Book</span>
          <select id="f-set_id" name="set_id">${bookOptionsHtml}</select>
        </label>
        ${fieldHtml({ label: 'Country', name: 'country', value: existing?.country, placeholder: 'e.g. USA, Canada, UK' })}
        ${fieldHtml({ label: 'Face value', name: 'face_value', type: 'number', value: existing?.face_value ?? '', placeholder: 'e.g. 1, 25, 1000' })}
        ${fieldHtml({ label: 'Denomination', name: 'denomination', value: existing?.denomination, placeholder: 'e.g. Dollar, Pesos, Yuan' })}
        ${fieldHtml({ label: 'Year', name: 'year', type: 'number', value: existing?.year })}
        ${fieldHtml({ label: 'Mint mark', name: 'mint_mark', value: existing?.mint_mark, placeholder: 'e.g. P, D, S, W' })}
        ${fieldHtml({ label: 'Quantity', name: 'quantity', type: 'number', value: existing?.quantity ?? 1, required: true })}
        ${sharedTail}
      </div>
    `
  } else {
    // Trains form (the original)
    const allSets = await window.roundhouse.sets.list()
    const setsByCollection = new Map<number, TrainSet[]>()
    for (const s of allSets) {
      const arr = setsByCollection.get(s.collection_id) ?? []
      arr.push(s)
      setsByCollection.set(s.collection_id, arr)
    }
    const trainCollections = await window.roundhouse.collections.list('trains')
    const currentSetId = existing?.set_id ?? defaults?.setId ?? ''
    const setOptionsHtml = `
      <option value=""${currentSetId === '' || currentSetId == null ? ' selected' : ''}>— No set —</option>
      ${trainCollections
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
        ${conditionField}
        ${fieldHtml({ label: 'Original box', name: 'original_box', type: 'checkbox', value: existing?.original_box ? '1' : '' })}
        ${fieldHtml({ label: 'Purchase date', name: 'purchase_date', type: 'date', value: existing?.purchase_date })}
        ${fieldHtml({ label: 'Purchase price', name: 'purchase_price_cents', type: 'currency', value: existing?.purchase_price_cents != null ? (existing.purchase_price_cents / 100).toFixed(2) : '' })}
        ${fieldHtml({ label: 'Current value', name: 'current_value_cents', type: 'currency', value: existing?.current_value_cents != null ? (existing.current_value_cents / 100).toFixed(2) : '' })}
        ${fieldHtml({ label: 'Source', name: 'source', value: existing?.source, placeholder: 'e.g. eBay, Facebook, gift' })}
        ${fieldHtml({ label: 'Storage location', name: 'storage_location', value: existing?.storage_location })}
        ${fieldHtml({ label: 'Notes', name: 'notes', type: 'textarea', value: existing?.notes, span: 2 })}
      </div>
    `
  }

  body.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action="condition-help"]')
    if (target) {
      e.preventDefault()
      openConditionHelp(kind)
    }
  })

  return openDialog({
    title: existing ? `Edit ${kind === 'coins' ? 'coin/bill' : 'item'}` : `New ${kind === 'coins' ? 'coin/bill' : 'item'}`,
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body, ['purchase_price_cents', 'current_value_cents'])

      const payload: ItemInput = {
        set_id: data['set_id'] != null ? Number(data['set_id']) : null,
        collection_id: collectionId,
        type: (data['type'] as ItemType) || (kind === 'coins' ? 'coin' : 'other'),
        name: String(data['name'] ?? ''),
        manufacturer: (data['manufacturer'] as string | null) ?? null,
        model_number: (data['model_number'] as string | null) ?? null,
        scale: (data['scale'] as Scale | null) ?? null,
        road_name: (data['road_name'] as string | null) ?? null,
        era: (data['era'] as string | null) ?? null,
        country: (data['country'] as string | null) ?? null,
        face_value: data['face_value'] != null ? Number(data['face_value']) : null,
        denomination: (data['denomination'] as string | null) ?? null,
        mint_mark: (data['mint_mark'] as string | null) ?? null,
        quantity: data['quantity'] != null ? Math.max(1, Number(data['quantity'])) : 1,
        year: data['year'] != null ? Number(data['year']) : null,
        condition: (data['condition'] as ItemInput['condition']) ?? null,
        original_box: data['original_box'] === 1 ? 1 : data['original_box'] === 0 ? 0 : null,
        purchase_date: (data['purchase_date'] as string | null) ?? null,
        purchase_price_cents: (data['purchase_price_cents'] as number | null) ?? null,
        current_value_cents: (data['current_value_cents'] as number | null) ?? null,
        storage_location: (data['storage_location'] as string | null) ?? null,
        source: (data['source'] as string | null) ?? null,
        notes: (data['notes'] as string | null) ?? null
      }
      if (existing) await window.roundhouse.items.update(existing.id, payload)
      else await window.roundhouse.items.create(payload)
      return true
    }
  })
}
