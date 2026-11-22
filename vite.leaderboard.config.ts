import { defineConfig } from 'vite';
export default defineConfig({publicDir:false,build:{ssr:'server/vercel-leaderboard-entry.ts',outDir:'api',emptyOutDir:false,target:'node20',minify:false,sourcemap:false,rollupOptions:{output:{entryFileNames:'leaderboard.js',format:'es'}}},ssr:{noExternal:true}});
