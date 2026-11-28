import { describe, expect, it } from 'vitest';
import { questionReportHref, CONTACT_EMAIL } from './feedback';

describe('question reports', () => {
  it('includes only public question context and encodes it safely', () => {
    const url = new URL(questionReportHref('2026-11-28', 2, 'public-id&subject=other'));
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect([...url.searchParams.keys()]).toEqual(['subject', 'body']);
    expect(url.searchParams.get('subject')).toBe('Stat Window — question or scoring issue');
    expect(url.searchParams.get('body')).toContain('Puzzle date: 2026-11-28\nQuestion: 2\nQuestion ID: public-id&subject=other');
  });
});
