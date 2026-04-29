import { escapeHtml } from './dom'
// CHANGELOG.md is bundled at build time via Vite's ?raw import. No
// network call, works offline, the notes always match the version
// installed.
import changelogText from '../../../CHANGELOG.md?raw'

/**
 * Release Notes modal — content-only popup that renders the bundled
 * CHANGELOG.md as HTML.
 *
 * Triggered by main when the user clicks "Release Notes…" in the native
 * About dialog (App menu → About Roundhouse → Release Notes…). This
 * matches the Manifest app's pattern: app metadata in the OS-native
 * About panel, release history in a dedicated in-app modal.
 */
export async function openReleaseNotesModal(): Promise<void> {
  const installedVersion = await window.roundhouse.app.version()

  const dlg = document.createElement('dialog')
  dlg.className = 'rh-dialog about-dialog'
  dlg.innerHTML = `
    <form method="dialog" class="rh-dialog-form">
      <header class="rh-dialog-head">
        <h3>Release Notes</h3>
        <button type="button" class="rh-dialog-x" aria-label="Close" data-action="cancel">×</button>
      </header>
      <div class="rh-dialog-body about-body">
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
 *   # / ## / ### headings, bullet lists, **bold**, `code`, links, URLs.
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
