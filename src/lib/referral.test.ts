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
  it('does not use arbitrary values, object prototype names, internal or spoofed hosts', () => {
    for (const x of ['user@example.com','__proto__','constructor','toString','%3Cscript%3E']) expect(referralChannel('?utm_source='+x, '')).toBeNull();
    expect(referralChannel('', 'https://reddit.com.evil.test/')).toBeNull();
    expect(referralChannel('', 'https://www.statwindow.app/how-to-play.html')).toBeNull();
    expect(referralChannel('', 'javascript:alert(1)')).toBeNull();
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
  const makeStore=()=>{
    const data=new Map<string,string>();
    return { data, getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);} };
  };
  it('restores only a fixed channel on reload without another landing event',()=>{
    const store=makeStore();
    expect(initReferralSession('s1','?utm_source=reddit&utm_campaign=private','',origin,store)).toEqual({channel:'reddit',landing:true});
    expect([...store.data.values()]).toEqual(['reddit']);
    expect(initReferralSession('s1','',origin+'/how-to-play.html',origin,store)).toEqual({channel:'reddit',landing:false});
    expect(readReferralSession('s1')).toBe('reddit');
    expect(readReferralSession('qa')).toBeNull();
    clearReferralSession(store);
    expect(store.data.size).toBe(0);
    expect(readReferralSession('s1')).toBeNull();
  });
  it('clears stale attribution for an unknown external arrival, unknown explicit tag or new cohort',()=>{
    const store=makeStore();
    const seed=()=>initReferralSession('s1','?utm_source=reddit','',origin,store);
    seed();expect(initReferralSession('s1','','https://unknown.example',origin,store).channel).toBeNull();
    seed();expect(initReferralSession('s1','?utm_source=private','',origin,store).channel).toBeNull();
    seed();expect(initReferralSession('qa','','',origin,store).channel).toBeNull();
    expect(store.data.size).toBe(0);
    clearReferralSession(store);
  });
  it('rejects tampered storage and works without writable storage',()=>{
    const store=makeStore();
    store.setItem('stat-window:referral:s1','private-user-id');
    expect(initReferralSession('s1','','',origin,store).channel).toBeNull();
    expect(initReferralSession('s1','?utm_source=x','',origin,null)).toEqual({channel:'x',landing:true});
    expect(initReferralSession('s1','','',origin,null).channel).toBeNull();
    clearReferralSession(store);
  });
});
