import { describe, expect, it } from 'vitest';
import { labelFor } from '../../scripts/nba/category-labels';

describe('NBA category metadata', () => {
  const names = new Map([['LAL', 'Los Angeles Lakers'], ['OKC', 'Oklahoma City Thunder']]);

  it('uses event year for a 2009–10 postseason at the decade boundary', () => {
    expect(labelFor({ id: 'some-finals', scope: 'finals', season: '2009-10', eventDate: null, franchise: 'LAL', player: null } as never, names))
      .toBe('2010s · NBA Finals');
  });

  it('recognizes the Seattle franchise rather than retroactively calling it Oklahoma City', () => {
    expect(labelFor({ id: 'old-sonics', scope: 'regular-season', season: '1993-94', eventDate: null, franchise: 'OKC', player: null } as never, names))
      .toBe('1990s · Seattle SuperSonics');
  });

  it('separates Phil Jackson career titles from a Finals game label', () => {
    expect(labelFor({ id: 'nba-jackson10-titles', scope: 'finals', season: '2009-10', eventDate: null, franchise: 'LAL', player: 'Phil Jackson' } as never, names))
      .toBe('Career · Phil Jackson');
  });
});
