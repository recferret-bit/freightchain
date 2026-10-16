const ramp = s => Math.min(1, Math.max(0, (s - 60) / 120));
export const ROUTE_CURVATURE = {
  route66: s => ramp(s) * (0.0045 * Math.sin(s / 310) + 0.0035 * Math.sin(s / 130 + 1.1) + 0.0016 * Math.sin(s / 47 + 2.0)),
  stuart: s => ramp(s) * (0.0012 * Math.sin(s / 700) + 0.0007 * Math.sin(s / 260 + 1)),
  siberia: s => ramp(s) * (0.0030 * Math.sin(s / 420) + 0.0025 * Math.sin(s / 170 + 2) + 0.0010 * Math.sin(s / 60)),
  brenner: s => ramp(s) * (0.0055 * Math.sin(s / 230) + 0.0035 * Math.sin(s / 95 + 0.6) + 0.0018 * Math.sin(s / 40 + 2)),
  panamerican: s => ramp(s) * (0.0035 * Math.sin(s / 900) + 0.0015 * Math.sin(s / 300 + 1)),
};
