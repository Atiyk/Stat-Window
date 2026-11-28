import { describe, expect, it } from 'vitest';
import { parseGrowthCounts, growthReport } from './growth-report.mjs';
const day={from:'2026-11-28',to:'2026-11-28',period:'daily'};
describe('growth report',()=>{
 it('isolates official counts and labels aggregate rates',()=>{const text=growthReport(parseGrowthCounts('/,80\n/e/s1/start/daily,40\n/e/s1/complete/daily/200-299,30\n/e/qa/start/daily,999'),day);expect(text).toContain('Daily starts: 40 | finishes: 30 | aggregate finish ratio: 75%');expect(text).not.toContain('999');});
 it('rejects malformed and duplicate input',()=>{for(const bad of ['/e/s1/start/daily,-1','/e/s1/start/daily,2\n/e/s1/start/daily,3','/e/s1/start/daily,NaN'])expect(()=>parseGrowthCounts(bad)).toThrow();});
 it('does not infer rates from sparse, small, or inconsistent counts',()=>{expect(growthReport(parseGrowthCounts('/e/s1/start/daily,1'),day)).toContain('aggregate finish ratio: unavailable');expect(growthReport(parseGrowthCounts('/e/s1/start/daily,1\n/e/s1/complete/daily/200-299,1'),day)).toContain('insufficient denominator');expect(growthReport(parseGrowthCounts('/e/s1/start/daily,30\n/e/s1/complete/daily/200-299,31'),day)).toContain('finishes exceed starts');});
 it('rejects impossible calendar dates and invalid periods',()=>{const rows=parseGrowthCounts('/,1');expect(()=>growthReport(rows,{...day,from:'2026-02-30'})).toThrow();expect(()=>growthReport(rows,{...day,to:'2026-11-29'})).toThrow();});
});
