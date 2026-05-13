import { escapeHtml, fmtCents, fmtDate, typeLabel, conditionLabel } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import { loadLookups, lookupOptions, lookupLabel } from '../lib/lookups'
import { openConditionHelp } from '../lib/condition-help'
import { wireRowTable, rowsForKind } from '../lib/rows'
import { buildCsv } from '../lib/csv'
import { parseFractional, formatFractional } from '../lib/fraction'
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
      ${kind === 'trains' ? trainsSearchHelpPopoverHtml() : coinsSearchHelpPopoverHtml()}
      <div class="filters no-print">
        <label class="field-inline filter-search">
          <span class="field-label">
            Search
            <button type="button" class="help-dot" popovertarget="search-help" aria-label="Search syntax help">?</button>
          </span>
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

  // Restore persisted filter values (issue #16) so the user doesn't
  // re-pick their working country every time they leave and come back
  // to /coins. Keys are kind-prefixed so trains and coins don't
  // collide. "All" / empty selections write nothing (remove the key).
  const typeKey = `${kind}.filter.type`
  const countryKey = 'coins.filter.country'

  const savedType = sessionStorage.getItem(typeKey)
  if (savedType) {
    // Only restore if the option still exists in the dropdown.
    if (Array.from(fType.options).some((o) => o.value === savedType)) {
      fType.value = savedType
    } else {
      sessionStorage.removeItem(typeKey)
    }
  }
  if (fCountry) {
    const savedCountry = sessionStorage.getItem(countryKey)
    if (savedCountry) {
      if (Array.from(fCountry.options).some((o) => o.value === savedCountry)) {
        fCountry.value = savedCountry
      } else {
        sessionStorage.removeItem(countryKey)
      }
    }
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
  fType.addEventListener('change', () => {
    if (fType.value) sessionStorage.setItem(typeKey, fType.value)
    else sessionStorage.removeItem(typeKey)
    void refresh()
  })
  fScale?.addEventListener('change', () => void refresh())
  fCountry?.addEventListener('change', () => {
    if (fCountry.value) sessionStorage.setItem(countryKey, fCountry.value)
    else sessionStorage.removeItem(countryKey)
    void refresh()
  })

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
        <label class="field" for="f-face_value">
          <span class="field-label">Face value</span>
          <input id="f-face_value" name="face_value" type="text" inputmode="decimal"
            value="${formatFractional(existing?.face_value ?? null) || (existing?.face_value ?? '')}"
            placeholder="e.g. 1, 25, 1/2, 0.5, ½" autocomplete="off" />
          <span class="field-hint muted small" data-face-value-error hidden></span>
        </label>
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

  // Face value (coins only) — live blur conversion. The user can type
  // "1/2" or "½" or ".5"; on blur we normalize to a decimal and show
  // an inline error if the value is unparseable.
  const fvInput = body.querySelector<HTMLInputElement>('#f-face_value')
  const fvError = body.querySelector<HTMLElement>('[data-face-value-error]')
  if (fvInput && fvError) {
    fvInput.addEventListener('blur', () => {
      const raw = fvInput.value.trim()
      if (!raw) {
        fvError.hidden = true
        fvError.textContent = ''
        return
      }
      const parsed = parseFractional(raw)
      if (parsed == null) {
        fvError.hidden = false
        fvError.textContent = `Couldn't read "${raw}" — try a decimal (0.5), fraction (1/2), or glyph (½).`
        return
      }
      fvError.hidden = true
      fvError.textContent = ''
      // Replace input with the canonical display form so the user sees
      // exactly what's about to be stored (and so re-blurs are no-ops).
      fvInput.value = formatFractional(parsed)
    })
  }

  return openDialog({
    title: existing ? `Edit ${kind === 'coins' ? 'coin/bill' : 'item'}` : `New ${kind === 'coins' ? 'coin/bill' : 'item'}`,
    body,
    submitLabel: existing ? 'Save changes' : 'Create',
    onSubmit: async () => {
      // Face value: parse text → number. Reject unparseable non-empty input.
      if (fvInput && fvInput.value.trim()) {
        const fvParsed = parseFractional(fvInput.value)
        if (fvParsed == null) {
          fvInput.focus()
          if (fvError) {
            fvError.hidden = false
            fvError.textContent = `Couldn't read "${fvInput.value.trim()}" — try a decimal, fraction, or glyph.`
          }
          return false
        }
      }
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
        face_value: parseFractional(data['face_value']),
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

// ─── Search syntax help popovers (kind-aware) ────────────────────
//
// Both popovers use the same #search-help id and the same .help-popover
// CSS class. Only one is rendered per page (kind-gated in the panel
// template above), so the id collision never happens at runtime. Field
// separator accepts both `:` and `=` since v0.5.5 (resolves #13).

function trainsSearchHelpPopoverHtml(): string {
  return `
    <div id="search-help" popover="auto" class="help-popover">
      <header class="help-popover-head">
        <h3>Search tips · Trains</h3>
        <button type="button" class="icon-btn" popovertarget="search-help" popovertargetaction="hide" aria-label="Close">×</button>
      </header>
      <p class="help-popover-lede">Type words to search by name, manufacturer, model number, road name, notes, and source. The patterns below let you go further. <strong>:</strong> and <strong>=</strong> both work as the field separator.</p>

      <h4>Restrict to a field</h4>
      <ul class="help-list">
        <li><code>mfg:bachmann</code><span class="help-desc">manufacturer contains <em>bachmann</em></span></li>
        <li><code>scale:HO</code><span class="help-desc">only HO scale</span></li>
        <li><code>type:locomotive</code><span class="help-desc">only locomotives</span></li>
        <li><code>road:union</code><span class="help-desc">road name contains <em>union</em></span></li>
        <li><code>year:1985</code><span class="help-desc">items from 1985</span></li>
        <li><code>source=eBay</code><span class="help-desc">items sourced from eBay</span></li>
      </ul>

      <h4>Find items missing a value</h4>
      <ul class="help-list">
        <li><code>mfg:</code><span class="help-desc">manufacturer is blank</span></li>
        <li><code>year:</code><span class="help-desc">no year recorded</span></li>
        <li><code>scale:</code><span class="help-desc">no scale assigned</span></li>
        <li><code>photos:</code><span class="help-desc">no photos uploaded</span></li>
        <li><code>-photos:</code><span class="help-desc">items that have at least one photo</span></li>
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
      <p class="help-desc">name, mfg, model, scale, type, condition, source, road, era, year, notes, storage, photos</p>
    </div>`
}

function coinsSearchHelpPopoverHtml(): string {
  return `
    <div id="search-help" popover="auto" class="help-popover">
      <header class="help-popover-head">
        <h3>Search tips · Coins</h3>
        <button type="button" class="icon-btn" popovertarget="search-help" popovertargetaction="hide" aria-label="Close">×</button>
      </header>
      <p class="help-popover-lede">Type words to search by name, country, denomination, mint mark, notes, and source. The patterns below let you go further. <strong>:</strong> and <strong>=</strong> both work as the field separator.</p>

      <h4>Restrict to a field</h4>
      <ul class="help-list">
        <li><code>country:USA</code><span class="help-desc">country contains <em>USA</em></span></li>
        <li><code>denomination:dollar</code><span class="help-desc">denomination contains <em>dollar</em></span></li>
        <li><code>mint:S</code><span class="help-desc">San Francisco mint mark</span></li>
        <li><code>year:1898</code><span class="help-desc">coins from 1898</span></li>
        <li><code>type:bill</code><span class="help-desc">only paper bills (vs coin)</span></li>
        <li><code>source=HeritCoin</code><span class="help-desc">items sourced from HeritCoin</span></li>
        <li><code>condition:proof</code><span class="help-desc">proof-grade coins</span></li>
      </ul>

      <h4>Find items missing a value</h4>
      <ul class="help-list">
        <li><code>country:</code><span class="help-desc">no country recorded</span></li>
        <li><code>year:</code><span class="help-desc">no year recorded</span></li>
        <li><code>mint:</code><span class="help-desc">no mint mark</span></li>
        <li><code>photos:</code><span class="help-desc">no photos uploaded</span></li>
        <li><code>-photos:</code><span class="help-desc">coins that have at least one photo</span></li>
      </ul>

      <h4>Exclude with a minus</h4>
      <ul class="help-list">
        <li><code>-morgan</code><span class="help-desc">exclude coins matching <em>morgan</em></span></li>
        <li><code>-country:USA</code><span class="help-desc">exclude US coins</span></li>
        <li><code>-condition:</code><span class="help-desc">only coins with a condition set</span></li>
      </ul>

      <h4>Combine</h4>
      <ul class="help-list">
        <li><code>country:USA year:1898</code><span class="help-desc">US coins from 1898</span></li>
        <li><code>"silver dollar" -morgan</code><span class="help-desc">silver dollars, excluding Morgan</span></li>
      </ul>

      <h4>Available fields</h4>
      <p class="help-desc">name, country, denomination, mint, year, qty, type, condition, source, notes, storage, photos</p>
    </div>`
}
