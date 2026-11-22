import { describe, expect, it, vi } from 'vitest';
import { savePrivacy } from './privacy';
import { analyticsHosts, analyticsOn, eventPath, privacySignal, resumeAnalytics, setCohort, setTrackSink, startAnalytics, totalBand, track, trackOnce, type TrackEvent } from './track';

describe('eventPath', () => {
  it('maps every event to a fixed, low-cardinality path with no answers or ids', () => {
    const cases: [TrackEvent, string][] = [
      [{ name: 'visit_new' }, '/e/visit/new'],
      [{ name: 'visit_return', gap: 1, age: 1 }, '/e/visit/return/gap-1/day1'],
      [{ name: 'visit_return', gap: 3, age: 7 }, '/e/visit/return/gap-2-6/day7'],
      [{ name: 'visit_return', gap: 9, age: 30 }, '/e/visit/return/gap-7plus'],
      [{ name: 'run_start', mode: 'daily' }, '/e/start/daily'],
      [{ name: 'first_touch', mode: 'challenge' }, '/e/first-touch/challenge'],
      [{ name: 'round_lock', mode: 'daily', round: 3, hit: false }, '/e/lock/daily/r3/miss'],
      [{ name: 'round_next', mode: 'practice', round: 5 }, '/e/next/practice/r5'],
      [{ name: 'run_exit', mode: 'daily', round: 2 }, '/e/exit/daily/r2'],
      [{ name: 'run_complete', mode: 'daily', total: 274 }, '/e/complete/daily/200-299'],
      [{ name: 'share', mode: 'daily', method: 'clipboard' }, '/e/share/daily/clipboard'],
      [{ name: 'challenge_open', kind: 'past', withScore: true }, '/e/challenge-open/past/with-score'],
    ];
    for (const [e, path] of cases) expect(eventPath(e)).toBe(path);
  });
  it('bands totals the same way as the results distribution', () => {
    expect([0, 99, 100, 399, 400, 500].map(totalBand)).toEqual(['0-99', '0-99', '100-199', '300-399', '400-500', '400-500']);
  });
});

describe('privacySignal', () => {
  it('honours Global Privacy Control and Do Not Track', () => {
    expect(privacySignal({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: '1' } as unknown as Navigator)).toBe(true);
    expect(privacySignal({ doNotTrack: 'unspecified' } as unknown as Navigator)).toBe(false);
  });
});

describe('trackOnce', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it('counts a start once per browser, across reloads (a fresh module would re-check storage)', () => {
    const sent: string[] = [];
    setTrackSink((e) => sent.push(eventPath(e)));
    const store = memory();
    const e: TrackEvent = { name: 'run_start', mode: 'daily' };
    expect(trackOnce('start:daily:runs:2026-11-17', '2026-11-17', e, store)).toBe(true);
    expect(trackOnce('start:daily:runs:2026-11-17', '2026-11-17', e, store)).toBe(false);
    // Same key from a new page load: the in-memory guard is gone, storage still knows.
    expect(trackOnce('start:daily:runs:2026-11-17', '2026-11-17', e, { getItem: store.getItem, setItem: store.setItem })).toBe(false);
    expect(trackOnce('start:practice:practice:2026-11-15', '2026-11-17', { name: 'run_start', mode: 'practice' }, store)).toBe(true);
    expect(sent).toEqual(['/e/start/daily', '/e/start/practice']);
  });
  it('forgets keys after 14 days so storage stays small', () => {
    setTrackSink(() => {});
    const store = memory();
    trackOnce('a', '2026-11-01', { name: 'visit_new' }, store);
    trackOnce('b', '2026-11-20', { name: 'visit_new' }, store);
    expect(Object.keys(JSON.parse(store.m.get('stat-window:sent')!))).toEqual(['b']);
  });
  it('still sends once per load when storage throws', () => {
    const sent: string[] = [];
    setTrackSink((e) => sent.push(eventPath(e)));
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(trackOnce('c', '2026-11-17', { name: 'visit_new' }, broken)).toBe(true);
    expect(trackOnce('c', '2026-11-17', { name: 'visit_new' }, broken)).toBe(false);
    expect(sent).toEqual(['/e/visit/new']);
  });
});

describe('startAnalytics', () => {
  const fake = () => {
    const calls: unknown[][] = [];
    return {
      calls,
      vercel: {
        inject: ((props: unknown) => void calls.push(['inject', props])) as never,
        pageview: ((p: unknown) => void calls.push(['pageview', p])) as never,
      },
    };
  };
  const nav = {} as Navigator;
  it('sends nothing unless the build turned analytics on', () => {
    const f = fake();
    expect(startAnalytics({ enabled: false, nav, vercel: f.vercel })).toBe(false);
    expect(f.calls).toEqual([]);
  });
  it('sends nothing when the browser asks not to be tracked', () => {
    const f = fake();
    expect(startAnalytics({ enabled: true, nav: { doNotTrack: '1' } as unknown as Navigator, vercel: f.vercel })).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe('startAnalytics wiring (simulated window)', () => {
  it('turns auto-tracking off, sends one real page view, then one virtual page view per event', () => {
    const g = globalThis as { window?: unknown };
    const had = 'window' in g;
    g.window = g.window ?? {};
    try {
      const calls: unknown[][] = [];
      const vercel = {
        inject: ((props: unknown) => void calls.push(['inject', props])) as never,
        pageview: ((p: unknown) => void calls.push(['pageview', p])) as never,
      };
      expect(startAnalytics({ enabled: true, nav: {} as Navigator, vercel })).toBe(true);
      track({ name: 'round_lock', mode: 'daily', round: 1, hit: true });
      const inj = calls[0]![1] as { disableAutoTrack: boolean; beforeSend: (e: { url: string }) => { url: string } };
      expect(inj.disableAutoTrack).toBe(true);
      expect(inj.beforeSend({ url: 'https://stat-window.vercel.app/?day=2026-11-16&vs=274' }).url).toBe('https://stat-window.vercel.app/');
      expect(calls.slice(1)).toEqual([
        ['pageview', { route: '/', path: '/' }],
        ['pageview', { route: '/e/lock/daily/r1/hit', path: '/e/lock/daily/r1/hit' }],
      ]);
    } finally {
      setTrackSink(() => {});
      if (!had) delete g.window;
    }
  });
});

describe('Phase 1 analytics controls', () => {
  const vercelFake = () => {
    const calls: unknown[][] = [];
    return {
      calls,
      vercel: {
        inject: ((props: unknown) => void calls.push(['inject', props])) as never,
        pageview: ((p: unknown) => void calls.push(['pageview', p])) as never,
      },
    };
  };
  const off = { analytics: 'off', scores: 'unset', key: null, sent: [], done: [], asked: false } as const;
  const on = { analytics: 'on', scores: 'unset', key: null, sent: [], done: [], asked: false } as const;

  it('the in-app switch turns analytics off, and an explicit yes overrides GPC/DNT', () => {
    const g = globalThis as { window?: unknown };
    const had = 'window' in g;
    g.window = g.window ?? {};
    try {
      const a = vercelFake();
      expect(startAnalytics({ enabled: true, nav: {} as Navigator, vercel: a.vercel, privacy: { ...off, sent: [], done: [] } })).toBe(false);
      expect(a.calls).toEqual([]);
      const b = vercelFake();
      expect(startAnalytics({ enabled: true, nav: { globalPrivacyControl: true } as unknown as Navigator, vercel: b.vercel, privacy: { ...on, sent: [], done: [] } })).toBe(true);
    } finally {
      setTrackSink(() => {});
      if (!had) delete g.window;
    }
  });

  it('new events stay low-cardinality and carry no score, key or URL', () => {
    expect(eventPath({ name: 'percentile', outcome: 'ready' })).toBe('/e/percentile/ready');
    expect(eventPath({ name: 'privacy', choice: 'deleted' })).toBe('/e/privacy/deleted');
    expect(eventPath({ name: 'share', mode: 'daily', method: 'native-image' })).toBe('/e/share/daily/native-image');
  });

  it('prefixes a launch season or QA cohort, and leaves beta paths unchanged', () => {
    try {
      setCohort('s1');
      expect(eventPath({ name: 'run_start', mode: 'daily' })).toBe('/e/s1/start/daily');
      setCohort('qa');
      expect(eventPath({ name: 'run_start', mode: 'daily' })).toBe('/e/qa/start/daily');
    } finally {
      setCohort('beta');
    }
    expect(eventPath({ name: 'run_start', mode: 'daily' })).toBe('/e/start/daily');
  });
});

describe('analyticsOn', () => {
  it('runs on the production host unless the build switches it off', () => {
    expect(analyticsOn(undefined, 'stat-window.vercel.app')).toBe(true);
    expect(analyticsOn('', 'stat-window.vercel.app')).toBe(true);
    expect(analyticsOn('off', 'stat-window.vercel.app')).toBe(false);
    expect(analyticsOn(' OFF ', 'stat-window.vercel.app')).toBe(false);
  });
  it('stays off on previews, local runs and CI unless the build asks for it', () => {
    expect(analyticsOn(undefined, 'stat-window-git-main-atiyk-a.vercel.app')).toBe(false);
    expect(analyticsOn(undefined, 'localhost')).toBe(false);
    expect(analyticsOn(undefined, undefined)).toBe(false);
    expect(analyticsOn('vercel', 'localhost')).toBe(true);
  });
});

describe('calendar reminder events', () => {
  it('map to fixed paths, with the cohort prefix', () => {
    expect(eventPath({ name: 'remind', method: 'ics' })).toBe('/e/remind/ics');
    expect(eventPath({ name: 'remind', method: 'google' })).toBe('/e/remind/google');
    expect(eventPath({ name: 'remind_open' })).toBe('/e/remind/open');
    try {
      setCohort('qa');
      expect(eventPath({ name: 'remind_open' })).toBe('/e/qa/remind/open');
      expect(eventPath({ name: 'remind', method: 'ics' })).toBe('/e/qa/remind/ics');
    } finally {
      setCohort('beta');
    }
  });

  it('are never sent under GPC, DNT or the in-app off switch', () => {
    const g = globalThis as { window?: unknown };
    const had = 'window' in g;
    g.window = g.window ?? {};
    const unset = { analytics: 'unset', scores: 'unset', key: null, sent: [], done: [], asked: false } as const;
    const cases: [Navigator, typeof unset | { analytics: 'off' } & Omit<typeof unset, 'analytics'>][] = [
      [{ globalPrivacyControl: true } as unknown as Navigator, unset],
      [{ doNotTrack: '1' } as unknown as Navigator, unset],
      [{} as Navigator, { ...unset, analytics: 'off' }],
    ];
    try {
      for (const [nav, privacy] of cases) {
        const calls: unknown[][] = [];
        const vercel = {
          inject: ((props: unknown) => void calls.push(['inject', props])) as never,
          pageview: ((p: unknown) => void calls.push(['pageview', p])) as never,
        };
        expect(startAnalytics({ enabled: true, nav, vercel, privacy: { ...privacy, sent: [], done: [] } })).toBe(false);
        track({ name: 'remind', method: 'ics' });
        track({ name: 'remind', method: 'google' });
        track({ name: 'remind_open' });
        expect(calls).toEqual([]);
      }
    } finally {
      setTrackSink(() => {});
      if (!had) delete g.window;
    }
  });
});

describe('opting out when localStorage writes fail (CR-3)', () => {
  it('stops events at once, though the choice could not be stored', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } });
    try {
      const views: string[] = [];
      const vercel = { inject: (() => {}) as never, pageview: ((o: { path: string }) => void views.push(o.path)) as never };
      expect(startAnalytics({ enabled: true, nav: {} as Navigator, vercel })).toBe(true);
      expect(savePrivacy({ analytics: 'off' }).analytics).toBe('off'); // the Privacy dialog's onChange
      track({ name: 'run_start', mode: 'daily' });
      expect(views).toEqual(['/']);
    } finally {
      setTrackSink(() => {});
      vi.unstubAllGlobals();
    }
  });
});

describe('turning analytics on in the Privacy dialog (CR-5)', () => {
  const setup = () => {
    const m = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } });
    const views: string[] = [];
    let injects = 0;
    const vercel = { inject: (() => void injects++) as never, pageview: ((o: { path: string }) => void views.push(o.path)) as never };
    return { views, vercel, injects: () => injects };
  };

  it('starts analytics at once when it began off under GPC/DNT', () => {
    const t = setup();
    try {
      expect(startAnalytics({ enabled: true, nav: { globalPrivacyControl: true } as unknown as Navigator, vercel: t.vercel })).toBe(false);
      expect(t.injects()).toBe(0);
      savePrivacy({ analytics: 'on' }); // the dialog's onChange
      expect(resumeAnalytics()).toBe(true);
      track({ name: 'run_start', mode: 'daily' });
      expect(t.views).toEqual(['/', '/e/start/daily']);
      // Idempotent: a second tick (or a remount) never injects twice.
      expect(resumeAnalytics()).toBe(true);
      expect(t.injects()).toBe(1);
      // And off again still stops it.
      savePrivacy({ analytics: 'off' });
      track({ name: 'run_complete', mode: 'daily', total: 100 });
      expect(t.views).toEqual(['/', '/e/start/daily']);
    } finally {
      setTrackSink(() => {});
      vi.unstubAllGlobals();
    }
  });

  it('starts after an earlier "off", but never when the build or host has analytics off', () => {
    const t = setup();
    try {
      savePrivacy({ analytics: 'off' });
      expect(startAnalytics({ enabled: false, nav: {} as Navigator, vercel: t.vercel })).toBe(false);
      savePrivacy({ analytics: 'on' });
      expect(resumeAnalytics()).toBe(false);
      expect(t.injects()).toBe(0);
      savePrivacy({ analytics: 'off' });
      expect(startAnalytics({ enabled: true, nav: {} as Navigator, vercel: t.vercel })).toBe(false);
      expect(resumeAnalytics()).toBe(false); // still off: nothing to start
      savePrivacy({ analytics: 'on' });
      expect(resumeAnalytics()).toBe(true);
      expect(t.injects()).toBe(1);
    } finally {
      setTrackSink(() => {});
      vi.unstubAllGlobals();
    }
  });
});

describe('analytics host allow-list (A-1, VITE_ANALYTICS_HOSTS)', () => {
  it('defaults to stat-window.vercel.app', () => {
    expect(analyticsHosts(undefined)).toEqual(['stat-window.vercel.app']);
    expect(analyticsHosts(' , ')).toEqual(['stat-window.vercel.app']);
  });
  it('takes a comma-separated list of exact hostnames, so a new domain needs no code change', () => {
    const hosts = analyticsHosts(' StatWindow.example , stat-window.vercel.app,');
    expect(hosts).toEqual(['statwindow.example', 'stat-window.vercel.app']);
    expect(analyticsOn(undefined, 'statwindow.example', hosts)).toBe(true);
    expect(analyticsOn(undefined, 'STATWINDOW.example', hosts)).toBe(true);
    expect(analyticsOn(undefined, 'stat-window.vercel.app', hosts)).toBe(true);
    expect(analyticsOn('off', 'statwindow.example', hosts)).toBe(false);
    // Exact match only: previews, subdomains and look-alikes stay off.
    expect(analyticsOn(undefined, 'www.statwindow.example', hosts)).toBe(false);
    expect(analyticsOn(undefined, 'stat-window-git-main-atiyk-a.vercel.app', hosts)).toBe(false);
    expect(analyticsOn(undefined, 'localhost', hosts)).toBe(false);
  });
  it('ignores entries that are not plain hostnames', () => {
    expect(analyticsHosts('https://statwindow.example/,*.vercel.app,statwindow.example')).toEqual(['statwindow.example']);
    expect(analyticsHosts('*')).toEqual(['stat-window.vercel.app']);
  });
});
