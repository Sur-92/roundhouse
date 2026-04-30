import { initRouter } from './router'
import { loadLookups } from './lib/lookups'
import { openReleaseNotesModal } from './lib/about'
import './global'

console.log('Roundhouse renderer ready. API present:', typeof window.roundhouse !== 'undefined')

// Prime the type/scale/condition lookup cache before the first render so
// chips and detail readouts show user-customized labels immediately.
loadLookups()
  .catch((err) => console.warn('Lookup preload failed (will retry on demand):', err))
  .finally(() => initRouter())

// Triggered from the App menu → About Roundhouse → Release Notes… button.
window.roundhouse.app.onReleaseNotesRequested(() => {
  void openReleaseNotesModal()
})

// Cross-platform paste rescue. The renderer-side `paste` event flow
// ranges from inconsistent (Windows + rich HTML clipboard) to outright
// silent failure on some Chromium / sandbox / OS combos. So we hijack
// every paste in two layers:
//
//   1. Listen for the paste event. If e.clipboardData has plain text,
//      use it (fast path, no IPC round-trip).
//   2. If clipboardData is empty (Windows quirk when source is rich
//      HTML), call the main process's privileged Electron clipboard
//      readText() — that always returns the OS-level plain text.
//
// We also bind Ctrl/Cmd+V at the keydown layer for any focused editable
// element so we never depend on Chromium dispatching a paste event in
// the first place.

function isEditableTarget(t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(t instanceof HTMLElement)) return false
  if (t instanceof HTMLInputElement) {
    return /^(text|search|url|email|tel|password|number)$/i.test(t.type)
  }
  if (t instanceof HTMLTextAreaElement) return true
  return t.isContentEditable
}

function insertAtCaret(target: HTMLElement, text: string): void {
  if (!text) return
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length
    const end = target.selectionEnd ?? target.value.length
    target.value = target.value.slice(0, start) + text + target.value.slice(end)
    const caret = start + text.length
    target.selectionStart = target.selectionEnd = caret
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    document.execCommand('insertText', false, text)
  }
}

async function fetchClipboardText(): Promise<string> {
  try {
    return await window.roundhouse.clipboard.readText()
  } catch {
    return ''
  }
}

// Layer 1: paste event handler (fast path)
document.addEventListener('paste', async (e: ClipboardEvent) => {
  if (!isEditableTarget(e.target)) return

  let text = e.clipboardData?.getData('text/plain') ?? ''

  // Windows + ChatGPT/eBay sometimes leaves text/plain empty — only the
  // rich HTML variant is on the clipboard. Try HTML next, stripping tags.
  if (!text) {
    const html = e.clipboardData?.getData('text/html') ?? ''
    if (html) {
      const div = document.createElement('div')
      div.innerHTML = html
      text = (div.textContent || div.innerText || '').trim()
    }
  }

  // Last resort: ask main for the OS clipboard contents directly.
  if (!text) text = await fetchClipboardText()

  if (!text) return  // genuinely nothing to paste; let default fire

  e.preventDefault()
  insertAtCaret(e.target as HTMLElement, text)
})

// Layer 2: keydown handler for Ctrl/Cmd+V — independent of whether
// Chromium fires a paste event at all. If the paste event fired and was
// already handled (synchronously by Layer 1), this still runs but only
// tries to fetch from main if Layer 1 didn't insert anything.
document.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key !== 'v' && e.key !== 'V') return
  if (!(e.ctrlKey || e.metaKey)) return
  if (!isEditableTarget(e.target)) return
  // If preventDefault has already been set by Layer 1, the browser's
  // default paste won't fire — perfect, our insert already ran.
  if (e.defaultPrevented) return
  // Otherwise, fetch the clipboard ourselves and insert.
  const text = await fetchClipboardText()
  if (!text) return
  e.preventDefault()
  insertAtCaret(e.target as HTMLElement, text)
})
