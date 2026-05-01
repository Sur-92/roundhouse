import { escapeHtml, fmtCents } from '../lib/dom'
import type { Item } from '@shared/types'

/**
 * v0.5.0 redesign: two small collection cards near the bottom so the
 * background image (the new Trains·Coins·Journeys composition) gets
 * to dominate the visual frame.
 */
export async function renderHome(el: HTMLElement): Promise<void> {
  const [trainsCol, coinsCol] = await Promise.all([
    window.roundhouse.collections.getByKind('trains'),
    window.roundhouse.collections.getByKind('coins')
  ])

  const [trainItems, coinItems] = await Promise.all([
    window.roundhouse.items.list({ collectionKind: 'trains' }),
    window.roundhouse.items.list({ collectionKind: 'coins' })
  ])

  const trainStats = computeStats(trainItems, 'trains')
  const coinStats = computeStats(coinItems, 'coins')

  el.innerHTML = `
    <section class="home-overlay">
      <div class="home-greeting">
        <h2>Welcome to the Roundhouse</h2>
        <p class="muted">Trains · Coins · Journeys</p>
      </div>

      <div class="collection-cards">
        <a class="collection-card collection-card--trains" href="#/trains">
          <span class="collection-emoji" aria-hidden="true">🚂</span>
          <div class="collection-card-body">
            <h3>${escapeHtml(trainsCol?.name ?? 'Trains')}</h3>
            <p class="collection-stats">
              <strong>${trainStats.count.toLocaleString()}</strong> ${trainStats.count === 1 ? 'item' : 'items'}
              ${trainStats.totalCents > 0 ? ` · <strong>${fmtCents(trainStats.totalCents)}</strong> purchased` : ''}
            </p>
          </div>
        </a>

        <a class="collection-card collection-card--coins" href="#/coins">
          <span class="collection-emoji" aria-hidden="true">🪙</span>
          <div class="collection-card-body">
            <h3>${escapeHtml(coinsCol?.name ?? 'Coins')}</h3>
            <p class="collection-stats">
              <strong>${coinStats.count.toLocaleString()}</strong> ${coinStats.count === 1 ? 'record' : 'records'}
              ${coinStats.totalCents > 0 ? ` · <strong>${fmtCents(coinStats.totalCents)}</strong> current value` : ''}
            </p>
          </div>
        </a>
      </div>
    </section>
  `
}

function computeStats(items: Item[], kind: 'trains' | 'coins'): { count: number; totalCents: number } {
  if (kind === 'trains') {
    const totalCents = items.reduce((sum, i) => sum + (i.purchase_price_cents ?? 0), 0)
    return { count: items.length, totalCents }
  }
  // coins: total = sum(quantity × current_value_cents)
  const totalCents = items.reduce(
    (sum, i) => sum + ((i.current_value_cents ?? 0) * (i.quantity || 1)),
    0
  )
  return { count: items.length, totalCents }
}
