/* Generic object pool with WeakSet ownership tracking (`owned` / `idle`) to prevent double-release and track active/free counts. */
export class ObjectPool {
  constructor(name, create, reset) { this.name = name; this.create = create; this.reset = reset; this.free = []; this.idle = new WeakSet(); this.owned = new WeakSet(); this.made = 0; this.out = 0; }
  acquire() {
    let o = this.free.pop();
    if (o) this.idle.delete(o); else { o = this.create(); this.made++; this.owned.add(o); }
    this.out++; return o;
  }
  release(o) {
    if (this.idle.has(o)) return;
    o.parent?.remove(o); this.reset(o); this.idle.add(o); this.free.push(o); this.out--;
  }
  prewarm(n) { while (this.free.length + this.out < n) { const o = this.create(); this.made++; this.owned.add(o); this.reset(o); this.idle.add(o); this.free.push(o); } }
  get stats() { return { created: this.made, free: this.free.length, active: this.out }; }
}
