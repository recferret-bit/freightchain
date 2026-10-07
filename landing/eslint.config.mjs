// Same rules and browser globals as the game client; only the file globs differ.
import base from '../client/eslint.config.mjs';
const site = base.find(c => c.files.includes('site/**/*.js'));
export default [{ ...site, files: ['src/**/*.js'] }, { ...site, files: ['vite.config.js'], languageOptions: { ...site.languageOptions, globals: { process: 'readonly' } } }];
