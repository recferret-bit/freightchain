import { CLI_AUDIT_SKIP, cliAuditRecord } from '../../../src/cli/cli-audit.js';

describe('cliAuditRecord', () => {
  it('names the OS user and keeps the arguments', () => {
    const at = new Date(Date.UTC(2036, 9, 8, 12));
    expect(cliAuditRecord('ada', 'pool:payout', ['--pool', '3'], at)).toMatchObject({
      wallet: 'cli:ada', action: 'cli.pool:payout', target: 'pool:payout', role: 'cli', afterState: { args: ['--pool', '3'] }, at,
    });
    expect(CLI_AUDIT_SKIP.has('promo:list')).toBe(true);
  });
});
