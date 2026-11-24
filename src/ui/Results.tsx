import { useEffect, useMemo, useRef, useState } from 'react';
import type { Slate } from '../content/schema';
import { challengeUrl } from '../engine/challenge';
import { msUntilNextPuzzle } from '../engine/daily';
import { REMIND_COPY, followsPuzzleClock, googleCalendarUrl, icsPath, nextReminder, reminderHour, reminderTime } from '../engine/remind';
import { totalPoints, type Mode, type PracticeTiming, type RoundRecord } from '../engine/game';
import { MAX_TOTAL, answerTimeMs, formatAnswerTime, shareText, postgameHighlight, type OfficialHighlight, type PlayerStats } from '../engine/summary';
import { ordinal } from '../engine/percentile';
import { formatCountdown, formatDay, formatValue } from '../lib/format';
import { isMixedSportDay } from '../content/cutover';
import { track, type PlayMode, type ShareMethod } from '../lib/track';
import { useNow } from './hooks';
import { ComparisonLine, ConsentChoice } from './Comparison';
import { cardBlob, type CardFormat, type CardInput } from './share-card';
import { useComparison } from './use-comparison';
import { Leaderboard } from './Leaderboard';
import { InstallPrompt } from './InstallPrompt';
import { PracticeTimingChoice } from './PracticeTimingChoice';
import './results-polish.css';

type Props = {
  slate: Slate;
  /** Public puzzle label: "No. 4", or "Beta No. 4" once a formal season has launched. */
  label: string;
  /** First completed run of today's official puzzle: may join the daily comparison. */
  eligible: boolean;
  onPrivacy?: (() => void) | undefined;
  mode: Mode;
  playMode: PlayMode;
  untimedPractice?: boolean;
  /** False when this is an earlier day (finished after midnight UTC, practice or a challenge). */
  isToday: boolean;
  /** The score a friend's link claimed. Unverified: shown for comparison only. */
  vs: number | null;
  vsTime: number | null;
  results: readonly RoundRecord[];
  stats: PlayerStats;
  officialHighlight?: OfficialHighlight | undefined;
  animateScorecard?: boolean;
  archive: readonly string[];
  onPractice: (day: string, timing?: PracticeTiming) => void;
  onBackToToday: () => void;
  /** Called after a share attempt (for the experiment's guardrail). */
  onShared?: ((method: ShareMethod) => void) | undefined;
  /** Survival is open and this player is offered it: a quiet secondary button. */
  survivalCta?: (() => void) | null | undefined;
};

/** "7:00 PM" in the player's own time zone, or null when that zone is UTC anyway. */
function localTimeOf(at: Date): string | null {
  if (at.getTimezoneOffset() === 0) return null;
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function friendLine(total: number, vs: number, time: number | null, vsTime: number | null): string {
  if (total > vs) return `You beat your friend by ${total - vs} points.`;
  if (total < vs) return `Your friend leads by ${vs - total} points. Send a rematch.`;
  if (time !== null && vsTime !== null) {
    if (time < vsTime) return `Tied at ${total}. You win the time tiebreaker!`;
    if (time > vsTime) return `Tied at ${total}. Your friend wins on time.`;
  }
  return `Tied at ${total} points. Rematch?`;
}

export function Results({ slate, label, eligible, onPrivacy, mode, playMode, untimedPractice = false, isToday, vs, vsTime, results, stats, officialHighlight, animateScorecard = false, archive, onPractice, onBackToToday, onShared, survivalCta = null }: Props) {
  const total = totalPoints(results);
  const [format, setFormat] = useState<CardFormat>('square');
  const [cardOptionsOpen, setCardOptionsOpen] = useState(false);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [practiceTiming, setPracticeTiming] = useState<PracticeTiming>('timed');
  const [pending, setPending] = useState<'challenge' | 'image' | 'save' | null>(null);
  const working = useRef(false);
  const answerMs = untimedPractice ? null : answerTimeMs(results);
  const raw = useComparison(eligible, slate.date, results);
  const slotRef = useRef<HTMLDivElement>(null);
  // After a yes or no the buttons go away; keep focus on the line that now answers.
  // The slot sits well above the consent box on phones, so bring it into view rather than move focus off-screen.
  const refocus = () => window.requestAnimationFrame(() => slotRef.current?.focus());
  const comparison = { ...raw, join: () => (raw.join(), refocus()), decline: () => (raw.decline(), refocus()) };
  const verified = comparison.state.kind === 'ready' ? comparison.state : null;
  const sample = verified?.n.toLocaleString('en-US');
  const percentile = verified ? `${ordinal(verified.percentile)} percentile today` : null;
  const percentileLine = percentile ? `${percentile} (${sample} games)` : null;
  const cardInput = useMemo<CardInput>(() => ({
    label,
    format,
    untimed: untimedPractice,
    date: formatDay(slate.date),
    results,
    answerMs,
    percentile: percentile ? { label: percentile, detail: `based on ${sample} eligible completed games` } : null,
    host: window.location.host || 'stat-window.vercel.app',
  }), [label, format, untimedPractice, slate.date, results, answerMs, percentile, sample]);
  const now = useNow(1000);
  // The reminder slot is fixed when the screen opens, not every second.
  const remind = useMemo(() => {
    const at = new Date();
    return {
      href: icsPath(reminderHour(at)),
      google: googleCalendarUrl(at),
      time: reminderTime(nextReminder(at)),
      note: REMIND_COPY.note(followsPuzzleClock(at)),
    };
  }, []);
  const [toast, setToastText] = useState<string | null>(null);
  // Bumped on every show, so a repeat of the same message restarts its timer instead of vanishing early.
  const [toastShown, setToastShown] = useState(0);
  const setToast = (text: string | null) => {
    setToastText(text);
    if (text) setToastShown((n) => n + 1);
  };
  const [fallback, setFallback] = useState<string | null>(null);
  const reminderLinkRef = useRef<HTMLAnchorElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);

  // The last round may have left the page scrolled down to its fact: open the day at the top,
  // with focus on the heading the player can see (as each new round does).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // The copy-me box appears right under the share button: bring it into view, focused and selected,
  // so "select the text below" is already done for the player.
  useEffect(() => {
    const box = fallbackRef.current;
    if (!fallback || !box) return;
    box.focus({ preventScroll: true });
    box.select();
    box.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [fallback]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToastText(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast, toastShown]);

  const report = (m: ShareMethod) => {
    track({ name: 'share', mode: playMode, method: m });
    onShared?.(m);
  };

  const nativeShare = typeof navigator !== 'undefined' && !!navigator.share && matchMedia('(pointer: coarse)').matches;
  const canShareFile = nativeShare && typeof navigator.canShare === 'function';
  const filename = `stat-window-${slate.date}${untimedPractice ? '-untimed' : ''}${format === 'portrait' ? '-portrait' : ''}.png`;
  const [preparedCard, setPreparedCard] = useState<{ input: CardInput; blob: Blob | null; file: File | null } | null>(null);
  const card = preparedCard?.input === cardInput ? preparedCard : null;
  const cardPrepared = card !== null;
  // Prepare the selected image ahead of its share tap so Safari keeps the user gesture.
  useEffect(() => {
    if (!cardOptionsOpen || !canShareFile || cardPrepared) return;
    let live = true;
    void cardBlob(cardInput).then((blob) => {
      if (!live) return;
      let file: File | null = null;
      if (blob) {
        try {
          const png = new File([blob], filename, { type: 'image/png' });
          if (navigator.canShare({ files: [png] })) file = png;
        } catch {
          // Download remains available when the browser cannot share files.
        }
      }
      setPreparedCard({ input: cardInput, blob, file });
    });
    return () => {
      live = false;
    };
  }, [cardOptionsOpen, canShareFile, cardPrepared, cardInput, filename]);

  const share = async (file: File | null = null) => {
    if (working.current) return;
    working.current = true;
    setPending(file ? 'image' : 'challenge');
    setToast(null);
    setFallback(null);
    const url = challengeUrl(window.location.origin, slate.date, untimedPractice ? undefined : total, answerMs);
    const text = shareText({ label, results, url, percentile: percentileLine, answerMs, untimed: untimedPractice });
    try {
      if (nativeShare) {
        try {
          await navigator.share(file ? { text, files: [file] } : { text });
          // The sheet closed with a target picked. Whether anything was sent isn't observable.
          setFallback(null);
          report(file ? 'native-image' : 'native');
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          // Refused (for example NotAllowedError): fall through to the clipboard.
        }
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setFallback(null);
      setToast(file ? 'Challenge copied. Save the image separately.' : 'Copied');
      report('clipboard');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        report('cancelled');
        return;
      }
      setFallback(text);
      setToast(file ? 'Copy the selected text and save the image separately.' : 'Copy the selected text');
      report('failed');
    } finally {
      working.current = false;
      setPending(null);
    }
  };

  const saveCard = async () => {
    if (working.current) return;
    working.current = true;
    setPending('save');
    setToast(null);
    let href: string | null = null;
    try {
      const blob = card?.blob ?? await cardBlob(cardInput);
      if (!blob) throw new Error('Card unavailable');
      href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = filename;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      setToast('Download started');
      report('image-saved');
    } catch {
      setToast('Couldn’t make the image. Try again.');
    } finally {
      if (href) {
        const objectUrl = href;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      }
      working.current = false;
      setPending(null);
    }
  };

  const remindTapped = (method: 'ics' | 'google') => {
    track({ name: 'remind', method });
    setToast(REMIND_COPY.toast);
  };

  const nextAt = new Date(now.getTime() + msUntilNextPuzzle(now));
  const local = localTimeOf(nextAt);

  const practice = mode === 'practice';
  const practiceLabel = playMode === 'challenge' ? 'Challenge' : untimedPractice ? 'Untimed practice' : 'Practice';

  return (
    <article className="results daily-results">
      <header className="results-head">
        <p className="context results-context">
          {practice
            ? `${practiceLabel} · ${label} · ${formatDay(slate.date)} · not counted in your stats`
            : `${label} · ${formatDay(slate.date)}`}
        </p>
        <h1 className="results-title results-total" ref={headingRef} tabIndex={-1}>
          <span className="sr-only">Score </span>
          <span className="results-score tabular">{total}</span>
          <span className="results-max">of {MAX_TOTAL}</span>
        </h1>
        <p className="results-verdict">{postgameHighlight(results, officialHighlight)}</p>
        <ol className="ledger scorecard" role="list" aria-label="Question by question" data-arrive={animateScorecard || undefined}>
          {results.map((r, i) => (
            <li key={i} className="ledger-cell" data-status={!r.hit ? 'miss' : r.points > 0 ? 'hit' : 'zero'} style={animateScorecard ? { animationDelay: `${i * 30}ms` } : undefined}>
              <span className="sr-only">
                Question {i + 1}, {r.points} points, {r.timedOut ? 'time expired' : r.hit ? 'hit' : 'miss'}
              </span>
              <span className="ledger-num" aria-hidden="true">{r.points}</span>
            </li>
          ))}
        </ol>
        {answerMs !== null && <p className="results-time">Answer time <strong className="tabular">{formatAnswerTime(answerMs)}</strong></p>}
      </header>

      <div className="results-actions">
        {/* The share of the day just played always comes first, on practice and challenge runs too. */}
        <button type="button" className="btn btn-primary" aria-describedby="challenge-share-note" aria-busy={pending === 'challenge'} aria-disabled={pending !== null} onClick={() => void share()}>
          {untimedPractice ? 'Share practice score' : 'Challenge a friend'}
        </button>
        {fallback && (
          <textarea
            ref={fallbackRef}
            className="share-fallback"
            readOnly
            value={fallback}
            rows={5}
            aria-label="Your result to copy"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <p className="share-note" id="challenge-share-note">
          {total > 0 || untimedPractice ? 'Send your score and the same five questions.' : 'Send the same five questions.'} No spoilers.
          {total > 0 && answerMs !== null && ' Time breaks ties.'}
        </p>
        <div className="score-card">
          <button type="button" className="btn btn-link score-card-toggle" aria-expanded={cardOptionsOpen} aria-controls="score-card-options" onClick={() => setCardOptionsOpen((open) => !open)}>
            Customize or save score card
          </button>
          <div className="score-card-options" id="score-card-options" hidden={!cardOptionsOpen}>
            <fieldset className="card-formats" disabled={pending !== null}>
              <legend>Score card format</legend>
              {(['square', 'portrait'] as const).map((option) => (
                <label key={option}>
                  <input type="radio" name="card-format" checked={format === option} onChange={() => setFormat(option)} />
                  {option === 'square' ? 'Square' : 'Portrait'}
                </label>
              ))}
            </fieldset>
            <div className="score-card-actions">
              <button type="button" className="btn btn-quiet btn-small save-score-card" aria-busy={pending === 'save'} aria-disabled={pending !== null} onClick={() => void saveCard()}>
                Save score card
              </button>
              {canShareFile && (!card || card.file) && (
                <button type="button" className="btn btn-quiet btn-small share-score-card" aria-busy={!card || pending === 'image'} aria-disabled={!card?.file || pending !== null} onClick={() => { if (card?.file) void share(card.file); }}>
                  Share score card
                </button>
              )}
            </div>
          </div>
        </div>
        <ComparisonLine comparison={comparison} onPrivacy={onPrivacy} ref={slotRef} />
        {vs !== null && <p className="versus">{friendLine(total, vs, answerMs, vsTime)}</p>}
        {(practice || !isToday) && (
          <button type="button" className="btn btn-quiet" onClick={onBackToToday}>
            Play today’s puzzle
          </button>
        )}
        {survivalCta && (
          <button type="button" className="btn btn-quiet" onClick={survivalCta}>
            Try Survival: 20 rounds, one life
          </button>
        )}
        <ConsentChoice comparison={comparison} onPrivacy={onPrivacy} />
        <p className="next-window">
          Next puzzle in <span className="tabular">{formatCountdown(msUntilNextPuzzle(now))}</span>, at 12:00 AM Eastern
          {local ? ` (${local} your time)` : ''}.
        </p>
        <div className="remind">
          <p className="remind-row">
            {REMIND_COPY.label(remind.time)}{' '}
            <span className="remind-keep">
              <a className="btn-link" href={remind.href} onClick={() => remindTapped('ics')}>
                {REMIND_COPY.ics}
              </a>
              <span aria-hidden="true">{'\u00a0·'}</span>
            </span>{' '}
            <a
              className="btn-link"
              href={remind.google}
              ref={reminderLinkRef}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={REMIND_COPY.googleName}
              onClick={() => remindTapped('google')}
            >
              {REMIND_COPY.google}
            </a>
          </p>
          <p className="remind-note">{remind.note}</p>
        </div>
        {!practice && playMode === 'daily' && <InstallPrompt completedDays={stats.played} onDismiss={() => reminderLinkRef.current?.focus({ preventScroll: true })} />}
      </div>

      <ol className="recap" aria-label="Your five windows">
        {slate.questions.map((q, i) => {
          const r = results[i];
          if (!r) return null;
          const span = q.max - q.min;
          const p = (v: number) => `${((v - q.min) / span) * 100}%`;
          return (
            <li key={q.id} className="recap-row" data-hit={r.hit}>
              <div className="recap-text">
                <p className="recap-q">{q.prompt}</p>
                <p className="recap-a">
                  {formatValue(q.answer, q.step)} {q.answer === 1 ? q.unit.singular : q.unit.plural} · you said{' '}
                  {formatValue(r.lo, q.step)}–{formatValue(r.hi, q.step)}
                </p>
              </div>
              <div className="recap-bar" aria-hidden="true">
                <span className="recap-window" style={{ left: p(r.lo), width: `calc(${p(r.hi)} - ${p(r.lo)})` }} />
                <span className="recap-pin" style={{ left: p(q.answer) }} />
              </div>
              <p className="recap-points tabular">{r.hit ? `+${r.points}` : '0'}</p>
            </li>
          );
        })}
      </ol>

      <Leaderboard day={slate.date} results={results} eligible={eligible && isToday} />

      {!practice && (
        <dl className="stats">
          <div><dt>Played</dt><dd className="tabular">{stats.played}</dd></div>
          <div><dt>Average</dt><dd className="tabular">{stats.average}</dd></div>
          <div><dt>Best</dt><dd className="tabular">{stats.best}</dd></div>
          <div><dt>Days in a row</dt><dd className="tabular">{stats.streak}</dd></div>
        </dl>
      )}

      {!practice && stats.played > 0 && (
        <section className="dist" aria-labelledby="dist-title">
          <h2 id="dist-title" className="dist-title">Your days</h2>
          <p className="dist-sub">
            Longest run: <span className="tabular">{stats.longest}</span> {stats.longest === 1 ? 'day' : 'days'} in a row. Kept in this browser.
          </p>
          <ol className="dist-list">
            {stats.distribution.map((count, band) => {
              const label = band === 4 ? '400–500' : `${band * 100}–${band * 100 + 99}`;
              const max = Math.max(...stats.distribution, 1);
              const today = band === Math.min(4, Math.floor(total / 100));
              return (
                <li key={band} className="dist-row" data-today={today || undefined}>
                  <span className="dist-label tabular">{label}</span>
                  <span className="dist-track" aria-hidden="true">
                    <span className="dist-bar" style={{ width: `${(count / max) * 100}%` }} />
                  </span>
                  <span className="dist-count tabular">
                    {count}
                    <span className="sr-only"> {count === 1 ? 'day' : 'days'}{today ? ', including today' : ''}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {archive.length > 0 && (
        <section className="archive" aria-labelledby="archive-title">
          <h2 id="archive-title" className="archive-title">Past games</h2>
          <p className="archive-sub">Practice runs don’t count toward your stats.</p>
          <PracticeTimingChoice timing={practiceTiming} onChange={setPracticeTiming} />
          <ul className="archive-list" id="past-games">
            {(archiveExpanded ? archive : archive.slice(0, 5)).map((day) => (
              <li key={day}>
                <button type="button" className="btn btn-quiet" onClick={() => onPractice(day, practiceTiming)}>
                  {formatDay(day)}
                  {isMixedSportDay(day) && <span className="archive-tag"> · mixed sports</span>}
                </button>
              </li>
            ))}
          </ul>
          {archive.length > 5 && (
            <button type="button" className="btn-link archive-toggle" aria-expanded={archiveExpanded} aria-controls="past-games" onClick={() => setArchiveExpanded(!archiveExpanded)}>
              {archiveExpanded ? 'Show recent games' : 'View all past games'}
            </button>
          )}
        </section>
      )}

      {onPrivacy && (
        <p className="privacy-foot">
          <button type="button" className="btn-link" onClick={onPrivacy}>
            Privacy and your data
          </button>
        </p>
      )}

      <div className="toast" role="status" aria-live="polite" data-visible={toast !== null}>
        {toast}
      </div>
    </article>
  );
}
