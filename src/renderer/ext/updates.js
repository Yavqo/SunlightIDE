// Tracks new extension versions across checks and app restarts.
export class ExtensionUpdateTracker {
  constructor({ seen = [], persist = () => {}, notify = () => {}, change = () => {} } = {}) {
    this.seen = new Set(Array.isArray(seen) ? seen.filter((s) => typeof s === 'string').slice(-500) : []);
    Object.assign(this, { persist, notify, change });
    this.updates = [];
  }
  observe({ catalog, error, registry = '', installed }, { notifications = true } = {}) {
    // A failed registry refresh does not mean previously known updates disappeared.
    if (error) {
      if (this.registry !== undefined && this.registry !== registry) this.updates = [];
      if (installed) this.updates = this.updates.filter((e) => installed.some((i) => i.id === e.id && i.source !== 'dev' && i.manifest?.version === e.installedVersion));
      this.change(this.updates);
      return;
    }
    this.registry = registry;
    this.updates = catalog.filter((e) => e.installed && e.updateAvailable && e.installedSource !== 'dev');
    this.change(this.updates);
    if (!notifications) return;
    const fresh = this.updates.filter((e) => !this.seen.has(this.key(e, registry)));
    if (!fresh.length) return;
    for (const e of fresh) this.seen.add(this.key(e, registry));
    this.seen = new Set([...this.seen].slice(-500));
    this.persist([...this.seen]);
    this.notify(fresh);
  }
  key(entry, registry) { return `${entry.source === 'registry' ? registry : 'bundled'}|${entry.id}@${entry.version}`; }
}
