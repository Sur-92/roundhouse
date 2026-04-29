import { escapeHtml } from './dom'
// Manifest's pattern: bundle the changelog at build time via Vite's ?raw
// import. The markdown text is baked into the renderer; no network call,
// no rate limits, works offline, and the notes are guaranteed to match
// the version actually installed.
import changelogText from '../../../CHANGELOG.md?raw'

/**
 * "About Roundhouse" modal — combines app version + copyright with the
 * inline release-history changelog (rendered from bundled CHANGELOG.md).
 */
export async function openAboutDialog(): Promise<void> {
  const installedVersion = await window.roundhouse.app.version()

  const dlg = document.createElement('dialog')
  dlg.className = 'rh-dialog about-dialog'
  dlg.innerHTML = `
    <form method="dialog" class="rh-dialog-form">
      <header class="rh-dialog-head">
        <div class="about-head-content">
          <img class="about-logo" src="/logo.png" alt="" aria-hidden="true" />
          <div>
            <h3>Roundhouse</h3>
            <p class="about-version">v${escapeHtml(installedVersion)}</p>
          </div>
        </div>
        <button type="button" class="rh-dialog-x" aria-label="Close" data-action="cancel">×</button>
      </header>
      <div class="rh-dialog-body about-body">
        <p class="about-tag">A desktop catalog for model train collections.</p>
        <p class="about-meta">
          © 2026 Steve Beamesderfer · MIT License<br />
          <a href="https://github.com/Sur-92/roundhouse" target="_blank" rel="noopener">github.com/Sur-92/roundhouse</a>
        </p>

        <h4 class="about-section-head">Release notes</h4>
        <div class="changelog-body">${renderChangelog(changelogText, installedVersion)}</div>
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

/**
 * Tiny markdown→HTML for the limited subset used in CHANGELOG.md:
 *   # / ## / ### headings, bullet lists, **bold**, `code`, and bare URLs.
 * Highlights the entry whose tag matches the installed version.
 */
function renderChangelog(md: string, installed: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let inList = false
  const closeList = (): void => { if (inList) { out.push('</ul>'); inList = false } }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) { closeList(); continue }

    const h2 = /^##\s+(v\d+\.\d+\.\d+)\s+(.*)$/.exec(line)
    if (h2) {
      closeList()
      const tag = h2[1]!
      const rest = h2[2]!
      const isCurrent = tag.replace(/^v/, '') === installed
      out.push(`
        <h3 class="changelog-version${isCurrent ? ' current' : ''}">
          <span class="changelog-tag">${escapeHtml(tag)}</span>
          <span class="changelog-rest">${escapeHtml(rest)}</span>
          ${isCurrent ? '<span class="changelog-badge">Installed</span>' : ''}
        </h3>`)
      continue
    }

    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1) {
      closeList()
      out.push(`<h2 class="changelog-title">${formatInline(h1[1]!)}</h2>`)
      continue
    }

    const h3 = /^###\s+(.+)$/.exec(line)
    if (h3) {
      closeList()
      out.push(`<h4>${formatInline(h3[1]!)}</h4>`)
      continue
    }

    const b = /^[-*]\s+(.+)$/.exec(line)
    if (b) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${formatInline(b[1]!)}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${formatInline(line)}</p>`)
  }
  closeList()
  return out.join('')
}

function formatInline(s: string): string {
  let html = escapeHtml(s)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${text}</a>`
  )
  html = html.replace(
    /(^|\s)(https?:\/\/[^\s<>"]+)/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${url}</a>`
  )
  return html
}
