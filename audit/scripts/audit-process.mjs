import fs from 'node:fs';
import { spawn } from 'node:child_process';

export const FAILURE_MESSAGES = {
  provider_policy: 'Provider refused the security review; resolve account access with the provider before retrying.',
  usage_limit: 'Provider usage/session limit reached; wait for the limit to reset before retrying.',
  mcp_unavailable: 'Docker MCP tools were unavailable; check the bridge connection and workspace trust.',
  timeout: 'Audit process exceeded its time budget.',
  process_error: 'Audit process exited unsuccessfully.',
  missing_report: 'Process finished without submitting the required report.',
  invalid_report: 'Submitted report failed contract validation.',
  setup_error: 'Audit process could not be configured or started.',
  missing_exit: 'Worker exit status is missing; successful completion is unverified.',
};

// Labels explain failures without copying source, credentials, or provider payloads into diagnostics.
export function classifyAuditFailure(result, fallback = 'missing_report') {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  let reason = fallback;
  if (/flagged for possible cybersecurity risk|apply for Daybreak access/i.test(output)) reason = 'provider_policy';
  else if (/you.ve hit your (?:session|usage|weekly) limit|usage limit (?:reached|exceeded)|quota exceeded|RESOURCE_EXHAUSTED/i.test(output)) reason = 'usage_limit';
  else if (/audit (?:MCP|tool).*?(?:not (?:show up|attached)|empty)|audit_docker.*?(?:unavailable|not attached)|project MCP server (?:never attached|is not attached)|folder untrusted/i.test(output)) reason = 'mcp_unavailable';
  else if (result.timedOut || result.code === 124) reason = 'timeout';
  else if (result.code == null) reason = 'missing_exit';
  else if (result.code !== 0) reason = 'process_error';
  return { reason, message: FAILURE_MESSAGES[reason] };
}

export function runAgentProcess(invocation, timeoutMs, logFile, { signal, onProgress, heartbeatMs = 30_000 } = {}) {
  if (timeoutMs != null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)) throw new Error('Invalid audit process timeout');
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 2_147_483_647) throw new Error('Invalid heartbeat interval');
  return new Promise((resolve, reject) => {
    let logFd;
    try {
      logFd = logFile ? fs.openSync(logFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600) : null;
      if (logFd != null) {
        const stat = fs.fstatSync(logFd);
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Audit log must be a singly linked regular file');
        fs.fchmodSync(logFd, 0o600);
        fs.ftruncateSync(logFd, 0);
      }
    } catch (err) { if (logFd != null) fs.closeSync(logFd); reject(err); return; }
    const started = Date.now();
    let lastOutput = started;
    const child = spawn(invocation.executable, invocation.args, {
      cwd: invocation.cwd, env: invocation.env || process.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let logged = 0;
    const stop = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    // Silence during model reasoning is normal; only an explicit operator deadline ends a review.
    const timer = timeoutMs == null ? null : setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const progress = onProgress ? setInterval(() => onProgress({ elapsedMs: Date.now() - started, idleMs: Date.now() - lastOutput, pid: child.pid }), heartbeatMs) : null;
    const finish = (code, processSignal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (progress) clearInterval(progress);
      signal?.removeEventListener('abort', stop);
      stop();
      if (logFd != null) fs.closeSync(logFd);
      resolve({ code: timedOut ? 124 : code, signal: processSignal, timedOut, elapsedMs: Date.now() - started, stdout, stderr });
    };
    const writeLog = (buf) => {
      lastOutput = Date.now();
      if (logFd == null || logged >= 8 * 1024 * 1024) return;
      const bytes = buf.subarray(0, 8 * 1024 * 1024 - logged);
      try { fs.writeSync(logFd, bytes); logged += bytes.length; } catch { /* process result still records failure */ }
    };
    child.stdout.on('data', (chunk) => { writeLog(chunk); stdout = (stdout + chunk.toString('utf8')).slice(-512_000); });
    child.stderr.on('data', (chunk) => { writeLog(chunk); stderr = (stderr + chunk.toString('utf8')).slice(-128_000); });
    child.on('error', (err) => { stderr = `${stderr}\n${err.message}`; finish(127); });
    child.on('close', (code, processSignal) => finish(code ?? 1, processSignal));
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdin.on('error', () => {});
    child.stdin.end(invocation.stdin || '');
  });
}
