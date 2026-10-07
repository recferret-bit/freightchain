// One-off (dev): create the treasury keypair → data/treasury.json (gitignored). The server reads only the PUBLIC key from it; keep the secret for payouts / refunds.
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import fs from 'node:fs';
const file = process.argv[2] || 'data/treasury.json';
if (fs.existsSync(file)) { console.log(`${file} exists – public key: ${JSON.parse(fs.readFileSync(file, 'utf8')).publicKey}`); process.exit(0); }
fs.mkdirSync(file.replace(/[^/]*$/, '') || '.', { recursive: true });
const kp = nacl.sign.keyPair();
fs.writeFileSync(file, JSON.stringify({ publicKey: bs58.encode(kp.publicKey), secretKey: bs58.encode(kp.secretKey) }, null, 2), { mode: 0o600 });
console.log(`treasury written to ${file}\npublic key: ${bs58.encode(kp.publicKey)}\n(devnet: fund it only if you want to test payouts; receiving needs no balance beyond rent-exempt minimum on first deposit)`);
