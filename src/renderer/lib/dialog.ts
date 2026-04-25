import { escapeHtml } from './dom'

export interface DialogOptions {
  title: string
  body: string | HTMLElement
  submitLabel?: string
  cancelLabel?: string
  /** Return false to prevent close. */
  onSubmit?: () => Promise<boolean | void> | boolean | void
  destructive?: boolean
}

/**
 * Shows a modal dialog using the native <dialog> element.
 * Resolves true on submit, false on cancel/close.
 */
export function openDialog(opts: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog')
    dlg.className = 'rh-dialog'

    dlg.innerHTML = `
      <form method="dialog" class="rh-dialog-form">
        <header class="rh-dialog-head">
          <h3>${escapeHtml(opts.title)}</h3>
          <button type="button" class="rh-dialog-x" aria-label="Close" data-action="cancel">×</button>
        </header>
        <div class="rh-dialog-body"></div>
        <footer class="rh-dialog-foot">
          <button type="button" class="btn" data-action="cancel">${escapeHtml(opts.cancelLabel ?? 'Cancel')}</button>
          <button type="button" class="btn ${opts.destructive ? 'danger' : 'primary'}" data-action="submit">${escapeHtml(opts.submitLabel ?? 'Save')}</button>
        </footer>
      </form>
    `

    const bodyHost = dlg.querySelector('.rh-dialog-body')!
    if (typeof opts.body === 'string') bodyHost.innerHTML = opts.body
    else bodyHost.appendChild(opts.body)

    document.body.appendChild(dlg)

    let resolved = false
    const finish = (ok: boolean): void => {
      if (resolved) return
      resolved = true
      dlg.close()
      dlg.remove()
      resolve(ok)
    }

    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      finish(false)
    })

    dlg.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement
      const action = t.dataset['action']
      if (action === 'cancel') finish(false)
      else if (action === 'submit') {
        if (opts.onSubmit) {
          const result = await opts.onSubmit()
          if (result === false) return
        }
        finish(true)
      }
    })

    dlg.showModal()

    // Focus first input if any
    const firstInput = dlg.querySelector<HTMLElement>('input, select, textarea')
    firstInput?.focus()
  })
}

export function confirmDialog(message: string, opts?: { title?: string; destructive?: boolean }): Promise<boolean> {
  return openDialog({
    title: opts?.title ?? 'Are you sure?',
    body: `<p class="dialog-message">${escapeHtml(message)}</p>`,
    submitLabel: opts?.destructive ? 'Delete' : 'OK',
    destructive: opts?.destructive
  })
}
