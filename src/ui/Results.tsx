import { useEffect, useMemo, useRef, useState } from 'react';
import type { Slate } from '../content/schema';
import { challengeUrl } from '../engine/challenge';
import { msUntilNextPuzzle } from '../engine/daily';
import { REMIND_COPY, followsPuzzleClock, googleCalendarUrl, icsPath, nextReminder, reminderHour, reminderTime } from '../engine/remind';
import { totalPoints, type Mode, type RoundRecord } from '../engine/game';
import { MAX_TOTAL, answerTimeMs, formatAnswerTime, shareText, verdict, type PlayerStats } from '../engine/summary';
import { ordinal } from '../engine/percentile';
import { formatCountdown, formatDay, formatValue } from '../lib/format';
import { isMixedSportDay } from '../content/cutover';
import { track, type PlayMode, type ShareMethod } from '../lib/track';
import { useNow } from './hooks';
import { ComparisonLine, ConsentChoice } from './Comparison';
import { cardBlob } from './share-card';
import { useComparison } from './use-comparison';
import { Leaderboard } from './Leaderboard';

type Props = {
  slate: Slate;
  /** Public puzzle label: "No. 4", or "Beta No. 4" once a formal season has launched. */
  label: string;
  /** First completed run of today's official puzzle: may join the daily comparison. */
  eligible: boolean;
  onPrivacy?: (() => void) | undefined;
  mode: Mode;
  playMode: PlayMode;
  /** False when this is an earlier day (finished after midnight UTC, practice or a challenge). */
  isToday: boolean;
  /** The score a friend's link claimed. Unverified: shown for comparison only. */
  vs: number | null;
  vsTime: number | null;
  results: readonly RoundRecord[];
  stats: PlayerStats;
  archive: readonly string[];
  onPractice: (day: string) => void;
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

export function Results({ slate, label, eligible, onPrivacy, mode, playMode, isToday, vs, vsTime, results, stats, archive, onPractice, onBackToToday, onShared, survivalCta = null }: Props) {
  const total = totalPoints(results);
  const answerMs = answerTimeMs(results);
  const raw = useComparison(eligible, slate.date, results);
  const slotRef = useRef<HTMLDivElement>(null);
  // After a yes or no the buttons go away; keep focus on the line that now answers.
  // The slot sits well above the consent box on phones, so bring it into view rather than move focus off-screen.
  const refocus = () => window.requestAnimationFrame(() => slotRef.current?.focus());
  const comparison = { ...raw, join: () => (raw.join(), refocus()), decline: () => (raw.decline(), refocus()) };
  const verified = comparison.state.kind === 'ready' ? comparison.state : null;
  const percentileLine = verified ? `${ordinal(verified.percentile)} percentile today (${verified.n.toLocaleString('en-US')} games)` : null;
  const cardInput = () => ({
    label,
    date: formatDay(slate.date),
    results,
    answerMs,
    percentile: verified ? { label: `${ordinal(verified.percentile)} percentile today`, detail: `based on ${verified.n.toLocaleString('en-US')} eligible completed games` } : null,
    host: window.location.host || 'stat-window.vercel.app',
  });
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
  // The card is drawn ahead of the tap: Safari only allows share() straight from the gesture,
  // so awaiting fonts and a canvas inside the click could cost the share sheet.
  const cardKey = `${label}|${total}|${answerMs ?? ''}|${percentileLine ?? ''}`;
  const card = useRef<{ key: string; blob: Blob | null } | null>(null);
  useEffect(() => {
    if (!nativeShare) return;
    let live = true;
    void cardBlob(cardInput()).then((blob) => {
      if (live) card.current = { key: cardKey, blob };
    });
    return () => {
      live = false;
    };
    // cardInput is derived from cardKey's parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeShare, cardKey]);

  const share = async () => {
    const url = challengeUrl(window.location.origin, slate.date, total, answerMs);
    const text = shareText({ label, results, url, percentile: percentileLine, answerMs });
    try {
      // Native share sheet on touch devices; with the image card when the browser accepts files.
      if (nativeShare) {
        // Normally ready; drawn now only if the tap beat the first render.
        const blob = card.current?.key === cardKey ? card.current.blob : await cardBlob(cardInput());
        const file = blob ? new File([blob], `stat-window-${slate.date}.png`, { type: 'image/png' }) : null;
        const withFile = file && navigator.canShare?.({ files: [file] }) ? { files: [file] } : {};
        try {
          await navigator.share({ text, ...withFile });
          // The sheet closed with a target picked. Whether anything was sent isn't observable.
          report('files' in withFile ? 'native-image' : 'native');
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          // Refused (for example NotAllowedError): fall through to the clipboard.
        }
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setToast('Copied. Paste it anywhere.');
      report('clipboard');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        report('cancelled');
        return;
      }
      setFallback(text);
      setToast('Couldn’t copy automatically. The text below is selected.');
      report('failed');
    }
  };

  const saveCard = async () => {
    const blob = await cardBlob(cardInput());
    if (!blob) {
      setToast('Couldn’t make the image in this browser.');
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `stat-window-${slate.date}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    setToast('Score card ready. No answers on it.');
    report('image-saved');
  };

  const remindTapped = (method: 'ics' | 'google') => {
    track({ name: 'remind', method });
    setToast(REMIND_COPY.toast);
  };

  const nextAt = new Date(now.getTime() + msUntilNextPuzzle(now));
  const local = localTimeOf(nextAt);

  const practice = mode === 'practice';

  return (
    <article className="results">
      <header className="results-head">
        <h1 className="results-title" ref={headingRef} tabIndex={-1}>
          {verdict(total)}
        </h1>
        <p className="results-total">
          <span className="results-score tabular">{total}</span>
          <span className="results-max">of {MAX_TOTAL}</span>
        </p>
        <p className="results-time">Answer time: <strong className="tabular">{answerMs === null ? 'Not timed' : formatAnswerTime(answerMs)}</strong> <span>· five 24-second shot clocks</span></p>
        <ol className="ledger scorecard" aria-label="Question by question">
          {results.map((r, i) => (
            <li key={i} className="ledger-cell" data-status={!r.hit ? 'miss' : r.points > 0 ? 'hit' : 'zero'} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="sr-only">
                Question {i + 1}: {r.points} points
              </span>
              <span className="ledger-num" aria-hidden="true">{r.points}</span>
            </li>
          ))}
        </ol>
        <p className="context results-context">
          {practice
            ? `${playMode === 'challenge' ? 'Challenge' : 'Practice'} · ${label} · ${formatDay(slate.date)} · not counted in your stats`
            : `${label} · ${formatDay(slate.date)}`}
        </p>
        <ComparisonLine comparison={comparison} onPrivacy={onPrivacy} ref={slotRef} />
        {vs !== null && <p className="versus">{friendLine(total, vs, answerMs, vsTime)}</p>}
      </header>

      <div className="results-actions">
        {/* The share of the day just played always comes first, on practice and challenge runs too. */}
        <button type="button" className="btn btn-primary" onClick={share}>
          Challenge a friend
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
        <p className="share-note">
          {total > 0
            ? `They get the same five questions and see your ${total}${answerMs === null ? '' : ` and ${formatAnswerTime(answerMs)}`}. Higher score wins; time breaks ties. No answers shared.`
            : 'They get the same five questions. No answers are in the link.'}
        </p>
        <button type="button" className="btn btn-link" onClick={saveCard}>
          Save score card (no answers on it)
        </button>
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
          <h2 id="archive-title" className="archive-title">Warm up on an earlier day</h2>
          <p className="archive-sub">Practice runs don’t count toward your stats.</p>
          <ul className="archive-list">
            {archive.map((day) => (
              <li key={day}>
                <button type="button" className="btn btn-quiet" onClick={() => onPractice(day)}>
                  {formatDay(day)}
                  {isMixedSportDay(day) && <span className="archive-tag"> · mixed sports</span>}
                </button>
              </li>
            ))}
          </ul>
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
