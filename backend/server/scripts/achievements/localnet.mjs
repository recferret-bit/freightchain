// Real Bubblegum v2 + PostgreSQL acceptance, using scratch wallets and a disposable local validator.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const server = fileURLToPath(new URL('../../', import.meta.url)), root = resolve(server, '../..');
const require = createRequire(join(server, 'package.json'));
const imp = rel => import(pathToFileURL(join(server, 'dist', `${rel}.js`)).href);
const bg = require('@metaplex-foundation/mpl-bubblegum');
const core = require('@metaplex-foundation/mpl-core');
const ac = require('@metaplex-foundation/mpl-account-compression');
const u = require('@metaplex-foundation/umi');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { Connection } = require('@solana/web3.js');
const { default: bs58 } = require('bs58');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dbName = `freightchain_nft_${process.pid}`;
const dbUrl = `postgresql://freight:freight_dev_password@127.0.0.1:15433/${dbName}`;
let prisma;
const endpoint=execFileSync('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'],{encoding:'utf8'}).trim();
assert(/^unix:\/\//.test(endpoint),'NFT acceptance requires a local Docker socket');
const sql = text => execFileSync('docker',['exec','freightchain-postgres','psql','-U','freight','-d','postgres','-v','ON_ERROR_STOP=1','-c',text],{stdio:'pipe'});
const dir = mkdtempSync(join(tmpdir(), 'fc-nft-local-'));
const manifest = JSON.parse(readFileSync(new URL('./localnet-programs.json', import.meta.url), 'utf8'));
const programs = resolve(process.env.NFT_PROGRAM_DIR || join(root, 'backend/programs/target/nft-localnet'));
mkdirSync(programs, { recursive: true });
for (const p of manifest.programs) {
  const file = join(programs, `${p.name}.so`);
  if (!existsSync(file)) execFileSync('solana', ['program', 'dump', '--url', 'devnet', p.address, file], { stdio: 'inherit' });
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), p.sha256, `${p.name}: public program bytes changed; review the new snapshot before updating the manifest`);
}
const available = port => new Promise(resolve => { const socket=createServer(); socket.once('error',()=>resolve(false)); socket.listen(port,'127.0.0.1',()=>socket.close(()=>resolve(true))); });
let port;
for(let attempt=0;attempt<100;attempt++){const candidate=30000+Math.floor(Math.random()*20000);if((await Promise.all([0,1,2,3].map(n=>available(candidate+n)))).every(Boolean)){port=candidate;break;}}
assert(port,'no free local validator ports');
const rpc = `http://127.0.0.1:${port}`;
const log = openSync(`${dir}/validator.log`, 'w');
const bins = [['bubblegum', bg.MPL_BUBBLEGUM_PROGRAM_ID], ['core', core.MPL_CORE_PROGRAM_ID], ['compression', ac.MPL_ACCOUNT_COMPRESSION_PROGRAM_ID], ['noop', ac.MPL_NOOP_PROGRAM_ID]];
const args = ['--ledger', `${dir}/ledger`, '--bind-address','127.0.0.1','--rpc-port',String(port),'--faucet-port',String(port+2),'--gossip-port',String(port+3),'--dynamic-port-range',`${port+10}-${port+60}`,'--quiet'];
for (const [name,id] of bins) args.push('--bpf-program',id,join(programs, `${name}.so`));
const child=spawn('solana-test-validator',args,{stdio:['ignore',log,log]});
try {
  let ready=false;
  child.once('error', error => { console.error(error.message); });
  for(let i=0;i<120;i++) { assert.equal(child.exitCode,null,`validator exited: ${dir}`); try { const r=await fetch(rpc,{signal:AbortSignal.timeout(1000),method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})}); if((await r.json()).result==='ok'){ready=true;break;} }catch{} await sleep(250); }
  assert(ready,`validator not ready: ${dir}`);
  sql(`CREATE DATABASE ${dbName}`);
  execFileSync(join(server,'node_modules/.bin/prisma'),['migrate','deploy'],{cwd:server,env:{...process.env,DATABASE_URL:dbUrl},stdio:'pipe'});
  prisma=new (require('@prisma/client').PrismaClient)({datasourceUrl:dbUrl});
  const umi=createUmi(rpc,{commitment:'confirmed'}).use(bg.mplBubblegum()).use(core.mplCore());
  const payer=u.generateSigner(umi); umi.use(u.keypairIdentity(payer));
  const connection=new Connection(rpc,'confirmed');
  const fund=await connection.requestAirdrop(new (require('@solana/web3.js').PublicKey)(payer.publicKey),10e9); await connection.confirmTransaction(fund,'confirmed');
  const collection=u.generateSigner(umi), tree=u.generateSigner(umi), owner=u.generateSigner(umi);
  await core.createCollection(umi,{collection,name:'Local achievements',uri:'https://example.invalid/local.json',plugins:[{type:'BubblegumV2'},{type:'PermanentFreezeDelegate',frozen:true,authority:{type:'None'}}]}).sendAndConfirm(umi);
  await (await bg.createTreeV2(umi,{merkleTree:tree,maxDepth:3,maxBufferSize:8,canopyDepth:0,public:false})).sendAndConfirm(umi);
  console.log('collection/tree created',collection.publicKey,tree.publicKey);
  const {BubblegumMintAdapter}=await imp('infrastructure/solana/bubblegum-mint.adapter');
  const adapter=new BubblegumMintAdapter({solanaRpc:rpc,solanaCommitment:'confirmed',solanaRpcFallbacks:[],achievementMintSecret:JSON.stringify([...payer.secretKey]),achievementTree:tree.publicKey,achievementCollection:collection.publicKey,priorityFee:{minMicrolamports:0}});
  let saved;
  const minted=await adapter.mint({wallet:owner.publicKey,name:'First mile',uri:'https://example.invalid/local.json'},async tx=>{saved=tx; assert.equal((await connection.getSignatureStatuses([tx.signature])).value[0],null);});
  assert(saved); assert.equal(saved.signature,minted.signature);
  const signature=bs58.decode(minted.signature);
  const leaf=await bg.parseLeafFromMintV2Transaction(umi,signature);
  assert.equal(leaf.owner,owner.publicKey); assert.equal(leaf.__kind,'V2');
  const {publicKey:pk,u8,u64}=require('@metaplex-foundation/umi/serializers');
  const leafHash=bg.hash([u8().serialize(2),pk().serialize(leaf.id),pk().serialize(leaf.owner),pk().serialize(leaf.delegate),u64().serialize(leaf.nonce),leaf.dataHash,leaf.creatorHash,leaf.collectionHash,leaf.assetDataHash,u8().serialize(leaf.flags)]);
  const leaves=[u.publicKey(leafHash)], root=u.publicKeyBytes(bg.getMerkleRoot(leaves,3)), proof=bg.getMerkleProofAtIndex(leaves,3,0);
  await ac.verifyLeaf(umi,{merkleTree:tree.publicKey,root,leaf:leafHash,index:0,proof}).sendAndConfirm(umi);
  console.log('real adapter minted; onSigned ran before broadcast; owner and Merkle proof verified',minted.signature);
  const params={merkleTree:tree.publicKey,coreCollection:collection.publicKey,leafOwner:owner.publicKey,leafDelegate:owner.publicKey,root,proof,dataHash:leaf.dataHash,creatorHash:leaf.creatorHash,assetDataHash:u.some(leaf.assetDataHash),flags:u.some(leaf.flags),nonce:leaf.nonce,index:0};
  let refused=false;
  try {await bg.transferV2(umi,{...params,authority:owner,newLeafOwner:u.generateSigner(umi).publicKey}).sendAndConfirm(umi);}catch(e){console.log('transfer refusal',e.name,e.message.split('\n')[0]); assert(e instanceof bg.CollectionIsFrozenError, 'expected the exact Bubblegum collection-freeze error'); refused=true;}
  assert(refused,'transfer unexpectedly succeeded');
  assert.equal(await adapter.assetIdOf(minted.signature),leaf.id);
  assert.deepEqual(await adapter.treeUsage(),{minted:1,capacity:8});
  await assert.rejects(adapter.mint({wallet:owner.publicKey,name:'Claim lost',uri:'https://example.invalid/claim.json'},async()=>{throw new Error('test claim lost');}),/test claim lost/);
  assert.deepEqual(await adapter.treeUsage(),{minted:1,capacity:8});
  const {AchievementMintPrismaRepository}=await imp('infrastructure/prisma/repositories/achievement-mint.prisma.repository');
  const {AchievementPrismaRepository}=await imp('infrastructure/prisma/repositories/achievement.prisma.repository');
  const {RideQueryPrismaRepository}=await imp('infrastructure/prisma/repositories/ride-query.prisma.repository');
  const {PlayerPrismaRepository}=await imp('infrastructure/prisma/repositories/player.prisma.repository');
  const {AchievementService}=await imp('application/services/achievement.service');
  const {MintAchievementsHandler}=await imp('application/use-cases/achievements/mint-achievements/mint-achievements.handler');
  const {MintAchievementsCommand}=await imp('application/use-cases/achievements/mint-achievements/mint-achievements.command');
  const now=new Date(), old=new Date(now.getTime()-49*3600e3), wallets=[u.generateSigner(umi).publicKey,u.generateSigner(umi).publicKey,u.generateSigner(umi).publicKey];
  for(let i=0;i<wallets.length;i++){
    const wallet=wallets[i];
    await prisma.player.create({data:{wallet,createdAt:old,freeRides:0,freeDay:'2000-01-01'}});
    const ride=await prisma.ride.create({data:{wallet,tier:'1h',seed:1,minSeconds:3600,completeDist:60000,status:'completed',createdAt:old,startedAt:old,endedAt:old,lastS:60000,driveSeconds:3600,hull:100}});
    await prisma.rideVerdict.create({data:{rideId:ride.id,status:i===1?'rejected':'verified',reasons:i===1?[{code:'speed',detail:'fixture'}]:[],scores:{},rulesVersion:7,judgedAt:old}});
    await prisma.achievementUnlock.create({data:{wallet,achievementId:'shift-complete',earnedAt:i===2?now:old,rideId:ride.id}});
  }
  const clock={now:()=>now}, rules={get:()=>({verdictEnforce:true,demoWallets:new Set()})}, mints=new AchievementMintPrismaRepository(prisma);
  const achievements=new AchievementService(new AchievementPrismaRepository(prisma),mints,new RideQueryPrismaRepository(prisma),clock,rules);
  const handler=new MintAchievementsHandler(adapter,mints,achievements,rules,{capture:()=>{}},clock,new PlayerPrismaRepository(prisma));
  const command=new MintAchievementsCommand(48*3600e3,10);
  const readAsset=adapter.assetIdOf.bind(adapter);
  adapter.assetIdOf=async()=>null; // A landed mint whose receipt lookup temporarily fails must remain sent.
  const pass=await handler.execute(command); assert.equal(pass.queued,2); assert.equal(pass.skipped,1);
  assert.equal((await prisma.achievementMint.findUnique({where:{wallet_achievementId:{wallet:wallets[0],achievementId:'shift-complete'}}})).status,'sent');
  adapter.assetIdOf=readAsset;
  const recovered=new MintAchievementsHandler(new BubblegumMintAdapter({solanaRpc:rpc,solanaCommitment:'confirmed',solanaRpcFallbacks:[],achievementMintSecret:JSON.stringify([...payer.secretKey]),achievementTree:tree.publicKey,achievementCollection:collection.publicKey,priorityFee:{minMicrolamports:0}}),new AchievementMintPrismaRepository(prisma),achievements,rules,{capture:()=>{}},clock,new PlayerPrismaRepository(prisma));
  await recovered.execute(command);
  const rows=await prisma.achievementMint.findMany();
  assert.equal(rows.find(r=>r.wallet===wallets[0]).status,'minted');
  assert.equal(rows.find(r=>r.wallet===wallets[1]).status,'skipped');
  assert.equal(rows.some(r=>r.wallet===wallets[2]),false);
  assert.equal((await adapter.treeUsage()).minted,2);
  const durable=rows.find(r=>r.wallet===wallets[0]); assert.equal(durable.attempts,1); assert(durable.assetId&&durable.signature);
  // A fresh repository/handler pass resolves durable state without minting the same badge twice.
  const second=new MintAchievementsHandler(adapter,new AchievementMintPrismaRepository(prisma),achievements,rules,{capture:()=>{}},clock,new PlayerPrismaRepository(prisma));
  await second.execute(command); assert.equal((await adapter.treeUsage()).minted,2);
  console.log('PASS PostgreSQL mint worker: 48h delay, rejected-ride exclusion, durable receipt and duplicate protection');
  // An unfrozen collection and independently verified leaf prove this wallet/proof path can transfer.
  const movable=u.generateSigner(umi), controlTree=u.generateSigner(umi);
  await core.createCollection(umi,{collection:movable,name:'Transfer control',uri:'https://example.invalid/control.json',plugins:[{type:'BubblegumV2'}]}).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  await (await bg.createTreeV2(umi,{merkleTree:controlTree,maxDepth:3,maxBufferSize:8,canopyDepth:0,public:false})).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  const controlMint=await bg.mintV2(umi,{leafOwner:owner.publicKey,merkleTree:controlTree.publicKey,coreCollection:movable.publicKey,metadata:{name:'Movable control',uri:'https://example.invalid/control.json',sellerFeeBasisPoints:0,collection:u.some(movable.publicKey),creators:[]}}).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  const cl=await bg.parseLeafFromMintV2Transaction(umi,controlMint.signature);
  const ch=bg.hash([u8().serialize(2),pk().serialize(cl.id),pk().serialize(cl.owner),pk().serialize(cl.delegate),u64().serialize(cl.nonce),cl.dataHash,cl.creatorHash,cl.collectionHash,cl.assetDataHash,u8().serialize(cl.flags)]);
  const cp=bg.getMerkleProofAtIndex([u.publicKey(ch)],3,0), cr=u.publicKeyBytes(bg.getMerkleRoot([u.publicKey(ch)],3));
  await ac.verifyLeaf(umi,{merkleTree:controlTree.publicKey,root:cr,leaf:ch,index:0,proof:cp}).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  const recipient=u.generateSigner(umi).publicKey;
  await bg.transferV2(umi,{...params,merkleTree:controlTree.publicKey,coreCollection:movable.publicKey,root:cr,proof:cp,dataHash:cl.dataHash,creatorHash:cl.creatorHash,assetDataHash:u.some(cl.assetDataHash),flags:u.some(cl.flags),nonce:cl.nonce,index:0,authority:owner,newLeafOwner:recipient}).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  const moved=bg.hash([u8().serialize(2),pk().serialize(cl.id),pk().serialize(recipient),pk().serialize(recipient),u64().serialize(cl.nonce),cl.dataHash,cl.creatorHash,cl.collectionHash,cl.assetDataHash,u8().serialize(cl.flags)]);
  await ac.verifyLeaf(umi,{merkleTree:controlTree.publicKey,root:u.publicKeyBytes(bg.getMerkleRoot([u.publicKey(moved)],3)),leaf:moved,index:0,proof:cp}).sendAndConfirm(umi,{confirm:{commitment:'confirmed'}});
  console.log('PASS unfrozen transfer control: new owner leaf verified on chain');
  console.log('PASS local Bubblegum adapter, ownership, valid proof, exact frozen refusal',dir);
  writeFileSync(join(dir,'result.json'),JSON.stringify({passed:true,programs:manifest.programs,collection:collection.publicKey,tree:tree.publicKey,mintSignature:minted.signature,workerSignature:durable.signature,workerAsset:durable.assetId,checks:['real adapter and pre-broadcast signature callback','on-chain owner and Merkle proof','specific CollectionIsFrozen refusal','successful unfrozen transfer control','48h mint delay','rejected completion excluded','receipt lookup recovery from durable sent row','one mint after repeated worker passes']},null,2));
}catch(error){console.error(error);process.exitCode=1;}
finally{
  if(prisma)await prisma.$disconnect();
  try{sql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);}catch(error){console.error('test database cleanup failed');process.exitCode=1;}
  if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(5000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  closeSync(log);
}
// Umi may retain a websocket reconnect timer after validator shutdown; all owned resources are closed above.
process.exit(process.exitCode || 0);
