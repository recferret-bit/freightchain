import { rnd } from '../prng.js';

/* The expression language of entity configs ('h * 0.45', 'r2 > 0.3', 'hi ? 12 : 8', 'palette[pick % len(palette)]').
   Parsed once by hand and compiled to closures – no eval / new Function, so a config can never run code.
   Evaluation follows JS exactly (same operators, precedence, IEEE order), so a builder transliterated LITERALLY
   (`11.6 - k * .35 - 0.4`, never folded to `11.2 - k * .35`) gives bit-identical numbers. */

export const LIMITS = { len: 256, tokens: 128, depth: 24, ident: 32 };
export const CONSTS = { PI: Math.PI, E: Math.E };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const FNS = {   // name → [fn, min args, max args]
  min: [Math.min, 2, 4], max: [Math.max, 2, 4], abs: [Math.abs, 1, 1], sign: [Math.sign, 1, 1], floor: [Math.floor, 1, 1], ceil: [Math.ceil, 1, 1], round: [Math.round, 1, 1],
  sqrt: [Math.sqrt, 1, 1], sin: [Math.sin, 1, 1], cos: [Math.cos, 1, 1], tan: [Math.tan, 1, 1], atan2: [Math.atan2, 2, 2], pow: [Math.pow, 2, 2],
  clamp: [clamp, 3, 3], len: [a => (Array.isArray(a) ? a.length : NaN), 1, 1], rnd: [rnd, 1, 1],
};
const BAD_IDENT = new Set(['__proto__', 'constructor', 'prototype']);
export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ExprError extends Error {}

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    const num = /^(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]), at: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(src.slice(i));
    if (id) {
      let name = id[0]; if (name.startsWith('Math.')) name = name.slice(5);
      if (name.includes('.')) throw new ExprError(`'${id[0]}' is not allowed`);
      out.push({ t: 'id', v: name, at: i }); i += id[0].length; continue;
    }
    const op = /^(===|!==|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:(),[\]])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] === '===' ? '==' : op[0] === '!==' ? '!=' : op[0], at: i }); i += op[0].length; continue; }
    throw new ExprError(`unexpected '${c}' at ${i}`);
  }
  if (out.length > LIMITS.tokens) throw new ExprError(`more than ${LIMITS.tokens} tokens`);
  return out;
}

/* Recursive descent with JS precedence: ?: < || < && < comparison < + - < * / % < unary < postfix [ ]. */
export function parseExpr(src) {
  if (typeof src !== 'string') throw new ExprError('expression must be a string');
  if (src.length > LIMITS.len) throw new ExprError(`longer than ${LIMITS.len} characters`);
  const toks = tokenize(src); let p = 0, depth = 0;
  const peek = () => toks[p], isOp = v => toks[p]?.t === 'op' && toks[p].v === v;
  const eat = v => { if (!isOp(v)) throw new ExprError(`expected '${v}'${toks[p] ? ` at ${toks[p].at}` : ' at the end'}`); p++; };
  const deeper = f => { if (++depth > LIMITS.depth) throw new ExprError(`nested deeper than ${LIMITS.depth}`); try { return f(); } finally { depth--; } };
  const cond = () => deeper(() => {
    const c = or(); if (!isOp('?')) return c;
    p++; const a = cond(); eat(':'); const b = cond(); return { k: '?', c, a, b };
  });
  const left = (next, ops) => () => { let a = next(); while (peek()?.t === 'op' && ops.includes(peek().v)) { const op = toks[p++].v; a = { k: 'bin', op, a, b: next() }; } return a; };
  const unary = () => deeper(() => {
    if (peek()?.t === 'op' && ['-', '+', '!'].includes(peek().v)) { const op = toks[p++].v; return { k: 'un', op, a: unary() }; }
    return postfix();
  });
  const mul = left(unary, ['*', '/', '%']), add = left(mul, ['+', '-']);
  const cmp = () => { const a = add(); if (peek()?.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) { const op = toks[p++].v; const b = add(); if (peek()?.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) throw new ExprError('chained comparison – use && between them'); return { k: 'bin', op, a, b }; } return a; };
  const and = left(cmp, ['&&']), or = left(and, ['||']);
  function postfix() { let a = primary(); while (isOp('[')) { p++; const i = cond(); eat(']'); a = { k: 'idx', a, i }; } return a; }
  function primary() {
    const t = toks[p++];
    if (!t) throw new ExprError('unexpected end');
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'op' && t.v === '(') { const e = cond(); eat(')'); return e; }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'num', v: t.v === 'true' };
      if (BAD_IDENT.has(t.v) || t.v.length > LIMITS.ident) throw new ExprError(`'${t.v}' is not allowed`);
      if (isOp('(')) {
        const f = FNS[t.v]; if (!f) throw new ExprError(`unknown function '${t.v}'`);
        p++; const args = []; if (!isOp(')')) { args.push(cond()); while (isOp(',')) { p++; args.push(cond()); } } eat(')');
        if (args.length < f[1] || args.length > f[2]) throw new ExprError(`${t.v}() takes ${f[1] === f[2] ? f[1] : `${f[1]}–${f[2]}`} argument(s)`);
        return { k: 'call', f: t.v, args };
      }
      if (t.v in CONSTS) return { k: 'num', v: CONSTS[t.v] };
      return { k: 'id', v: t.v };
    }
    throw new ExprError(`unexpected '${t.v}' at ${t.at}`);
  }
  const ast = cond();
  if (p < toks.length) throw new ExprError(`unexpected '${toks[p].v}' at ${toks[p].at}`);
  return ast;
}

/* A compile-time scope: every name gets a slot in ONE frame array, so a lookup is an index, not a map search.
   Loops and lets declare into a child scope (same frame); a name may not shadow another. */
export class Scope {
  constructor(parent = null) { this.parent = parent; this.names = new Map(); this.root = parent ? parent.root : this; if (!parent) this.size = 0; }
  find(name) { for (let s = this; s; s = s.parent) if (s.names.has(name)) return s.names.get(name); return -1; }
  declare(name) {
    if (!IDENT.test(name) || BAD_IDENT.has(name) || name.length > LIMITS.ident) throw new ExprError(`bad name '${name}'`);
    if (name in CONSTS || name === 'true' || name === 'false') throw new ExprError(`'${name}' is a reserved name`);   // a function name is fine: len(x) is a call, len a value
    if (this.find(name) >= 0) throw new ExprError(`'${name}' is already defined`);
    const i = this.root.size++; this.names.set(name, i); return i;
  }
  child() { return new Scope(this); }
}

/* number → constant; string → compiled closure (frame → value). Unknown names fail here, not at run time. */
export function compileExpr(src, scope) {
  if (typeof src === 'number' || typeof src === 'boolean') return () => src;
  const build = n => {
    switch (n.k) {
      case 'num': { const v = n.v; return () => v; }
      case 'id': { const i = scope.find(n.v); if (i < 0) throw new ExprError(`unknown name '${n.v}'`); return f => f[i]; }
      case 'idx': { const a = build(n.a), i = build(n.i); return f => { const l = a(f), k = i(f); return Array.isArray(l) && Number.isInteger(k) && k >= 0 && k < l.length ? l[k] : NaN; }; }
      case 'un': { const a = build(n.a); return n.op === '-' ? f => -a(f) : n.op === '+' ? f => +a(f) : f => !a(f); }
      case '?': { const c = build(n.c), a = build(n.a), b = build(n.b); return f => (c(f) ? a(f) : b(f)); }
      case 'call': {
        const fn = FNS[n.f][0], as = n.args.map(build);
        if (as.length === 1) { const [a] = as; return f => fn(a(f)); }
        if (as.length === 2) { const [a, b] = as; return f => fn(a(f), b(f)); }
        return f => fn(...as.map(a => a(f)));
      }
      case 'bin': {
        const a = build(n.a), b = build(n.b);
        switch (n.op) {
          case '+': return f => a(f) + b(f); case '-': return f => a(f) - b(f); case '*': return f => a(f) * b(f); case '/': return f => a(f) / b(f); case '%': return f => a(f) % b(f);
          case '<': return f => a(f) < b(f); case '<=': return f => a(f) <= b(f); case '>': return f => a(f) > b(f); case '>=': return f => a(f) >= b(f);
          case '==': return f => a(f) === b(f); case '!=': return f => a(f) !== b(f);
          case '&&': return f => a(f) && b(f); case '||': return f => a(f) || b(f);
        }
      }
    }
    throw new ExprError(`bad node ${n.k}`);
  };
  return build(parseExpr(src));
}
