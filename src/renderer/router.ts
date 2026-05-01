import { renderHome } from './views/home'
import { renderCollections } from './views/collections'
import { renderCollectionDetail } from './views/collection-detail'
import { renderSets } from './views/sets'
import { renderSetDetail } from './views/set-detail'
import { renderItems, renderItemsForKind } from './views/items'
import { renderItemDetail } from './views/item-detail'
import { renderRequests } from './views/requests'
import { renderSettings } from './views/settings'

type RouteHandler = (el: HTMLElement, params: Record<string, string>) => void | Promise<void>

interface CompiledRoute {
  pattern: RegExp
  paramNames: string[]
  handler: RouteHandler
  /** the top-level tab to highlight when this route is active */
  tab: string
}

function compile(pattern: string, handler: RouteHandler, tab: string): CompiledRoute {
  const paramNames: string[] = []
  const re = pattern.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name)
    return '([^/]+)'
  })
  return { pattern: new RegExp('^' + re + '$'), paramNames, handler, tab }
}

const routes: CompiledRoute[] = [
  compile('/', renderHome, '/'),
  compile('/collections', renderCollections, '/collections'),
  compile('/collections/:id', renderCollectionDetail, '/collections'),
  compile('/sets', renderSets, '/sets'),
  compile('/sets/:id', renderSetDetail, '/sets'),
  compile('/items', renderItems, '/trains'),
  compile('/items/:id', renderItemDetail, '/trains'),
  compile('/trains', (el) => renderItemsForKind(el, 'trains'), '/trains'),
  compile('/coins', (el) => renderItemsForKind(el, 'coins'), '/coins'),
  compile('/requests', renderRequests, '/requests'),
  compile('/settings', renderSettings, '/settings')
]

export function initRouter(): void {
  const view = document.getElementById('view')
  if (!view) return

  const render = async (): Promise<void> => {
    const path = window.location.hash.replace(/^#/, '') || '/'
    let matched: { handler: RouteHandler; params: Record<string, string>; tab: string } | null = null

    for (const r of routes) {
      const m = r.pattern.exec(path)
      if (m) {
        const params: Record<string, string> = {}
        r.paramNames.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1] ?? '')))
        matched = { handler: r.handler, params, tab: r.tab }
        break
      }
    }

    view.innerHTML = ''
    if (matched) {
      await matched.handler(view, matched.params)
    } else {
      view.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No route for <code>${path}</code>.</p></section>`
    }

    document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
      a.classList.toggle('active', a.dataset['route'] === (matched?.tab ?? '/'))
    })
  }

  window.addEventListener('hashchange', () => void render())
  void render()
}

export function navigate(path: string): void {
  window.location.hash = path
}
