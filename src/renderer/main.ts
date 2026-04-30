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

// Edit menu → Paste (and Ctrl+V via the accelerator). Replaces the
// previous role: 'paste' which silently failed on Windows + sandbox.
// Reads OS clipboard via main, inserts at caret in the focused field.
window.roundhouse.app.onMenuPaste(async () => {
  const focused = document.activeElement
  diag(`menu-paste IPC received; focused=${(focused as HTMLElement)?.tagName} editable=${isEditableTarget(focused)}`)
  if (!isEditableTarget(focused)) {
    diag('menu-paste: focused not editable, ignoring')
    return
  }
  let text = ''
  try {
    text = await window.roundhouse.clipboard.readText()
  } catch (err) {
    diag(`menu-paste: clipboard.readText threw: ${String(err)}`)
    return
  }
  diag(`menu-paste: clipboard returned ${text.length} chars`)
  if (!text) return
  insertAtCaret(focused as HTMLElement, text)
  diag(`menu-paste: inserted ${text.length} chars`)
})

// Diagnostic helper — fire-and-forget, never blocks.
const diag = (msg: string): void => {
  void window.roundhouse.diag.log(msg).catch(() => {})
}

// Surface any uncaught errors / promise rejections to the diag log so
// they show up the next time the user opens it on Windows.
window.addEventListener('error', (e) => {
  diag(`window.error: ${e.message} at ${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  diag(`unhandledrejection: ${String(e.reason)}`)
})

// Renderer boot marker.
diag(`renderer boot — ua=${navigator.userAgent}`)

// Log every contextmenu event in the renderer so we can see if the
// renderer is dispatching it at all. If this never fires on Windows,
// something is intercepting right-clicks before the renderer.
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null
  diag(`contextmenu event: target=${t?.tagName} editable=${t?.isContentEditable} selection.length=${(window.getSelection()?.toString() ?? '').length} defaultPrevented=${e.defaultPrevented}`)
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
  const t = e.target as HTMLElement | null
  const types = e.clipboardData ? Array.from(e.clipboardData.types) : []
  const plainLen = e.clipboardData?.getData('text/plain').length ?? -1
  const htmlLen = e.clipboardData?.getData('text/html').length ?? -1
  diag(`paste event: target=${t?.tagName}/${(t as HTMLInputElement)?.type ?? ''} editable=${isEditableTarget(t)} clipboard.types=${types.join(',') || 'none'} text/plain=${plainLen} text/html=${htmlLen}`)

  if (!isEditableTarget(e.target)) {
    diag('paste skipped: target not editable')
    return
  }

  let text = e.clipboardData?.getData('text/plain') ?? ''
  let source = 'text/plain'

  // Windows + ChatGPT/eBay sometimes leaves text/plain empty — only the
  // rich HTML variant is on the clipboard. Try HTML next, stripping tags.
  if (!text) {
    const html = e.clipboardData?.getData('text/html') ?? ''
    if (html) {
      const div = document.createElement('div')
      div.innerHTML = html
      text = (div.textContent || div.innerText || '').trim()
      if (text) source = 'text/html-stripped'
    }
  }

  // Last resort: ask main for the OS clipboard contents directly.
  if (!text) {
    text = await fetchClipboardText()
    if (text) source = 'main.clipboard.readText'
  }

  if (!text) {
    diag('paste: no text from any source — letting default fire')
    return
  }

  e.preventDefault()
  insertAtCaret(e.target as HTMLElement, text)
  diag(`paste: inserted ${text.length} chars from ${source}`)
})

// Layer 2: keydown handler for Ctrl/Cmd+V — independent of whether
// Chromium fires a paste event at all. If the paste event fired and was
// already handled (synchronously by Layer 1), this still runs but only
// tries to fetch from main if Layer 1 didn't insert anything.
document.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key !== 'v' && e.key !== 'V') return
  if (!(e.ctrlKey || e.metaKey)) return
  const t = e.target as HTMLElement | null
  diag(`keydown Ctrl+V: target=${t?.tagName}/${(t as HTMLInputElement)?.type ?? ''} editable=${isEditableTarget(t)} defaultPrevented=${e.defaultPrevented}`)
  if (!isEditableTarget(e.target)) return
  if (e.defaultPrevented) return
  const text = await fetchClipboardText()
  diag(`keydown Ctrl+V fallback: main returned ${text.length} chars`)
  if (!text) return
  e.preventDefault()
  insertAtCaret(e.target as HTMLElement, text)
  diag('keydown Ctrl+V fallback: inserted')
})
