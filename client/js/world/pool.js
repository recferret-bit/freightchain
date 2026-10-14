import * as THREE from 'three';

/* Object pools for the streamed road. Leaf module (imports only three) so props.js / holes.js / the theme builders can use it.
   Sizes and shapes of props are continuous, so whole props are NOT pooled – the primitives they are made of are: every `mk()` mesh and every prop `group()`.
   Builders keep building exactly as before; chunks.js hands the whole tree back (`releaseTree`) when a chunk scrolls out of range. */

export class ObjectPool {
  /* `owned` = everything this pool ever created, so releaseTree only recycles what it owns */
  constructor(name, create, reset) { this.name = name; this.create = create; this.reset = reset; this.free = []; this.idle = new WeakSet(); this.owned = new WeakSet(); this.made = 0; this.out = 0; }
  acquire() {
    let o = this.free.pop();
    if (o) this.idle.delete(o); else { o = this.create(); this.made++; this.owned.add(o); }
    this.out++; return o;
  }
  release(o) {
    if (this.idle.has(o)) return;   // double release (e.g. a prop detached by destroyProp and then found again via its collider)
    o.parent?.remove(o); this.reset(o); this.idle.add(o); this.free.push(o); this.out--;
  }
  prewarm(n) { while (this.free.length + this.out < n) { const o = this.create(); this.made++; this.owned.add(o); this.reset(o); this.idle.add(o); this.free.push(o); } }
  get stats() { return { created: this.made, free: this.free.length, active: this.out }; }
}
/* Back to factory state: builders set rotation/scale/userData/name freely and damage.js topples props with rotateX/Z. */
const wipe = o => { o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.visible = true; o.name = ''; o.userData = {}; };
export const meshPool = new ObjectPool('mesh', () => new THREE.Mesh(), m => { wipe(m); m.geometry = null; m.material = null; m.frustumCulled = true; m.renderOrder = 0; });   // theme materials must not outlive a route switch
export const groupPool = new ObjectPool('group', () => new THREE.Group(), g => { while (g.children.length) g.remove(g.children[0]); wipe(g); });

export function mesh(geo, mat) { const m = meshPool.acquire(); m.geometry = geo; m.material = mat; return m; }
export const group = () => groupPool.acquire();

/* Return a built object tree to the pools (children first; anything not made by a pool – a vehicle or landmark root, a role group, the gantry banner – is just detached).
   Snapshot before mutating: never release while traversing. `onNode` lets the owner clean up per-object state (damage.js toppling props). */
export function releaseTree(root, onNode) {
  const nodes = []; root.traverse(o => nodes.push(o));
  for (let i = nodes.length - 1; i >= 0; i--) {
    const o = nodes[i]; onNode?.(o);
    if (meshPool.owned.has(o)) meshPool.release(o); else if (groupPool.owned.has(o)) groupPool.release(o); else o.parent?.remove(o);
  }
}
export const poolStats = () => ({ mesh: meshPool.stats, group: groupPool.stats });
