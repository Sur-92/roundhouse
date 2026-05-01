import { escapeHtml, on, typeLabel, conditionLabel, fmtCents, fmtDate } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
import { openLightbox } from '../lib/lightbox'
import { openConditionHelp, conditionHelpDotHtml } from '../lib/condition-help'
import { renderEbayPanel } from '../lib/ebay'
import { openItemDialog } from './items'
import { navigate } from '../router'
import type { Item, ItemPhoto, TrainSet, Collection } from '@shared/types'

export async function renderItemDetail(el: HTMLElement, params: Record<string, string>): Promise<void> {
  const id = Number(params['id'])
  const item = await window.roundhouse.items.get(id)
  if (!item) {
    el.innerHTML = `<section class="panel"><h2>Not found</h2><p class="muted">No item with id ${id}.</p></section>`
    return
  }

  let parentSet: TrainSet | null = null
  let parentCollection: Collection | null = null
  if (item.set_id) {
    parentSet = await window.roundhouse.sets.get(item.set_id)
    if (parentSet) parentCollection = await window.roundhouse.collections.get(parentSet.collection_id)
  }

  let photos = await window.roundhouse.photos.listForItem(id)

  el.innerHTML = `
    <nav class="breadcrumb">
      <a href="#/items">Items</a>
      <span class="sep">›</span>
      ${parentCollection ? `<a href="#/collections/${parentCollection.id}">${escapeHtml(parentCollection.name)}</a><span class="sep">›</span>` : ''}
      ${parentSet ? `<a href="#/sets/${parentSet.id}">${escapeHtml(parentSet.name)}</a><span class="sep">›</span>` : ''}
      <span>${escapeHtml(item.name)}</span>
    </nav>

    <section class="panel item-detail">
      <header class="panel-head">
        <div>
          <h2>${escapeHtml(item.name)}</h2>
          <p class="card-meta">
            <span class="chip chip-type">${escapeHtml(typeLabel(item.type))}</span>
            ${item.scale ? `<span class="chip">${escapeHtml(item.scale)}</span>` : ''}
            ${item.manufacturer ? `<span>${escapeHtml(item.manufacturer)}</span>` : ''}
            ${item.model_number ? `<span>#${escapeHtml(item.model_number)}</span>` : ''}
          </p>
        </div>
        <div class="head-actions">
          <button class="btn" data-action="edit">Edit</button>
          <button class="btn danger" data-action="delete">Delete</button>
        </div>
      </header>

      <div class="item-grid">
        <div class="item-photos" id="photos">
          ${renderPhotosBlock(photos)}
        </div>

        <dl class="item-fields">
          ${field('Type', typeLabel(item.type))}
          ${field('Scale', item.scale)}
          ${field('Manufacturer', item.manufacturer)}
          ${field('Model number', item.model_number)}
          ${field('Road name', item.road_name)}
          ${field('Era', item.era)}
          ${field('Year', item.year)}
          ${conditionFieldRow(item.condition)}
          ${field('Original box', item.original_box == null ? null : item.original_box ? 'Yes' : 'No')}
          ${field('Purchase date', fmtDate(item.purchase_date))}
          ${field('Purchase price', fmtCents(item.purchase_price_cents))}
          ${field('Current value', fmtCents(item.current_value_cents))}
          ${field('Storage location', item.storage_location)}
          ${field('Source', item.source)}
        </dl>
      </div>

      ${item.notes ? `<section class="item-notes"><h3>Notes</h3><p>${escapeHtml(item.notes)}</p></section>` : ''}

      <div id="ebay-mount"></div>
    </section>
  `

  // Mount the eBay panel asynchronously so the rest of the page renders first.
  const ebayMount = el.querySelector<HTMLDivElement>('#ebay-mount')
  if (ebayMount) void renderEbayPanel(ebayMount, id)

  el.querySelector<HTMLButtonElement>('[data-action="edit"]')!.addEventListener('click', async () => {
    // Determine the item's collection kind so the dialog renders the
    // correct field set (train fields vs coin fields).
    let itemKind: 'trains' | 'coins' = 'trains'
    if (item.collection_id) {
      const coll = await window.roundhouse.collections.get(item.collection_id)
      if (coll) itemKind = coll.kind
    }
    if (await openItemDialog(itemKind, item)) await renderItemDetail(el, params)
  })

  // Condition help-dot in the read-only fields list
  el.querySelector<HTMLButtonElement>('[data-action="condition-help"]')?.addEventListener('click', () => openConditionHelp())

  el.querySelector<HTMLButtonElement>('[data-action="delete"]')!.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Delete "${item.name}"? All photos for this item will also be deleted.`,
      { title: 'Delete item?', destructive: true }
    )
    if (ok) {
      await window.roundhouse.items.delete(id)
      navigate('/items')
    }
  })

  const photosEl = el.querySelector<HTMLDivElement>('#photos')!

  const refreshPhotos = async (): Promise<void> => {
    photos = await window.roundhouse.photos.listForItem(id)
    photosEl.innerHTML = renderPhotosBlock(photos)
  }

  on<HTMLButtonElement>(photosEl, '[data-action="add-photo"]', 'click', async () => {
    await window.roundhouse.photos.add(id)
    await refreshPhotos()
  })

  on<HTMLButtonElement>(photosEl, '[data-action="delete-photo"]', 'click', async (_e, btn) => {
    const photoId = Number(btn.dataset['id'])
    const ok = await confirmDialog('Delete this photo?', { title: 'Delete photo?', destructive: true })
    if (ok) {
      await window.roundhouse.photos.delete(photoId)
      await refreshPhotos()
    }
  })

  on<HTMLButtonElement>(photosEl, '[data-action="set-primary"]', 'click', async (_e, btn) => {
    const photoId = Number(btn.dataset['id'])
    await window.roundhouse.photos.setPrimary(id, photoId)
    await refreshPhotos()
  })

  on<HTMLImageElement>(photosEl, '[data-action="open-lightbox"]', 'click', (_e, target) => {
    const photoId = Number(target.dataset['id'])
    const idx = photos.findIndex((p) => p.id === photoId)
    if (idx >= 0) openLightbox(photos, idx)
  })

  // Caption editing — listen on focusout for any caption input.
  photosEl.addEventListener('focusout', async (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('.photo-caption-input')
    if (!input) return
    const photoId = Number(input.dataset['id'])
    const photo = photos.find((p) => p.id === photoId)
    if (!photo) return
    const newCaption = input.value.trim() || null
    if (newCaption === photo.caption) return
    await window.roundhouse.photos.setCaption(photoId, newCaption)
    photo.caption = newCaption
  })

  // Drag-to-reorder. We update display_order on drop.
  let dragId: number | null = null
  photosEl.addEventListener('dragstart', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.photo-tile')
    if (!tile) return
    dragId = Number(tile.dataset['id'])
    tile.classList.add('dragging')
    e.dataTransfer?.setData('text/plain', String(dragId))
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  })
  photosEl.addEventListener('dragover', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.photo-tile')
    if (!tile || dragId == null) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const tiles = Array.from(photosEl.querySelectorAll<HTMLElement>('.photo-tile'))
    tiles.forEach((t) => t.classList.toggle('drag-over', t === tile && Number(t.dataset['id']) !== dragId))
  })
  photosEl.addEventListener('dragleave', (e) => {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.photo-tile')
    tile?.classList.remove('drag-over')
  })
  photosEl.addEventListener('drop', async (e) => {
    e.preventDefault()
    const overTile = (e.target as HTMLElement).closest<HTMLElement>('.photo-tile')
    photosEl.querySelectorAll<HTMLElement>('.drag-over').forEach((el) => el.classList.remove('drag-over'))
    if (dragId == null || !overTile) { dragId = null; return }
    const overId = Number(overTile.dataset['id'])
    if (dragId === overId) { dragId = null; return }
    // Re-arrange: remove dragId from current position, insert before overId.
    const newOrder = photos.map((p) => p.id).filter((id) => id !== dragId)
    const insertAt = newOrder.indexOf(overId)
    newOrder.splice(insertAt < 0 ? newOrder.length : insertAt, 0, dragId)
    dragId = null
    await window.roundhouse.photos.reorder(id, newOrder)
    await refreshPhotos()
  })
  photosEl.addEventListener('dragend', () => {
    photosEl.querySelectorAll<HTMLElement>('.dragging, .drag-over').forEach((el) => {
      el.classList.remove('dragging')
      el.classList.remove('drag-over')
    })
    dragId = null
  })
}

function renderPhotosBlock(photos: ItemPhoto[]): string {
  if (!photos.length) {
    return `
      <div class="photos-empty">
        <p class="muted">No photos yet.</p>
        <button class="btn primary" data-action="add-photo">Add photos</button>
      </div>`
  }

  const tiles = photos
    .map((p) => {
      const isPrimary = p.is_primary === 1
      const captionVal = p.caption ?? ''
      return `
        <figure class="photo-tile${isPrimary ? ' primary' : ''}" data-id="${p.id}" draggable="true" title="Drag to reorder">
          <div class="photo-tile-img-wrap" data-action="open-lightbox" data-id="${p.id}" tabindex="0">
            <img src="${window.roundhouse.photos.url(p.file_path)}" alt="${escapeHtml(captionVal)}" loading="lazy" data-action="open-lightbox" data-id="${p.id}" />
            ${isPrimary ? '<span class="primary-badge" title="Primary photo">★</span>' : ''}
          </div>
          <input class="photo-caption-input" type="text" placeholder="Add a caption…" value="${escapeHtml(captionVal)}" data-id="${p.id}" maxlength="200" />
          <div class="photo-tile-actions">
            <button class="icon-btn ${isPrimary ? 'is-primary' : ''}" data-action="set-primary" data-id="${p.id}" title="${isPrimary ? 'Primary photo' : 'Set as primary'}" ${isPrimary ? 'disabled' : ''}>★</button>
            <button class="icon-btn danger" data-action="delete-photo" data-id="${p.id}" title="Delete photo">🗑</button>
          </div>
        </figure>`
    })
    .join('')

  return `
    <div class="photo-gallery">${tiles}</div>
    <div class="photo-actions">
      <span class="muted small">Drag tiles to reorder · click an image to enlarge · ★ marks the primary photo (used as the thumbnail)</span>
      <button class="btn" data-action="add-photo">Add more</button>
    </div>`
}

function field(label: string, value: unknown): string {
  if (value == null || value === '') {
    return `<div class="field-row"><dt>${escapeHtml(label)}</dt><dd class="muted">—</dd></div>`
  }
  return `<div class="field-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`
}

/** Condition field row with a help-dot that opens the TCA grading guide. */
function conditionFieldRow(condition: string | null): string {
  const value = condition ? conditionLabel(condition) : null
  const dd = value == null || value === ''
    ? '<dd class="muted">—</dd>'
    : `<dd>${escapeHtml(String(value))}</dd>`
  return `
    <div class="field-row">
      <dt>Condition ${conditionHelpDotHtml()}</dt>
      ${dd}
    </div>`
}
