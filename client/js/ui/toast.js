import { guide } from '../guide.js';

/* Transient on-screen message. Centred in css/style.css (left 50% + translateX -50%, width max-content), so a longer line does not shift it.
   While the tutorial dialog is up, a toast that teaches the same lesson is dropped – the dialog, the green tip and the cheer already say it.
   Assist drops the ones its tip bubble raises for the same change (a grind, a stall, off the road, the battery…). A red light, a donation, the radio, a hull hit still show. */
const toastEl = document.getElementById('toast'); let toastTO = 0;
const lesson = /^(?:⚠ GRIND!|Battery too flat|Press the clutch|Hold the key in START|Engine off$|Engine running$|ENGINE STALLED|NO BRAKES|OFF ROAD!|Parking brake |BATTERY |Battery low|Engine is cold|Straining against|Engine is straining|Brakes are overheating|Headlights |Wipers:|Press I \(engine\)|Release parking brake)/;
const assistLesson = /^(?:⚠ GRIND!|Battery too flat|Hold the key in START|ENGINE STALLED|OFF ROAD!|Parking brake ON|BATTERY |Battery low|Engine is cold|Straining against|Engine is straining|Brakes are overheating)/;
const TIP = [
  [['head'], /^Headlights /],
  [['wiper', 'wash'], /^Wipers:/],
  [['park'], /^Parking brake /],
  [['GRIND', 'CLU', 'SHIFTER'], /^⚠ GRIND!/],
  [['STALL', 'key-start', 'key-on'], /^(?:ENGINE STALLED|Hold the key in START|Engine running$|Engine off$|Press the clutch|Press I \(engine\))/],
  [['BAT'], /^(?:Battery |BATTERY )/],
  [['OFF ROAD', 'WHEEL'], /^OFF ROAD!/],
  [['COLD'], /^Engine is cold/],
  [['STRAIN', 'OVER-REV', 'RPM×100'], /^(?:Engine is straining|Straining against)/],
  [['BRAKES'], /^(?:Brakes are overheating|Straining against)/],
];
const tutorialUp = () => guide.hold || !!document.body?.classList?.contains?.('tutorial');
function repeatsGuide(msg) {
  if (tutorialUp() && lesson.test(msg)) return true;
  if (guide.assist && assistLesson.test(msg)) return true;
  const ids = guide.tips.map(t => t.id);
  return TIP.some(([id, re]) => re.test(msg) && id.some(k => ids.includes(k)));
}
export function toast(msg, ms = 2200) {
  if (!toastEl || repeatsGuide(msg)) return;
  toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastTO); toastTO = setTimeout(() => toastEl.classList.remove('on'), ms);
}
