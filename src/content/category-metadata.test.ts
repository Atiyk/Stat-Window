import { describe, expect, it } from 'vitest';
import labels from './nba-categories.json';

describe('published NBA category labels', () => {
  it('puts postseason questions in the decade when the event occurred', () => {
    expect(labels['nba-shaq00-finals-ppg']).toBe('2000s · NBA Finals');
    expect(labels['nba-iguodala15-votes']).toBe('2010s · NBA Finals');
  });

  it('uses historical franchise names, not current names retroactively', () => {
    expect(labels['nba-sonics94-regular-wins']).toBe('1990s · Seattle SuperSonics');
  });

  it('labels a multi-year coaching record as a career question', () => {
    expect(labels['nba-jackson10-titles']).toBe('Career · Phil Jackson');
  });
});
