import { describe, expect, it } from 'vitest';
import { periodKey, boards, expiryFor, pseudonym, handleLeaderboard, leaderboardContext } from './leaderboard.ts';
describe('Eastern calendar leaderboard periods',()=>{
 it('weeks start Monday including Sunday before and after DST',()=>{expect(periodKey('week','2026-03-08',null)).toBe('2026-03-02');expect(periodKey('week','2026-03-09',null)).toBe('2026-03-09');expect(periodKey('week','2026-11-01',null)).toBe('2026-10-26');});
 it('months and seasons use calendar keys',()=>{expect(periodKey('month','2026-12-31',null)).toBe('2026-12');expect(periodKey('month','2027-01-01',null)).toBe('2027-01');expect(boards('test','2026-11-22',null)).toHaveLength(4);});
 it('fixed seasons rotate and retention has bounded expiry',()=>{
   expect(periodKey('season','2026-01-01',null)).toBe('block-0');
   expect(periodKey('season','2026-04-30',null)).toBe('block-0');
   expect(periodKey('season','2026-05-01',null)).toBe('block-1');
   expect(expiryFor('season','2026-01-01')).toBe(expiryFor('season','2026-04-30'));
   expect(expiryFor('day','2026-03-08')).toBe(Date.parse('2026-04-08T00:00:00Z')/1000);
   expect(expiryFor('week','2026-11-01')).toBe(Date.parse('2026-12-02T00:00:00Z')/1000);
 });
 it('pseudonyms are stable and do not expose raw member',()=>{const id='a'.repeat(40);expect(pseudonym(id)).toBe(pseudonym(id));expect(pseudonym(id)).not.toContain(id);});
 it('defaults to disabled without explicit budgets',()=>{const c=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',SCORE_HASH_SECRET:'a'.repeat(32)},null,async()=>null);expect(c.enabled).toBe(false);});
 it('rejects unconsented POST even if a store is present',async()=>{const c=leaderboardContext({VERCEL:'1',VERCEL_ENV:'production',SCORES_ENABLED:'1',LEADERBOARDS_ENABLED:'1',LEADERBOARDS_DAILY_BUDGET:'1000',LEADERBOARDS_MONTHLY_BUDGET:'20000',LEADERBOARDS_ERASE_BUDGET:'2000',SCORE_HASH_SECRET:'a'.repeat(32)},{} as never,async()=>null);const r=await handleLeaderboard(new Request('https://stat-window.vercel.app/api/leaderboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player:'a'.repeat(22)})}),c);expect(r.status).toBe(409);});
 it('does not leak leaderboard data when disabled',async()=>{const c=leaderboardContext({},null,async()=>null);const r=await handleLeaderboard(new Request('https://example.com/api/leaderboard?period=day'),c);expect(r.status).toBe(503);});
});
