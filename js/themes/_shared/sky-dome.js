import * as THREE from 'three';
import { trackMat } from './mats.js';
import { CFG } from '../../config.js';

/* Sky dome (follows the camera): horizon→zenith gradient, a sun glow + disc, and optional procedural clouds.
   horizon/zenith: [r,g,b] 0..1 – the horizon colour should match the theme's fog colour.
   sun: { dir:[x,y,z], color:[r,g,b], glow (exponent of the halo, lower = wider), size (exponent of the disc, lower = bigger), gain (disc brightness) }
   clouds: { amount 0..1, color:[r,g,b], scale (higher = smaller clouds) } */
const VERT = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }';
const FRAG = `varying vec3 vD; uniform vec3 sun, sunCol, hor, top, cloudCol, nhor, ntop, twCol; uniform float glow, size, gain, cloud, cscale, night, tw, stars;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }
  float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
  void main(){
    vec3 d = normalize(vD);
    float h = max(d.y,0.);
    vec3 c = mix(mix(hor,nhor,night), mix(top,ntop,night), pow(h,0.55));
    float sd = max(dot(d,sun),0.), day = 1.-night;
    c = mix(c, twCol, tw*.55*(1.-pow(h,.35)));   // dusk / dawn: warm band along the horizon (same blend as the fog colour, see world/daynight.js)
    c += twCol*pow(sd,5.)*tw*.5*(1.-h);
    if (night > 0. && d.y > 0.03) {   // stars: one hashed dot per cell of an (azimuth, height) grid
      vec2 g = vec2(atan(d.x,d.z)*48., d.y*90.), id = floor(g);
      float st = step(.972, hash(id))*smoothstep(.14, 0., length(fract(g)-.5));
      c += vec3(.9,.95,1.)*st*(.55+.45*hash(id+7.3))*night*stars*smoothstep(.03,.25,d.y);
    }
    vec3 moon = normalize(vec3(-.35,.42,-.85)); float md = dot(d,moon);
    c += night*(vec3(.85,.9,1.)*smoothstep(.9986,.9992,md) + vec3(.3,.4,.65)*pow(max(md,0.),90.)*.35);
    if (cloud > 0. && d.y > 0.02) {
      float n = fbm(d.xz/(d.y+.25)*cscale), m = smoothstep(1.-cloud, 1.-cloud+.25, n);
      c = mix(c, cloudCol*(1.-.93*night), m*smoothstep(.02,.25,d.y)*.85);
    }
    c += (sunCol*pow(sd,glow)*0.5 + vec3(1.,.95,.8)*pow(sd,size)*gain)*day;
    gl_FragColor = vec4(c,1.);
  }`;
export function createSkyDome({ horizon, zenith, sun, clouds = { amount: 0, color: [1, 1, 1], scale: 2 } }) {
  const v3 = a => new THREE.Vector3(...a);
  const mat = trackMat(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { sun: { value: v3(sun.dir).normalize() }, sunCol: { value: v3(sun.color) }, hor: { value: v3(horizon) }, top: { value: v3(zenith) }, cloudCol: { value: v3(clouds.color) },
      glow: { value: sun.glow }, size: { value: sun.size }, gain: { value: sun.gain }, cloud: { value: clouds.amount }, cscale: { value: clouds.scale },
      night: { value: 0 }, tw: { value: 0 }, twCol: { value: v3([1, .55, .25]) }, stars: { value: 1 }, nhor: { value: v3(CFG.NIGHT_HORIZON) }, ntop: { value: v3(CFG.NIGHT_ZENITH) } },
  }));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), mat); mesh.renderOrder = -10;
  return { mesh };
}
