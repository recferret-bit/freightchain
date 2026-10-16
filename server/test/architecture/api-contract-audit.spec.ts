import { sourceFiles } from './source-files.js';

/* The HTTP contract rule, enforced statically: every controller method (a) declares every request part through a Zod-validated decorator,
   (b) returns a typed, non-empty DTO produced by a CQRS handler – never void / unknown, never 204, (c) never writes to @Res()/@Req(),
   (d) never throws Nest HttpExceptions. Every error is rendered by the one ProblemDetailsFilter as application/problem+json,
   except Solana Action routes, whose ActionErrorFilter answers `{ message }` as application/json. */
const files = sourceFiles();
const controllers = files.filter((f) => f.path.endsWith('.http.controller.ts'));
const NEST_EXCEPTIONS = /\b(HttpException|BadRequestException|UnauthorizedException|ForbiddenException|NotFoundException|ConflictException|InternalServerErrorException|ServiceUnavailableException)\b/;

describe('HTTP contract audit', () => {
  it('finds the controllers', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(5);
    for (const c of controllers) expect(c.text, c.path).toMatch(/@Controller\(/);
  });

  it('request parts only through ZodBody / ZodQuery / ZodParams – no raw @Body() @Query() @Param() @Headers()', () => {
    for (const c of controllers) expect(c.text, c.path).not.toMatch(/@(Body|Query|Param|Headers)\(/);
  });

  it('never touches the raw response or request object', () => {
    for (const c of controllers) expect(c.text, c.path).not.toMatch(/@(Res|Req|Request|Response)\(/);
  });

  it('no Nest HttpException anywhere in domain, application, presentation (only the filter maps framework exceptions)', () => {
    for (const f of files.filter((x) => ['domain', 'application', 'presentation'].includes(x.layer))) expect(f.text, f.path).not.toMatch(NEST_EXCEPTIONS);
  });

  it('every route method has an explicit, non-empty return type', () => {
    let routes = 0;
    for (const c of controllers) {
      for (const m of c.text.matchAll(/@(?:Get|Post|Put|Patch|Delete)\([^)]*\)[\s\S]*?\)\s*:\s*([^{]+?)\s*\{/g)) {
        routes++;
        const returns = m[1] ?? '';
        expect(returns, `${c.path}: ${m[0].slice(0, 80)}`).not.toMatch(/^(Promise<)?(void|unknown|any|never|undefined|null)>?$/);
        expect(returns.length, c.path).toBeGreaterThan(0);
      }
    }
    expect(routes).toBeGreaterThanOrEqual(18);
  });

  it('every route produces its DTO through the CQRS bus (a controller never answers by itself)', () => {
    for (const c of controllers) {
      const routes = [...c.text.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(([^)]*)\)[\s\S]*?\{\n([\s\S]*?)\n  \}/g)];
      expect(routes.length, c.path).toBeGreaterThan(0);
      for (const [, route, body] of routes) expect(body ?? '', `${c.path} ${route}`).toMatch(/this\.(commandBus|queryBus)\.execute/);
    }
  });

    it('no 204 / empty responses', () => {
    for (const c of controllers) expect(c.text, c.path).not.toMatch(/@HttpCode\(\s*204\s*\)|HttpStatus\.NO_CONTENT/);
  });

  it('handlers never return void / unknown', () => {
    for (const f of files.filter((x) => x.path.endsWith('.handler.ts'))) {
      expect(f.text, f.path).not.toMatch(/I(?:Command|Query)Handler<[^>]*,\s*(void|unknown|any)\s*>/);
      expect(f.text, f.path).not.toMatch(/Promise<(void|unknown|any)>/);
    }
  });

  it('every controller is registered, and every handler is wired (a missing registration would only fail at runtime)', () => {
    const presentationModule = files.find((f) => f.path === 'presentation/presentation.module.ts')?.text ?? '';
    for (const c of controllers) expect(presentationModule, c.path).toContain(/export class (\w+)/.exec(c.text)?.[1] ?? '?');
    const applicationModule = files.filter(f => ['application/application.module.ts', 'app/editor-worker.module.ts'].includes(f.path)).map(f => f.text).join('\n');
    for (const h of files.filter((f) => f.path.endsWith('.handler.ts'))) expect(applicationModule, h.path).toContain(/export class (\w+)/.exec(h.text)?.[1] ?? '?');
  });

  it('every application port is bound to an adapter in the InfrastructureModule', () => {
    const infra = files.find((f) => f.path === 'infrastructure/infrastructure.module.ts')?.text ?? '';
    for (const p of files.filter((f) => f.path.endsWith('.port.ts'))) {
      for (const m of p.text.matchAll(/export abstract class (\w+)/g)) expect(infra, `${p.path}: ${m[1]}`).toMatch(new RegExp(`provide:\\s*${m[1]}\\b`));
    }
  });
});
