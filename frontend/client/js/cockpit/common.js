/* Shared 2D dash widgets and declarative button descriptors. */
export const DASH_WIDGET_BTNS = {
  heat: { id: 'heat', label: 'HEAT' },
  cold: { id: 'cold', label: 'COLD' },
  prev: { id: 'r-prev', label: '‹' },
  pwr:  { id: 'r-pwr',  label: 'PWR' },
  next: { id: 'r-next', label: '›' },
};

export { litShapes, litRect, litCircle, chromeGrad, uiBtns, uiButton } from './primitives.js';
export { gauge, miniGauge, ledBar } from './gauges.js';
export { stallLamp, lamp, warnLamp, strainLamp, brakeLamp, batLamp, climateButton, heatButton, coldButton } from './lamps.js';
export { keyAnim, ignitionPanel } from './ignition.js';
export { radioPanel } from './radio-panel.js';
export { lever, LEVER_RATE, leverPos, drawShifter } from './shifter.js';
