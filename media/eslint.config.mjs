// Lint for the media app: node side (make.mjs, video/*.mjs, audio/**/*.mjs) and the page-side scripts (video/page.js, video/clock.js run inside play.html). `npm run lint`
const pageGlobals = Object.fromEntries('window document performance requestAnimationFrame cancelAnimationFrame dispatchEvent KeyboardEvent Math Date Array Object Number String JSON Promise'.split(' ').map(k => [k, 'readonly']));
const nodeGlobals = Object.fromEntries('process console fetch URL setTimeout clearTimeout Buffer'.split(' ').map(k => [k, 'readonly']));
const rules = { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }] };
export default [
  { files: ['make.mjs', 'video/*.mjs', 'audio/**/*.mjs', 'test/*.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals }, rules },
  { files: ['video/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...pageGlobals, __vstep: 'readonly', __game: 'readonly' } }, rules },
];
