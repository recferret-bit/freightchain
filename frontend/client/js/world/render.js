import * as THREE from 'three';
import { CFG } from '../config.js';
import { st } from '../state.js';
import { clamp } from '../util.js';
import { curv, roadAt } from '../road.js';
import { renderer, scene, camera } from './scene.js';
import { env } from './environment.js';
import { mats as themeMats } from '../themes/_shared/mats.js';
import { MAT } from './props.js';
import { trailer, trailerMats } from './trailer.js';
import { vehicleMats, setBehindVehiclesVisible } from './vehicles.js';
import { junctionMats } from './junctions.js';
import { depotMats } from './depot.js';
import { holeMats } from './holes.js';
import { roadObjects } from './chunks.js';
import { cv, view, mirrorRects } from '../cockpit/canvas.js';
import { updateBeam } from './daynight.js';
import { SHAKE_START, SHAKE_MOVING, rpmShake } from '../sim/shake.js';

/* Per-frame 3D render: main camera, shake, trailer hitch, and the two mirror passes. */

/* Sizes the WebGL canvas + cockpit canvas. The view offset shifts the horizon up so more road shows in the windscreen. */
export function resize() {
  view.DPR = Math.min(devicePixelRatio || 1, 2); view.W = innerWidth; view.H = innerHeight;
  const { W, H, DPR } = view;
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false);
  cv.width = W * DPR; cv.height = H * DPR; camera.aspect = W / H; camera.setViewOffset(W, H, 0, H * 0.14, W, H); camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* mirror pass flips the projection, so every single-sided material must swap its culling side for that pass */
/* (the route's own materials come from themes/_shared/mats.js and change when another route is selected, so the list is rebuilt per frame) */
const flipMats = () => [...new Set([...themeMats, ...Object.values(MAT), ...trailerMats, ...vehicleMats, ...junctionMats, ...depotMats, ...holeMats])];   // a Set: a material listed twice would be flipped twice (= not at all)

const mirrorCam = new THREE.PerspectiveCamera(50, 1, 0.3, 3500); mirrorCam.rotation.order = 'YXZ';   // far must reach the sky dome (r 2500, fog:false) or it is clipped to black
function renderMirrors(px, pz, th, shake) {
  const { W, H } = view;
  const u = Math.min(H / 100, W / 150), pad = .5 * u;
  // a mirror image is x-flipped: flip the projection and swap the face culling of every material for this pass
  const FLIP_MATS = flipMats();
  for (const m of FLIP_MATS) if (m.side !== THREE.DoubleSide) m.side = m.side === THREE.BackSide ? THREE.FrontSide : THREE.BackSide;
  try {
    renderer.setScissorTest(true);
    const fx = Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = Math.sin(th), j = () => (Math.random() - .5) * shake * 2.5;
    for (const r of mirrorRects()) {
      const x = r.x - pad, y = r.y - pad, w = r.w + 2 * pad, h = r.h + 2 * pad, lat = r.side * 1.5;
      renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
      mirrorCam.aspect = w / h; mirrorCam.fov = r.side ? 56 : 22; mirrorCam.updateProjectionMatrix();
      mirrorCam.projectionMatrix.elements[0] *= -1; mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
      mirrorCam.position.set(px + rx * lat - fx * .6 + j(), 2.5 + j(), pz + rz * lat - fz * .6 + j());
      mirrorCam.rotation.set(-.03 + j() * .05, -(th + Math.PI - r.side * .07) + j() * .05, 0);
      trailer.visible = r.side !== 0;   // the centre mirror would only see the trailer's nose
      renderer.render(scene, mirrorCam);
    }
  } finally {
    trailer.visible = true; renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
    for (const m of FLIP_MATS) if (m.side !== THREE.DoubleSide) m.side = m.side === THREE.BackSide ? THREE.FrontSide : THREE.BackSide;
  }
}
export function renderWorld() {
  const p = roadAt(st.s), th = p.t + st.psi, drive = st.mode === 'drive', now = performance.now();
  const crank = st.ign && st.ign.t >= 1.0 ? .03 * (.6 + .4 * Math.sin(now / 22)) * SHAKE_START : 0, idle = st.engineOn ? (.003 + st.rpm * .000002) * SHAKE_START : 0;
  const lat = st.d, shake = drive ? (st.v * 0.0008 * SHAKE_MOVING + (st.off ? 0.05 * Math.min(1, st.v / 8) : 0) + st.jolt * 0.04 + crank + idle + st.rumble * .03 * SHAKE_START + st.crash * .2 + rpmShake() * .01) : 0;
  const px = p.x + Math.cos(p.t) * lat, pz = p.z + Math.sin(p.t) * lat, rot = shake * .14;
  camera.position.set(px + (Math.random() - .5) * shake, 2.7 + (Math.random() - .5) * shake, pz + (Math.random() - .5) * shake);
  camera.rotation.set(-0.04 + st.pitch + (Math.random() - .5) * rot, -th + (Math.random() - .5) * rot, -st.steer * 0.012 * clamp(st.v / 12, 0, 1) - curv(st.s) * st.v * Math.min(1, st.v / CFG.MAX_SPEED) * 0.5 - st.roll + crank * .12 * Math.sin(now / 37));
  env.sky.mesh.position.copy(camera.position); env.mountains.position.set(px, 0, pz); env.terrain.update(px, pz);   // sky/mountains/terrain follow the camera
  trailer.position.set(px - Math.sin(th) * 1.2, 0, pz + Math.cos(th) * 1.2); trailer.rotation.y = -st.tyaw;  trailer.userData.rev.visible = st.gear < 0 && drive;   // hitched at the kingpin, lags in curves
  updateBeam(px, pz, th);   // (the road around the truck is streamed by net/orchestrator.js before this)
  roadObjects.setBehindVisible(false, st.s, st.psi, lat); setBehindVehiclesVisible(false, px, pz, th, st.psi); trailer.visible = false;
  try { renderer.render(scene, camera); } finally { roadObjects.setBehindVisible(true, st.s, st.psi, lat); setBehindVehiclesVisible(true, px, pz, th, st.psi); trailer.visible = true; }
  renderMirrors(px, pz, th, shake);
}
