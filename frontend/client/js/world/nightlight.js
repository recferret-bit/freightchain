import * as THREE from 'three';
import { CFG } from '../config.js';

/* Night lighting for the unlit (MeshBasicMaterial) scene, plus a daytime form shade.
   At night every ordinary material is multiplied by a light map computed per fragment from its WORLD position:
   a tiny ambient + the truck's headlight cone (when the lights are on) + the nearest lamp posts. So with the headlights off the world is pitch black, and with them on the road,
   markings, props and traffic are lit where the beam falls (an additive decal could only add a flat colour, never reveal the surface).
   By day (CFG.FORM_SHADE, F8) the same patch multiplies by a soft half-Lambert of the world normal, and darkens the last 2 cm of a box edge.
   Faces that point up (the road, roofs) stay at the flat colour, so the driving surface does not shift with the sun. The term fades with night, so the headlight cone stays even.
   Materials with toneMapped:false (lamps, glow sprites, the beam decal, gantry banner) are exempt – they stay self-lit. Patched once on the prototype, so nothing else has to opt in.
   Uniforms are shared; world/daynight.js drives them every frame. A box marks itself with the boxHalf attribute (props.js markBox); anything else gets (0,0,0) and no seam. */
export const LAMPS = 12;
export const NL = {
  nlDark: { value: 0 },                       // 0 day … 1 full night (dn.k)
  nlAmb: { value: .012 },                     // what is left of the world with no light at all
  nlBeam: { value: new THREE.Vector4() },     // truck x, z, sin(heading), cos(heading)
  nlBeamK: { value: 0 },                      // headlights on (0..1)
  nlBeamLen: { value: 75 }, nlBeamW: { value: 16 }, nlBeamNear: { value: 3.2 },
  nlLampCol: { value: new THREE.Vector3(1, .78, .45) },
  nlLamps: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) },   // x, z, radius, intensity (0 = unused)
  formSun: { value: new THREE.Vector3(0.62, 0.48, -0.35).normalize() },   // viewer default (a low sun, so the sides differ). daynight.js copies the route's sun once the game loop runs
  formK: { value: 1 },                        // 0 flat … 1 full form shade (already includes the night fade when the game loop runs)
};
/* boxHalf is the geometry's half-extent in its own space (0 = not a box). nlLm / nlLh are that point and that half-extent in metres along the mesh axes. */
const VDECL = 'attribute vec3 boxHalf;\nvarying vec3 nlP;\nvarying vec3 nlN;\nvarying vec3 nlLm;\nvarying vec3 nlLh;\n';
const VBODY = `
vec3 nlS = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
nlP = (modelMatrix * vec4(transformed, 1.0)).xyz;
// the normal attribute is in three's shader prefix. objectNormal exists only for an env map or skinning, which these materials do not use.
nlN = cross(modelMatrix[1].xyz, modelMatrix[2].xyz) * normal.x + cross(modelMatrix[2].xyz, modelMatrix[0].xyz) * normal.y + cross(modelMatrix[0].xyz, modelMatrix[1].xyz) * normal.z;
nlLm = position * nlS; nlLh = boxHalf * nlS;
`;
const FDECL = `varying vec3 nlP; varying vec3 nlN; varying vec3 nlLm; varying vec3 nlLh;
uniform float nlDark, nlAmb, nlBeamK, nlBeamLen, nlBeamW, nlBeamNear, formK; uniform vec4 nlBeam; uniform vec3 nlLampCol, formSun; uniform vec4 nlLamps[${LAMPS}];
vec3 nlLight(vec3 p) {
  vec2 d = p.xz - nlBeam.xy; float f = d.x * nlBeam.z - d.y * nlBeam.w, l = d.x * nlBeam.w + d.y * nlBeam.z;   // metres ahead of / right of the truck
  float sig = nlBeamW * .11 + f * .025 + nlBeamNear * exp(-max(f, 0.) / 9.);   // wide right at the truck, narrowing to the pencil beam
  float b = smoothstep(-3., 3., f) * pow(clamp(1. - f / nlBeamLen, 0., 1.), 1.3) * exp(-.5 * l * l / (sig * sig));
  vec3 L = vec3(1., .93, .72) * b * nlBeamK * 1.6;
  for (int i = 0; i < ${LAMPS}; i++) { vec4 q = nlLamps[i]; if (q.w > 0.) { vec2 e = p.xz - q.xy; float t = clamp(1. - dot(e, e) / (q.z * q.z), 0., 1.); L += nlLampCol * t * t * q.w; } }
  return vec3(nlAmb) + L;
}
float formShade() {
  float len2 = dot(nlN, nlN);
  vec3 n = len2 > 1e-6 ? nlN * inversesqrt(len2) : vec3(0.0, 1.0, 0.0);
  float shade = mix(0.62, 1.0, clamp(dot(n, formSun) * 0.5 + 0.5, 0.0, 1.0));   // soft half-Lambert: a hard one facets the 7-sided props
  shade = mix(shade, 1.0, smoothstep(0.45, 0.9, n.y));   // upward faces stay at the painted colour (the road must not dip when the sun is low)
  float seam = 1.0;
  if (nlLh.x > 0.0) {   // metres to the nearest edge of this face; computed here so a shared corner (distance 0) does not paint the whole face
    vec3 e = nlLh - abs(nlLm); float lo = min(e.x, min(e.y, e.z)), hi = max(e.x, max(e.y, e.z)), mid = e.x + e.y + e.z - lo - hi;
    seam = 1.0 - (1.0 - smoothstep(0.0, 0.02, mid)) * 0.38;
  }
  return mix(1.0, shade * seam, formK);
}
`;
const proto = THREE.MeshBasicMaterial.prototype;
proto.onBeforeCompile = function (shader) {
  if (this.toneMapped === false) return;
  // r160 MeshBasicMaterial has no defaultAttributeValues (only ShaderMaterial does). Without it a geometry
  // that lacks boxHalf or normal leaves the attribute unbound and the seam/normal read garbage.
  const d = this.defaultAttributeValues ??= { color: [1, 1, 1], uv: [0, 0], uv1: [0, 0] };
  if (d.boxHalf === undefined) d.boxHalf = [0, 0, 0];   // cylinders, planes: no seam
  if (d.normal === undefined) d.normal = [0, 1, 0];     // a ribbon with no normals faces up, so the form term leaves it flat
  Object.assign(shader.uniforms, NL);
  shader.vertexShader = VDECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VBODY);
  shader.fragmentShader = FDECL + shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= formShade() * mix(vec3(1.), nlLight(nlP), nlDark);\n#include <opaque_fragment>');
};
proto.customProgramCacheKey = function () { return this.toneMapped === false ? 'raw' : 'nl'; };

/* F8 in the game and the viewer. The game loop (daynight.js) reapplies the night fade on top of this every frame. */
export function setFormShade(on) {
  CFG.FORM_SHADE = on ? 1 : 0; NL.formK.value = CFG.FORM_SHADE; return CFG.FORM_SHADE;
}
export const toggleFormShade = () => setFormShade(!CFG.FORM_SHADE);
