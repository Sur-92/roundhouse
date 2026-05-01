import { escapeHtml, on } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import { loadLookups } from '../lib/lookups'
import type { CollectionKind, LookupKind, LookupRow, LookupInput } from '@shared/types'

interface SectionConfig {
  kind: LookupKind
  title: string
  description: string
  valueHint?: string
  /** When set, omit this section for collection kinds in this list. */
  hideForKinds?: CollectionKind[]
}

const SECTIONS: SectionConfig[] = [
  {
    kind: 'type',
    title: 'Item types',
    description: 'Categories shown in the Type dropdown when you create or edit an item. Drag rows by their grip handle (⠿) to reorder.',
    valueHint: 'A short identifier (e.g. passenger_car). Cannot contain spaces; we recommend snake_case.'
  },
  {
    kind: 'scale',
    title: 'Scales',
    description: 'Model scales — HO, N, O, etc. Add specialty scales like ON30 or 1/64 here. Drag to reorder.',
    valueHint: 'The scale name as you want it stored (e.g. ON30).',
    hideForKinds: ['coins']  // Coins don't have scales.
  },
  {
    kind: 'condition',
    title: 'Conditions',
    description: 'Condition labels for items. Trains use the TCA grading scale; coins use the Sheldon scale. Drag to reorder.',
    valueHint: 'A short identifier (e.g. mint, restoration_project).'
  }
]

const KIND_TABS: Array<{ kind: CollectionKind; label: string }> = [
  { kind: 'trains', label: 'Trains' },
  { kind: 'coins', label: 'Coins' }
]

/** Sticky-ish "currently editing this kind" — defaults to trains, persists in sessionStorage so navigating away and back keeps you on the same tab. */
function activeKind(): CollectionKind {
  const k = sessionStorage.getItem('settings.kind')
  return k === 'coins' ? 'coins' : 'trains'
}
function setActiveKind(k: CollectionKind): void {
  sessionStorage.setItem('settings.kind', k)
}

export async function renderSettings(el: HTMLElement): Promise<void> {
  const kind = activeKind()

  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Settings</h2>
          <p class="muted">Customize the dropdown options that appear when you create or edit items. Drag rows by the grip (⠿) to reorder.</p>
        </div>
      </header>

      <nav class="kind-tabs" id="kind-tabs">
        ${KIND_TABS.map((t) => `
          <button class="kind-tab ${t.kind === kind ? 'active' : ''}" data-kind="${t.kind}">${escapeHtml(t.label)}</button>
        `).join('')}
      </nav>

      <div class="settings-sections" id="sections"></div>
    </section>
  `

  el.querySelector<HTMLElement>('#kind-tabs')!.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.kind-tab')
    if (!btn) return
    const newKind = (btn.dataset['kind'] as CollectionKind) || 'trains'
    if (newKind === kind) return
    setActiveKind(newKind)
    void renderSettings(el)
  })

  const host = el.querySelector<HTMLDivElement>('#sections')!
  const sections = SECTIONS.filter((s) => !s.hideForKinds?.includes(kind))
  host.innerHTML = sections.map((s) => sectionShellHtml(s, kind)).join('')

  for (const section of sections) {
    void hydrateSection(section, kind, host)
  }
}

function sectionShellHtml(s: SectionConfig, kind: CollectionKind): string {
  return `
    <section class="settings-section" data-kind="${s.kind}">
      <header class="settings-section-head">
        <div>
          <h3>${escapeHtml(s.title)}</h3>
          <p class="muted small">${escapeHtml(s.description)}</p>
        </div>
        <button class="btn primary" data-action="new">New ${escapeHtml(s.kind)}</button>
      </header>
      <div class="settings-list" data-list data-collection-kind="${kind}">
        <p class="muted">Loading…</p>
      </div>
    </section>`
}

async function hydrateSection(s: SectionConfig, collectionKind: CollectionKind, host: HTMLElement): Promise<void> {
  const sectionEl = host.querySelector<HTMLElement>(`.settings-section[data-kind="${s.kind}"]`)!
  const listEl = sectionEl.querySelector<HTMLElement>('[data-list]')!
  let cachedRows: LookupRow[] = []

  const refresh = async (): Promise<void> => {
    cachedRows = await window.roundhouse.lookups.list(s.kind, collectionKind)
    if (!cachedRows.length) {
      listEl.innerHTML = `<p class="empty">None yet.</p>`
      return
    }
    listEl.innerHTML = cachedRows.map((row) => lookupRowHtml(row)).join('')
  }

  sectionEl.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openLookupDialog(s, collectionKind, undefined)) await refresh()
  })

  on<HTMLButtonElement>(listEl, '[data-action="edit"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const row = cachedRows.find((r) => r.id === id)
    if (row && (await openLookupDialog(s, collectionKind, row))) await refresh()
  })

  on<HTMLButtonElement>(listEl, '[data-action="delete"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const row = cachedRows.find((r) => r.id === id)
    if (!row) return
    if (row.is_system) {
      await openDialog({
        title: 'Built-in cannot be deleted',
        body: `<p class="dialog-message">"${escapeHtml(row.label)}" is a built-in ${s.kind} and can't be removed. You can rename its label, but the underlying value stays the same so existing items don't break.</p>`,
        submitLabel: 'OK',
        cancelLabel: 'Close'
      })
      return
    }
    const ok = await confirmDialog(
      `Delete "${row.label}"? Existing items using this value will keep it on their record, but it'll stop appearing in the dropdown.`,
      { title: `Delete ${s.kind}?`, destructive: true }
    )
    if (ok) {
      try {
        await window.roundhouse.lookups.delete(s.kind, id)
        await loadLookups({ force: true })
        await refresh()
      } catch (err) {
        await openDialog({
          title: 'Could not delete',
          body: `<p class="dialog-message">${escapeHtml(String(err))}</p>`,
          submitLabel: 'OK',
          cancelLabel: 'Close'
        })
      }
    }
  })

  // ─── Drag-to-reorder ─────────────────────────────────
  let dragId: number | null = null

  listEl.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.settings-row')
    if (!row || row.dataset['draggable'] !== 'true') return
    dragId = Number(row.dataset['id'])
    row.classList.add('dragging')
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', String(dragId))
      e.dataTransfer.effectAllowed = 'move'
    }
  })

  listEl.addEventListener('dragover', (e) => {
    if (dragId == null) return
    const row = (e.target as HTMLElement).closest<HTMLElement>('.settings-row')
    if (!row) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    listEl.querySelectorAll<HTMLElement>('.settings-row').forEach((r) => {
      r.classList.toggle('drag-over', r === row && Number(r.dataset['id']) !== dragId)
    })
  })

  listEl.addEventListener('dragleave', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.settings-row')
    row?.classList.remove('drag-over')
  })

  listEl.addEventListener('drop', async (e) => {
    e.preventDefault()
    listEl.querySelectorAll<HTMLElement>('.drag-over').forEach((r) => r.classList.remove('drag-over'))
    const overRow = (e.target as HTMLElement).closest<HTMLElement>('.settings-row')
    if (dragId == null || !overRow) { dragId = null; return }
    const overId = Number(overRow.dataset['id'])
    if (dragId === overId) { dragId = null; return }
    const newOrder = cachedRows.map((r) => r.id).filter((id) => id !== dragId)
    const insertAt = newOrder.indexOf(overId)
    newOrder.splice(insertAt < 0 ? newOrder.length : insertAt, 0, dragId)
    dragId = null
    try {
      await window.roundhouse.lookups.reorder(s.kind, newOrder)
      await loadLookups({ force: true })
      await refresh()
    } catch (err) {
      console.error(err)
      await openDialog({
        title: 'Could not save order',
        body: `<p class="dialog-message">${escapeHtml(String(err))}</p>`,
        submitLabel: 'OK',
        cancelLabel: 'Close'
      })
    }
  })

  listEl.addEventListener('dragend', () => {
    listEl.querySelectorAll<HTMLElement>('.dragging, .drag-over').forEach((r) => {
      r.classList.remove('dragging')
      r.classList.remove('drag-over')
    })
    dragId = null
  })

  await refresh()
}

function lookupRowHtml(row: LookupRow): string {
  const sysBadge = row.is_system ? `<span class="chip system-chip">Built-in</span>` : ''
  const deleteBtn = row.is_system
    ? `<button class="icon-btn" data-action="delete" data-id="${row.id}" title="Built-in — can't delete">🗑</button>`
    : `<button class="icon-btn danger" data-action="delete" data-id="${row.id}" title="Delete">🗑</button>`
  return `
    <article class="settings-row" data-id="${row.id}" data-draggable="true" draggable="true" title="Drag to reorder">
      <span class="drag-grip" aria-hidden="true">⠿</span>
      <span class="settings-row-label">${escapeHtml(row.label)}</span>
      <span class="settings-row-value muted small mono">${escapeHtml(row.value)}</span>
      ${sysBadge}
      <span class="settings-row-actions">
        <button class="icon-btn" data-action="edit" data-id="${row.id}" title="Edit">✎</button>
        ${deleteBtn}
      </span>
    </article>`
}

async function openLookupDialog(
  section: SectionConfig,
  collectionKind: CollectionKind,
  existing: LookupRow | undefined
): Promise<boolean> {
  const isSystem = !!existing?.is_system
  const body = document.createElement('form')
  body.className = 'rh-form'

  const valueField = isSystem
    ? `<label class="field" for="f-value">
         <span class="field-label">Value</span>
         <input id="f-value" type="text" value="${escapeHtml(existing!.value)}" disabled />
         <span class="field-hint muted small">Built-in value can't be renamed (so existing items keep working). You can change the label.</span>
       </label>`
    : fieldHtml({
        label: 'Value',
        name: 'value',
        value: existing?.value,
        required: true,
        placeholder: 'short_identifier'
      })

  body.innerHTML = `
    <div class="rh-form-grid">
      ${valueField}
      ${fieldHtml({ label: 'Label', name: 'label', value: existing?.label, required: true, placeholder: 'How it appears in the dropdown' })}
    </div>
    ${section.valueHint ? `<p class="muted small">${escapeHtml(section.valueHint)}</p>` : ''}
    <p class="muted small">The order in the dropdown is set by drag-and-drop on the Settings page.</p>
  `

  return openDialog({
    title: existing ? `Edit ${section.kind}` : `New ${section.kind}`,
    body,
    submitLabel: existing ? 'Save changes' : 'Add',
    onSubmit: async () => {
      if (!body.reportValidity()) return false
      const data = readForm(body)
      const value = isSystem ? existing!.value : String(data['value'] ?? '').trim()
      const label = String(data['label'] ?? '').trim()
      if (!value || !label) return false
      const payload: Partial<LookupInput> = { label }
      if (!isSystem) payload.value = value
      try {
        if (existing) {
          await window.roundhouse.lookups.update(section.kind, existing.id, payload)
        } else {
          await window.roundhouse.lookups.create(section.kind, collectionKind, payload as LookupInput)
        }
        await loadLookups({ force: true })
        return true
      } catch (err) {
        await openDialog({
          title: 'Could not save',
          body: `<p class="dialog-message">${escapeHtml(String(err))}</p>`,
          submitLabel: 'OK',
          cancelLabel: 'Close'
        })
        return false
      }
    }
  })
}
