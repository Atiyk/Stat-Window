import { GARDEN, symbolSvg } from './symbol.ts';

/** The vector brand files in public/, keyed by path. scripts/brand/icons.ts writes them; a test keeps them current. */
export const BRAND_SVGS: Record<string, string> = {
  'brand/symbol.svg': symbolSvg({ line: GARDEN.navy, ball: GARDEN.copper }),
  'brand/symbol-cream.svg': symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper }),
  'brand/symbol-mono.svg': symbolSvg({ line: 'currentColor', ball: 'currentColor' }),
  'favicon.svg': symbolSvg({ line: GARDEN.cream, ball: GARDEN.copper, tile: GARDEN.navy, tileRadius: 14 }, 0.86),
};
