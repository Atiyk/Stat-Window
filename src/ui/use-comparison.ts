import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoundRecord } from '../engine/game';
import { browserSignal, loadPrivacy, savePrivacy, scoreIntent } from '../lib/privacy';
import { isQa, refreshComparison, submitDaily, type Comparison } from '../lib/scores';
import { track, trackOnce, type AnalyticsCohort } from '../lib/track';

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

export function useComparison(eligible: boolean, day: string, results: readonly RoundRecord[], cohort: AnalyticsCohort): ComparisonApi {
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
        if (loadPrivacy().deleting || loadPrivacy().scores === 'off') { setState({ kind: 'off' }); return; }
        setState(c);
        if (c.kind === 'unavailable') trackOnce(`comparison-failure:${day}`, day, { name: 'failure', source: 'comparison', cohort });
      });
    },
    [day, cohort],
  );

  useEffect(() => {
    const update = () => {
      const p = loadPrivacy();
      if (p.deleting || p.scores === 'off') setState({ kind: 'off' });
    };
    window.addEventListener('stat-window:privacy-choice', update);
    const storageUpdate = (e: StorageEvent) => {
      if (e.key === 'stat-window:privacy:v1') update();
    };
    window.addEventListener('storage', storageUpdate);
    return () => {
      window.removeEventListener('stat-window:privacy-choice', update);
      window.removeEventListener('storage', storageUpdate);
    };
  }, []);

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
      track({ name: 'privacy', choice: 'scores-on', cohort });
      send(true);
    },
    decline: () => {
      savePrivacy({ scores: 'off' });
      track({ name: 'privacy', choice: 'scores-off', cohort });
      setState({ kind: 'off' });
    },
    refresh: () => {
      if (state.kind !== 'ready' && state.kind !== 'gathering') return;
      // QA reads its own season's tally by sending the run again (see submitDaily).
      if (isQa()) return send(loadPrivacy().scores === 'on');
      const score = state.score;
      void refreshComparison(day, score).then((c) => {
        if (loadPrivacy().deleting || loadPrivacy().scores === 'off') { setState({ kind: 'off' }); return; }
        setState(c.kind === 'unavailable' ? state : c);
      });
    },
  };
}
