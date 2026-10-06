/* Road centre-line as a function of distance s: curvature -> heading -> x/z table (1 m step). The road is ENDLESS: the table grows on demand.
   The curvature profile comes from the road network (js/net/network.js, which mixes the selected route's bend style with the generated layout) and is
   installed with setRoadProfile(). s < 0 (behind the depot's start line) is a straight extrapolation. Float64 tables; no origin rebasing, so past ~100 km
   the Float32 vertex data of the road meshes starts to jitter. */

let RX = new Float64Array(0), RZ = RX, RT = RX, n = 0;   // n = entries integrated so far
let profile = () => 0;
export const curv = s => profile(s);   // 1/m, + = right turn
export function setRoadProfile(fn) { profile = fn; n = 0; grow(8192); RX[0] = RZ[0] = RT[0] = 0; n = 1; }
function grow(cap) {
  if (RX.length >= cap) return;
  const c = Math.max(cap, RX.length * 2), nx = new Float64Array(c), nz = new Float64Array(c), nt = new Float64Array(c);
  nx.set(RX.subarray(0, n)); nz.set(RZ.subarray(0, n)); nt.set(RT.subarray(0, n)); RX = nx; RZ = nz; RT = nt;
}
function extend(to) {   // integrate up to index `to` (midpoint heading per 1 m step)
  if (to < n) return;
  grow(to + 2);
  for (let i = n; i <= to; i++) { const t = RT[i - 1], k = profile(i - 1), tm = t + k / 2; RX[i] = RX[i - 1] + Math.sin(tm); RZ[i] = RZ[i - 1] - Math.cos(tm); RT[i] = t + k; }
  n = to + 1;
}
setRoadProfile(profile);   // straight until a route is selected
export function roadAt(s) {
  if (!(s >= 0)) { s = s || 0; return { x: RX[0] + Math.sin(RT[0]) * s, z: RZ[0] - Math.cos(RT[0]) * s, t: RT[0] }; }
  const i = Math.floor(s), f = s - i; extend(i + 1);
  return { x: RX[i] + (RX[i + 1] - RX[i]) * f, z: RZ[i] + (RZ[i + 1] - RZ[i]) * f, t: RT[i] + (RT[i + 1] - RT[i]) * f };
}
