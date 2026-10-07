import { defineConfig } from 'vite';

/* Dev: `npm run dev` here + `npm run server:dev` at the root. Vite serves this page on :5173 and proxies the API and the other pages
   (lobby, game, their modules) to Nest on :3000, so the session cookie stays same-origin. Prod: `vite build` → dist/, served by Nest at /. */
const NEST = process.env.API ?? 'http://localhost:3000';
const toNest = ['/api', '/escrow', '/lobby.html', '/play.html', '/viewer.html', '/site', '/js', '/css', '/icons', '/favicon.ico', '/manifest.webmanifest'];

export default defineConfig({
  server: { port: 5173, proxy: Object.fromEntries(toNest.map(p => [p, { target: NEST, changeOrigin: false }])), fs: { allow: ['..'] } },   // fs.allow: wallet.js is imported from ../client
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: 'hidden', assetsInlineLimit: 0, chunkSizeWarningLimit: 60 },   // 'hidden': maps are built (for error reports) but not linked from the bundles; 60 kB warns long before the page gets heavy
  esbuild: { legalComments: 'none' },
});
