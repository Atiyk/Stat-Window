import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWeek, dayWords, monthDay, reviewableWeeks, weekdayLong, weekdayShort, weekRange, weeklyShareText, WEEK_MAX, type DayState, type Week } from '../engine/weekly';
import { currentSeason, type SeasonConfig } from '../engine/season';
import type { SaveStore } from '../engine/storage';
import { track, type ShareMethod } from '../lib/track';
import { useOfficialHistory } from './use-history';
import './weekly.css';

const SHORT_STATE: Record<Exclude<DayState['kind'], 'completed'>, string> = {
  unplayed: '–',
  open: '•',
  future: '',
  'before-season': 'n/a',
  unavailable: '?',
};

/** A compact Monday-to-Sunday strip. Each day is one list item with a text equivalent. */
export function WeekStrip({ week }: { week: Week }) {
  return (
    <ol className="week-strip" aria-label={`Daily scores, ${weekRange(week)}`}>
      {week.days.map((d) => (
        <li key={d.day} className="week-strip__day" data-state={d.kind}>
          <span className="sr-only">{weekdayLong(d.day)} {monthDay(d.day)}: {dayWords(d)}</span>
          <span className="week-strip__bar" aria-hidden="true">
            {d.kind === 'completed' && <span style={{ height: `${Math.max(4, (d.points / 500) * 100)}%` }} />}
          </span>
          <span className="week-strip__value tabular" aria-hidden="true">{d.kind === 'completed' ? d.points : SHORT_STATE[d.kind]}</span>
          <span className="week-strip__name" aria-hidden="true">{weekdayShort(d.day).slice(0, 1)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The home and results glance: this week so far, with a way into the full scoreboard. Hidden until there is a genuine eligible game. */
export function WeekGlance({ store, today, config, onOpen, className }: {
  store: SaveStore;
  today: string;
  config: SeasonConfig;
  onOpen: () => void;
  className?: string;
}) {
  const season = currentSeason(today, config);
  const monday = reviewableWeeks(today, season, config)[0]!;
  const history = useOfficialHistory(store, today, config, monday);
  const week = useMemo(() => (history ? buildWeek(monday, today, season, config, history) : null), [history, monday, today, season, config]);
  if (!week || week.completed === 0) return null;
  const games = `${week.completed} of ${week.seasonDays} ${week.seasonDays === 1 ? 'game' : 'games'}`;
  return (
    <section className={`week-glance ${className ?? ''}`} aria-labelledby="week-glance-title">
      <div className="week-glance__head">
        <h2 id="week-glance-title" className="week-glance__title">This week</h2>
        <p className="week-glance__sum"><span className="tabular">{week.total.toLocaleString('en-US')}</span> points · {games}</p>
      </div>
      <WeekStrip week={week} />
      <button type="button" className="btn-link week-glance__open" onClick={onOpen}>Weekly Scoreboard</button>
    </section>
  );
}

function barWidth(d: DayState): string {
  return d.kind === 'completed' ? `${Math.max(d.points > 0 ? 1.5 : 0, d.points / 5)}%` : '0%';
}

export function Weekly({ store, today, config, onBack }: { store: SaveStore; today: string; config: SeasonConfig; onBack: () => void }) {
  const season = currentSeason(today, config);
  const starts = useMemo(() => reviewableWeeks(today, season, config), [today, season, config]);
  const [which, setWhich] = useState(0);
  const history = useOfficialHistory(store, today, config, starts.at(-1));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  const week = history ? buildWeek(starts[which]!, today, season, config, history) : null;

  return (
    <article className="weekly" aria-labelledby="weekly-title">
      <button type="button" className="btn-link subpage-back" onClick={onBack}>← Today’s puzzle</button>
      <header className="weekly__head">
        <p className="context">Weekly Scoreboard</p>
        <h1 id="weekly-title" ref={headingRef} tabIndex={-1} className="weekly__title">
          {week ? weekRange(week) : 'Your week'}
        </h1>
      </header>
      {starts.length > 1 && (
        <div className="week-tabs" role="group" aria-label="Choose a week">
          {starts.map((s, i) => (
            <button key={s} type="button" className="week-tab" aria-pressed={which === i} onClick={() => setWhich(i)}>
              {i === 0 ? 'This week' : 'Last week'}
            </button>
          ))}
        </div>
      )}
      {!week || !history ? <p className="loading" aria-live="polite">Loading your week…</p> : <WeekBody week={week} unavailable={history.unavailable.filter((d) => d >= week.start && d <= week.end).length} />}
    </article>
  );
}

function WeekBody({ week, unavailable }: { week: Week; unavailable: number }) {
  const [fallback, setFallback] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (fallback) { boxRef.current?.focus({ preventScroll: true }); boxRef.current?.select(); }
  }, [fallback]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const share = async () => {
    const text = weeklyShareText(week, `${window.location.origin}/`);
    const report = (method: ShareMethod) => track({ name: 'weekly_share', method });
    setFallback(null);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try {
          await navigator.share({ text });
          report('native');
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
        }
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setToast('Copied');
      report('clipboard');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return report('cancelled');
      setFallback(text);
      setToast('Copy the selected text');
      report('failed');
    }
  };

  const maxLabel = week.seasonDays === 7 ? `of ${WEEK_MAX.toLocaleString('en-US')}` : `of ${week.maxPossible.toLocaleString('en-US')} possible`;
  const games = `${week.completed} of ${week.seasonDays}`;
  return (
    <>
      <dl className="stats weekly__stats">
        <div className="weekly__total"><dt>Total</dt><dd className="tabular">{week.total.toLocaleString('en-US')}<span className="weekly__of"> {maxLabel}</span></dd></div>
        <div><dt>Games</dt><dd className="tabular">{games}</dd></div>
        <div><dt>Average</dt><dd className="tabular">{week.average ?? '–'}</dd></div>
        <div><dt>Best day</dt><dd className="tabular">{week.best ? <>{week.best.points}<span className="weekly__of"> {weekdayShort(week.best.day)}</span></> : '–'}</dd></div>
      </dl>
      <ol className="week-rows" aria-label="Day by day">
        {week.days.map((d) => (
          <li key={d.day} className="week-row" data-state={d.kind}>
            <span className="week-row__day"><span className="week-row__name">{weekdayShort(d.day)}</span> <span className="week-row__date">{monthDay(d.day)}</span></span>
            <span className="week-row__track" aria-hidden="true"><span className="week-row__bar" style={{ width: barWidth(d) }} /></span>
            <span className="week-row__value tabular">{d.kind === 'completed' ? <>{d.points}<span className="sr-only"> points</span></> : dayWords(d).replace(/^./, (c) => c.toUpperCase())}</span>
          </li>
        ))}
      </ol>
      <p className="weekly__note">
        {week.completed === 0
          ? 'No eligible daily games this week yet.'
          : week.seasonDays < 7
            ? `This season began midweek, so ${week.seasonDays} ${week.seasonDays === 1 ? 'day counts' : 'days count'} here. Days you didn’t play stay empty and are never scored as zero.`
            : 'Seven daily games, up to 3,500 points. Days you didn’t play stay empty and are never scored as zero.'}
        {unavailable > 0 && ` ${unavailable} saved ${unavailable === 1 ? 'game' : 'games'} couldn’t be verified and ${unavailable === 1 ? 'isn’t' : 'aren’t'} counted.`}
        {' '}Official games only, from this browser.
      </p>
      {week.completed > 0 && (
        <div className="weekly__share">
          <button type="button" className="btn btn-quiet" onClick={() => void share()}>Share this week</button>
          <p className="weekly__note">Shares daily scores and the games-played count, never questions or answers.</p>
          {fallback && <textarea ref={boxRef} className="share-fallback" readOnly rows={9} value={fallback} aria-label="Your weekly scorecard to copy" onFocus={(e) => e.currentTarget.select()} />}
        </div>
      )}
      <div className="toast" role="status" aria-live="polite" data-visible={toast !== null}>{toast}</div>
    </>
  );
}

