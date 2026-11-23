import type { Question } from './schema';
import labels from './nba-categories.json';

// NBA labels are generated offline from the reviewed fact database's structured
// season, scope, franchise and player metadata. Never guess from live prompt text.
const nbaLabels: Readonly<Record<string, string>> = labels;

export function contextLabel(q: Question): string {
  const nba = nbaLabels[q.id];
  if (nba) return nba;
  // Legacy mixed-sport question contexts often begin with the sport already.
  // Don't print "NBA · NBA · ..." or "NHL · NHL · ..." in older archives.
  return q.context.startsWith(`${q.sport} · `) || q.context === q.sport
    ? q.context
    : `${q.sport} · ${q.context}`;
}
