import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_SVGS } from '../../src/brand/assets.ts';

describe('brand files', () => {
  it('the SVGs in public/ are generated from src/brand/symbol.ts (npm run brand:icons)', () => {
    for (const [path, svg] of Object.entries(BRAND_SVGS)) {
      expect(readFileSync(join(import.meta.dirname, '..', '..', 'public', path), 'utf8'), path).toBe(svg);
    }
  });
});
