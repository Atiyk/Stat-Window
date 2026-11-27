import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { MAX_POINTS_PER_ROUND } from '../engine/scoring';
import {
  buildReport, catches, MIN_CATEGORY_ATTEMPTS, MIN_CONSISTENCY_GAMES, PERIOD_GAMES, RISK_BANDS,
  type BandStats, type CategoryRow, type Dimension, type Report, type Tally,
} from '../engine/scouting';
import type { SeasonConfig } from '../engine/season';
import type { SaveStore } from '../engine/storage';
import { formatDay, plural } from '../lib/format';
import { useOfficialHistory } from './use-history';
import './weekly.css';
import './scouting.css';

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

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
        <h1 id="scouting-title" ref={headingRef} tabIndex={-1} className="scouting__title">How you estimate</h1>
        <p className="weekly__sub">Scouting Report · from this browser’s official daily games</p>
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
      {unavailable > 0 && <p className="scouting__note">{plural(unavailable, 'saved game')} couldn’t be verified, so nothing is counted yet.</p>}
      <button type="button" className="btn btn-primary" onClick={onBack}>Back to today’s puzzle</button>
    </section>
  );
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** The headline profile: one row per question a scout would ask, each with its sample or an honest "not yet". */
function ProfileSheet({ report }: { report: Report }) {
  const { profile: p, games } = report;
  const rows: { label: string; value: string; note: string; quiet?: boolean }[] = [
    { label: 'Completed games', value: String(games), note: 'official daily games this season' },
    p.recent
      ? { label: 'Recent scoring', value: `${p.recent.average}`, note: `average over your last ${plural(p.recent.games, 'game')}` }
      : { label: 'Recent scoring', value: '–', note: 'after your first game', quiet: true },
    { label: 'Catch rate', value: pct(p.caught.caught, p.caught.attempts), note: `${p.caught.caught} of ${plural(p.caught.attempts, 'question')} caught; a timeout counts as a miss` },
    p.strongest
      ? { label: 'Strongest category', value: p.strongest.label, note: `${Math.round(p.strongest.perAttempt)} points per attempt over ${plural(p.strongest.attempts, 'attempt')}` }
      : { label: 'Strongest category', value: 'Not clear yet', note: `needs two statistic categories with ${MIN_CATEGORY_ATTEMPTS}+ attempts and a clear lead`, quiet: true },
    p.risk
      ? { label: 'Risk profile', value: p.risk.label, note: `${Math.round(p.risk.share * 100)}% of ${plural(p.risk.windows, 'locked window')} (timeouts left out) ${RISK_BANDS.find((b) => b.id === p.risk!.band)!.widthNote.replace(/^window covers/, 'covered')}` }
      : { label: 'Risk profile', value: 'Not enough windows', note: `needs ${MIN_CATEGORY_ATTEMPTS} saved windows`, quiet: true },
    p.trend
      ? { label: 'Recent trend', value: p.trend.direction === 'same' ? 'About the same' : `${signed(p.trend.direction === 'more' ? p.trend.points : -p.trend.points)} per game`, note: `last ${PERIOD_GAMES} games against the ${PERIOD_GAMES} before them` }
      : { label: 'Recent trend', value: 'Not yet', note: `after ${plural(PERIOD_GAMES * 2 - games, 'more game')} (${PERIOD_GAMES} recent and ${PERIOD_GAMES} earlier)`, quiet: true },
    p.best
      ? { label: 'Personal best', value: String(p.best.total), note: formatDay(p.best.day) }
      : { label: 'Personal best', value: '–', note: 'after your first game', quiet: true },
    p.consistency
      ? { label: 'Consistency', value: `${p.consistency.low}–${p.consistency.high}`, note: `the middle half of your ${p.consistency.games} games` }
      : { label: 'Consistency', value: 'Not yet', note: `after ${plural(MIN_CONSISTENCY_GAMES - games, 'more game')}`, quiet: true },
  ];
  return (
    <dl className="profile scouting__metrics">
      {rows.map((r) => (
        <div key={r.label} className="profile__row" data-quiet={r.quiet || undefined}>
          <dt>{r.label}</dt>
          <dd><span className="profile__value tabular">{r.value}</span><span className="profile__note">{r.note}</span></dd>
        </div>
      ))}
    </dl>
  );
}

/** The last games as a game log: one column per game, height is its total out of 500. */
function GameLog({ series }: { series: Report['series'] }) {
  const pts = series.slice(-30);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.total));
  const hi = Math.max(...pts.map((p) => p.total));
  return (
    <figure className="game-log">
      <figcaption className="scouting__h3">Last {plural(pts.length, 'game')}</figcaption>
      <ol className="game-log__bars" aria-label={`Totals, oldest to newest: ${pts.map((p) => `${formatDay(p.day)} ${p.total}`).join(', ')}`}>
        {pts.map((p) => (
          <li key={p.day} title={`${formatDay(p.day)}: ${p.total}`} data-edge={p.total === hi ? 'high' : p.total === lo ? 'low' : undefined}>
            <span style={{ height: `${Math.max(3, (p.total / 500) * 100)}%` }} />
          </li>
        ))}
      </ol>
      <p className="scouting__note">Each column is one game, out of 500, newest on the right. Lowest {lo}, highest {hi}.</p>
    </figure>
  );
}

function Fold({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <details className="scouting__details">
      <summary>{title}<span>{sub}</span></summary>
      {children}
    </details>
  );
}

function Body({ report, unavailable, onWeekly }: { report: Report; unavailable: number; onWeekly: () => void }) {
  const { overall } = report;
  return (
    <>
      <ProfileSheet report={report} />
      <GameLog series={report.series} />
      <p className="scouting__note">
        Descriptive only: puzzles differ in difficulty, so these numbers don’t measure skill on their own. Longest streak {plural(report.stats.longest, 'day')}.
      </p>

      <div className="scouting__folds">
        <Fold title="What stands out" sub="Notes the sample supports">
          {report.observations.length > 0 ? (
            <ul className="observations">{report.observations.map((o) => <li key={o}>{o}</li>)}</ul>
          ) : (
            <p className="scouting__note">Nothing stands out yet. Notes appear once a group has {MIN_CATEGORY_ATTEMPTS} or more attempts.</p>
          )}
          {report.comparison && <p className="scouting__note">Comparisons are descriptive, not a claim about improvement.</p>}
        </Fold>
        <Fold title="Every window" sub={`What happened to your ${plural(overall.attempts, 'window')}`}>
          <OutcomeBar t={overall} />
          <p className="scouting__note">“Caught” counts every window that held the answer, including zero-point catches.</p>
        </Fold>
        <Fold title="Risk profile" sub="Wide and narrow windows, from the potential points you saved">
          <p className="scouting__note">
            Potential is what a window would score if it caught the answer, from its width on that question’s scale ({MAX_POINTS_PER_ROUND} is the tightest). A narrow window isn’t a measure of confidence. Timeouts have no window and aren’t included.
          </p>
          <BandTable bands={report.bands} />
          <p className="scouting__note">
            {report.nearMisses > 0 ? `${plural(report.nearMisses, 'near miss', 'near misses')} (missed by under 5% of the scale). ` : ''}
            {report.bands.some((b) => b.attempts > 0 && !b.sufficient) ? `Bands with fewer than ${MIN_CATEGORY_ATTEMPTS} attempts show counts only.` : ''}
          </p>
        </Fold>
        <Fold title="Question formats" sub="Recall, reference and missing point">
          <CategoryTable rows={report.formats.current} noun="format" />
          {report.formats.earlier.length > 0 && (
            <section className="scouting__dim" aria-label="Earlier formats">
              <h3 className="scouting__h3">Earlier formats</h3>
              <p className="scouting__note">Formats used before the current three, shown under the names they were played with.</p>
              <CategoryTable rows={report.formats.earlier} noun="format" />
            </section>
          )}
        </Fold>
        <Fold title="Knowledge profile" sub="Subject, era and statistic">
          <p className="scouting__note">
            Groups use each question’s structured details. Groups under {MIN_CATEGORY_ATTEMPTS} attempts show counts only. “Not recorded” covers older puzzles without those details.
          </p>
          {DIMENSIONS.map(({ dim, title, noun, limit }) => (
            <section key={dim} className="scouting__dim" aria-label={title}>
              <h3 className="scouting__h3">{title}</h3>
              <CategoryTable rows={report.dims[dim]} noun={noun} {...(limit ? { limit } : {})} />
            </section>
          ))}
        </Fold>
      </div>

      {unavailable > 0 && <p className="scouting__note">{plural(unavailable, 'saved game')} couldn’t be verified and {unavailable === 1 ? 'isn’t' : 'aren’t'} counted.</p>}
      <p className="scouting__foot">
        <button type="button" className="btn-link" onClick={onWeekly}>Weekly Scoreboard</button>
      </p>
    </>
  );
}
