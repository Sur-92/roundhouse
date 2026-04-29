import { escapeHtml } from './dom'
import type { ItemPhoto } from '@shared/types'

/**
 * Fullscreen image viewer for an item's photo gallery.
 *
 * Opens a modal <dialog> with the selected photo big, plus prev/next
 * navigation (← →), keyboard arrows, ESC to close, and the caption
 * shown beneath. The dialog autoclose is via popover-like behavior —
 * click the backdrop or press ESC to dismiss.
 */
export function openLightbox(photos: ItemPhoto[], startIndex: number): void {
  if (!photos.length) return
  let index = Math.max(0, Math.min(startIndex, photos.length - 1))

  const dlg = document.createElement('dialog')
  dlg.className = 'lightbox'
  dlg.innerHTML = `
    <button type="button" class="lightbox-close" data-action="close" aria-label="Close">×</button>
    <button type="button" class="lightbox-nav lightbox-prev" data-action="prev" aria-label="Previous">‹</button>
    <button type="button" class="lightbox-nav lightbox-next" data-action="next" aria-label="Next">›</button>
    <figure class="lightbox-figure">
      <img class="lightbox-image" alt="" />
      <figcaption class="lightbox-caption"></figcaption>
    </figure>
    <div class="lightbox-counter"></div>
  `

  const img = dlg.querySelector<HTMLImageElement>('.lightbox-image')!
  const caption = dlg.querySelector<HTMLElement>('.lightbox-caption')!
  const counter = dlg.querySelector<HTMLElement>('.lightbox-counter')!
  const prevBtn = dlg.querySelector<HTMLButtonElement>('[data-action="prev"]')!
  const nextBtn = dlg.querySelector<HTMLButtonElement>('[data-action="next"]')!

  const update = (): void => {
    const p = photos[index]!
    img.src = window.roundhouse.photos.url(p.file_path)
    img.alt = p.caption ?? ''
    caption.textContent = p.caption ?? ''
    caption.style.visibility = p.caption ? 'visible' : 'hidden'
    counter.textContent = `${index + 1} / ${photos.length}`
    prevBtn.disabled = photos.length <= 1
    nextBtn.disabled = photos.length <= 1
  }

  const go = (delta: number): void => {
    index = (index + delta + photos.length) % photos.length
    update()
  }

  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const action = t.closest<HTMLElement>('[data-action]')?.dataset['action']
    if (action === 'close' || t === dlg) {
      dlg.close()
    } else if (action === 'prev') {
      go(-1)
    } else if (action === 'next') {
      go(1)
    }
  })

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
  })

  dlg.addEventListener('close', () => dlg.remove())

  document.body.appendChild(dlg)
  update()
  dlg.showModal()
}
