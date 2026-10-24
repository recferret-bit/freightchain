import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SERVER_DIR } from '../architecture/source-files.js';
import { ACHIEVEMENTS } from '../../src/domain/achievements/achievements.js';
import { NFT_METADATA_URIS } from '../../src/domain/achievements/nft-metadata-uris.js';

describe('achievement metadata release', () => {
  it('validates every earnable asset offline and reports only unpublished ids without reading a key', () => {
    const output = execFileSync(process.execPath, ['scripts/achievements/upload-irys.mjs', '--prepare', '--keypair', '/does/not/exist'], { cwd: SERVER_DIR, encoding: 'utf8' });
    const report = JSON.parse(output) as { earnable: number; published: number; missing: { id: string; pngBytes: number; sha256: string }[] };
    const earnable = ACHIEVEMENTS.filter(a => a.measure !== null);
    expect(report.earnable).toBe(44);
    expect(report.published).toBe(Object.keys(NFT_METADATA_URIS).length);
    expect(report.missing.map(a => a.id).sort()).toEqual(earnable.filter(a => !NFT_METADATA_URIS[a.id]).map(a => a.id).sort());
    expect(report.missing.every(a => a.pngBytes > 1000 && /^[a-f0-9]{64}$/.test(a.sha256))).toBe(true);
  });

  it('refuses to replace an existing leaf URI or mix clusters before touching a wallet', () => {
    const module = join(SERVER_DIR, 'scripts/achievements/metadata-release.mjs');
    const script = `import { mergeMetadataUris } from ${JSON.stringify(module)};
      import assert from 'node:assert/strict';
      assert.deepEqual(mergeMetadataUris({ a: 'old' }, { b: 'new' }), { a: 'old', b: 'new' });
      assert.throws(() => mergeMetadataUris({ a: 'old' }, { a: 'new' }), /frozen/);`;
    execFileSync(process.execPath, ['--input-type=module', '-e', script]);
    expect(() => execFileSync(process.execPath, ['scripts/achievements/upload-irys.mjs', '--prepare', '--cluster', 'mainnet'], { cwd: SERVER_DIR, stdio: 'pipe' })).toThrow();
  });
});
