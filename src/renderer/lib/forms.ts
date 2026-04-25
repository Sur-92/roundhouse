import { escapeHtml } from './dom'

type Option = { value: string; label: string }

export const SCALE_OPTIONS: Option[] = [
  { value: '', label: '—' },
  { value: 'Z', label: 'Z' },
  { value: 'N', label: 'N' },
  { value: 'HO', label: 'HO' },
  { value: 'OO', label: 'OO' },
  { value: 'S', label: 'S' },
  { value: 'O', label: 'O' },
  { value: 'G', label: 'G' },
  { value: 'other', label: 'Other' }
]

export const TYPE_OPTIONS: Option[] = [
  { value: 'locomotive', label: 'Locomotive' },
  { value: 'rolling_stock', label: 'Rolling stock' },
  { value: 'building', label: 'Building' },
  { value: 'figurine', label: 'Figurine' },
  { value: 'track', label: 'Track' },
  { value: 'scenery', label: 'Scenery' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' }
]

export const CONDITION_OPTIONS: Option[] = [
  { value: '', label: '—' },
  { value: 'new', label: 'New' },
  { value: 'like_new', label: 'Like new' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'parts', label: 'For parts' }
]

export interface FieldOpts {
  label: string
  name: string
  type?: 'text' | 'number' | 'date' | 'currency' | 'textarea' | 'select' | 'checkbox'
  value?: string | number | null
  options?: Option[]
  required?: boolean
  placeholder?: string
  span?: 1 | 2 // grid span
}

export function fieldHtml(opts: FieldOpts): string {
  const span = opts.span === 2 ? ' field-span-2' : ''
  const value = opts.value == null ? '' : String(opts.value)
  const reqMark = opts.required ? ' <span class="req">*</span>' : ''
  const id = `f-${opts.name}`

  if (opts.type === 'textarea') {
    return `
      <label class="field${span}" for="${id}">
        <span class="field-label">${escapeHtml(opts.label)}${reqMark}</span>
        <textarea id="${id}" name="${opts.name}" rows="4"${opts.required ? ' required' : ''} placeholder="${escapeHtml(opts.placeholder ?? '')}">${escapeHtml(value)}</textarea>
      </label>`
  }

  if (opts.type === 'select') {
    const opts_ = opts.options ?? []
    const optionsHtml = opts_
      .map(
        (o) =>
          `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
      )
      .join('')
    return `
      <label class="field${span}" for="${id}">
        <span class="field-label">${escapeHtml(opts.label)}${reqMark}</span>
        <select id="${id}" name="${opts.name}"${opts.required ? ' required' : ''}>${optionsHtml}</select>
      </label>`
  }

  if (opts.type === 'checkbox') {
    return `
      <label class="field field-check${span}" for="${id}">
        <input id="${id}" name="${opts.name}" type="checkbox"${value === '1' || value === 'true' ? ' checked' : ''} />
        <span class="field-label">${escapeHtml(opts.label)}${reqMark}</span>
      </label>`
  }

  if (opts.type === 'currency') {
    return `
      <label class="field${span}" for="${id}">
        <span class="field-label">${escapeHtml(opts.label)}${reqMark}</span>
        <div class="field-currency">
          <span class="field-prefix">$</span>
          <input id="${id}" name="${opts.name}" type="number" step="0.01" min="0" value="${escapeHtml(value)}" placeholder="${escapeHtml(opts.placeholder ?? '')}" />
        </div>
      </label>`
  }

  return `
    <label class="field${span}" for="${id}">
      <span class="field-label">${escapeHtml(opts.label)}${reqMark}</span>
      <input id="${id}" name="${opts.name}" type="${opts.type ?? 'text'}" value="${escapeHtml(value)}"${opts.required ? ' required' : ''} placeholder="${escapeHtml(opts.placeholder ?? '')}" />
    </label>`
}

/** Read a form's values into a flat string|null map, with currency converted to cents. */
export function readForm(form: HTMLFormElement, currencyFields: string[] = []): Record<string, string | number | null> {
  const fd = new FormData(form)
  const out: Record<string, string | number | null> = {}

  // Initialize checkboxes (FormData omits unchecked boxes)
  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    out[cb.name] = cb.checked ? 1 : 0
  })

  for (const [k, v] of fd.entries()) {
    const sv = String(v).trim()
    if (currencyFields.includes(k)) {
      out[k] = sv ? Math.round(parseFloat(sv) * 100) : null
    } else if (sv === '') {
      out[k] = null
    } else {
      out[k] = sv
    }
  }
  return out
}
