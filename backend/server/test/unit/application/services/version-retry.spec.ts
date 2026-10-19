import { withVersionRetry } from '../../../../src/application/services/version-retry.js';
import { isDemoWallet, demoScaleOf } from '../../../../src/application/services/demo.js';
import { VersionConflictError } from '../../../../src/domain/shared/errors.js';
import { unitRules } from '../../../support/unit-context.js';

describe('withVersionRetry', () => {
  it('retries a lost lock, gives up after the attempts, lets other errors through at once', async () => {
    let calls = 0;
    expect(await withVersionRetry(async () => { if (++calls < 3) throw new VersionConflictError(); return 'ok'; })).toBe('ok');
    await expect(withVersionRetry(async () => { throw new VersionConflictError(); }, 2)).rejects.toBeInstanceOf(VersionConflictError);
    let others = 0;
    await expect(withVersionRetry(async () => { others++; throw new Error('other'); })).rejects.toThrow('other');
    expect(others).toBe(1);
  });
});

describe('demo wallets', () => {
  it('listed wallets, or every wallet with *', () => {
    expect(isDemoWallet(unitRules({ demoWallets: new Set(['a']) }), 'a')).toBe(true);
    expect(isDemoWallet(unitRules({ demoWallets: new Set(['a']) }), 'b')).toBe(false);
    expect(isDemoWallet(unitRules({ demoWallets: new Set(['*']) }), 'b')).toBe(true);
    expect(demoScaleOf(unitRules({ demoScale: 7 }))).toBe(7);
  });
});
