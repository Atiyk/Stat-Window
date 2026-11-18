import { defineConfig } from 'vite';

/** Bundles the score API into one self-contained ES module for Vercel (npm run api:build). */
export default defineConfig({
  // Never copy public/ into api/: only the bundle belongs there.
  publicDir: false,
  build: {
    ssr: 'server/vercel-entry.ts',
    outDir: 'api',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'scores.js', format: 'es' } },
  },
  ssr: { noExternal: true },
});
