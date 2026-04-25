export async function renderHome(el: HTMLElement): Promise<void> {
  const [collections, sets, items] = await Promise.all([
    window.roundhouse.collections.list(),
    window.roundhouse.sets.list(),
    window.roundhouse.items.list()
  ])

  el.innerHTML = `
    <section class="hero">
      <h2>Welcome to the Roundhouse</h2>
      <p class="lede">Your model train catalog — locomotives, rolling stock, buildings, figurines, track, and scenery.</p>
      <div class="stats">
        <a class="stat" href="#/collections">
          <span class="stat-num">${collections.length}</span>
          <span class="stat-label">Collection${collections.length === 1 ? '' : 's'}</span>
        </a>
        <a class="stat" href="#/sets">
          <span class="stat-num">${sets.length}</span>
          <span class="stat-label">Set${sets.length === 1 ? '' : 's'}</span>
        </a>
        <a class="stat" href="#/items">
          <span class="stat-num">${items.length}</span>
          <span class="stat-label">Item${items.length === 1 ? '' : 's'}</span>
        </a>
      </div>
      <div class="actions">
        <a class="btn primary" href="#/collections">Open Collections</a>
        <a class="btn" href="#/items">Browse Items</a>
      </div>
    </section>
  `
}
