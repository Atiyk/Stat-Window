import type { Question } from './schema';
import labels from './nba-categories.json';

// NBA labels are generated offline from the reviewed fact database's structured
// season, scope, franchise and player metadata. Never guess from live prompt text.
const nbaLabels: Readonly<Record<string, string>> = labels;

export function contextLabel(q: Question): string {
  return nbaLabels[q.id] ?? `${q.sport} · ${q.context}`;
}
