import { describe, expect, it } from 'vitest';
import { referralChannel, initReferralSession, readReferralSession, clearReferralSession } from './referral';
import { eventPath, setCohort } from './track';

describe('referral attribution', () => {
  it('recognizes only allowlisted tags and hostnames, with tags taking precedence', () => {
    expect(referralChannel('?utm_source=Twitter&utm_campaign=secret', 'https://reddit.com/r/nba/')).toBe('x');
    expect(referralChannel('', 'https://www.reddit.com/r/nba/?private=value')).toBe('reddit');
    expect(referralChannel('?utm_source=embed', '')).toBe('embed');
    expect(referralChannel('?utm_source=how-to-play', '')).toBe('guide');
    expect(referralChannel('?utm_source=playlin', '')).toBe('playlin');
  });
  it.each([
    ['x', 'x'], ['threads', 'threads'], ['reddit', 'reddit'], ['email', 'email'],
    ['newsletter', 'email'], ['listdle', 'directory'], ['alldle', 'alldle'],
    ['creator', 'creator'], ['embed', 'embed'], ['google', 'search'], ['bing', 'search'],
    ['whatsapp', 'groupchat'], ['tiktok', 'video'], ['producthunt', 'launch'],
  ])('maps %s to the fixed channel %s', (tag, channel) => {
    expect(referralChannel('?utm_source=' + tag, '')).toBe(channel);
  });
  it('does not use arbitrary values, object prototype names, internal or spoofed hosts', () => {
    for (const x of ['user@example.com','__proto__','constructor','toString','%3Cscript%3E']) expect(referralChannel('?utm_source='+x, '')).toBeNull();
    expect(referralChannel('', 'https://reddit.com.evil.test/')).toBeNull();
    expect(referralChannel('', 'https://www.statwindow.app/how-to-play.html')).toBeNull();
    expect(referralChannel('', 'javascript:alert(1)')).toBeNull();
    expect(referralChannel('?utm_source=unknown', 'https://www.reddit.com/r/nba/')).toBeNull();
  });
  it('retains QA and season isolation for fixed event paths', () => {
    try {
      setCohort('qa');
      expect(eventPath({name:'referral',channel:'x',step:'landing',cohort:'s1'})).toBe('/e/qa/referral/x/landing');
      setCohort('s1');
      expect(eventPath({name:'referral',channel:'playlin',step:'complete'})).toBe('/e/s1/referral/playlin/complete');
    } finally { setCohort('beta'); }
  });
});

describe('tab-scoped referral continuity', () => {
  const origin='https://www.statwindow.app';
  const day = '2026-11-28';
  const tomorrow = '2026-11-29';
  const makeStore=()=>{
    const data=new Map<string,string>();
    return { data, getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);} };
  };
  it('restores only a fixed channel on reload without another landing event',()=>{
    const store=makeStore();
    expect(initReferralSession('s1','?utm_source=reddit&utm_campaign=private','',origin,store,day)).toEqual({channel:'reddit',landing:true});
    expect([...store.data.values()]).toEqual([day + ':reddit']);
    expect(initReferralSession('s1','',origin+'/how-to-play.html',origin,store,day)).toEqual({channel:'reddit',landing:false});
    expect(readReferralSession('s1', day, store)).toBe('reddit');
    expect(readReferralSession('qa', day, store)).toBeNull();
    clearReferralSession(store);
    expect(store.data.size).toBe(0);
    expect(readReferralSession('s1', day, store)).toBeNull();
  });
  it('clears stale attribution for an unknown external arrival, unknown explicit tag or new cohort',()=>{
    const store=makeStore();
    const seed=()=>initReferralSession('s1','?utm_source=reddit','',origin,store,day);
    seed();expect(initReferralSession('s1','','https://unknown.example',origin,store,day).channel).toBeNull();
    seed();expect(initReferralSession('s1','?utm_source=private','',origin,store,day).channel).toBeNull();
    seed();expect(initReferralSession('qa','','',origin,store,day).channel).toBeNull();
    expect(store.data.size).toBe(0);
    clearReferralSession(store);
  });
  it('does not count a tagged reload or history restore as a new landing', () => {
    const store = makeStore();
    const tag = '?utm_source=reddit';
    expect(initReferralSession('s1', tag, '', origin, store, day)).toEqual({ channel: 'reddit', landing: true });
    expect(initReferralSession('s1', tag, '', origin, store, day, true)).toEqual({ channel: 'reddit', landing: false });
    expect(initReferralSession('s1', tag, '', origin, store, tomorrow, true)).toEqual({ channel: null, landing: false });
    expect(store.data.size).toBe(0);
    expect(initReferralSession('s1', tag, '', origin, store, tomorrow)).toEqual({ channel: 'reddit', landing: true });
  });

  it('clears an open tab at the next Eastern day and rejects old or undated stored values', () => {
    const store = makeStore();
    const tag = '?utm_source=x';
    initReferralSession('s1', tag, '', origin, store, day);
    expect(readReferralSession('s1', tomorrow, store)).toBeNull();
    expect(store.data.size).toBe(0);

    for (const expired of ['x', day + ':x']) {
      store.setItem('stat-window:referral:s1', expired);
      expect(initReferralSession('s1', '', '', origin, store, tomorrow)).toEqual({ channel: null, landing: false });
      expect(store.data.size).toBe(0);
    }
  });
  it('rejects tampered storage and works without writable storage',()=>{
    const store=makeStore();
    store.setItem('stat-window:referral:s1', day + ':private-user-id');
    expect(initReferralSession('s1','','',origin,store,day).channel).toBeNull();
    expect(initReferralSession('s1','?utm_source=x','',origin,null,day)).toEqual({channel:'x',landing:true});
    expect(initReferralSession('s1','','',origin,null,day).channel).toBeNull();
    clearReferralSession(store);
  });
});
