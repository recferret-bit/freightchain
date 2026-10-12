import assert from 'node:assert/strict';
import test from 'node:test';
import { donationPayPath, orderPayPath, ridePayPath, solanaPayUrl } from '../site/solana-pay.js';

test('solana pay url encodes the api host', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const local = solanaPayUrl('', 'http://localhost:3000', `/api/solana-pay/rides/${id}`);
  assert.equal(local, `solana:${encodeURIComponent(`http://localhost:3000/api/solana-pay/rides/${id}`)}`);
  const prod = solanaPayUrl('https://api.freightchain.fun', 'https://freightchain.fun', `/api/solana-pay/orders/${id}`);
  assert.equal(prod, `solana:${encodeURIComponent(`https://api.freightchain.fun/api/solana-pay/orders/${id}`)}`);
  assert.equal(decodeURIComponent(prod.slice('solana:'.length)).startsWith('https://'), true);
  assert.equal(ridePayPath(id), `/api/solana-pay/rides/${id}`);
  assert.equal(orderPayPath(id), `/api/solana-pay/orders/${id}`);
  assert.equal(donationPayPath(id), `/api/solana-pay/donations/${id}`);
});
