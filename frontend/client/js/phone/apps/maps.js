import { PhoneApp } from '../app.js';

/* Maps is still drawn by ui/map (the navigation canvas). This class is the launcher entry and the OS stack slot. */

export class MapsApp extends PhoneApp {
  constructor() { super({ id: 'maps', label: 'MAPS', color: '#34a853' }); }
}
