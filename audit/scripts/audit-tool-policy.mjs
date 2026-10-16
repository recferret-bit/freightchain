import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_TOOLS = new Set(['get_audit_context', 'get_attack_plan', 'list_files', 'read_file', 'search_code', 'run_container_check', 'write_poc', 'submit_audit_report', 'submit_crosscheck_report']);

export function auditToolDecision(input, skillFiles = []) {
  const name = input?.toolCall?.name;
  const args = input?.toolCall?.args;
  const server = args?.ServerName;
  const ownMcp = name === 'call_mcp_tool' && ['audit_docker', 'audit-docker_audit_docker'].includes(server) && MCP_TOOLS.has(args?.ToolName);
  const skillRead = name === 'view_file' && args?.IsSkillFile === true && typeof args.AbsolutePath === 'string' && path.isAbsolute(args.AbsolutePath) && skillFiles.includes(path.normalize(args.AbsolutePath));
  if (ownMcp || skillRead || name === 'finish') return { decision: 'allow' };
  return { decision: 'deny', reason: 'Only the audit Docker MCP server and the staged audit skill are available. Host tools and other integrations are disabled.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input;
  try {
    const text = fs.readFileSync(0, 'utf8');
    if (text.length <= 1024 * 1024) input = JSON.parse(text);
  } catch { /* malformed hook requests fail closed */ }
  process.stdout.write(JSON.stringify(auditToolDecision(input, process.argv.slice(2))));
}
