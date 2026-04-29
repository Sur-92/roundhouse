import { escapeHtml } from './dom'

/**
 * Reusable "Condition grading" help dialog. Lives in its own module so
 * the same content is shown wherever a help-dot points to it (Item Edit
 * dialog, Item Detail view).
 */
export function openConditionHelp(): void {
  const dlg = document.createElement('dialog')
  dlg.className = 'rh-dialog'
  dlg.innerHTML = `
    <form method="dialog" class="rh-dialog-form">
      <header class="rh-dialog-head">
        <h3>Condition grading</h3>
        <button type="button" class="rh-dialog-x" aria-label="Close" data-action="cancel">×</button>
      </header>
      <div class="rh-dialog-body">
        <p class="help-popover-lede">These follow the <strong>TCA (Train Collectors Association)</strong> grading standard — the industry reference used by auction houses, price guides like Greenberg's, and the model-railroad hobby generally.</p>
        <ul class="help-list condition-list">
          <li><strong>New</strong><span class="help-desc">Unused, in original packaging, never operated. <em>TCA: Mint (M).</em></span></li>
          <li><strong>Like new</strong><span class="help-desc">Appears unused — may be out of box, but pristine and shows no signs of operation. <em>TCA: Like New (LN).</em></span></li>
          <li><strong>Excellent</strong><span class="help-desc">Minor wear from light handling or display, no defects, all parts present and functional. <em>TCA: Excellent (EX).</em></span></li>
          <li><strong>Good</strong><span class="help-desc">Noticeable wear from regular use; small scratches or paint touch-ups acceptable; all parts present and operates correctly. <em>TCA: Good (G).</em></span></li>
          <li><strong>Fair</strong><span class="help-desc">Significant wear; minor defects or replacement parts; may need cleaning or light service to operate well. <em>TCA: Fair (F).</em></span></li>
          <li><strong>Poor</strong><span class="help-desc">Heavy wear, possible damage or missing parts, likely needs restoration to operate. <em>TCA: Poor (P).</em></span></li>
          <li><strong>For parts</strong><span class="help-desc">Not functional or substantially incomplete — kept as a parts donor, restoration project, or reference only.</span></li>
        </ul>
        <p class="help-desc small">Source: Train Collectors Association — see their published grading standards at traincollectors.org. Custom condition labels you've added via Settings aren't covered here; only the seven built-ins.</p>
      </div>
      <footer class="rh-dialog-foot">
        <button type="button" class="btn primary" data-action="cancel">Close</button>
      </footer>
    </form>
  `
  document.body.appendChild(dlg)
  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset['action'] === 'cancel' || t === dlg) dlg.close()
  })
  dlg.addEventListener('close', () => dlg.remove())
  dlg.showModal()
}

/** A button that, when clicked, opens the condition grading help dialog. */
export function conditionHelpDotHtml(label = 'Condition grading help'): string {
  return `<button type="button" class="help-dot" data-action="condition-help" aria-label="${escapeHtml(label)}">?</button>`
}
