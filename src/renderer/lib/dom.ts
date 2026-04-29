/** Tiny DOM helpers used across views. No framework. */

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  )
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (string | Node)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else node.setAttribute(k, v)
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function on<E extends Element>(
  root: ParentNode,
  selector: string,
  event: string,
  handler: (e: Event, target: E) => void
): void {
  root.addEventListener(event, (e) => {
    const t = (e.target as Element)?.closest(selector) as E | null
    if (t && root.contains(t)) handler(e, t)
  })
}

export function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  // accept YYYY-MM-DD or ISO
  const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// As of v0.3.0 these labels come from the user-managed lookup tables
// instead of a hardcoded map. The cache must be primed (loadLookups)
// before these are called — main.ts does that during boot.
import { lookupLabel } from './lookups'

export function typeLabel(t: string): string {
  return lookupLabel('type', t)
}

export function conditionLabel(c: string | null | undefined): string {
  if (!c) return '—'
  return lookupLabel('condition', c)
}
