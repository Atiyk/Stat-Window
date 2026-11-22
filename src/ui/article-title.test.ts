import { describe, expect, it } from 'vitest';
import { articleTitle } from './Sources';

describe('article title in the source link (BUG-13)', () => {
  it('reads the article name from a Wikipedia URL', () => {
    expect(articleTitle('https://en.wikipedia.org/wiki/List_of_NBA_regular_season_records')).toBe('List of NBA regular season records');
    expect(articleTitle('https://en.wikipedia.org/wiki/2021%E2%80%9322_Memphis_Grizzlies_season')).toBe('2021–22 Memphis Grizzlies season');
  });
  it('gives nothing for other sites or a broken URL', () => {
    expect(articleTitle('https://www.nba.com/stats')).toBeNull();
    expect(articleTitle('https://en.wikipedia.org/wiki/%E0%A4%A')).toBeNull();
  });
});
