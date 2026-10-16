import { weather } from '../state.js';

/* A HONK weather burn on the driver's cab. The route ambient is remembered the first time, so clear can put it back. */
export function assignWeather(kind) {
  if (weather.baseAmbient == null) weather.baseAmbient = weather.ambient;
  if (kind === 'snow') { weather.snow = 1; weather.ambient = Math.min(weather.baseAmbient, -8); }
  else if (kind === 'clear') { weather.snow = 0; weather.ambient = weather.baseAmbient; }
}
