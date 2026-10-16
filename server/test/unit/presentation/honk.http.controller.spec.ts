import bs58 from 'bs58';
import { BurnHonkTimeCommand } from '../../../src/application/use-cases/honk/burn-honk-time.handler.js';
import { BurnHonkWeatherCommand } from '../../../src/application/use-cases/honk/burn-honk-weather.handler.js';
import { BurnHonkCommand, GetHonkCatalogQuery, GetHonkQuery, MintHonkVisualCommand } from '../../../src/application/use-cases/honk/honk.handlers.js';
import { HonkHttpController, honkBurnBodySchema, honkTimeBodySchema, honkVisualBodySchema, honkWeatherBodySchema } from '../../../src/presentation/honk/honk.http.controller.js';
import { rideIdParamsSchema } from '../../../src/presentation/common/dto/common.dto.js';
import { busMock } from '../../support/bus.js';

const SIG = bs58.encode(Buffer.alloc(64, 7));

describe('HonkHttpController', () => {
  it('dispatches the balance, the catalog, a visual mint and a stream burn', async () => {
    const commands = busMock({ balance: '9', pays: '1' }), queries = busMock({ balance: '0', minted: '0', burned: '0', visuals: [] });
    const c = new HonkHttpController(commands.bus, queries.bus);
    expect(await c.mine({ wallet: 'w' })).toEqual({ balance: '0', minted: '0', burned: '0', visuals: [] });
    expect(queries.last()).toEqual(new GetHonkQuery('w'));
    await c.catalog();
    expect(queries.last()).toEqual(new GetHonkCatalogQuery());
    await c.visual({ wallet: 'w' }, { slot: 'wheel', item: 'gold', signature: SIG });
    expect(commands.last()).toEqual(new MintHonkVisualCommand('w', 'wheel', 'gold', SIG));
    await c.honk({ wallet: 'w' }, { id: 'ride-1' }, { signature: SIG });
    expect(commands.last()).toEqual(new BurnHonkCommand('w', 'ride-1', SIG));
    await c.honkTime({ wallet: 'w' }, { id: 'ride-1' }, { phase: 'night' });
    expect(commands.last()).toEqual(new BurnHonkTimeCommand('w', 'ride-1', 'night', undefined));
    await c.honkWeather({ wallet: 'w' }, { id: 'ride-1' }, { weather: 'snow', signature: SIG });
    expect(commands.last()).toEqual(new BurnHonkWeatherCommand('w', 'ride-1', 'snow', SIG));
  });

  it('a visual body is a short slot and item; the ride id is the watch param; day or night is the time body', () => {
    expect(honkVisualBodySchema.parse({ slot: 'wheel', item: 'gold' })).toEqual({ slot: 'wheel', item: 'gold' });
    expect(honkVisualBodySchema.parse({ slot: 'wheel', item: 'gold', signature: SIG })).toEqual({ slot: 'wheel', item: 'gold', signature: SIG });
    expect(honkVisualBodySchema.safeParse({ slot: 'wheel', item: 'gold', signature: 'nope' }).success).toBe(false);
    expect(honkBurnBodySchema.parse({})).toEqual({});
    expect(honkBurnBodySchema.parse({ signature: SIG })).toEqual({ signature: SIG });
    expect(honkBurnBodySchema.safeParse({ signature: '' }).success).toBe(false);
    for (const bad of [{}, { slot: '', item: 'gold' }, { slot: 'wheel', item: '' }, { slot: 'x'.repeat(33), item: 'gold' }, { slot: 'wheel', item: 1 }]) {
      expect(honkVisualBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(rideIdParamsSchema.parse({ id: 'ride-1' })).toEqual({ id: 'ride-1' });
    expect(honkTimeBodySchema.parse({ phase: 'day' })).toEqual({ phase: 'day' });
    expect(honkTimeBodySchema.safeParse({ phase: 'dusk' }).success).toBe(false);
    expect(honkTimeBodySchema.safeParse({}).success).toBe(false);
    expect(honkWeatherBodySchema.parse({ weather: 'clear' })).toEqual({ weather: 'clear' });
    expect(honkWeatherBodySchema.safeParse({ weather: 'rain' }).success).toBe(false);
    expect(honkWeatherBodySchema.safeParse({}).success).toBe(false);
  });
});
