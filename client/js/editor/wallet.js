/* Editor sign-in on top of the shared wallet handlers (js/wallet/). Same solana:signIn sheet as the landing page.
   The first challenge has no address (the wallet fills that in). A wallet with no sign-in connects, then signs the
   wallet-bound text. Storybook does not serve /site/, so this file never imports it. */
import { post } from './api.js';
import { beginWallet, chooseWallet, connectAddress, signBytes, signInWith, refused } from '../wallet/handlers.js';

let chosen = null;
const storybook = () => location.hostname.startsWith('storybook.');
const ours = message => !storybook() || String(message ?? '').startsWith(`${location.host} wants you to sign in`);
const HOST_ERR = 'the sign-in text names another site – not signed';

/** The nonce request starts at the click. `ready()` is the challenge once it has arrived, so a later wallet click can open it immediately. */
function prefetch(load) {
  let value = null, error = null, settled = false;
  const promise = Promise.resolve().then(load).then(v => { value = v; settled = true; return v; }, e => { error = e; settled = true; throw e; });
  return { ready: () => (settled && !error ? value : null), promise: () => promise };
}

async function verifySigned(signed) {
  if (!ours(signed.message)) throw new Error(HOST_ERR);
  await post('auth/verify', { wallet: signed.wallet, signature: signed.signature, message: signed.message, nonce: signed.nonce });
  return signed.wallet;
}

/** CONNECT WALLET: open the wallet, sign the editor challenge, set the editor cookie. Returns the address. */
export async function editorSignIn() {
  const prep = prefetch(() => post('auth/nonce', {}));
  let job = null;
  const p = await chooseWallet(undefined, wallet => { job = beginWallet(wallet, prep.ready()); });
  chosen = p;
  if (!job) job = beginWallet(p, prep.ready());
  if (job.mode === 'signin') {
    try {
      const signed = await job.pending;
      if (signed) return await verifySigned(signed);
    } catch (e) {
      if (refused(e) || e?.status === 404 || e?.message === HOST_ERR) throw e;
    }
  } else if (job.mode === 'wait') {
    const challenge = await prep.promise();
    if (challenge?.domain && storybook() && challenge.domain !== location.host) throw new Error(HOST_ERR);
    try {
      const signed = await signInWith(p, challenge);
      if (signed) return await verifySigned(signed);
    } catch (e) {
      if (refused(e) || e?.status === 404 || e?.message === HOST_ERR) throw e;
    }
  }
  const wallet = job.mode === 'connect' ? await job.pending : await connectAddress(p);
  const { message } = await post('auth/nonce', { wallet });
  if (!ours(message)) throw new Error(HOST_ERR);
  await post('auth/verify', { wallet, signature: await signBytes(p, message) });
  return wallet;
}

/** A later editor signature (publish) from the wallet that just signed in. */
export async function sign(message) {
  const p = chosen ?? await chooseWallet();
  chosen = p;
  return signBytes(p, message);
}
