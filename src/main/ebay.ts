import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EbayConfig, EbayListing, EbaySearchResult, Item } from '@shared/types'

/**
 * eBay Browse API integration.
 *
 * Uses OAuth 2.0 client_credentials flow to obtain an Application Token,
 * caches it in memory until ~1 minute before expiry, then auto-refreshes.
 * The token is server-only (main process) — it never crosses to the
 * renderer. Renderer talks to us via the ebay:* IPC channels.
 *
 * Search results are cached per item for one hour to avoid pinging the
 * API on every revisit of an item's detail page.
 */

interface RawConfig {
  app_id: string
  cert_id: string
  marketplace?: string
}

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
const SCOPE = 'https://api.ebay.com/oauth/api_scope'
const CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000  // refresh 1 minute before expiry

let config: RawConfig | null = null
let cachedToken: { value: string; expiresAt: number } | null = null
const searchCache = new Map<number, { at: number; result: EbaySearchResult }>()

// ─── Config loading ──────────────────────────────────────────

function userConfigPath(): string {
  return join(app.getPath('userData'), 'ebay.json')
}

function devFallbackPath(): string {
  return join(app.getAppPath(), 'dist', 'ebay.json')
}

function readConfigFile(path: string): RawConfig | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<RawConfig>
    if (typeof raw.app_id !== 'string' || !raw.app_id.trim()) return null
    if (typeof raw.cert_id !== 'string' || !raw.cert_id.trim()) return null
    return {
      app_id: raw.app_id.trim(),
      cert_id: raw.cert_id.trim(),
      marketplace: typeof raw.marketplace === 'string' ? raw.marketplace : 'EBAY_US'
    }
  } catch {
    return null
  }
}

export function loadEbayConfig(): void {
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

export function getEbayStatus(): EbayConfig {
  if (!config) return { configured: false }
  return { configured: true, marketplace: config.marketplace ?? 'EBAY_US' }
}

// ─── OAuth token ─────────────────────────────────────────────

async function getApplicationToken(): Promise<string> {
  if (!config) throw new Error('eBay not configured')
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.value
  }

  const credentials = Buffer.from(`${config.app_id}:${config.cert_id}`).toString('base64')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new Error(`eBay auth ${res.status}: ${text || res.statusText}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  }
  return cachedToken.value
}

// ─── Query construction ──────────────────────────────────────

/**
 * Build an eBay search query from the item's identifying fields.
 * Two flavors based on which kind of collection the item lives in:
 *
 *  - Train items use manufacturer + model + name + scale (heaviest
 *    signal first, scale appended only when there's room).
 *  - Coin/bill items use year + country + face_value + denomination
 *    + mint mark, falling back to a portion of the name when the
 *    structured fields are sparse.
 *
 * Kind is inferred from which set of fields is populated on the item;
 * coins always have at least country/face_value/denomination filled.
 */
export function buildEbayQuery(item: Item): string {
  if (isCoinItem(item)) return buildCoinQuery(item)
  return buildTrainQuery(item)
}

function isCoinItem(item: Item): boolean {
  return !!(item.country || item.denomination || item.face_value != null || item.mint_mark)
}

function buildTrainQuery(item: Item): string {
  const parts: string[] = []

  if (item.manufacturer && item.manufacturer.trim()) {
    parts.push(item.manufacturer.trim())
  }
  if (item.model_number && item.model_number.trim()) {
    parts.push(`"${item.model_number.trim()}"`)
  }

  // Strip leading prefix from name: "Locomotive - Big Boy" → "Big Boy".
  const stripped = item.name.replace(/^[^-]+\s+-\s+/, '').trim()
  if (stripped) {
    const namePart = stripped.split(/\s+/).slice(0, 3).join(' ')
    if (namePart && !parts.some((p) => p.toLowerCase().includes(namePart.toLowerCase()))) {
      parts.push(namePart)
    }
  }

  if (item.scale && parts.join(' ').length < 40) {
    parts.push(item.scale)
  }

  return parts.join(' ').trim() || item.name
}

function buildCoinQuery(item: Item): string {
  const parts: string[] = []

  if (item.year != null) parts.push(String(item.year))
  if (item.country && item.country.trim()) parts.push(item.country.trim())

  // "1 Dollar", "20 Pesos", "1000 Yuan" — quote so eBay treats it as a
  // unit rather than splitting into separate tokens.
  if (item.face_value != null && item.denomination) {
    parts.push(`"${item.face_value} ${item.denomination.trim()}"`)
  } else if (item.denomination) {
    parts.push(item.denomination.trim())
  } else if (item.face_value != null) {
    parts.push(String(item.face_value))
  }

  if (item.mint_mark && item.mint_mark.trim()) {
    parts.push(item.mint_mark.trim())
  }

  // If the structured fields are sparse, append a few words from the
  // item name (often something like "Morgan Silver Dollar").
  if (parts.length < 3 && item.name) {
    const namePart = item.name
      .replace(/^[^-]+\s+-\s+/, '')
      .split(/\s+/)
      .slice(0, 4)
      .join(' ')
    if (namePart) {
      const lower = namePart.toLowerCase()
      if (!parts.some((p) => lower.includes(p.toLowerCase()))) {
        parts.push(namePart)
      }
    }
  }

  return parts.join(' ').trim() || item.name
}

// ─── Browse API search ───────────────────────────────────────

interface RawListing {
  itemId: string
  title: string
  price?: { value: string; currency: string }
  thumbnailImages?: Array<{ imageUrl: string }>
  image?: { imageUrl: string }
  condition?: string
  itemWebUrl: string
  buyingOptions?: string[]
  itemEndDate?: string
  seller?: { username: string; feedbackPercentage?: string }
}

interface RawSearchResponse {
  total?: number
  itemSummaries?: RawListing[]
  warnings?: Array<{ message?: string }>
}

function transformListing(raw: RawListing): EbayListing {
  const buyingOption = (raw.buyingOptions && raw.buyingOptions[0]) || 'FIXED_PRICE'
  return {
    itemId: raw.itemId,
    title: raw.title,
    price: raw.price ?? { value: '0.00', currency: 'USD' },
    imageUrl: raw.thumbnailImages?.[0]?.imageUrl ?? raw.image?.imageUrl ?? null,
    condition: raw.condition ?? null,
    url: raw.itemWebUrl,
    buyingOption,
    endTime: raw.itemEndDate,
    seller: {
      username: raw.seller?.username ?? '',
      feedbackPercentage: raw.seller?.feedbackPercentage
    }
  }
}

export async function searchForItem(item: Item, opts: { force?: boolean } = {}): Promise<EbaySearchResult> {
  if (!config) throw new Error('eBay not configured')

  // Cache hit?
  const cached = searchCache.get(item.id)
  if (!opts.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result
  }

  const query = buildEbayQuery(item)
  const params = new URLSearchParams({
    q: query,
    limit: '12',
    sort: 'price'
  })

  const token = await getApplicationToken()
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': config.marketplace ?? 'EBAY_US',
      Accept: 'application/json'
    }
  })

  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new Error(`eBay search ${res.status}: ${text || res.statusText}`)
  }

  const data = (await res.json()) as RawSearchResponse
  const result: EbaySearchResult = {
    query,
    total: data.total ?? 0,
    listings: (data.itemSummaries ?? []).map(transformListing),
    fetchedAt: new Date().toISOString()
  }

  searchCache.set(item.id, { at: Date.now(), result })
  return result
}

/** Clear cached search for an item — useful if its fields changed. */
export function invalidateSearchCache(itemId?: number): void {
  if (itemId == null) searchCache.clear()
  else searchCache.delete(itemId)
}
