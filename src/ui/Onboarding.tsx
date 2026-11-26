import { CORE_INTRO } from '../content/teaching';
import { TeachingPlay } from './TeachingPlay';

/**
 * The core first-play introduction: the easy, real Warriors 73-win question, played
 * untimed with the same Readout, Ruler, scoring, reveal and Live Court Run as the
 * daily. It teaches by play (drag or type, lock, inclusive edges, the narrow-window
 * risk, scoring and court advancement) and can be skipped at once. It never loads or
 * saves a scored slate, and the 24-second shot clock is not mounted until onDone().
 */
export function Onboarding({ onDone, onGuide }: { onDone: () => void; onGuide?: (() => void) | undefined }) {
  return (
    <TeachingPlay
      example={CORE_INTRO}
      className="onboarding-play"
      label="First-play tutorial"
      titleClassName="onboarding-practice-title"
      coach
      courtRun
      status={<p className="context onboarding-status">Practice · <span className="shot-clock">No timer</span></p>}
      actions={({ phase, moved, lock, replay }) => (
        <>
          {phase === 'ready' ? (
            <button type="button" className="btn btn-primary" disabled={!moved} onClick={lock}>
              {moved ? 'Lock the window' : 'Pull the brackets in first'}
            </button>
          ) : phase === 'resolved' ? (
            <button type="button" className="btn btn-primary" onClick={onDone}>Start today's five</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled>Revealing…</button>
          )}
          {phase === 'resolved' && <button type="button" className="btn btn-quiet" onClick={replay}>Try another window</button>}
          {phase === 'ready' && <button type="button" className="btn btn-quiet" onClick={onDone}>Skip tutorial and start</button>}
          {phase === 'resolved' && (
            <p className="onboarding-footnote">
              Five questions, 24 seconds each. Press Start to begin the first clock.
              {onGuide && <> Questions come in a few types; <button type="button" className="btn-link" onClick={onGuide}>see how each works</button>.</>}
            </p>
          )}
        </>
      )}
    />
  );
}
