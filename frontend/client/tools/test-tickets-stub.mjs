// Contract for the ticket stub: POST /api/tickets/orders/:id/reconcile and GET /api/referrals match the shipped shapes.
// A reconcile with no reference signature must not credit a ticket. Usage: npm --prefix frontend/client run test:tickets-stub
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = +(process.env.STUB_PORT || 34151);
const stubPath = fileURLToPath(new URL('../../../backend/server/scripts/stub-api.mjs', import.meta.url));
const fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const child = spawn(process.execPath, [stubPath], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
const base = `http://127.0.0.1:${PORT}`;
const stop = () => { if (!child.killed) child.kill(); };
process.on('exit', stop);
await new Promise((ok, no) => { child.stdout.once('data', ok); child.once('exit', (c) => no(new Error(`stub exited ${c}`))); });
const call = async (method, path, body) => {
  const r = await fetch(`${base}/api/${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json();
  return { status: r.status, json };
};
const me = async () => (await call('GET', 'me')).json;
const bal = (body, poolId) => body.tickets.find((t) => t.poolId === poolId).balance;

const ref = await call('GET', 'referrals');
check('GET /api/referrals is 200', ref.status === 200, String(ref.status));
check('referral view keys', ['code', 'capacity', 'used', 'pending', 'available', 'max', 'gift', 'referredBy', 'invites'].every((k) => k in ref.json));
check('referral code is 8 chars', ref.json.code === 'STUB2345');
check('referral gift is a cab colour', ref.json.gift === 'convoy');
check('referredBy is null', ref.json.referredBy === null);
check('invites is an empty list', Array.isArray(ref.json.invites) && ref.json.invites.length === 0);
check('referral counts are integers', [ref.json.capacity, ref.json.used, ref.json.pending, ref.json.available, ref.json.max].every((n) => Number.isInteger(n)));

const missing = await call('POST', 'tickets/orders/no-such/reconcile', {});
check('reconcile of an unknown order is 404', missing.status === 404, String(missing.status));
check('unknown order problem code is not_found', missing.json.code === 'not_found');

const before = bal(await me(), 1);
const created = await call('POST', 'tickets', { poolId: 1, qty: 1 });
check('an order is created unpaid', created.status === 200 && created.json.status === 'awaiting_payment' && !created.json.signature);
const looked = await call('POST', `tickets/orders/${created.json.id}/reconcile`, {});
check('reconcile without a signature is not_found', looked.status === 200 && looked.json.status === 'not_found');
check('that body still carries the order', looked.json.order?.id === created.json.id && looked.json.order.status === 'awaiting_payment');
check('not_found does not credit a ticket', bal(await me(), 1) === before);

const bare = await call('POST', `tickets/orders/${created.json.id}/confirm`, {});
check('confirm without a signature is 400', bare.status === 400 && bare.json.code === 'transaction_invalid');
const pending = await call('POST', `tickets/orders/${created.json.id}/confirm`, { signature: 'sig-stub' });
check('first confirm is pending', pending.json.status === 'pending' && pending.json.order.signature === 'sig-stub');
const paid = await call('POST', `tickets/orders/${created.json.id}/confirm`, { signature: 'sig-stub' });
check('second confirm is paid', paid.json.status === 'paid' && paid.json.order.status === 'paid');
check('paid credits the one ticket', bal(await me(), 1) === before + 1);
const again = await call('POST', `tickets/orders/${created.json.id}/reconcile`, {});
check('reconcile of a paid order is paid', again.status === 200 && again.json.status === 'paid' && again.json.order.status === 'paid');
check('a second reconcile does not credit again', bal(await me(), 1) === before + 1);
const still = await call('GET', 'referrals');
check('referrals stay an empty invite list', still.status === 200 && still.json.invites.length === 0 && still.json.code === 'STUB2345');

stop();
const n = 20;
console.log(`${n - fails.length}/${n}`);
process.exit(fails.length ? 1 : 0);
