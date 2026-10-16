/** Unhandled browser crashes. Product events stay on the allowlist; this path is the only one that may carry a stack. */

export const CLIENT_ERROR_SURFACES = ['landing', 'whitepaper', 'pitchdeck', 'lobby', 'game'] as const;
export type ClientErrorSurface = (typeof CLIENT_ERROR_SURFACES)[number];

export const CLIENT_ERROR_IP_LIMIT = 10;
export const CLIENT_ERROR_IP_WINDOW_MS = 60_000;
/** Under PostHog's free 100_000 exceptions / month, with room for a bad day. */
export const CLIENT_ERROR_DAY_LIMIT = 2_000;
export const CLIENT_ERROR_MAX_FRAMES = 8;
const MAX_TEXT = 200;

const RELEASE = /^[0-9a-f]{7,40}$/;
const EXTENSION = /^(chrome|moz|safari-web)-extension:/i;
const THIRD_PARTY = /cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/i;
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{40,}/g;
const SCRIPT_ERROR = /^Script error\.?$/;
const NOISE = /ResizeObserver loop|^AbortError$/;

export interface ClientErrorFrameInput {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
}

export interface ClientErrorInput {
  surface: string;
  release: string | null;
  name: string;
  value: string;
  /** Youngest frame first, as the browser prints it. */
  frames: readonly ClientErrorFrameInput[];
}

export interface PreparedClientError {
  surface: ClientErrorSurface;
  release: string | null;
  type: string;
  value: string;
  frames: { filename: string; function: string; lineno: number; colno: number; inApp: boolean }[];
}

const isSurface = (value: string): value is ClientErrorSurface => (CLIENT_ERROR_SURFACES as readonly string[]).includes(value);

/** Null when the report is noise (a hidden cross-origin error, an extension, a known browser quirk). */
export function prepareClientError(input: ClientErrorInput): PreparedClientError | null {
  if (!isSurface(input.surface)) return null;
  const type = clip(input.name) || 'Error';
  const value = scrub(input.value);
  if (SCRIPT_ERROR.test(value) || SCRIPT_ERROR.test(type) || NOISE.test(value) || NOISE.test(type)) return null;
  const frames = [];
  let extensionOnly = input.frames.length > 0;
  for (const raw of input.frames) {
    if (frames.length >= CLIENT_ERROR_MAX_FRAMES) break;
    const filename = scrub(raw.filename);
    if (!filename || EXTENSION.test(filename)) continue;
    extensionOnly = false;
    frames.push({
      filename,
      function: clip(raw.function) || '?',
      lineno: clamp(raw.lineno, 10_000_000),
      colno: clamp(raw.colno, 1_000_000),
      inApp: !THIRD_PARTY.test(filename),
    });
  }
  if (extensionOnly) return null; // every frame belonged to a browser extension
  frames.reverse(); // PostHog reads the last frame as the throw site
  return {
    surface: input.surface,
    release: input.release && RELEASE.test(input.release) ? input.release : null,
    type,
    value: value || type,
    frames,
  };
}

function scrub(value: string): string {
  return clip(value.replace(/https?:\/\/\S+/g, (url) => url.split('?')[0] ?? url).replace(BASE58, '[redacted]').replace(/[\u0000-\u001f]/g, ' '));
}

function clip(value: string): string {
  return value.trim().slice(0, MAX_TEXT);
}

function clamp(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0) return 0;
  return value > max ? max : value;
}
