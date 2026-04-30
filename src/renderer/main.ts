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

// Force-plain-text paste fallback. Windows + Chromium sandbox can fail
// to handle the default paste flow when the clipboard contains rich
// HTML (typical when copying from ChatGPT, eBay, web pages). We
// preventDefault on the rich path and inject the text/plain variant
// manually, which works regardless of the surrounding format soup.
document.addEventListener('paste', (e: ClipboardEvent) => {
  const target = e.target as HTMLElement | null
  if (!target) return
  const isInput = target instanceof HTMLInputElement && /^(text|search|url|email|tel|password|number)$/i.test(target.type)
  const isTextarea = target instanceof HTMLTextAreaElement
  const isContentEditable = target.isContentEditable
  if (!isInput && !isTextarea && !isContentEditable) return

  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!text) return  // nothing useful to paste; let the default fire

  e.preventDefault()

  if (isInput || isTextarea) {
    const el = target as HTMLInputElement | HTMLTextAreaElement
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, start) + text + el.value.slice(end)
    const caret = start + text.length
    el.selectionStart = el.selectionEnd = caret
    // Trigger input listeners so frameworks / our own form readers see the change.
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else {
    document.execCommand('insertText', false, text)
  }
})
