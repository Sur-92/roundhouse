import { escapeHtml, on } from '../lib/dom'
import { openDialog, confirmDialog } from '../lib/dialog'
import { fieldHtml, readForm } from '../lib/forms'
import { loadLookups } from '../lib/lookups'
import type { LookupKind, LookupRow, LookupInput } from '@shared/types'

interface SectionConfig {
  kind: LookupKind
  title: string
  description: string
  /** Hint shown next to the value field in the dialog */
  valueHint?: string
}

const SECTIONS: SectionConfig[] = [
  {
    kind: 'type',
    title: 'Item types',
    description: 'Categories for items — Locomotive, Rolling stock, Building, etc. Used to color-code the chip on the Items list.',
    valueHint: 'A short identifier (e.g. passenger_car). Cannot contain spaces; we recommend snake_case.'
  },
  {
    kind: 'scale',
    title: 'Scales',
    description: 'Model scales — HO, N, O, etc. Add specialty scales like ON30 or 1/64 here.',
    valueHint: 'The scale name as you want it stored (e.g. ON30).'
  },
  {
    kind: 'condition',
    title: 'Conditions',
    description: 'Condition labels for items — New, Excellent, For parts, etc.',
    valueHint: 'A short identifier (e.g. mint, restoration_project).'
  }
]

export async function renderSettings(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Settings</h2>
          <p class="muted">Customize the dropdowns that appear when you create or edit items.</p>
        </div>
      </header>
      <div class="settings-sections" id="sections"></div>
    </section>
  `

  const host = el.querySelector<HTMLDivElement>('#sections')!
  host.innerHTML = SECTIONS.map(sectionShellHtml).join('')

  for (const section of SECTIONS) {
    void hydrateSection(section, host)
  }
}

function sectionShellHtml(s: SectionConfig): string {
  return `
    <section class="settings-section" data-kind="${s.kind}">
      <header class="settings-section-head">
        <div>
          <h3>${escapeHtml(s.title)}</h3>
          <p class="muted small">${escapeHtml(s.description)}</p>
        </div>
        <button class="btn primary" data-action="new">New ${escapeHtml(s.kind)}</button>
      </header>
      <div class="settings-list" data-list>
        <p class="muted">Loading…</p>
      </div>
    </section>`
}

async function hydrateSection(s: SectionConfig, host: HTMLElement): Promise<void> {
  const sectionEl = host.querySelector<HTMLElement>(`.settings-section[data-kind="${s.kind}"]`)!
  const listEl = sectionEl.querySelector<HTMLElement>('[data-list]')!

  const refresh = async (): Promise<void> => {
    const rows = await window.roundhouse.lookups.list(s.kind)
    if (!rows.length) {
      listEl.innerHTML = `<p class="empty">None yet.</p>`
      return
    }
    listEl.innerHTML = rows.map((row) => lookupRowHtml(row)).join('')
  }

  sectionEl.querySelector<HTMLButtonElement>('[data-action="new"]')!.addEventListener('click', async () => {
    if (await openLookupDialog(s, undefined)) await refresh()
  })

  on<HTMLButtonElement>(listEl, '[data-action="edit"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const rows = await window.roundhouse.lookups.list(s.kind)
    const row = rows.find((r) => r.id === id)
    if (row && (await openLookupDialog(s, row))) await refresh()
  })

  on<HTMLButtonElement>(listEl, '[data-action="delete"]', 'click', async (_e, btn) => {
    const id = Number(btn.dataset['id'])
    const rows = await window.roundhouse.lookups.list(s.kind)
    const row = rows.find((r) => r.id === id)
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

  await refresh()
}

function lookupRowHtml(row: LookupRow): string {
  const sysBadge = row.is_system ? `<span class="chip system-chip">Built-in</span>` : ''
  const deleteBtn = row.is_system
    ? `<button class="icon-btn" data-action="delete" data-id="${row.id}" title="Built-in — can't delete">🗑</button>`
    : `<button class="icon-btn danger" data-action="delete" data-id="${row.id}" title="Delete">🗑</button>`
  return `
    <article class="settings-row">
      <span class="settings-row-label">${escapeHtml(row.label)}</span>
      <span class="settings-row-value muted small mono">${escapeHtml(row.value)}</span>
      ${sysBadge}
      <span class="settings-row-actions">
        <button class="icon-btn" data-action="edit" data-id="${row.id}" title="Edit">✎</button>
        ${deleteBtn}
      </span>
    </article>`
}

async function openLookupDialog(section: SectionConfig, existing: LookupRow | undefined): Promise<boolean> {
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
      ${fieldHtml({ label: 'Sort order', name: 'sort_order', type: 'number', value: existing?.sort_order ?? '' })}
    </div>
    ${section.valueHint ? `<p class="muted small">${escapeHtml(section.valueHint)}</p>` : ''}
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
      const sortRaw = data['sort_order']
      const sort = sortRaw == null || sortRaw === '' ? undefined : Number(sortRaw)
      const payload: Partial<LookupInput> = { label, sort_order: sort }
      if (!isSystem) payload.value = value
      try {
        if (existing) {
          await window.roundhouse.lookups.update(section.kind, existing.id, payload)
        } else {
          await window.roundhouse.lookups.create(section.kind, payload as LookupInput)
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
