import { renderHome } from './views/home'
import { renderCollections } from './views/collections'
import { renderSets } from './views/sets'
import { renderItems } from './views/items'

type RouteHandler = (el: HTMLElement) => void | Promise<void>

const routes: Record<string, RouteHandler> = {
  '/': renderHome,
  '/collections': renderCollections,
  '/sets': renderSets,
  '/items': renderItems
}

export function initRouter(): void {
  const view = document.getElementById('view')
  if (!view) return

  const render = async (): Promise<void> => {
    const path = window.location.hash.replace(/^#/, '') || '/'
    const handler = routes[path] ?? renderHome
    view.innerHTML = ''
    await handler(view)
    document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
      a.classList.toggle('active', a.dataset.route === path)
    })
  }

  window.addEventListener('hashchange', () => void render())
  void render()
}
