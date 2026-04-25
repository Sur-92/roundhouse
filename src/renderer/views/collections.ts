export async function renderCollections(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head">
        <h2>Collections</h2>
        <button class="btn primary" id="new-collection">New collection</button>
      </header>
      <div id="collection-list" class="list"></div>
    </section>
  `

  const list = el.querySelector<HTMLDivElement>('#collection-list')!
  const refresh = async (): Promise<void> => {
    const all = await window.roundhouse.collections.list()
    if (!all.length) {
      list.innerHTML = `<p class="empty">No collections yet. Create your first one to get started.</p>`
      return
    }
    list.innerHTML = all
      .map(
        (c) => `
        <article class="card">
          <h3>${escapeHtml(c.name)}</h3>
          ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
        </article>`
      )
      .join('')
  }

  el.querySelector<HTMLButtonElement>('#new-collection')!.addEventListener('click', async () => {
    const name = window.prompt('Collection name?')
    if (!name) return
    await window.roundhouse.collections.create({ name, description: null })
    await refresh()
  })

  await refresh()
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  )
}
