export function render(el, store) {
  el.textContent = String(store.remaining);
}
