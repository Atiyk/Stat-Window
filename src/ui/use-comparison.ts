import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundRecord } from '../engine/game';
import { browserSignal, loadPrivacy, savePrivacy, scoreIntent } from '../lib/privacy';
import { refreshComparison, submitDaily, type Comparison } from '../lib/scores';
import { track, trackOnce } from '../lib/track';

export type ComparisonState = Comparison | { kind: 'none' } | { kind: 'loading' } | { kind: 'off' };

export type ComparisonApi = {
  state: ComparisonState;
  /** Player said yes to joining today's comparison. */
  join: () => void;
  /** Player said no (remembered; can be changed in Privacy). */
  decline: () => void;
  refresh: () => void;
};

/** One in-flight submission per day per page, so StrictMode remounts and re-renders never double-send. */
const inflight = new Map<string, Promise<Comparison>>();

export function useComparison(eligible: boolean, day: string, results: readonly RoundRecord[]): ComparisonApi {
  const [state, setState] = useState<ComparisonState>({ kind: eligible ? 'loading' : 'none' });
  const resultsRef = useRef(results);
  resultsRef.current = results;

  const send = useCallback(
    (consent: boolean) => {
      setState({ kind: 'loading' });
      const key = `${day}:${consent}`;
      const p = inflight.get(key) ?? submitDaily({ day, results: resultsRef.current, consent });
      inflight.set(key, p);
      void p.then((c) => {
        inflight.delete(key);
        setState(c);
        const outcome = c.kind === 'consent' ? 'consent' : c.kind;
        trackOnce(`pct:${day}:${outcome}`, day, { name: 'percentile', outcome });
      });
    },
    [day],
  );

  useEffect(() => {
    if (!eligible) return;
    const intent = scoreIntent(loadPrivacy(), browserSignal());
    if (intent === 'skip') setState({ kind: 'off' });
    else if (intent === 'ask') setState({ kind: 'consent' });
    else send(loadPrivacy().scores === 'on');
  }, [eligible, send]);

  return {
    state,
    join: () => {
      savePrivacy({ scores: 'on' });
      track({ name: 'privacy', choice: 'scores-on' });
      send(true);
    },
    decline: () => {
      savePrivacy({ scores: 'off' });
      track({ name: 'privacy', choice: 'scores-off' });
      setState({ kind: 'off' });
    },
    refresh: () => {
      if (state.kind !== 'ready' && state.kind !== 'gathering') return;
      const score = state.score;
      void refreshComparison(day, score).then((c) => setState(c.kind === 'unavailable' ? state : c));
    },
  };
}
