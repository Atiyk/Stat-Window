import { useEffect, useMemo, useRef } from 'react';
import { MAX_POINTS_PER_ROUND } from '../engine/scoring';
import {
  buildReport, catches, MIN_CATEGORY_ATTEMPTS, PERIOD_GAMES, RISK_BANDS,
  type BandStats, type CategoryRow, type Dimension, type Report, type Tally,
} from '../engine/scouting';
import type { SeasonConfig } from '../engine/season';
import type { SaveStore } from '../engine/storage';
import { formatDay } from '../lib/format';
import { useOfficialHistory } from './use-history';
import './weekly.css';
import './scouting.css';

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const OUTCOMES = [
  { key: 'scoringHits', label: 'Scoring hits', note: 'caught the answer and earned points' },
  { key: 'zeroCatches', label: 'Zero-point catches', note: 'caught the answer with a window too wide to score' },
  { key: 'misses', label: 'Misses', note: 'the answer was outside the window' },
  { key: 'timeouts', label: 'Timeouts', note: 'the clock ran out' },
] as const;

function OutcomeBar({ t }: { t: Tally }) {
  return (
    <figure className="outcomes">
      <div className="outcomes__bar" aria-hidden="true">
        {OUTCOMES.map((o) => t[o.key] > 0 && <span key={o.key} data-outcome={o.key} style={{ flexGrow: t[o.key] }} />)}
      </div>
      <figcaption className="sr-only">Outcome of every window, as the list below.</figcaption>
      <ul className="outcomes__list">
        {OUTCOMES.map((o) => (
          <li key={o.key} data-outcome={o.key}>
            <span className="outcomes__swatch" aria-hidden="true" />
            <span><strong className="tabular">{t[o.key]}</strong> {o.label.toLowerCase()}<span className="sr-only">: {o.note}</span></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Trend({ series }: { series: Report['series'] }) {
  const pts = series.slice(-30);
  if (pts.length < 3) return <p className="scouting__note">Scores appear here after three completed games.</p>;
  const w = 300;
  const h = 72;
  const x = (i: number) => 6 + (i / (pts.length - 1)) * (w - 12);
  const y = (v: number) => h - 6 - (v / 500) * (h - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  const lo = Math.min(...pts.map((p) => p.total));
  const hi = Math.max(...pts.map((p) => p.total));
  const text = `Scores from ${formatDay(pts[0]!.day)} to ${formatDay(pts.at(-1)!.day)}, oldest to newest: ${pts.map((p) => p.total).join(', ')}. Lowest ${lo}, highest ${hi}.`;
  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={text}>
        <line x1="0" x2={w} y1={y(0)} y2={y(0)} className="trend__axis" />
        <path d={d} className="trend__line" />
        {pts.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.total)} r="2.5" className="trend__dot" />)}
      </svg>
      <figcaption className="scouting__note">Total per completed game, newest on the right (0 to 500). Lowest {lo}, highest {hi}.</figcaption>
    </figure>
  );
}

function BandTable({ bands }: { bands: readonly BandStats[] }) {
  return (
    <table className="scouting-table">
      <caption className="sr-only">Risk bands, from the potential points of the window you saved</caption>
      <thead><tr><th scope="col">Window</th><th scope="col">Attempts</th><th scope="col">Caught</th><th scope="col">Earned / potential</th></tr></thead>
      <tbody>
        {RISK_BANDS.map((meta) => {
          const b = bands.find((x) => x.band === meta.id)!;
          return (
            <tr key={meta.id} data-band={meta.id}>
              <th scope="row">{meta.label}<span className="scouting-table__sub">potential {meta.min}–{meta.max}</span></th>
              <td className="tabular">{b.attempts}</td>
              <td className="tabular">{b.attempts ? `${catches(b)} of ${b.attempts}` : '–'}</td>
              <td className="tabular">{b.attempts ? `${b.earned} / ${b.potential}` : '–'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CategoryTable({ rows, noun, limit }: { rows: readonly CategoryRow[]; noun: string; limit?: number }) {
  const shown = rows.filter((r) => !limit || r.sufficient).slice(0, limit ?? rows.length);
  const hidden = rows.length - shown.length;
  return (
    <>
      <table className="scouting-table">
        <caption className="sr-only">Results by {noun}</caption>
        <thead><tr><th scope="col">{noun[0]!.toUpperCase() + noun.slice(1)}</th><th scope="col">Attempts</th><th scope="col">Caught</th><th scope="col">Points / attempt</th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} data-sufficient={r.sufficient}>
              <th scope="row">{r.label}{!r.sufficient && <span className="scouting-table__sub">small sample</span>}</th>
              <td className="tabular">{r.attempts}</td>
              <td className="tabular">{catches(r)} of {r.attempts}</td>
              <td className="tabular">{r.sufficient ? Math.round(r.perAttempt) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <p className="scouting__note">{plural(hidden, 'more category', 'more categories')} with fewer than {MIN_CATEGORY_ATTEMPTS} attempts {hidden === 1 ? 'isn’t' : 'aren’t'} listed.</p>}
    </>
  );
}

const DIMENSIONS: { dim: Dimension; title: string; noun: string; limit?: number }[] = [
  { dim: 'format', title: 'Question format', noun: 'format' },
  { dim: 'focus', title: 'Players and teams', noun: 'subject' },
  { dim: 'era', title: 'NBA era', noun: 'era' },
  { dim: 'family', title: 'Statistic', noun: 'statistic', limit: 8 },
];

export function Scouting({ store, today, config, onBack, onWeekly }: {
  store: SaveStore;
  today: string;
  config: SeasonConfig;
  onBack: () => void;
  onWeekly: () => void;
}) {
  const history = useOfficialHistory(store, today, config);
  const report = useMemo(() => (history ? buildReport(history.records, today) : null), [history, today]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);

  return (
    <article className="scouting" aria-labelledby="scouting-title">
      <button type="button" className="btn-link subpage-back" onClick={onBack}>← Today’s puzzle</button>
      <header className="scouting__head">
        <p className="context">Scouting Report</p>
        <h1 id="scouting-title" ref={headingRef} tabIndex={-1} className="scouting__title">How you estimate</h1>
      </header>
      {!history || !report ? <p className="loading" aria-live="polite">Reading your games…</p>
        : report.games === 0 ? <Empty unavailable={history.unavailable.length} onBack={onBack} />
        : <Body report={report} unavailable={history.unavailable.length} onWeekly={onWeekly} />}
    </article>
  );
}

function Empty({ unavailable, onBack }: { unavailable: number; onBack: () => void }) {
  return (
    <section className="scouting__empty">
      <p className="scouting__lead">Your report starts after your first completed daily game of this season.</p>
      <p className="scouting__note">It uses official daily games only, kept in this browser. Practice and challenge replays of earlier days aren’t included.</p>
      {unavailable > 0 && <p className="scouting__note">{plural(unavailable, 'saved game')} couldn’t be verified, so nothing is counted yet.</p>}
      <button type="button" className="btn btn-primary" onClick={onBack}>Back to today’s puzzle</button>
    </section>
  );
}

function Body({ report, unavailable, onWeekly }: { report: Report; unavailable: number; onWeekly: () => void }) {
  const { stats, overall } = report;
  const metrics: [string, string][] = [
    ['Completed games', String(report.games)],
    ['Average', String(stats.average)],
    ['Best', String(stats.best)],
    ['Streak', `${stats.streak}`],
    ['Windows that caught it', pct(catches(overall), overall.attempts)],
    ['Points per attempt', report.perAttempt === null ? '–' : String(Math.round(report.perAttempt))],
  ];
  const more14 = PERIOD_GAMES * 2 - report.games;
  return (
    <>
      <p className="scouting__lead">
        From your {plural(report.games, 'completed official game')} this season. Descriptive only: puzzles differ in difficulty, so these numbers don’t measure skill on their own.
      </p>
      <dl className="stats scouting__metrics">
        {metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabular">{value}</dd></div>)}
      </dl>
      <p className="scouting__note">
        Longest streak {stats.longest} {stats.longest === 1 ? 'day' : 'days'}. “Windows that caught it” counts every window that held the answer, including zero-point catches. Out of {overall.attempts} windows.
      </p>

      <section aria-labelledby="outcomes-title" className="scouting__section">
        <h2 id="outcomes-title" className="scouting__h">What happened to your windows</h2>
        <OutcomeBar t={overall} />
      </section>

      <section aria-labelledby="observations-title" className="scouting__section">
        <h2 id="observations-title" className="scouting__h">What stands out</h2>
        {report.observations.length > 0 ? (
          <ul className="observations">{report.observations.map((o) => <li key={o}>{o}</li>)}</ul>
        ) : (
          <p className="scouting__note">Nothing stands out yet. Notes appear once a group has {MIN_CATEGORY_ATTEMPTS} or more attempts{more14 > 0 ? `, and the recent comparison after ${plural(more14, 'more game')} (${PERIOD_GAMES} recent and ${PERIOD_GAMES} earlier)` : ''}.</p>
        )}
        {report.comparison && <p className="scouting__note">Comparisons are descriptive, not a claim about improvement.</p>}
      </section>

      <details className="scouting__details">
        <summary>Risk profile<span>Wide and narrow windows, from the potential points you saved</span></summary>
        <p className="scouting__note">
          Potential is what a window would score if it caught the answer, from its width on that question’s scale ({MAX_POINTS_PER_ROUND} is the tightest). A narrow window isn’t a measure of confidence. Timeouts have no window and aren’t included.
        </p>
        <BandTable bands={report.bands} />
        <p className="scouting__note">
          {report.nearMisses > 0 ? `${plural(report.nearMisses, 'near miss', 'near misses')} (missed by under 5% of the scale). ` : ''}
          {report.bands.some((b) => b.attempts > 0 && !b.sufficient) ? `Bands with fewer than ${MIN_CATEGORY_ATTEMPTS} attempts show counts only.` : ''}
        </p>
      </details>

      <details className="scouting__details">
        <summary>Knowledge profile<span>Format, subject, era and statistic</span></summary>
        <p className="scouting__note">
          Groups use each question’s structured details. Groups under {MIN_CATEGORY_ATTEMPTS} attempts show counts only. “Not recorded” covers older puzzles without those details.
        </p>
        {DIMENSIONS.map(({ dim, title, noun, limit }) => (
          <section key={dim} className="scouting__dim" aria-label={title}>
            <h3 className="scouting__h3">{title}</h3>
            <CategoryTable rows={report.dims[dim]} noun={noun} {...(limit ? { limit } : {})} />
          </section>
        ))}
      </details>

      <details className="scouting__details">
        <summary>Scores over time<span>Total for each completed game</span></summary>
        <Trend series={report.series} />
      </details>

      {unavailable > 0 && <p className="scouting__note">{plural(unavailable, 'saved game')} couldn’t be verified and {unavailable === 1 ? 'isn’t' : 'aren’t'} counted.</p>}
      <p className="scouting__foot">
        <button type="button" className="btn-link" onClick={onWeekly}>Weekly Scoreboard</button>
      </p>
    </>
  );
}
