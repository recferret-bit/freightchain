/* An entity's file is a data-only JS module: `export default { … };`. This module turns that text into a value WITHOUT executing it
   (a literal-only parser: objects, arrays, strings, numbers incl. hex and a leading minus, true / false / null, comments, trailing commas)
   and prints a value back as that text, deterministically. Anything else – a call, a variable, a spread, a template, a computed or
   `__proto__` key – is a syntax error, so a stored entity can never carry code. `print(parse(print(x))) === print(x)`. */

export const MAX_SOURCE = 64 * 1024;
export class SourceError extends Error {}

export function parseSource(text) {
  if (typeof text !== 'string') throw new SourceError('source must be text');
  if (text.length > MAX_SOURCE) throw new SourceError(`source is over ${MAX_SOURCE / 1024} KB`);
  let i = 0;
  const fail = msg => { const line = text.slice(0, i).split('\n').length; throw new SourceError(`line ${line}: ${msg}`); };
  const ws = () => {
    for (;;) {
      if (/\s/.test(text[i] ?? '')) { i++; continue; }
      if (text.startsWith('//', i)) { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e + 1; continue; }
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); if (e < 0) fail('unclosed comment'); i = e + 2; continue; }
      return;
    }
  };
  const word = w => { ws(); if (!text.startsWith(w, i) || /[\w$]/.test(text[i + w.length] ?? '')) return false; i += w.length; return true; };
  let depth = 0;
  function value() {
    ws(); const c = text[i];
    if (++depth > 32) fail('nested deeper than 32');
    try {
      if (c === '{') return object();
      if (c === '[') return array();
      if (c === "'" || c === '"') return string();
      if (c === '-' || c === '+' || c === '.' || /\d/.test(c ?? '')) return number();
      if (word('true')) return true; if (word('false')) return false; if (word('null')) return null;
      fail(`unexpected ${c === undefined ? 'end of file' : `'${c}'`} – only plain data (objects, arrays, strings, numbers, true/false/null) is allowed`);
    } finally { depth--; }
  }
  function number() {
    const m = /^([-+]?)(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) fail('bad number');
    i += m[0].length; const v = Number(m[2]); return m[1] === '-' ? -v : v;
  }
  function string() {
    const q = text[i++]; let s = '';
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\n' || text[i] === '\r') fail('line break in a string');
      if (text[i] === '\\') {
        const e = text[++i], map = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
        if (e === 'u') { const h = text.slice(i + 1, i + 5); if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape'); s += String.fromCharCode(parseInt(h, 16)); i += 5; continue; }
        if (!(e in map)) fail(`bad escape \\${e}`);
        s += map[e]; i++; continue;
      }
      s += text[i++];
    }
    if (text[i] !== q) fail('unclosed string');
    i++; return s;
  }
  function key() {
    ws();
    if (text[i] === "'" || text[i] === '"') return string();
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i)); if (!m) fail('expected a property name');
    i += m[0].length; return m[0];
  }
  function object() {
    i++; const o = {};
    for (;;) {
      ws(); if (text[i] === '}') { i++; return o; }
      const k = key();
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') fail(`'${k}' is not allowed as a key`);
      if (Object.prototype.hasOwnProperty.call(o, k)) fail(`duplicate key '${k}'`);
      ws(); if (text[i] !== ':') fail(`expected ':' after '${k}'`); i++;
      o[k] = value(); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return o; }
      fail("expected ',' or '}'");
    }
  }
  function array() {
    i++; const a = [];
    for (;;) {
      ws(); if (text[i] === ']') { i++; return a; }
      a.push(value()); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return a; }
      fail("expected ',' or ']'");
    }
  }
  ws(); if (!word('export') || !word('default')) fail("the file must start with 'export default'");
  const v = value(); ws(); if (text[i] === ';') i++; ws();
  if (i < text.length) fail('nothing may follow the exported value');
  return v;
}

/* Deterministic printer. Integers ≥ 0x10000 print as 0x + 6 hex digits (colours); short objects / arrays stay on one line. */
const num = n => (Number.isInteger(n) && n >= 0x10000 && n <= 0xffffff ? '0x' + n.toString(16).padStart(6, '0') : Object.is(n, -0) ? '-0' : String(n));
const str = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/[\x00-\x1f\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + "'";
const keyOf = k => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : str(k));
const WIDTH = 140;
function flat(v) {
  if (v === null) return 'null';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new SourceError('cannot print a non-finite number'); return num(v); }
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return str(v);
  if (Array.isArray(v)) return '[' + v.map(flat).join(', ') + ']';
  if (typeof v === 'object') { const e = Object.entries(v).filter(([, x]) => x !== undefined); return e.length ? '{ ' + e.map(([k, x]) => `${keyOf(k)}: ${flat(x)}`).join(', ') + ' }' : '{}'; }
  throw new SourceError(`cannot print a ${typeof v}`);
}
function block(v, ind) {
  const one = flat(v);
  if (typeof v !== 'object' || v === null || ind.length + one.length <= WIDTH) return one;
  const inner = ind + '  ';
  if (Array.isArray(v)) return '[\n' + v.map(x => inner + block(x, inner) + ',').join('\n') + '\n' + ind + ']';
  return '{\n' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${inner}${keyOf(k)}: ${block(x, inner)},`).join('\n') + '\n' + ind + '}';
}
export const printSource = v => 'export default ' + block(v, '') + ';\n';
