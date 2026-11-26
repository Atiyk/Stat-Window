import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWeek, dayWords, monthDay, reviewableWeeks, weekdayLong, weekdayShort, weeklyCard, weekRange, weeklyShareText, WEEK_MAX, type DayState, type Week } from '../engine/weekly';
import { currentSeason, type SeasonConfig } from '../engine/season';
import type { SaveStore } from '../engine/storage';
import { track, type ShareMethod } from '../lib/track';
import { useOfficialHistory } from './use-history';
import { weeklyCardBlob, type CardFormat } from './share-card';
import './results-polish.css';
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
export function WeekGlance({ store, today, config, onOpen, className, link = true }: {
  store: SaveStore;
  today: string;
  config: SeasonConfig;
  onOpen: () => void;
  className?: string;
  /** False where the page already links to the scoreboard (results). */
  link?: boolean;
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
      {link && <button type="button" className="btn-link week-glance__open" onClick={onOpen}>Weekly Scoreboard</button>}
    </section>
  );
}

export function Weekly({ store, today, config, onBack }: { store: SaveStore; today: string; config: SeasonConfig; onBack: () => void }) {
  const season = currentSeason(today, config);
  const starts = useMemo(() => reviewableWeeks(today, season, config), [today, season, config]);
  const [which, setWhich] = useState(0);
  const history = useOfficialHistory(store, today, config, starts.at(-1));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  // A week rollover at midnight can shorten the list: never point past it.
  const index = Math.min(which, starts.length - 1);
  const week = history ? buildWeek(starts[index]!, today, season, config, history) : null;
  const older = index < starts.length - 1;
  const newer = index > 0;
  const go = (to: number) => setWhich(to);

  return (
    <article className="weekly" aria-labelledby="weekly-title">
      <button type="button" className="btn-link subpage-back" onClick={onBack}>← Today’s puzzle</button>
      <header className="weekly__head">
        <h1 id="weekly-title" ref={headingRef} tabIndex={-1} className="weekly__title">
          {week ? weekRange(week) : 'Your week'}
        </h1>
        <p className="weekly__sub">
          Weekly Scoreboard · {index === 0 ? 'this week' : 'last week'}, Monday to Sunday (Eastern)
        </p>
        {starts.length > 1 && (
          <nav className="week-nav" aria-label="Choose a week">
            <button type="button" className="week-nav__btn" aria-disabled={!older} onClick={() => older && go(index + 1)}>
              <span aria-hidden="true">‹ </span>Previous week
            </button>
            <button type="button" className="week-nav__btn" aria-disabled={!newer} onClick={() => newer && go(index - 1)}>
              Next week<span aria-hidden="true"> ›</span>
            </button>
          </nav>
        )}
      </header>
      {!week || !history ? <p className="loading" aria-live="polite">Loading your week…</p> : <WeekBody key={week.start} week={week} unavailable={history.unavailable.filter((d) => d >= week.start && d <= week.end).length} />}
    </article>
  );
}

/** The seven days as a game log: a column per day, its shape and word saying what happened. */
function WeekRecord({ week }: { week: Week }) {
  const card = weeklyCard(week, '');
  return (
    <ol className="week-record" aria-label="Day by day">
      {card.days.map((d, i) => {
        const day = week.days[i]!;
        return (
          <li key={day.day} className="week-day" data-state={day.kind} data-mark={d.mark}>
            <span className="sr-only">{weekdayLong(day.day)} {monthDay(day.day)}: {dayWords(day)}</span>
            <span className="week-day__box" aria-hidden="true">
              {d.mark === 'score' && <span className="week-day__bar" style={{ height: `${Math.max(6, d.fill * 100)}%` }} />}
              {d.note && <span className="week-day__note">{d.note}</span>}
            </span>
            <span className="week-day__value tabular" aria-hidden="true">{d.value || ' '}</span>
            <span className="week-day__name" aria-hidden="true">{d.weekday}</span>
            <span className="week-day__date" aria-hidden="true">{d.date.replace(/^\w+ /, '')}</span>
          </li>
        );
      })}
    </ol>
  );
}

function WeekBody({ week, unavailable }: { week: Week; unavailable: number }) {
  const maxLabel = week.seasonDays === 7 ? `of ${WEEK_MAX.toLocaleString('en-US')}` : `of ${week.maxPossible.toLocaleString('en-US')} possible`;
  const games = `${week.completed} of ${week.seasonDays}`;
  const launchWeek = week.seasonDays < 7;
  return (
    <>
      <section className="week-summary" aria-label="Week summary">
        <p className="week-summary__total">
          <span className="sr-only">Total </span>
          <span className="week-summary__points tabular">{week.total.toLocaleString('en-US')}</span>
          <span className="week-summary__of"> {maxLabel}</span>
        </p>
        <dl className="weekly__stats">
          <div><dt>Games</dt><dd className="tabular">{games}</dd></div>
          <div><dt>Average</dt><dd className="tabular">{week.average ?? '–'}</dd></div>
          <div><dt>Best day</dt><dd className="tabular">{week.best ? `${weekdayShort(week.best.day)} ${week.best.points}` : '–'}</dd></div>
        </dl>
      </section>
      <WeekRecord week={week} />
      <p className="weekly__note">
        {week.completed === 0
          ? week.status === 'current' ? 'No eligible daily games this week yet. Today’s five counts as soon as you finish it.' : 'No eligible daily games this week.'
          : week.completed === 1 && week.status === 'current'
            ? 'Your first game of the week is in. Each daily five you finish adds to the total.'
            : launchWeek
              ? `Launch week: the season began midweek, so ${week.seasonDays} ${week.seasonDays === 1 ? 'day counts' : 'days count'} here.`
              : 'Seven daily games, up to 3,500 points.'}
        {' '}Days you didn’t play stay empty and are never scored as zero.
        {unavailable > 0 && ` ${unavailable} saved ${unavailable === 1 ? 'game' : 'games'} couldn’t be verified and ${unavailable === 1 ? 'isn’t' : 'aren’t'} counted.`}
        {' '}Official games only, from this browser.
      </p>
      {week.completed > 0 && <WeekShare week={week} />}
    </>
  );
}

type Prepared = { format: CardFormat; blob: Blob | null; url: string | null; file: File | null };

/** Share the week as text, or as an image: preview, download, or the native share sheet. */
function WeekShare({ week }: { week: Week }) {
  const [fallback, setFallback] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [format, setFormat] = useState<CardFormat>('square');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const busy = useRef(false);
  const url = `${window.location.origin}/`;
  const model = useMemo(() => weeklyCard(week, url), [week, url]);
  const filename = `stat-window-week-${week.start}${format === 'portrait' ? '-portrait' : ''}.png`;
  const nativeShare = typeof navigator !== 'undefined' && !!navigator.share && matchMedia('(pointer: coarse)').matches;
  const canShareFile = nativeShare && typeof navigator.canShare === 'function';
  const report = (method: ShareMethod) => track({ name: 'weekly_share', method });

  useEffect(() => {
    if (fallback) { boxRef.current?.focus({ preventScroll: true }); boxRef.current?.select(); }
  }, [fallback]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Draw the image ahead of any tap, so the share sheet keeps the user gesture (Safari).
  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    void weeklyCardBlob(model, format).then((blob) => {
      if (!live) return;
      let file: File | null = null;
      if (blob && canShareFile) {
        try {
          const png = new File([blob], filename, { type: 'image/png' });
          if (navigator.canShare({ files: [png] })) file = png;
        } catch {
          // Download stays available when files can't be shared.
        }
      }
      objectUrl = blob ? URL.createObjectURL(blob) : null;
      setPrepared({ format, blob, url: objectUrl, file });
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [model, format, filename, canShareFile]);
  const image = prepared?.format === format ? prepared : null;

  const shareText = async (file: File | null = null) => {
    if (busy.current) return;
    busy.current = true;
    const text = weeklyShareText(week, url);
    setFallback(null);
    try {
      if (nativeShare) {
        try {
          await navigator.share(file ? { text, files: [file] } : { text });
          report(file ? 'native-image' : 'native');
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
        }
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setToast(file ? 'Text copied. Save the image separately.' : 'Copied');
      report('clipboard');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return report('cancelled');
      setFallback(text);
      setToast('Copy the selected text');
      report('failed');
    } finally {
      busy.current = false;
    }
  };

  const save = () => {
    if (!image?.url) {
      setToast('Couldn’t make the image. Share the text instead.');
      return;
    }
    const link = document.createElement('a');
    link.href = image.url;
    link.download = filename;
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
    }
    setToast('Download started');
    report('image-saved');
  };

  return (
    <section className="weekly__share" aria-labelledby="weekly-share-title">
      <h2 id="weekly-share-title" className="weekly__h">Share your week</h2>
      <p className="weekly__note">Daily scores, dates and games played. Never questions or answers.</p>
      <div className="weekly__share-actions">
        <button type="button" className="btn btn-primary" onClick={() => void shareText()}>Share this week</button>
      </div>
      {fallback && <textarea ref={boxRef} className="share-fallback" readOnly rows={9} value={fallback} aria-label="Your weekly scorecard to copy" onFocus={(e) => e.currentTarget.select()} />}
      <div className="weekly-image">
        <fieldset className="card-formats">
          <legend>Image</legend>
          {(['square', 'portrait'] as const).map((option) => (
            <label key={option}>
              <input type="radio" name="weekly-format" checked={format === option} onChange={() => setFormat(option)} />
              {option === 'square' ? 'Square' : 'Portrait'}
            </label>
          ))}
        </fieldset>
        <div className="weekly-image__preview" data-format={format}>
          {image?.url ? <img src={image.url} alt={`Weekly scorecard image: ${weeklyShareText(week, url).split('\n').slice(1, -2).join(', ')}`} />
            : image ? <p className="weekly__note">This browser couldn’t draw the image. Share this week still sends the text.</p>
            : <p className="weekly__note" aria-live="polite">Drawing your scorecard…</p>}
        </div>
        <div className="weekly__share-actions">
          <button type="button" className="btn btn-quiet btn-small" aria-disabled={!image?.url} onClick={save}>Save image</button>
          {canShareFile && image?.file && (
            <button type="button" className="btn btn-quiet btn-small" onClick={() => void shareText(image.file)}>Share image</button>
          )}
        </div>
      </div>
      <div className="toast" role="status" aria-live="polite" data-visible={toast !== null}>{toast}</div>
    </section>
  );
}
