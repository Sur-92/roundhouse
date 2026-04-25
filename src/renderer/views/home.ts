export function renderHome(el: HTMLElement): void {
  el.innerHTML = `
    <section class="hero">
      <h2>Welcome to the Roundhouse</h2>
      <p class="lede">A catalog for your model train world — locomotives, rolling stock, buildings, figurines, track, and scenery.</p>
      <div class="actions">
        <a class="btn primary" href="#/collections">Open Collections</a>
        <a class="btn" href="#/items">Browse Items</a>
      </div>
    </section>
  `
}
