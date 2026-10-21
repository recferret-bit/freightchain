import { MapsApp } from './apps/maps.js';
import { MessagesApp } from './apps/messages.js';
import { WalletApp } from './apps/wallet.js';
import { SwapApp } from './apps/swap.js';
import { RadioApp, WeatherApp, TruckApp, CamApp, SettingsApp, CallsApp, WebApp, MusicApp } from './apps/utility.js';
import { GulpApp } from './apps/gulp.js';
import { PikeApp } from './apps/pike.js';

export const APPS = Object.freeze([
  new MapsApp(), new WalletApp(), new RadioApp(), new WeatherApp(), new TruckApp(), new MessagesApp(),
  new CamApp(), new SettingsApp(), new SwapApp(), new CallsApp(), new WebApp(), new MusicApp(), new GulpApp(), new PikeApp(),
]);

const BY_ID = new Map(APPS.map(app => [app.id, app]));
export const appById = id => BY_ID.get(id) ?? null;
