// Minimal fake of the three.js subset used, enough to run game logic headless in Node.
class V { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} project(){return this;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(o){this.x=o.x;this.y=o.y;this.z=o.z;return this;} setScalar(s){this.x=this.y=this.z=s;return this;} normalize(){return this;} invert(){return this;} }
class Obj { constructor(){this.position=new V();this.scale=new V(1,1,1);this.rotation=Object.assign(new V(),{order:'XYZ'});this.children=[];this.userData={};this.visible=true;this.parent=null;this.material=null;}
  add(...c){for(const o of c){o.parent=this;this.children.push(o);}return this;} remove(o){const i=this.children.indexOf(o);if(i>=0)this.children.splice(i,1);o.parent=null;return this;}
  traverse(f){f(this);for(const c of this.children)c.traverse(f);} rotateX(a){this.rotation.x+=a;} rotateZ(a){this.rotation.z+=a;} }
export class Group extends Obj {} export class Scene extends Obj { constructor(){super();this.fog=null;} }
export class Mesh extends Obj { constructor(g,m){super();this.geometry=g||{dispose(){}};this.material=Array.isArray(m)?m[0]:m;} }
export class PerspectiveCamera extends Obj { constructor(){super();this.projectionMatrix={elements:new Array(16).fill(1)};this.projectionMatrixInverse={copy(){return this;},invert(){return this;}};} updateProjectionMatrix(){} setViewOffset(){} }
export class WebGLRenderer { constructor(){this.calls=0;} setPixelRatio(){} setSize(){} setViewport(){} setScissor(){} setScissorTest(){} render(){this.calls++;} }
const geo = class { dispose(){} rotateY(){return this;} setAttribute(){} setIndex(){} setDrawRange(){} };
export const BoxGeometry=geo, ConeGeometry=geo, CylinderGeometry=geo, DodecahedronGeometry=geo, CircleGeometry=geo, PlaneGeometry=geo, SphereGeometry=geo, BufferGeometry=geo, BufferAttribute=class{};
export class MeshBasicMaterial { constructor(o={}){Object.assign(this,{side:0,userData:{}},o);} } export class ShaderMaterial extends MeshBasicMaterial {}
export class CanvasTexture { constructor(){this.repeat={set(){}};this.offset={set(){}};} }
export class Fog { constructor(_c,n,f){this.color={setRGB(){return this;}};this.near=n;this.far=f;} } export { V as Vector3 }; export class Vector4 { constructor(x=0,y=0,z=0,w=0){Object.assign(this,{x,y,z,w});} set(x,y,z,w){Object.assign(this,{x,y,z,w});return this;} }
export class Sprite extends Obj { constructor(m){super();this.material=m;} } export class SpriteMaterial extends MeshBasicMaterial {}
export const AdditiveBlending=2, LinearToneMapping=1;
export const BackSide=1, FrontSide=0, DoubleSide=2, RepeatWrapping=1000, ClampToEdgeWrapping=1001, LinearFilter=1006, SRGBColorSpace='srgb';
