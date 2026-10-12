// Two editor groups share documents while keeping tab membership and view state separate.
export class EditorGroups {
  constructor() { this.groups = [{ id: 'left', docs: [], active: null, views: new Map() }]; this.active = this.groups[0]; this.ratio = 0.5; }
  split() {
    if (this.groups.length === 1) this.groups.push({ id: 'right', docs: [], active: null, views: new Map() });
    return this.groups[1];
  }
  attach(group, doc, index = group.docs.length) {
    if (!group.docs.includes(doc)) group.docs.splice(Math.max(0, index), 0, doc);
    group.active = doc;
  }
  remove(group, doc) {
    const index = group.docs.indexOf(doc);
    if (index < 0) return;
    group.docs.splice(index, 1); group.views.delete(doc);
    if (group.active === doc) group.active = group.docs[Math.min(index, group.docs.length - 1)] || null;
  }
  owners(doc) { return this.groups.filter((g) => g.docs.includes(doc)); }
  move(doc, from, to, index = to.docs.length) {
    const view = from.views.get(doc);
    this.remove(from, doc);
    if (!to.docs.includes(doc)) {
      this.attach(to, doc, index);
      if (view) to.views.set(doc, view);
    } else to.active = doc;
  }
  join() {
    const [left, right] = this.groups;
    if (!right) return left;
    for (const doc of right.docs) {
      if (!left.docs.includes(doc)) { left.docs.push(doc); if (right.views.has(doc)) left.views.set(doc, right.views.get(doc)); }
    }
    if (this.active === right && right.active) { left.active = right.active; if (right.views.has(right.active)) left.views.set(right.active, right.views.get(right.active)); }
    this.groups = [left]; this.active = left;
    return left;
  }
  serialize() {
    return { ratio: this.ratio, activeGroup: this.active.id, groups: this.groups.map((g) => ({ id: g.id,
      documents: g.docs.filter((d) => !d.page && !d.readOnly).map((d) => d.recoveryId), active: g.active?.recoveryId || null,
      views: g.docs.filter((d) => !d.page && !d.readOnly).map((d) => ({ document: d.recoveryId, view: g.views.get(d) || d.view })) })) };
  }
}
