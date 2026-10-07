import * as THREE from 'three';

/* Night lighting for the unlit (MeshBasicMaterial) scene. At night every ordinary material is multiplied by a light map computed per fragment from its WORLD position:
   a tiny ambient + the truck's headlight cone (when the lights are on) + the nearest lamp posts. So with the headlights off the world is pitch black, and with them on the road,
   markings, props and traffic are lit where the beam falls (an additive decal could only add a flat colour, never reveal the surface).
   Materials with toneMapped:false (lamps, glow sprites, the beam decal, gantry banner) are exempt – they stay self-lit. Patched once on the prototype, so nothing else has to opt in.
   Uniforms are shared; world/daynight.js drives them every frame. */
export const LAMPS = 12;
export const NL = {
  nlDark: { value: 0 },                       // 0 day … 1 full night (dn.k)
  nlAmb: { value: .012 },                     // what is left of the world with no light at all
  nlBeam: { value: new THREE.Vector4() },     // truck x, z, sin(heading), cos(heading)
  nlBeamK: { value: 0 },                      // headlights on (0..1)
  nlBeamLen: { value: 75 }, nlBeamW: { value: 16 }, nlBeamNear: { value: 3.2 },
  nlLampCol: { value: new THREE.Vector3(1, .78, .45) },
  nlLamps: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) },   // x, z, radius, intensity (0 = unused)
};
const VDECL = 'varying vec3 nlP;\n';
const FDECL = `varying vec3 nlP; uniform float nlDark, nlAmb, nlBeamK, nlBeamLen, nlBeamW, nlBeamNear; uniform vec4 nlBeam; uniform vec3 nlLampCol; uniform vec4 nlLamps[${LAMPS}];
vec3 nlLight(vec3 p) {
  vec2 d = p.xz - nlBeam.xy; float f = d.x * nlBeam.z - d.y * nlBeam.w, l = d.x * nlBeam.w + d.y * nlBeam.z;   // metres ahead of / right of the truck
  float sig = nlBeamW * .11 + f * .025 + nlBeamNear * exp(-max(f, 0.) / 9.);   // wide right at the truck, narrowing to the pencil beam
  float b = smoothstep(-3., 3., f) * pow(clamp(1. - f / nlBeamLen, 0., 1.), 1.3) * exp(-.5 * l * l / (sig * sig));
  vec3 L = vec3(1., .93, .72) * b * nlBeamK * 1.6;
  for (int i = 0; i < ${LAMPS}; i++) { vec4 q = nlLamps[i]; if (q.w > 0.) { vec2 e = p.xz - q.xy; float t = clamp(1. - dot(e, e) / (q.z * q.z), 0., 1.); L += nlLampCol * t * t * q.w; } }
  return vec3(nlAmb) + L;
}
`;
const proto = THREE.MeshBasicMaterial.prototype;
proto.onBeforeCompile = function (shader) {
  if (this.toneMapped === false) return;
  Object.assign(shader.uniforms, NL);
  shader.vertexShader = VDECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n nlP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = FDECL + shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= mix(vec3(1.), nlLight(nlP), nlDark);\n#include <opaque_fragment>');
};
proto.customProgramCacheKey = function () { return this.toneMapped === false ? 'raw' : 'nl'; };
