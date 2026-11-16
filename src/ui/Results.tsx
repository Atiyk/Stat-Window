import { useEffect, useRef, useState } from 'react';
import type { Slate } from '../content/schema';
import { challengeUrl } from '../engine/challenge';
import { msUntilNextPuzzle } from '../engine/daily';
import { totalPoints, type Mode, type RoundRecord } from '../engine/game';
import { MAX_TOTAL, shareText, verdict, type PlayerStats } from '../engine/summary';
import { formatCountdown, formatDay, formatValue } from '../lib/format';
import { isMixedSportDay } from '../content/cutover';
import { track, type PlayMode } from '../lib/track';
import { useNow } from './hooks';

type Props = {
  slate: Slate;
  number: number;
  mode: Mode;
  playMode: PlayMode;
  /** False when this is an earlier day (finished after midnight UTC, practice or a challenge). */
  isToday: boolean;
  /** The score a friend's link claimed. Unverified: shown for comparison only. */
  vs: number | null;
  results: readonly RoundRecord[];
  stats: PlayerStats;
  archive: readonly string[];
  onPractice: (day: string) => void;
  onBackToToday: () => void;
};

/** "7:00 PM" in the player's own time zone, or null when that zone is UTC anyway. */
function localTimeOf(at: Date): string | null {
  if (at.getTimezoneOffset() === 0) return null;
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function comparison(total: number, vs: number): string {
  if (total > vs) return `Your friend’s link says ${vs}. You beat it by ${total - vs}.`;
  if (total === vs) return `Your friend’s link says ${vs}. Dead level.`;
  return `Your friend’s link says ${vs}. They take this one by ${vs - total}.`;
}

export function Results({ slate, number, mode, playMode, isToday, vs, results, stats, archive, onPractice, onBackToToday }: Props) {
  const total = totalPoints(results);
  const now = useNow(1000);
  const [toast, setToast] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const share = async () => {
    const text = shareText({ number, results, url: challengeUrl(window.location.origin, slate.date, total) });
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        track({ name: 'share', mode: playMode, method: 'native' });
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setToast('Copied. Paste it anywhere.');
      track({ name: 'share', mode: playMode, method: 'clipboard' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        track({ name: 'share', mode: playMode, method: 'cancelled' });
        return;
      }
      setFallback(text);
      setToast('Couldn’t copy automatically. Select the text below.');
      track({ name: 'share', mode: playMode, method: 'failed' });
    }
  };

  const nextAt = new Date(now.getTime() + msUntilNextPuzzle(now));
  const local = localTimeOf(nextAt);

  const practice = mode === 'practice';

  return (
    <article className="results">
      <header className="results-head">
        <p className="context">
          {practice
            ? `${playMode === 'challenge' ? 'Challenge' : 'Practice'} · No. ${number} · ${formatDay(slate.date)} · not counted in your stats`
            : `No. ${number} · ${formatDay(slate.date)}`}
          {slate.theme ? ` · ${slate.theme.title}` : ''}
        </p>
        <h1 className="results-title" ref={headingRef} tabIndex={-1}>
          {verdict(total)}
        </h1>
        <p className="results-total">
          <span className="results-score tabular">{total}</span>
          <span className="results-max">of {MAX_TOTAL}</span>
        </p>
        <ol className="ledger scorecard" aria-label="Round by round">
          {results.map((r, i) => (
            <li key={i} className="ledger-cell" data-status={!r.hit ? 'miss' : r.points > 0 ? 'hit' : 'zero'} style={{ animationDelay: `${i * 70}ms` }}>
              <span className="sr-only">
                Round {i + 1}: {r.points} points
              </span>
              <span className="ledger-num" aria-hidden="true">{r.points}</span>
            </li>
          ))}
        </ol>
        {slate.theme && <p className="theme-recap">{slate.theme.recap}</p>}
        {vs !== null && <p className="versus">{comparison(total, vs)}</p>}
      </header>

      <div className="results-actions">
        {practice || !isToday ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onBackToToday}>
              Play today’s puzzle
            </button>
            <button type="button" className="btn btn-quiet" onClick={share}>
              Send these five to a friend
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={share}>
            Challenge a friend
          </button>
        )}
        <p className="share-note">
          {total > 0
            ? `They get the same five questions and see your ${total}, never your answers.`
            : 'They get the same five questions. No answers are in the link.'}
        </p>
        {fallback && (
          <textarea className="share-fallback" readOnly value={fallback} rows={4} aria-label="Your result to copy" onFocus={(e) => e.currentTarget.select()} />
        )}
        <p className="next-window">
          Next puzzle in <span className="tabular">{formatCountdown(msUntilNextPuzzle(now))}</span>, at midnight UTC
          {local ? ` (${local} your time)` : ''}.
        </p>
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

      <div className="toast" role="status" aria-live="polite" data-visible={toast !== null}>
        {toast}
      </div>
    </article>
  );
}
