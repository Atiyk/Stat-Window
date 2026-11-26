import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { scoresApi } from './server/dev-plugin.ts';
import { assertLaunchEnv } from './src/engine/launch-config.ts';

// The launch day is committed; a leftover dashboard variable that disagrees fails the deploy.
assertLaunchEnv(process.env);

export default defineConfig({
  plugins: [react(), scoresApi()],
  build: { target: 'es2022', sourcemap: false },
});
