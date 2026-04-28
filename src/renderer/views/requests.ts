import { escapeHtml, fmtDate } from '../lib/dom'
import type { FeedbackCategory, FeedbackIssue, FeedbackStatus } from '@shared/types'

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: 'Something is broken',
  feature: 'Idea / feature',
  question: 'Question',
  other: 'Other'
}

const CATEGORY_ICON: Record<FeedbackCategory, string> = {
  bug: '🐞',
  feature: '💡',
  question: '❓',
  other: '📝'
}

export async function renderRequests(el: HTMLElement): Promise<void> {
  const status = await window.roundhouse.feedback.status()

  if (!status.configured) {
    el.innerHTML = `
      <section class="panel">
        <header class="panel-head">
          <div>
            <h2>Requests</h2>
          </div>
        </header>
        <div class="empty-card">
          <h3>Not set up yet</h3>
          <p>Requests need a one-time configuration file from the developer. If you'd like to send a request, contact your developer and ask for the <code>feedback.json</code> setup.</p>
        </div>
      </section>
    `
    return
  }

  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <div>
          <h2>Requests</h2>
          <p class="muted">Send the developer feedback, ideas, bug reports, or questions.${status.submitter ? ` Posting as <strong>${escapeHtml(status.submitter)}</strong>.` : ''}</p>
        </div>
        <button class="btn" data-action="refresh" title="Refresh from GitHub">↻ Refresh</button>
      </header>

      <form id="new-request" class="rh-form request-form">
        <div class="rh-form-grid">
          <label class="field" for="r-category">
            <span class="field-label">Type</span>
            <select id="r-category" name="category" required>
              <option value="feature">💡 Idea / feature</option>
              <option value="bug">🐞 Something is broken</option>
              <option value="question">❓ Question</option>
              <option value="other">📝 Other</option>
            </select>
          </label>
          <label class="field" for="r-title">
            <span class="field-label">Subject <span class="req">*</span></span>
            <input id="r-title" name="title" type="text" required placeholder="One-line summary" maxlength="200" />
          </label>
          <label class="field field-span-2" for="r-body">
            <span class="field-label">Details</span>
            <textarea id="r-body" name="body" rows="5" placeholder="Steps to reproduce, what you'd like to see, anything that helps explain…"></textarea>
          </label>
        </div>
        <div class="request-form-actions">
          <button type="submit" class="btn primary" id="r-submit">Send to developer</button>
          <span class="muted submit-status" id="submit-status"></span>
        </div>
      </form>

      <h3 class="request-list-title">Past requests</h3>
      <div id="request-list" class="request-list"><p class="muted">Loading…</p></div>
    </section>
  `

  const form = el.querySelector<HTMLFormElement>('#new-request')!
  const list = el.querySelector<HTMLDivElement>('#request-list')!
  const submitStatus = el.querySelector<HTMLSpanElement>('#submit-status')!
  const submitBtn = el.querySelector<HTMLButtonElement>('#r-submit')!
  const refreshBtn = el.querySelector<HTMLButtonElement>('[data-action="refresh"]')!

  let lastFlash: number | undefined
  const flash = (msg: string, kind: 'ok' | 'err' = 'ok'): void => {
    submitStatus.textContent = msg
    submitStatus.className = `muted submit-status ${kind}`
    window.clearTimeout(lastFlash)
    lastFlash = window.setTimeout(() => (submitStatus.textContent = ''), 4500)
  }

  const refresh = async (): Promise<void> => {
    list.innerHTML = `<p class="muted">Loading…</p>`
    try {
      const issues = await window.roundhouse.feedback.list()
      if (!issues.length) {
        list.innerHTML = `<p class="empty">No requests yet. Send your first using the form above.</p>`
        return
      }
      list.innerHTML = issues.map(renderIssueCard).join('')
    } catch (err) {
      console.error(err)
      list.innerHTML = `<p class="empty err">Could not load past requests. Check your internet connection. <span class="small">${escapeHtml(String(err))}</span></p>`
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    const title = String(fd.get('title') ?? '').trim()
    if (!title) return
    submitBtn.disabled = true
    flash('Sending…')
    try {
      await window.roundhouse.feedback.create({
        category: (fd.get('category') as FeedbackCategory) || 'other',
        title,
        body: String(fd.get('body') ?? '').trim() || null
      })
      form.reset()
      flash('Sent! The developer can now see your request on GitHub.', 'ok')
      await refresh()
    } catch (err) {
      console.error(err)
      flash(`Could not send: ${String(err)}`, 'err')
    } finally {
      submitBtn.disabled = false
    }
  })

  refreshBtn.addEventListener('click', () => void refresh())

  await refresh()
}

function renderIssueCard(issue: FeedbackIssue): string {
  const stateLabel = issue.state === 'closed' ? '✅ Resolved' : '🟢 Open'
  const closedLine = issue.state === 'closed' && issue.closed_at
    ? `<span class="request-meta">Resolved ${fmtDate(issue.closed_at)}</span>`
    : ''
  const commentsLine = issue.comments > 0
    ? `<span class="request-meta">💬 ${issue.comments} ${issue.comments === 1 ? 'reply' : 'replies'}</span>`
    : ''
  return `
    <article class="request-card state-${escapeHtml(issue.state)}">
      <header class="request-card-head">
        <span class="chip request-cat">${CATEGORY_ICON[issue.category]} ${escapeHtml(CATEGORY_LABEL[issue.category])}</span>
        <h4 class="request-title">${escapeHtml(issue.title)}</h4>
        <span class="state-badge state-${escapeHtml(issue.state)}">${stateLabel}</span>
      </header>
      ${issue.body ? `<p class="request-body">${escapeHtml(issue.body)}</p>` : ''}
      <footer class="request-card-foot">
        <span class="request-meta">Sent ${fmtDate(issue.created_at)}</span>
        ${closedLine}
        ${commentsLine}
        <span class="request-meta request-id">#${issue.number}</span>
      </footer>
    </article>`
}
