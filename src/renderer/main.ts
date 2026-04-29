import { initRouter } from './router'
import { loadLookups } from './lib/lookups'
import { openAboutDialog } from './lib/about'
import './global'

console.log('Roundhouse renderer ready. API present:', typeof window.roundhouse !== 'undefined')

// Prime the type/scale/condition lookup cache before the first render so
// chips and detail readouts show user-customized labels immediately.
loadLookups()
  .catch((err) => console.warn('Lookup preload failed (will retry on demand):', err))
  .finally(() => initRouter())

// Brand → About dialog (with inline release history).
document.getElementById('open-about')?.addEventListener('click', () => {
  void openAboutDialog()
})
