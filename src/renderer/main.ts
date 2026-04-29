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
