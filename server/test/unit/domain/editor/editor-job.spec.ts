import { clip, eventDto, jobDto, mayWrite } from '../../../../src/domain/editor/editor-job.js';
import { chooseProvider, type ProviderInfo } from '../../../../src/domain/editor/llm-providers.js';

const P = (id: ProviderInfo['id'], models = ['m1', 'm2']): ProviderInfo => ({ id, label: id, models, default: models[0]! });

describe('editor jobs (domain)', () => {
  it('a job writes its own entity or a NEW part; a job without an entity anything', () => {
    expect(mayWrite({ entityId: 'cactus' }, 'cactus', { exists: true, kind: 'prop' })).toBe(true);
    expect(mayWrite({ entityId: 'cactus' }, 'my-part', { exists: false, kind: 'part' })).toBe(true);
    expect(mayWrite({ entityId: 'cactus' }, 'rock', { exists: true, kind: 'prop' })).toBe(false);
    expect(mayWrite({ entityId: 'cactus' }, 'veh-wheels', { exists: true, kind: 'part' })).toBe(false);
    expect(mayWrite({ entityId: 'cactus' }, 'new-prop', { exists: false, kind: 'prop' })).toBe(false);
    expect(mayWrite({ entityId: null }, 'rock', { exists: true, kind: 'prop' })).toBe(true);
  });

  it('clip, and the DTOs carry ISO dates', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('abc', 4)).toBe('abc');
    const at = new Date('2026-10-29T10:00:00.000Z');
    expect(eventDto({ jobId: 'j', seq: 1, type: 'text', payload: { text: 'hi' }, at })).toEqual({ seq: 1, type: 'text', payload: { text: 'hi' }, at: '2026-10-29T10:00:00.000Z' });
    expect(jobDto({ id: 'j', wallet: 'W', prompt: 'p', provider: 'fake', model: 'scripted', entityId: null, baseRevisionId: null, resultRevisionId: null, status: 'done', error: null, tokensIn: 1, tokensOut: 2, createdAt: at, startedAt: at, finishedAt: null })).toMatchObject({ createdAt: '2026-10-29T10:00:00.000Z', finishedAt: null, status: 'done' });
  });

  it('chooseProvider: the asked one when enabled, else the preferred, else the first; models must be offered', () => {
    const on = [P('anthropic'), P('gemini', ['g'])];
    expect(chooseProvider(on, null)).toMatchObject({ info: { id: 'anthropic' }, model: 'm1' });
    expect(chooseProvider(on, 'gemini')).toMatchObject({ info: { id: 'gemini' }, model: 'g' });
    expect(chooseProvider(on, null, 'anthropic', 'm2')).toMatchObject({ model: 'm2' });
    expect(chooseProvider(on, null, 'openai')).toHaveProperty('error');
    expect(chooseProvider(on, null, 'anthropic', 'nope')).toHaveProperty('error');
    expect(chooseProvider([], null)).toHaveProperty('error');
  });
});
