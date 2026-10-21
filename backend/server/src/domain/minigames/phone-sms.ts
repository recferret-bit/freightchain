import { MG_GRID } from '../shared/index.js';
import { WINDOW_MS, type MgLang, type MgMode } from './kinds.js';
import { answerHashHex, type MgMac } from './mac.js';
import { hex16, subseedRng } from './prng.js';
import { CODE_SVG, MARK_SVG, renderMark, renderMarkedCode, TEXT_SVG } from './svg.js';

/**
 * Twelve lines a side. They stay in the repo so the banned-word check has a corpus.
 * They are not painted: letter cells are not readable, and painting `{code}` into the
 * message would put the answer on the phone. The message is a mark. One cab slip
 * shows that same mark plus the digits. No "seed" / "сид" / "recovery".
 */
const EN = [
  'YARD GATE {code} BAY', 'DOCK PIN {code} LANE', 'DISPATCH SLIP {code}', 'NIGHT DESK {code} DOOR',
  'LOADING DOCK {code}', 'GATEHOUSE {code} LANE', 'TRAILER LOCK {code}', 'WAREHOUSE {code} DOOR',
  'SHIFT LEAD {code} BAY', 'RAMP SLOT {code} EAST', 'CAB CARD {code} COPY', 'LOT ROW {code} SOUTH',
];
const RU = [
  'ДИСПЕТЧЕР БЕЙ {code}', 'СКЛАД ВОРОТА {code}', 'ДОК НОМЕР {code}', 'ОХРАНА КПП {code}',
  'СМЕНА ЯЩИК {code}', 'РАМПА СЛОТ {code}', 'ГРУЗ МЕСТО {code}', 'БАЗА ВЪЕЗД {code}',
  'НОЧЬ ПОСТ {code}', 'КОЛОННА РЯД {code}', 'ПРИЦЕП ЛЮК {code}', 'СТОЯНКА РЯД {code}',
];

export interface PhoneLayout {
  threads: { id: string; role: string; bubbles: { id: string; assetId: string }[] }[];
  cab: { id: string; assetId: string }[];
  keys: string[];
  sendSlot: number;
  /** Home-grid permutation. Null slots stay empty. This is not the answer. */
  iconOrder: (string | null)[];
}

export interface PhoneSms {
  id: string;
  code: string;
  answerHash: string;
  nonce: string;
  windowMs: number;
  layout: PhoneLayout;
  svgs: Record<string, string>;
  /** Same-length decoys on the other cab slips and in the other threads. The answer is not in this list. */
  distractors: string[];
}

function digits(rnd: () => number, len: number, banned: Set<string>): string {
  for (let i = 0; i < 40; i++) {
    let s = '';
    for (let k = 0; k < len; k++) s += Math.floor(rnd() * 10).toString();
    if (!banned.has(s)) return s;
  }
  let s = '1'.repeat(len);
  while (banned.has(s)) s = String((Number(s) + 1) % 10 ** len).padStart(len, '0');
  return s;
}

function shuffleKeys(rnd: () => number): string[] {
  const keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  if (rnd() < 0.3) return keys; // 30% ordered, 70% shuffled — the draw is the subseed
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = keys[i]!, b = keys[j]!;
    keys[i] = b;
    keys[j] = a;
  }
  return keys;
}

/**
 * phone-sms for one variant. Asset ids come from the variant subseed (not a hash of the code).
 * The dispatch picture is a mark with no digits. One of the 5–7 cab slips repeats that mark
 * beside the code; the other slips use other marks and other codes. more-time: 60s, no decoy threads.
 */
export function buildPhoneSms(mac: MgMac, salt: Uint8Array, ordinal: number, variantSeq: number, lang: MgLang, mode: MgMode): PhoneSms {
  const idRnd = subseedRng(mac, salt, `ev:${ordinal}:id`);
  const vRnd = subseedRng(mac, salt, `ev:${ordinal}:v:${variantSeq}`);
  const nRnd = subseedRng(mac, salt, `ev:${ordinal}:nonce:${variantSeq}`);
  const len = 4 + Math.floor(vRnd() * 3);
  const windowText = String(WINDOW_MS[mode]);
  // `2000` is inside the SVG namespace URL, so it is never a code or a distractor.
  const reserved = new Set(['2000']);
  let code = digits(vRnd, len, reserved);
  for (let i = 0; i < 20 && windowText.includes(code); i++) code = digits(vRnd, len, reserved);
  const id = hex16(idRnd, code);
  const nonce = hex16(nRnd, code);
  const banned = new Set([code, ...reserved]);
  const cabN = 5 + Math.floor(vRnd() * 3);
  const decoyCab = Array.from({ length: cabN - 1 }, () => digits(vRnd, len, banned));
  for (const c of decoyCab) banned.add(c);
  const extraThreads = mode === 'more-time' ? 0 : 1 + (vRnd() < 0.5 ? 0 : 1);
  const threadCodes = Array.from({ length: extraThreads }, () => digits(vRnd, len, banned));
  for (const c of threadCodes) banned.add(c);
  // `lang` selects the corpus above. The pictures do not spell those lines.
  void lang;
  const marks = [0, 1, 2, 3, 4, 5, 6];
  for (let i = marks.length - 1; i > 0; i--) {
    const j = Math.floor(vRnd() * (i + 1));
    const a = marks[i]!, b = marks[j]!;
    marks[i] = b;
    marks[j] = a;
  }
  const answerMark = marks[0]!;
  const svgs: Record<string, string> = {};
  const takeId = (): string => hex16(vRnd, code);
  const paintMark = (mark: number, box: { w: number; h: number }): string => {
    const assetId = takeId();
    svgs[assetId] = renderMark(mark, vRnd, box);
    return assetId;
  };
  const paintCode = (value: string, mark: number, box: { w: number; h: number }): string => {
    const assetId = takeId();
    svgs[assetId] = renderMarkedCode(value, mark, vRnd, box);
    return assetId;
  };
  const roles = ['tyres', 'operator', 'mom'];
  const decoyMarks = marks.slice(1);
  const threads: PhoneLayout['threads'] = [{
    id: hex16(vRnd, code),
    role: 'dispatch',
    bubbles: [{ id: hex16(vRnd, code), assetId: paintMark(answerMark, MARK_SVG) }],
  }];
  threadCodes.forEach((value, i) => threads.push({
    id: hex16(vRnd, code),
    role: roles[i % roles.length]!,
    bubbles: [{ id: hex16(vRnd, code), assetId: paintCode(value, decoyMarks[i % decoyMarks.length]!, TEXT_SVG) }],
  }));
  // thread order shuffled; the answer thread is not pinned to slot 0
  for (let i = threads.length - 1; i > 0; i--) {
    const j = Math.floor(vRnd() * (i + 1));
    const a = threads[i]!, b = threads[j]!;
    threads[i] = b;
    threads[j] = a;
  }
  const slips = [
    { value: code, mark: answerMark },
    ...decoyCab.map((value, i) => ({ value, mark: decoyMarks[i % decoyMarks.length]! })),
  ];
  for (let i = slips.length - 1; i > 0; i--) {
    const j = Math.floor(vRnd() * (i + 1));
    const a = slips[i]!, b = slips[j]!;
    slips[i] = b;
    slips[j] = a;
  }
  const cab = slips.map((slip) => ({ id: hex16(vRnd, code), assetId: paintCode(slip.value, slip.mark, CODE_SVG) }));
  const iconOrder: (string | null)[] = [...MG_GRID];
  for (let i = iconOrder.length - 1; i > 0; i--) {
    const j = Math.floor(vRnd() * (i + 1));
    const a = iconOrder[i] ?? null;
    iconOrder[i] = iconOrder[j] ?? null;
    iconOrder[j] = a;
  }
  const layout: PhoneLayout = { threads, cab, keys: shuffleKeys(vRnd), sendSlot: Math.floor(vRnd() * 3), iconOrder };
  return {
    id, code, answerHash: answerHashHex(mac, id, code), nonce, windowMs: WINDOW_MS[mode], layout, svgs,
    distractors: [...decoyCab, ...threadCodes],
  };
}

/** Wire body of POST open. The expected code is not a field and must not appear as a substring. */
export interface MinigameOpenDto {
  id: string;
  ordinal: number;
  kind: 'phone-sms';
  variantSeq: number;
  nonce: string;
  windowMs: number;
  revealedAt: number;
  layout: PhoneLayout;
}

export function openPayload(built: PhoneSms, ordinal: number, variantSeq: number, revealedAt: number): MinigameOpenDto {
  return {
    id: built.id, ordinal, kind: 'phone-sms', variantSeq, nonce: built.nonce, windowMs: built.windowMs, revealedAt,
    layout: built.layout,
  };
}

export const templateCounts = (): { en: number; ru: number } => ({ en: EN.length, ru: RU.length });
/** The yard-desk lines. Tests check they never say seed / сид / recovery / invest / profit. */
export const phoneTemplateTexts = (): readonly string[] => [...EN, ...RU];
