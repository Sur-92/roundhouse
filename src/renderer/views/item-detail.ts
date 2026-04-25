import { escapeHtml, on, typeLabel, conditionLabel, fmtCents, fmtDate } from '../lib/dom'
import { confirmDialog } from '../lib/dialog'
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

  const photos = await window.roundhouse.photos.listForItem(id)

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
          ${field('Condition', conditionLabel(item.condition))}
          ${field('Original box', item.original_box == null ? null : item.original_box ? 'Yes' : 'No')}
          ${field('Purchase date', fmtDate(item.purchase_date))}
          ${field('Purchase price', fmtCents(item.purchase_price_cents))}
          ${field('Current value', fmtCents(item.current_value_cents))}
          ${field('Storage location', item.storage_location)}
        </dl>
      </div>

      ${item.notes ? `<section class="item-notes"><h3>Notes</h3><p>${escapeHtml(item.notes)}</p></section>` : ''}
    </section>
  `

  el.querySelector<HTMLButtonElement>('[data-action="edit"]')!.addEventListener('click', async () => {
    if (await openItemDialog(item)) await renderItemDetail(el, params)
  })

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
    const fresh = await window.roundhouse.photos.listForItem(id)
    photosEl.innerHTML = renderPhotosBlock(fresh)
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
    .map(
      (p) => `
        <figure class="photo-tile">
          <img src="${window.roundhouse.photos.url(p.file_path)}" alt="${escapeHtml(p.caption ?? '')}" loading="lazy" />
          <button class="icon-btn danger photo-del" data-action="delete-photo" data-id="${p.id}" title="Delete photo">🗑</button>
        </figure>`
    )
    .join('')
  return `
    <div class="photo-gallery">${tiles}</div>
    <div class="photo-actions">
      <button class="btn" data-action="add-photo">Add more</button>
    </div>`
}

function field(label: string, value: unknown): string {
  if (value == null || value === '') {
    return `<div class="field-row"><dt>${escapeHtml(label)}</dt><dd class="muted">—</dd></div>`
  }
  return `<div class="field-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`
}
