import type { AdminActionRecord } from '../domain/admin/admin.dto.js';

/** Read-only CLI commands do not write an audit row. */
export const CLI_AUDIT_SKIP = new Set(['promo:list']);

/** One privileged CLI invocation: wallet `cli:<os user>`, the argv, no chain secret. */
export function cliAuditRecord(user: string, command: string, args: readonly string[], at: Date): AdminActionRecord {
  const argv = [...args];
  return {
    wallet: `cli:${user || 'unknown'}`, action: `cli.${command}`, target: command, role: 'cli',
    beforeState: null, afterState: { args: argv }, detail: { args: argv }, requestId: null, at,
  };
}
