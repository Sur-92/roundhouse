import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  FeedbackCategory,
  FeedbackInput,
  FeedbackIssue,
  FeedbackStatus
} from '@shared/types'

interface RawConfig {
  repo: string
  token: string
  submitter?: string
}

const FEEDBACK_LABEL = 'roundhouse-feedback'
const CATEGORY_PREFIX = 'cat:'
const VALID_CATEGORIES: ReadonlySet<FeedbackCategory> = new Set([
  'bug',
  'feature',
  'question',
  'other'
])

let config: RawConfig | null = null

function userConfigPath(): string {
  return join(app.getPath('userData'), 'feedback.json')
}

function devFallbackPath(): string {
  // In dev, electron-vite leaves app paths pointing at the project root.
  return join(app.getAppPath(), 'dist', 'feedback.json')
}

function readConfigFile(path: string): RawConfig | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<RawConfig>
    if (typeof raw.repo !== 'string' || !raw.repo.includes('/')) return null
    if (typeof raw.token !== 'string' || !raw.token.startsWith('github_pat_')) return null
    return {
      repo: raw.repo,
      token: raw.token,
      submitter: typeof raw.submitter === 'string' ? raw.submitter : undefined
    }
  } catch {
    return null
  }
}

export function loadFeedbackConfig(): void {
  const userPath = userConfigPath()
  if (existsSync(userPath)) {
    config = readConfigFile(userPath)
    return
  }
  if (!app.isPackaged) {
    const dev = devFallbackPath()
    if (existsSync(dev)) {
      config = readConfigFile(dev)
      return
    }
  }
  config = null
}

export function getFeedbackStatus(): FeedbackStatus {
  if (!config) return { configured: false }
  return { configured: true, repo: config.repo, submitter: config.submitter }
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  if (!config) throw new Error('Feedback not configured')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Roundhouse-desktop'
  }
  if (init.headers) Object.assign(headers, init.headers as Record<string, string>)
  return fetch(`https://api.github.com${path}`, { ...init, headers })
}

interface GhLabel { name: string }
interface GhIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  created_at: string
  closed_at: string | null
  html_url: string
  comments: number
  labels: GhLabel[]
  pull_request?: unknown
}

function categoryFromLabels(labels: GhLabel[]): FeedbackCategory {
  for (const l of labels) {
    if (l.name.startsWith(CATEGORY_PREFIX)) {
      const c = l.name.slice(CATEGORY_PREFIX.length) as FeedbackCategory
      if (VALID_CATEGORIES.has(c)) return c
    }
  }
  return 'other'
}

function toFeedback(issue: GhIssue): FeedbackIssue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    state: issue.state,
    category: categoryFromLabels(issue.labels),
    created_at: issue.created_at,
    closed_at: issue.closed_at,
    url: issue.html_url,
    comments: issue.comments
  }
}

export async function listFeedbackIssues(): Promise<FeedbackIssue[]> {
  if (!config) throw new Error('Feedback not configured')
  const res = await gh(
    `/repos/${config.repo}/issues?labels=${FEEDBACK_LABEL}&state=all&per_page=100`
  )
  if (!res.ok) {
    throw new Error(`GitHub responded ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as GhIssue[]
  // GitHub's /issues endpoint includes PRs; filter them out.
  return data.filter((i) => !i.pull_request).map(toFeedback)
}

export async function createFeedbackIssue(input: FeedbackInput): Promise<FeedbackIssue> {
  if (!config) throw new Error('Feedback not configured')
  if (!VALID_CATEGORIES.has(input.category)) {
    throw new Error(`Invalid category: ${input.category}`)
  }
  if (!input.title?.trim()) throw new Error('Title is required')

  const labels = [FEEDBACK_LABEL, `${CATEGORY_PREFIX}${input.category}`]
  const submitter = config.submitter ? `\n\n— Submitted by ${config.submitter}` : ''
  const body = (input.body?.trim() ?? '') + submitter

  const res = await gh(`/repos/${config.repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: input.title.trim(), body, labels })
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new Error(`GitHub ${res.status}: ${text || res.statusText}`)
  }
  return toFeedback((await res.json()) as GhIssue)
}
