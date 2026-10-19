import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HONK_PARTS } from '../../../../src/domain/honk/parts-catalog.js';

const rust = readFileSync(join(import.meta.dirname, '../../../../../programs/freightchain_honk/src/catalog.rs'), 'utf8');

describe('HONK catalog drift', () => {
  it('the program sells the same pairs, at the same gold flag, as the ledger catalog', () => {
    const pairs = [...rust.matchAll(/\("([a-z_]+)", "([a-z0-9_]+)", (true|false)\)/g)].map((m) => `${m[1]}:${m[2]}:${m[3] === 'true'}`);
    const paid = HONK_PARTS.filter((p) => p.price !== null).map((p) => `${p.slot}:${p.item}:${p.item === 'gold'}`);
    expect(pairs).toEqual(paid);
  });
});
