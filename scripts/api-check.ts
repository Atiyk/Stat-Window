/**
 * Fails when api/scores.js is not the bundle of the current server/ and shared engine
 * sources, so production can never run code the tests didn't cover. Fix: npm run api:build.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const out = mkdtempSync(path.join(tmpdir(), 'sw-api-'));
try {
  execFileSync('npx', ['vite', 'build', '--config', 'vite.api.config.ts', '--logLevel', 'error', '--outDir', out], { stdio: 'inherit' });
  const fresh = readFileSync(path.join(out, 'scores.js'), 'utf8');
  let committed = '';
  try {
    committed = readFileSync('api/scores.js', 'utf8');
  } catch {
    /* missing */
  }
  if (fresh !== committed) {
    console.error('api/scores.js is out of date with server/ or src/engine. Run: npm run api:build');
    process.exit(1);
  }
  console.log('api/scores.js matches its sources.');
} finally {
  rmSync(out, { recursive: true, force: true });
}
