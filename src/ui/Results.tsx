import { useEffect, useRef, useState } from 'react';
import type { Slate } from '../content/schema';
import { msUntilNextPuzzle } from '../engine/daily';
import { totalPoints, type Mode, type RoundRecord } from '../engine/game';
import { MAX_TOTAL, shareText, verdict, type PlayerStats } from '../engine/summary';
import { formatCountdown, formatDay, formatValue } from '../lib/format';
import { track } from '../lib/track';
import { useNow } from './hooks';

type Props = {
  slate: Slate;
  number: number;
  mode: Mode;
  results: readonly RoundRecord[];
  stats: PlayerStats;
  archive: readonly string[];
  onPractice: (day: string) => void;
  onBackToToday: () => void;
};

export function Results({ slate, number, mode, results, stats, archive, onPractice, onBackToToday }: Props) {
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
    const text = shareText({ number, results, url: window.location.origin });
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        track({ name: 'share', number, method: 'native' });
        return;
      }
      await navigator.clipboard.writeText(text);
      setToast('Copied. Paste it anywhere.');
      track({ name: 'share', number, method: 'clipboard' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setFallback(text);
      setToast('Couldn’t copy automatically. Select the text below.');
      track({ name: 'share', number, method: 'failed' });
    }
  };

  const practice = mode === 'practice';

  return (
    <article className="results">
      <header className="results-head">
        <p className="context">
          {practice ? `Practice · No. ${number} · ${formatDay(slate.date)} · not counted` : `No. ${number} · ${formatDay(slate.date)}`}
        </p>
        <h1 className="results-title" ref={headingRef} tabIndex={-1}>
          {verdict(total)}
        </h1>
        <p className="results-total">
          <span className="results-score tabular">{total}</span>
          <span className="results-max">of {MAX_TOTAL}</span>
        </p>
      </header>

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

      <div className="results-actions">
        {practice ? (
          <button type="button" className="btn btn-primary" onClick={onBackToToday}>
            Back to today
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={share}>
            Share result
          </button>
        )}
        {fallback && (
          <textarea className="share-fallback" readOnly value={fallback} rows={3} aria-label="Your result to copy" onFocus={(e) => e.currentTarget.select()} />
        )}
        <p className="next-window">
          Next puzzle in <span className="tabular">{formatCountdown(msUntilNextPuzzle(now))}</span>
        </p>
      </div>

      {!practice && (
        <dl className="stats">
          <div><dt>Played</dt><dd className="tabular">{stats.played}</dd></div>
          <div><dt>Average</dt><dd className="tabular">{stats.average}</dd></div>
          <div><dt>Best</dt><dd className="tabular">{stats.best}</dd></div>
          <div><dt>Days in a row</dt><dd className="tabular">{stats.streak}</dd></div>
        </dl>
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
