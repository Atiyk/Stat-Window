/**
 * Generate NBA question-context labels from verified, structured fact metadata.
 * No runtime text parsing or editorial theme guessing in the player client.
 *
 * node --experimental-strip-types scripts/nba/category-labels.ts [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Fact, Franchise } from './model.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const SOURCE = join(ROOT, 'data/nba/facts.json');
const FRANCHISES = join(ROOT, 'data/nba/franchises.json');
const TARGET = join(ROOT, 'src/content/nba-categories.json');

function nameAtTime(f: Fact, franchiseNames: Map<string, string>): string | null {
  const start = f.season ? Number(f.season.slice(0, 4)) : 9999;
  switch (f.franchise) {
    case 'OKC': if (start < 2008) return 'Seattle SuperSonics'; break;
    case 'CHA': if (start >= 2004 && start < 2014) return 'Charlotte Bobcats'; break;
    case 'BKN': if (start < 2012) return 'New Jersey Nets'; break;
    case 'NOP': if (start < 2013) return 'New Orleans Hornets'; break;
    case 'MEM': if (start < 2001) return 'Vancouver Grizzlies'; break;
    case 'WAS': if (start < 1997) return start < 1973 ? 'Baltimore Bullets' : 'Washington Bullets'; break;
    case 'SAC': if (start < 1985) return start < 1972 ? 'Cincinnati Royals' : 'Kansas City Kings'; break;
    case 'GSW': if (start < 1971) return start < 1962 ? 'Philadelphia Warriors' : 'San Francisco Warriors'; break;
    case 'LAL': if (start < 1960) return 'Minneapolis Lakers'; break;
    case 'LAC': if (start < 1984) return start < 1978 ? 'Buffalo Braves' : 'San Diego Clippers'; break;
    case 'UTA': if (start < 1979) return 'New Orleans Jazz'; break;
  }
  return f.franchise ? franchiseNames.get(f.franchise) ?? null : null;
}

export function labelFor(f: Fact, franchiseNames: Map<string, string>): string {
  // The event date wins over the season start when the specific game takes
  // place in the next calendar year.
  const year = f.eventDate ? Number(f.eventDate.slice(0, 4))
    : f.season ? Number(f.season.slice(0, 4)) : null;
  const decade = year === null ? 'NBA' : `${Math.floor(year / 10) * 10}s`;
  if (f.scope === 'career') return `Career · ${f.player ?? 'NBA Records'}`;
  if (f.scope === 'finals') return `${decade} · NBA Finals`;
  if (f.scope === 'all-star') return `${decade} · NBA All-Star`;
  if (f.scope === 'draft') return `${decade} · NBA Draft`;
  if (f.scope === 'in-season-tournament') return `${decade} · In-Season Tournament`;
  if (f.scope === 'game-rules') return 'NBA Rules';
  if (f.franchise) return `${decade} · ${nameAtTime(f, franchiseNames) ?? 'NBA Records'}`;
  if (f.player) return `${decade} · ${f.player}`;
  return `${decade} · NBA Records`;
}

export function generateCategories(facts: Fact[], franchises: Franchise[]): string {
  const names = new Map(franchises.map(f => [f.id, f.currentName]));
  const seen = new Set<string>();
  const labels = facts.map((f) => {
    if (seen.has(f.id)) throw new Error(`duplicate question id ${f.id}`);
    seen.add(f.id);
    const category = labelFor(f, names);
    if (category.length > 40 || !category.trim()) throw new Error(`${f.id}: category too long or empty`);
    return [f.id, category] as const;
  });
  return JSON.stringify(Object.fromEntries(labels.sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n';
}

if (process.argv[1]?.endsWith('category-labels.ts')) {
  const facts = JSON.parse(readFileSync(SOURCE, 'utf8')) as Fact[];
  const franchises = JSON.parse(readFileSync(FRANCHISES, 'utf8')) as Franchise[];
  const expected = generateCategories(facts, franchises);
  const existing = readFileSync(TARGET, 'utf8');
  if (process.argv.includes('--check')) {
    if (existing !== expected) {
      console.error('NBA context labels are out of date; run node --experimental-strip-types scripts/nba/category-labels.ts');
      process.exitCode = 1;
    } else console.log(`Checked ${facts.length} NBA question categories`);
  } else {
    writeFileSync(TARGET, expected);
    console.log(`Generated ${facts.length} NBA question categories`);
  }
}
