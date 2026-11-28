import { courtRunCheckpoints } from '../../src/engine/court-run';
import { addDays } from '../../src/engine/daily';
import { WEEK_MAX, weeklyCard, type DayState, type Week } from '../../src/engine/weekly';
import { CANONICAL_URL } from '../../src/lib/site';
import { cardBlob, weeklyCardBlob } from '../../src/ui/share-card';

const dailyPoints = [82, 88, 0, 67, 96].map(points => ({ points }));
const exampleWeekStart = '2025-01-06';
const exampleScores = [328, 241, null, 391, 0, 305, null];
const completed = exampleScores.filter((score): score is number => score !== null);
const total = completed.reduce((sum, points) => sum + points, 0);
const week: Week = {
  start: exampleWeekStart,
  end: addDays(exampleWeekStart, 6),
  days: exampleScores.map((score, i): DayState => {
    const day = addDays(exampleWeekStart, i);
    return score === null ? { day, kind: 'unplayed' } : { day, kind: 'completed', points: score };
  }),
  completed: completed.length,
  total,
  average: Math.round(total / completed.length),
  best: { day: addDays(exampleWeekStart, 3), points: 391 },
  seasonDays: 7,
  maxPossible: WEEK_MAX,
  status: 'ended',
};

// Demonstration labels are part of each saved image, so they travel with the file.
// Inputs are synthetic and never come from official questions or player storage.
export async function demoScorecard(kind: 'daily' | 'weekly'): Promise<number[]> {
  await document.fonts.load('700 40px "DM Sans Variable"');
  const blob = kind === 'daily'
    ? await cardBlob({
        style: 'court-run',
        label: 'Daily demonstration score',
        date: '',
        total: dailyPoints.reduce((sum, round) => sum + round.points, 0),
        checkpoints: courtRunCheckpoints(dailyPoints),
        puzzleUrl: CANONICAL_URL,
      })
    : await weeklyCardBlob({
        ...weeklyCard(week, CANONICAL_URL),
        range: 'Demonstration scores',
      }, 'portrait');
  if (!blob) throw new Error(`Unable to render the ${kind} demonstration scorecard`);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
