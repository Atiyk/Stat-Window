import { useEffect, useMemo, useState } from 'react';
import { loadSlate } from '../content/inventory';
import { finishedDays, loadOfficialHistory, type OfficialHistory } from '../engine/history';
import { currentSeason, type SeasonConfig } from '../engine/season';
import { SAVE_KEY, type SaveStore } from '../engine/storage';

/**
 * This browser's eligible official history for `today`'s season, verified against the
 * published slates (src/engine/history.ts). `null` while loading. `from` limits the
 * slates that must be fetched (the Weekly views need at most fourteen days).
 * Re-reads when another tab saves a run.
 */
export function useOfficialHistory(store: SaveStore, today: string, config: SeasonConfig, from?: string): OfficialHistory | null {
  const season = currentSeason(today, config);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SAVE_KEY || e.key === null) setTick((n) => n + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const runs = store.load().runs;
  const range = useMemo(() => (from ? { from } : {}), [from]);
  const key = finishedDays(runs, season, config, today, range).join(',');
  const [state, setState] = useState<{ key: string; history: OfficialHistory } | null>(null);
  useEffect(() => {
    let live = true;
    void loadOfficialHistory(store.load().runs, season, config, today, loadSlate, range)
      .then((history) => { if (live) setState({ key: `${key}|${today}|${tick}`, history }); })
      .catch(() => { if (live) setState({ key: `${key}|${today}|${tick}`, history: { records: [], unavailable: [] } }); });
    return () => { live = false; };
  }, [store, season, config, today, range, key, tick]);
  return state && state.key === `${key}|${today}|${tick}` ? state.history : null;
}

/** Whether this browser has any finished official run this season (a cheap check; nothing is loaded). */
export function hasFinishedOfficialRun(store: SaveStore, today: string, config: SeasonConfig): boolean {
  return finishedDays(store.load().runs, currentSeason(today, config), config, today).length > 0;
}
