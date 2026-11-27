import { useEffect, useRef, useState } from 'react';
import { analyticsEnabled } from '../lib/track';
import { NBA_CUTOVER } from '../content/cutover';
import type { PlayerFormat } from '../content/formats';
import { CORE_INTRO, FORMAT_GUIDE, GUIDE_FORMATS, type TeachingExample } from '../content/teaching';
import { formatDay } from '../lib/format';
import { TeachingPlay } from './TeachingPlay';
import { WindowDemo } from './WindowDemo';
import './teaching.css';

/** What the guide shows: the overview, the first-play walkthrough, or one format's example. */
export type GuideView = 'list' | 'intro' | PlayerFormat;

/**
 * How to play: the rules, the three question types and one replayable, untimed worked
 * NBA example for each, using the real brackets and chart. Opening it never touches the
 * shot clock. While a timed question is live the guide still opens (it is the
 * player's choice, never forced) but says the clock is running and holds the worked
 * examples until the round resolves.
 */
export function Help({ open, onClose, onPrivacy, view: requested = 'list', clockLive = false }: {
  open: boolean;
  onClose: () => void;
  onPrivacy?: () => void;
  /** Where the guide opens. */
  view?: GuideView;
  /** A timed question is on screen with its clock running. */
  clockLive?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<GuideView>(requested);
  const [run, setRun] = useState(0);
  const returnTo = useRef<GuideView | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setView(clockLive ? 'list' : requested);
      d.showModal();
    }
    if (!open && d.open) d.close();
    // Only the open transition picks the starting view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Back on the list, return focus to the example the player just left.
  useEffect(() => {
    if (view !== 'list' || !open) return;
    const from = returnTo.current;
    returnTo.current = null;
    const target = from ? ref.current?.querySelector<HTMLElement>(`[data-guide-open="${from}"]`) : titleRef.current;
    target?.focus({ preventScroll: from === null });
  }, [view, open]);

  const show = (v: GuideView) => {
    setRun((n) => n + 1);
    setView(v);
    ref.current?.querySelector('.help-body')?.scrollTo?.({ top: 0 });
  };
  const back = () => {
    returnTo.current = view;
    setView('list');
  };

  const example: TeachingExample | null = view === 'list' ? null : view === 'intro' ? CORE_INTRO : FORMAT_GUIDE[view].example;
  const label = view === 'list' ? 'How to play' : view === 'intro' ? 'The basics' : FORMAT_GUIDE[view].label;

  return (
    <dialog ref={ref} className="help guide" aria-labelledby="help-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="help-body" data-view={view}>
        <div className="guide-head">
          {example ? (
            <button type="button" className="btn-link guide-back" onClick={back}>
              <span aria-hidden="true">←</span> All question types
            </button>
          ) : <span />}
          <button type="button" className="icon-btn guide-close" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {example && view !== 'list' ? (
          <>
            <h2 id="help-title" className="help-title guide-title">{label}</h2>
            <p className="guide-kicker">Untimed example · not saved or scored</p>
            <p className="guide-detail">{view === 'intro' ? 'Drag or type a window, lock it, and see how the scoring works.' : FORMAT_GUIDE[view].detail}</p>
            <TeachingPlay
              key={`${view}:${run}`}
              example={example}
              className="onboarding-play guide-play"
              label={`${label} example`}
              titleAs="h3"
              titleClassName="guide-example-title"
              coach={view === 'intro'}
              courtRun={view === 'intro'}
              actions={({ phase, moved, lock, replay }) => (
                <>
                  {phase === 'ready' ? (
                    <button type="button" className="btn btn-primary" disabled={!moved} onClick={lock}>
                      {moved ? 'Lock the window' : 'Pull the brackets in first'}
                    </button>
                  ) : phase === 'resolved' ? (
                    <button type="button" className="btn btn-primary" onClick={replay}>Replay this example</button>
                  ) : (
                    <button type="button" className="btn btn-primary" disabled>Revealing…</button>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={back}>Back to question types</button>
                </>
              )}
            />
          </>
        ) : (
          <>
            <h2 id="help-title" ref={titleRef} className="help-title" tabIndex={-1} autoFocus>How to play</h2>
            {clockLive && (
              <p className="guide-live" role="note">
                Your shot clock is still running. This guide doesn’t pause it; worked examples open after this question.
              </p>
            )}
            <p>
              Five NBA questions a day, each with a number for an answer. Drag the two brackets to frame your estimate,
              then lock the window before the 24-second shot clock runs out.
            </p>
            <WindowDemo className="help-demo" />
            <p>
              <strong>Tighter pays more,</strong> up to 100 points a question and 500 a day. A window covering nearly the whole
              ruler scores 0 even when it catches the answer, and so does a miss or a timeout. Both edges count as inside. The
              clock keeps running if you switch tabs or reload.
            </p>

            <h3 className="guide-section">Question types</h3>
            <p className="guide-intro">
              Same brackets, scoring and clock for all three. Each has an untimed example to try; nothing in it is saved or scored.
            </p>
            <ul className="guide-types">
              <li>
                <button type="button" className="guide-type" data-guide-open="intro" disabled={clockLive} onClick={() => show('intro')}>
                  <span className="guide-type__label">The basics</span>
                  <span className="guide-type__summary">The Warriors walkthrough: drag, lock, score, move up the court.</span>
                </button>
              </li>
              {GUIDE_FORMATS.map((f) => (
                <li key={f}>
                  <button type="button" className="guide-type" data-guide-open={f} data-format={f} disabled={clockLive} onClick={() => show(f)}>
                    <span className="guide-type__label">{FORMAT_GUIDE[f].label}</span>
                    <span className="guide-type__summary">{FORMAT_GUIDE[f].instruction}</span>
                  </button>
                </li>
              ))}
            </ul>

            <p>
              Prefer exact numbers? Tap either big number to type it. On a keyboard, Tab to a bracket and use the arrow keys
              (Shift moves further, Enter locks). Tap the ruler outside your window to pull that side straight to it.
            </p>
            <p className="help-small">
              A new puzzle opens every day at 12:00 AM Eastern, the same five for everyone. From {formatDay(NBA_CUTOVER)} every puzzle is NBA. Your progress stays in this browser;
              there’s no account.{' '}
              {analyticsEnabled
                ? 'We count plays without cookies or IDs (rounds locked, games finished, shares) to improve the game. Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. Names and answers are never kept.'
                : 'Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. Names and answers are never kept.'}{' '}
              {onPrivacy && (
                <>
                  <button type="button" className="btn-link" onClick={onPrivacy}>
                    Privacy choices
                  </button>
                  .{' '}
                </>
              )}
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Got it
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

/**
 * A small entry to the guide for pregame surfaces (the ready card, the home card):
 * place it anywhere and pass the App's guide opener.
 */
export function GuideLink({ onOpen, className = '' }: { onOpen: () => void; className?: string }) {
  return (
    <button type="button" className={`btn-link guide-link ${className}`} onClick={onOpen}>
      How to play · question types
    </button>
  );
}
