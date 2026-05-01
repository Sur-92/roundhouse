import { escapeHtml } from './dom'
import type { CollectionKind } from '@shared/types'

/**
 * Reusable "Condition grading" help dialog. Lives in its own module so
 * the same content is shown wherever a help-dot points to it (Item Edit
 * dialog, Item Detail view).
 *
 * Trains use the **TCA (Train Collectors Association)** grading scale.
 * Coins use the **Sheldon** numeric grading scale (P-1 through MS-70,
 * plus Proof). Pass the collection kind so the popup matches the
 * dropdown options shown beside it.
 */
export function openConditionHelp(kind: CollectionKind = 'trains'): void {
  const dlg = document.createElement('dialog')
  dlg.className = 'rh-dialog'
  dlg.innerHTML = `
    <form method="dialog" class="rh-dialog-form">
      <header class="rh-dialog-head">
        <h3>Condition grading</h3>
        <button type="button" class="rh-dialog-x" aria-label="Close" data-action="cancel">×</button>
      </header>
      <div class="rh-dialog-body">
        ${kind === 'coins' ? coinHelpBodyHtml() : trainHelpBodyHtml()}
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

function trainHelpBodyHtml(): string {
  return `
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
  `
}

function coinHelpBodyHtml(): string {
  return `
    <p class="help-popover-lede">Coins use the <strong>Sheldon grading scale</strong> — a 70-point numeric scale developed by Dr. William Sheldon and adopted by the ANA (American Numismatic Association) and major grading services like PCGS and NGC. Higher number = better preserved.</p>
    <ul class="help-list condition-list">
      <li><strong>Poor (P-1)</strong><span class="help-desc">Barely identifiable — date and type may be readable but most detail is gone.</span></li>
      <li><strong>Fair (FR-2)</strong><span class="help-desc">Heavily worn but the design and lettering are identifiable. Rims may be weak or worn into the legend.</span></li>
      <li><strong>About Good (AG-3)</strong><span class="help-desc">Major design elements visible but heavily worn. Lettering and date are partially worn.</span></li>
      <li><strong>Good (G-4 to G-6)</strong><span class="help-desc">Heavily worn but main design clearly outlined. Most lettering is legible. Rims are full.</span></li>
      <li><strong>Very Good (VG-8 to VG-10)</strong><span class="help-desc">Well worn but with all major design elements visible. Some interior detail visible.</span></li>
      <li><strong>Fine (F-12 to F-15)</strong><span class="help-desc">Moderate-to-heavy wear, but all features are bold and clear. Lettering complete.</span></li>
      <li><strong>Very Fine (VF-20 to VF-35)</strong><span class="help-desc">Light-to-moderate wear on all high points. All major and most minor design details are sharp.</span></li>
      <li><strong>Extremely Fine (EF-40 to EF-45)</strong><span class="help-desc">Light wear only on the highest points. All design details are sharp and bold; some original mint luster may show.</span></li>
      <li><strong>About Uncirculated (AU-50 to AU-58)</strong><span class="help-desc">Trace of wear on the highest points only. Most of the original mint luster is intact.</span></li>
      <li><strong>Mint State (MS-60 to MS-70)</strong><span class="help-desc">No wear at all. Bag marks, contact marks, or weak strikes drop the grade within MS. MS-70 is a perfect coin under 5× magnification.</span></li>
      <li><strong>Proof (PR-60 to PR-70)</strong><span class="help-desc">Specially struck coins (mirror or matte finish) made for collectors — not a wear grade but a manufacturing class. Graded on the same 60–70 scale as Mint State.</span></li>
    </ul>
    <p class="help-desc small">Source: ANA / Sheldon scale, PCGS &amp; NGC grading standards. Custom condition labels you've added via Settings aren't covered here; only the eleven Sheldon-scale built-ins.</p>
  `
}

/** A button that, when clicked, opens the condition grading help dialog. */
export function conditionHelpDotHtml(label = 'Condition grading help'): string {
  return `<button type="button" class="help-dot" data-action="condition-help" aria-label="${escapeHtml(label)}">?</button>`
}
