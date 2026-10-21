import { createHash, createHmac } from 'node:crypto';

// Recompute mgSalt and check it against mgCommit.
// mgSalt = HMAC-SHA256(MG_SECRET, version || rideId || wallet) as raw bytes (no extra separators).
// mgCommit = hex SHA-256 of those raw bytes, not of the hex encoding of the salt.
// The secret is read from the environment and is not printed.
const [rideId, wallet, commit] = process.argv.slice(2);
const secret = process.env.MG_SECRET;
const version = process.env.MG_SALT_VERSION || 'mg:v1';
if (!rideId || !wallet || !commit || !secret) {
  console.error('usage: node server/scripts/mg-verify.mjs <rideId> <wallet> <commit>   (MG_SECRET in the environment; MG_SALT_VERSION defaults to mg:v1)');
  process.exit(2);
}
const salt = createHmac('sha256', secret).update(`${version}${rideId}${wallet}`, 'utf8').digest();
const got = createHash('sha256').update(salt).digest('hex');
if (got !== commit.toLowerCase()) {
  console.error('commit mismatch');
  process.exit(1);
}
console.log(`ok ${salt.toString('hex')}`);
