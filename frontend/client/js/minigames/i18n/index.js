import { phone } from '../../phone.js';
import { en } from './en.js';
import { ru } from './ru.js';

const PACK = { en, ru };

export function t(key, vars) {
  const pack = PACK[phone.lang] ?? en;
  let s = pack[key] ?? en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
