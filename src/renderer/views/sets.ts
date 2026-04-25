export async function renderSets(el: HTMLElement): Promise<void> {
  el.innerHTML = `
    <section class="panel">
      <header class="panel-head"><h2>Sets</h2></header>
      <p class="muted">Coming soon — list, create, and edit sets within a collection.</p>
    </section>
  `
}
