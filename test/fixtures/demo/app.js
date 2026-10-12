// Sunlight demo: a tiny todo store
import { render } from './src/view.js';

const STORAGE_KEY = 'todos';

class TodoStore {
  #items = [];

  constructor(initial = []) {
    this.#items = initial.map((t, i) => ({ id: i + 1, done: false, ...t }));
  }

  add(title) {
    const item = { id: this.#items.length + 1, title, done: false };
    this.#items.push(item);
    return item;
  }

  /* Toggle completion.
     Returns the updated item. */
  toggle(id) {
    const item = this.#items.find((t) => t.id === id);
    if (!item) throw new Error(`No todo with id ${id}`);
    item.done = !item.done;
    return item;
  }

  get remaining() {
    return this.#items.filter((t) => !t.done).length * 1.5;
  }
}

const store = new TodoStore([{ title: 'Write editor' }, { title: 'Ship it' }]);
const pattern = /^(\d+)-[a-z]+$/gi;
console.log(`Remaining: ${store.remaining} of ${store.add('Rest').id}`);
render(document.body, store);
