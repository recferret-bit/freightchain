// Same rules and browser globals as the game client; only the file globs differ.
import base from '../client/eslint.config.mjs';
const site = base.find(c => c.files.includes('site/**/*.js'));
const tools = base.find(c => c.files.includes('tools/**/*.mjs'));
export default [{ ...site, files: ['src/**/*.js', 'test/**/*.js'] }, { ...tools, files: ['tools/**/*.mjs'] }, { ...site, files: ['vite.config.js'], languageOptions: { ...site.languageOptions, globals: { process: 'readonly' } } }];
