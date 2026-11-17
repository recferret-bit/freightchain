import { en } from './en.js';

export function t(key, vars) {
  let s = en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
