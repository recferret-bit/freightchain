// Recording fake of the three.js subset the 3D builders use: keeps every constructor argument, transform and material option,
// so tools/parity/dump.mjs can compare the object trees two code versions build (bit-exact, in Node, no WebGL).
let ids = 0;
class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } setScalar(s) { this.x = this.y = this.z = s; return this; } project() { return this; } normalize() { return this; } invert() { return this; } }
class Obj {
  constructor() { this.position = new V(); this.scale = new V(1, 1, 1); this.rotation = Object.assign(new V(), { order: 'XYZ' }); this.children = []; this.userData = {}; this.visible = true; this.parent = null; this.name = ''; this.renderOrder = 0; this.frustumCulled = true; this.uid = ++ids; }
  add(...c) { for (const o of c) { if (o.parent) o.parent.remove(o); o.parent = this; this.children.push(o); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); } rotateX(a) { this.rotation.x += a; } rotateZ(a) { this.rotation.z += a; }
}
export class Object3D extends Obj { constructor() { super(); this.type = 'Object3D'; } }
export class Group extends Obj { constructor() { super(); this.type = 'Group'; } }
export class Scene extends Obj { constructor() { super(); this.type = 'Scene'; this.fog = null; } }
export class Mesh extends Obj { constructor(g = null, m = null) { super(); this.type = 'Mesh'; this.geometry = g; this.material = m; } }
export class Sprite extends Obj { constructor(m) { super(); this.type = 'Sprite'; this.material = m; } }
export class Line extends Obj {} export class LineSegments extends Obj {} export class Points extends Obj {} export class InstancedMesh extends Mesh {}
export class PerspectiveCamera extends Obj { constructor() { super(); this.projectionMatrix = { elements: new Array(16).fill(1) }; this.projectionMatrixInverse = { copy() { return this; }, invert() { return this; } }; } updateProjectionMatrix() {} setViewOffset() {} }
export class OrthographicCamera extends PerspectiveCamera {}
export class WebGLRenderer { constructor() { this.calls = 0; this.domElement = {}; } setPixelRatio() {} setSize() {} setViewport() {} setScissor() {} setScissorTest() {} render() { this.calls++; } setClearColor() {} }
const geo = name => class { constructor(...args) { this.kind = name; this.args = args; this.ops = []; this.attributes = {}; } dispose() {} rotateX(a) { this.ops.push(['rotateX', a]); return this; } rotateY(a) { this.ops.push(['rotateY', a]); return this; } rotateZ(a) { this.ops.push(['rotateZ', a]); return this; } translate(...a) { this.ops.push(['translate', ...a]); return this; } scale(...a) { this.ops.push(['scale', ...a]); return this; } setAttribute(n) { this.ops.push(['attr', n]); return this; } setIndex() { return this; } setDrawRange() {} computeVertexNormals() {} computeBoundingBox() {} };
export const BoxGeometry = geo('Box'), ConeGeometry = geo('Cone'), CylinderGeometry = geo('Cylinder'), DodecahedronGeometry = geo('Dodecahedron'), CircleGeometry = geo('Circle'), PlaneGeometry = geo('Plane'), SphereGeometry = geo('Sphere'), BufferGeometry = geo('Buffer'), EdgesGeometry = geo('Edges'), RingGeometry = geo('Ring'), TorusGeometry = geo('Torus');
export class BufferAttribute { constructor(a, n) { this.array = a; this.itemSize = n; } }
export class Float32BufferAttribute extends BufferAttribute {}
export class Color { constructor(c) { this.c = c; } set(c) { this.c = c; return this; } setRGB() { return this; } setHex(c) { this.c = c; return this; } clone() { return new Color(this.c); } copy(o) { this.c = o.c; return this; } }
const mat = name => class { constructor(o = {}) { this.kind = name; this.opts = { ...o }; this.userData = {}; this.side = 0; Object.assign(this, o); } dispose() {} clone() { return new this.constructor(this.opts); } };
export const MeshBasicMaterial = mat('MeshBasic'), SpriteMaterial = mat('Sprite'), ShaderMaterial = mat('Shader'), LineBasicMaterial = mat('LineBasic'), MeshLambertMaterial = mat('MeshLambert'), PointsMaterial = mat('Points');
export class CanvasTexture { constructor(c) { this.log = c?.log ?? null; this.repeat = { set() {} }; this.offset = { set() {} }; } dispose() {} }
export class Texture extends CanvasTexture {} export class DataTexture extends CanvasTexture {}
export class Fog { constructor(_c, n, f) { this.color = { setRGB() { return this; } }; this.near = n; this.far = f; } }
export { V as Vector3 }; export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector4 { constructor(x = 0, y = 0, z = 0, w = 0) { Object.assign(this, { x, y, z, w }); } set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; } }
export class Euler extends V {} export class Matrix4 { constructor() { this.elements = new Array(16).fill(0); } } export class Quaternion {} export class Raycaster {} export class Box3 {} export class Clock { getDelta() { return 0; } }
export class GridHelper extends Obj {} export class AmbientLight extends Obj {} export class DirectionalLight extends Obj {}
export const AdditiveBlending = 2, NormalBlending = 1, LinearToneMapping = 1, BackSide = 1, FrontSide = 0, DoubleSide = 2, RepeatWrapping = 1000, ClampToEdgeWrapping = 1001, LinearFilter = 1006, NearestFilter = 1003, SRGBColorSpace = 'srgb', MathUtils = { degToRad: d => d * Math.PI / 180, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };
