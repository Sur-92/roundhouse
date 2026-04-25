export async function renderItems(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head"><h2>Items</h2></header>
      <p class="muted">Coming soon — catalog locomotives, rolling stock, buildings, figurines, and more.</p>
    </section>
  `
}
