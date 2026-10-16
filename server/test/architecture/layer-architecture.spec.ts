import { codeOf, importsOf, resolveImport, sourceFiles, type SourceFile } from './source-files.js';

/* Clean Architecture boundaries, enforced from the source text:
     domain          – pure TypeScript: no framework, no persistence, no application / infrastructure / presentation
     application     – ports + CQRS handlers + services: Nest decorators only; depends on domain
     infrastructure  – adapters (Prisma, Solana, JWT, HTTP plumbing): implements the ports; never depends on presentation
     presentation    – thin controllers + Zod DTOs: dispatch commands / queries; no persistence or external adapters
     app / cli       – composition root and CLI entry points
   Only main.ts may sit directly in src/. */
const files = sourceFiles();
const inLayer = (layer: string) => files.filter((f) => f.layer === layer);
const relativeImports = (f: SourceFile) => importsOf(f.text).filter((s) => s.startsWith('.')).map((s) => resolveImport(f.path, s));
const externalImports = (f: SourceFile) => importsOf(f.text).filter((s) => !s.startsWith('.'));
const layerOf = (srcPath: string) => srcPath.split('/')[0] ?? '';

describe('layer boundaries', () => {
  it('only main.ts sits directly in src/', () => {
    expect(files.filter((f) => f.layer === '').map((f) => f.path)).toEqual(['main.ts']);
  });

  it('a quoted property named from is not an import', () => {
    expect(importsOf("const row = ['surface', 'from', 'src'];\nimport { a } from './a.js';\nimport './side.js';\nconst d = import('./dyn.js');")).toEqual(['./a.js', './side.js', './dyn.js']);
  });

  it('domain imports nothing but the domain and bs58', () => {
    for (const f of inLayer('domain')) {
      for (const dep of relativeImports(f)) expect(layerOf(dep), `${f.path} → ${dep}`).toBe('domain');
      for (const ext of externalImports(f)) expect(['bs58'], `${f.path} imports ${ext}`).toContain(ext);
    }
  });

  it('nothing reads the wall clock except SystemClock – every timestamp comes from ClockPort (tests drive time); no Math.random anywhere', () => {
    for (const f of files.filter((x) => x.path !== 'infrastructure/time/system.clock.ts')) {
      const code = codeOf(f.text);
      expect(code, `${f.path} uses Date.now()`).not.toMatch(/Date\.now\(\)/);
      expect(code, `${f.path} uses new Date()`).not.toMatch(/new Date\(\s*\)/);
      expect(code, `${f.path} uses Math.random`).not.toMatch(/Math\.random/);
    }
  });

  it('the environment is read only by the config module (EnvService, the .env loader) – the CLI goes through EnvService too', () => {
    const allowed = (path: string) => path.startsWith('infrastructure/config/');
    for (const f of files.filter((x) => !allowed(x.path))) expect(codeOf(f.text), `${f.path} reads process.env`).not.toMatch(/process\.env/);
  });

  it('application depends on domain only, and uses just @nestjs/common and @nestjs/cqrs (application.module.ts also wires infrastructure.module)', () => {
    for (const f of inLayer('application')) {
      for (const dep of relativeImports(f)) {
        const allowed = layerOf(dep) === 'domain' || layerOf(dep) === 'application' || (f.path === 'application/application.module.ts' && dep === 'infrastructure/infrastructure.module.js');
        expect(allowed, `${f.path} → ${dep}`).toBe(true);
      }
      for (const ext of externalImports(f)) expect(['@nestjs/common', '@nestjs/cqrs'], `${f.path} imports ${ext}`).toContain(ext);
    }
  });

  it('presentation only reaches infrastructure through infrastructure/http, and imports no persistence / chain / JWT library', () => {
    for (const f of inLayer('presentation')) {
      for (const dep of relativeImports(f)) {
        if (layerOf(dep) === 'infrastructure') expect(dep.startsWith('infrastructure/http/'), `${f.path} → ${dep}`).toBe(true);
        expect(['domain', 'application', 'infrastructure', 'presentation'], `${f.path} → ${dep}`).toContain(layerOf(dep));
      }
      for (const ext of externalImports(f)) expect(['@nestjs/common', '@nestjs/cqrs', '@nestjs/throttler', 'zod'], `${f.path} imports ${ext}`).toContain(ext);
    }
  });

  it('infrastructure never depends on presentation or on the composition root', () => {
    for (const f of inLayer('infrastructure')) {
      for (const dep of relativeImports(f)) expect(['presentation', 'app', 'cli'], `${f.path} → ${dep}`).not.toContain(layerOf(dep));
    }
  });

  it('persistence and chain libraries stay in infrastructure (and the CLI for its own PrismaClient)', () => {
    for (const f of files.filter((x) => !['infrastructure', 'cli'].includes(x.layer))) {
      for (const ext of externalImports(f)) expect(ext, `${f.path} imports ${ext}`).not.toMatch(/^(@prisma\/client|@solana\/web3\.js|jose|tweetnacl)/);
    }
  });

  it('every relative import carries the .js extension (native ESM)', () => {
    for (const f of files) for (const spec of importsOf(f.text).filter((s) => s.startsWith('.'))) expect(spec, `${f.path} imports ${spec}`).toMatch(/\.js$/);
  });
});
