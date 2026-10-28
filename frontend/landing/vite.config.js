import { defineConfig } from 'vite';

/* Dev: `npm run dev` here + `npm run server:dev` at the root. Vite serves this page on :5173 and proxies the API and the other pages
   (lobby, game, their modules) to Nest on :3000, so the session cookie stays same-origin. Prod: `vite build` → dist/, served by Nest at /.
   /shared/ and /audio/ are the game's own files (client/shared, client/audio). Nest serves them from client/; without the proxy a page on :5173
   loads play.html and then 404s every shared module, and the game shows the file:// panel. */
const NEST = process.env.API ?? 'http://localhost:3000';
// Prefix match: the folders keep their slash, or '/site' would also take /sitemap.xml away from public/.
const toNest = ['/api', '/lobby.html', '/play.html', '/viewer.html', '/admin.html', '/blink.html', '/r.html', '/site/', '/js/', '/shared/', '/audio/', '/css/', '/icons/', '/favicon.ico', '/manifest.webmanifest'];

export default defineConfig({
  server: { port: 5173, proxy: Object.fromEntries(toNest.map(p => [p, { target: NEST, changeOrigin: false }])), fs: { allow: ['..'] } },   // fs.allow: wallet.js is imported from ../client
  build: { outDir: 'dist', rollupOptions: { input: { index: 'index.html', whitepaper: 'whitepaper.html', pitchdeck: 'pitchdeck.html', terms: 'terms/index.html', privacy: 'privacy/index.html', rules: 'rules/index.html' } }, emptyOutDir: true, modulePreload: { polyfill: false }, target: 'es2022', sourcemap: 'hidden', assetsInlineLimit: 0, chunkSizeWarningLimit: 60 },   // 'hidden': maps are built (for error reports) but not linked from the bundles; 60 kB warns long before the page gets heavy
  esbuild: { legalComments: 'none' },
});
