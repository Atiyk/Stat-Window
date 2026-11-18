import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { scoresApi } from './server/dev-plugin.ts';

export default defineConfig({
  plugins: [react(), scoresApi()],
  build: { target: 'es2022', sourcemap: false },
});
