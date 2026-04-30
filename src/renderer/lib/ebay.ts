import { escapeHtml } from './dom'
import type { EbayListing, EbaySearchResult } from '@shared/types'

/**
 * Renders the "Similar active listings on eBay" section for an item's
 * detail page. Mounts itself into the supplied container; manages its
 * own loading / error / empty states; offers a refresh button that
 * forces a fresh fetch (bypassing the per-item cache in main).
 */
export async function renderEbayPanel(host: HTMLElement, itemId: number): Promise<void> {
  const status = await window.roundhouse.ebay.status()

  if (!status.configured) {
    host.innerHTML = `
      <section class="ebay-panel">
        <header class="ebay-head">
          <h3>Active eBay listings</h3>
        </header>
        <div class="empty-card">
          <p class="muted">Not set up yet.</p>
          <p class="small muted">To see comparable active listings here, the developer needs to drop an <code>ebay.json</code> config file with eBay API credentials into the app's data folder.</p>
        </div>
      </section>
    `
    return
  }

  host.innerHTML = `
    <section class="ebay-panel">
      <header class="ebay-head">
        <h3>Active eBay listings</h3>
        <button class="btn" data-action="refresh" title="Re-query eBay">↻ Refresh</button>
      </header>
      <div class="ebay-meta" id="ebay-meta">
        <span class="muted">Loading…</span>
      </div>
      <div id="ebay-list" class="ebay-list"></div>
    </section>
  `

  const meta = host.querySelector<HTMLDivElement>('#ebay-meta')!
  const list = host.querySelector<HTMLDivElement>('#ebay-list')!
  const refreshBtn = host.querySelector<HTMLButtonElement>('[data-action="refresh"]')!

  const load = async (force = false): Promise<void> => {
    meta.innerHTML = '<span class="muted">Loading…</span>'
    list.innerHTML = ''
    try {
      const result = await window.roundhouse.ebay.searchForItem(itemId, { force })
      renderResult(meta, list, result)
    } catch (err) {
      meta.innerHTML = ''
      list.innerHTML = `
        <div class="empty err">
          <p>Couldn't reach eBay.</p>
          <p class="small">${escapeHtml(String(err))}</p>
        </div>`
    }
  }

  refreshBtn.addEventListener('click', () => void load(true))

  list.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.ebay-card')
    if (!a) return
    e.preventDefault()
    const url = a.getAttribute('href') || ''
    if (url) void window.roundhouse.ebay.openListing(url)
  })

  await load(false)
}

function renderResult(meta: HTMLElement, list: HTMLElement, result: EbaySearchResult): void {
  const summary = result.listings.length === 0
    ? `No active listings matched <code>${escapeHtml(result.query)}</code>.`
    : `${result.total.toLocaleString()} match${result.total === 1 ? '' : 'es'} for <code>${escapeHtml(result.query)}</code> · showing ${result.listings.length}`

  const stamp = new Date(result.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  meta.innerHTML = `${summary} <span class="ebay-stamp">· fetched ${escapeHtml(stamp)}</span>`

  if (!result.listings.length) {
    list.innerHTML = `<p class="empty muted">Try opening the item, refining the manufacturer or model number, then refresh.</p>`
    return
  }

  list.innerHTML = result.listings.map(cardHtml).join('')
}

function cardHtml(l: EbayListing): string {
  const price = formatPrice(l.price.value, l.price.currency)
  const isAuction = l.buyingOption === 'AUCTION'
  const condition = l.condition ? `<span class="ebay-condition">${escapeHtml(l.condition)}</span>` : ''
  const tag = isAuction ? '<span class="ebay-tag auction">Auction</span>' : '<span class="ebay-tag fixed">Buy It Now</span>'
  const endsIn = isAuction && l.endTime ? `<span class="ebay-ends">${escapeHtml(formatTimeRemaining(l.endTime))}</span>` : ''
  const img = l.imageUrl
    ? `<img src="${escapeHtml(l.imageUrl)}" alt="" loading="lazy" />`
    : `<span class="ebay-thumb-empty">📦</span>`

  return `
    <a class="ebay-card" href="${escapeHtml(l.url)}">
      <div class="ebay-thumb">${img}</div>
      <div class="ebay-body">
        <h4 class="ebay-title">${escapeHtml(l.title)}</h4>
        <div class="ebay-meta-row">
          ${tag}
          ${condition}
          ${endsIn}
        </div>
        <div class="ebay-price">${escapeHtml(price)}</div>
      </div>
    </a>`
}

function formatPrice(value: string, currency: string): string {
  const n = parseFloat(value)
  if (Number.isNaN(n)) return `${currency} ${value}`
  if (currency === 'USD') return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTimeRemaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'ended'
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)
  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}
