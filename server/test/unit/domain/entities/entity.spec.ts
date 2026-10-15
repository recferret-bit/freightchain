import { assertPublishable, assertSameKind, checkEntitySource, refersTo } from '../../../../src/domain/entities/entity.js';
import { printSource } from '../../../../src/domain/shared/entity.js';
import { BadRequestError, UnprocessableEntityError } from '../../../../src/domain/shared/errors.js';
import { fatCactus, seedEntity } from '../../../support/entity-fixtures.js';

const none = () => null;

describe('checkEntitySource (an entity file, read without running it)', () => {
  it('a valid file → its config and its canonical text', () => {
    const { config, source } = checkEntitySource(fatCactus(), 'cactus', none);
    expect(config.id).toBe('cactus');
    expect(source).toBe(printSource(config));
  });

  it('refuses code, another id, a gameplay key and a broken expression – each with its reasons (422)', () => {
    const refused = (src: string, id = 'cactus') => { try { checkEntitySource(src, id, none); } catch (e) { expect(e).toBeInstanceOf(UnprocessableEntityError); return (e as UnprocessableEntityError).errors.join(' | '); } throw new Error('accepted'); };
    expect(refused('export default { id: "cactus", parts: f() };')).toMatch(/only plain data/);
    expect(refused('module.exports = {}')).toMatch(/export default/);
    expect(refused(fatCactus(), 'rock')).toMatch(/must be 'rock'/);
    expect(refused(printSource({ ...seedEntity('cactus'), hp: 9 }))).toMatch(/gameplay/);
    const c = seedEntity('cactus'); (c['parts'] as { at: unknown[] }[])[0]!.at[1] = 'nope / 2';
    expect(refused(printSource(c))).toMatch(/unknown name 'nope'/);
  });

  it('a malformed id is a 400 before anything is parsed', () => {
    expect(() => checkEntitySource('x', 'Bad Id', none)).toThrow(BadRequestError);
  });
});

describe('assertSameKind', () => {
  it('an entity keeps its kind (from its row, else from the seed); a new one takes any', () => {
    expect(() => assertSameKind(null, { ...seedEntity('cactus'), kind: 'part' }, seedEntity('cactus'))).toThrow(UnprocessableEntityError);
    expect(() => assertSameKind(null, seedEntity('cactus'), null)).not.toThrow();
  });
});

describe('assertPublishable (the published set stays buildable)', () => {
  const crate = (tag = 'crate') => ({ id: 'job-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', tag, mat: 'm', s: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }] }) as never;
  const user = () => { const c = seedEntity('birch'); (c.parts as unknown[]).push({ use: 'job-crate' }); return c; };
  it('refersTo finds use / ref anywhere in the parts', () => {
    expect(refersTo(user().parts, 'job-crate')).toBe(true);
    expect(refersTo(seedEntity('birch').parts, 'job-crate')).toBe(false);
  });
  it('a model using an unpublished part, or a part revision that breaks a published direct or transitive user, is refused; the good cases pass', () => {
    expect(() => assertPublishable(user(), [seedEntity('rock')])).toThrow(/publish the parts it uses first/);
    expect(() => assertPublishable(user(), [crate()])).not.toThrow();
    expect(() => assertPublishable(crate(), [user()])).not.toThrow();
    expect(() => assertPublishable(crate('trunk'), [crate(), user()])).toThrow(UnprocessableEntityError);   // the published birch would get a second trunk
    const mid = { id: 'mid-part', kind: 'part', v: 1, slots: { m: {} }, parts: [{ use: 'job-crate', slots: { m: 'm' } }] } as never;
    const indirect = () => { const c = seedEntity('birch'); (c.parts as unknown[]).push({ use: 'mid-part', slots: { m: 'trunk' } }); return c; };
    expect(() => assertPublishable(crate('trunk'), [crate(), mid, indirect()])).toThrow(UnprocessableEntityError);   // 2-hop transitive user
  });
});
