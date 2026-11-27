import { describe, expect, it } from 'vitest';
import { PLAYER_FORMATS, RETIRED_FORMATS } from './formats';
import { QuestionSchema } from './schema';
import { CORE_INTRO, explainWindow, FORMAT_GUIDE, guideFor, TEACHING_EXAMPLES } from './teaching';
import { scoreWindow } from '../engine/scoring';

describe('format help coverage', () => {
  it('links every player format to its guidance and exactly one verified example', () => {
    expect(Object.keys(FORMAT_GUIDE).sort()).toEqual([...PLAYER_FORMATS].sort());
    for (const f of PLAYER_FORMATS) {
      const g = FORMAT_GUIDE[f];
      expect(g.label.trim().length, f).toBeGreaterThan(2);
      expect(g.tip.trim().length, f).toBeGreaterThan(30);
      expect(g.tip.length, f).toBeLessThanOrEqual(100);
      expect(g.example.question.meta?.format, f).toBe(f);
      expect(g.example.id, f).toBe(g.example.question.id);
    }
    expect(TEACHING_EXAMPLES.map((e) => e.question.meta?.format)).toEqual([...PLAYER_FORMATS]);
  });

  it('labels are distinct, so no two formats read the same', () => {
    const labels = PLAYER_FORMATS.map((f) => FORMAT_GUIDE[f].label);
    expect(new Set(labels).size).toBe(labels.length);
    const tips = PLAYER_FORMATS.map((f) => FORMAT_GUIDE[f].tip);
    expect(new Set(tips).size).toBe(tips.length);
  });

  it('every example (and the first-play walkthrough) is a schema-valid question with a unique teach- id', () => {
    const all = [...TEACHING_EXAMPLES, CORE_INTRO];
    const ids = all.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of all) {
      expect(e.id).toMatch(/^teach-[a-z0-9-]+$/);
      expect(() => QuestionSchema.parse(e.question), e.id).not.toThrow();
      expect(e.why.trim().length, e.id).toBeGreaterThan(20);
    }
  });

  it('only the missing-point example carries a chart, with exactly one hidden bar', () => {
    for (const e of TEACHING_EXAMPLES) {
      const isChart = e.question.meta?.format === 'missing-point';
      expect(!!e.question.chart, e.id).toBe(isChart);
      if (e.question.chart) expect(e.question.chart.points.filter((p) => p.value === null)).toHaveLength(1);
    }
  });

  it('missing or unknown metadata falls back to recall guidance', () => {
    expect(guideFor(undefined).format).toBe('recall');
    expect(guideFor(null).format).toBe('recall');
    expect(guideFor('vibes').format).toBe('recall');
    expect(guideFor('missing-point').label).toBe(FORMAT_GUIDE['missing-point'].label);
  });

  it('retired formats have no lesson of their own: historical questions get the recall guide', () => {
    for (const f of RETIRED_FORMATS) {
      expect(f in FORMAT_GUIDE, f).toBe(false);
      const g = guideFor(f);
      expect(g.format, f).toBe('recall');
      expect(g.tip, f).toBe(FORMAT_GUIDE.recall.tip);
    }
  });

  it('example prompts never print their own answer (no leakage before the lock)', () => {
    for (const e of TEACHING_EXAMPLES) {
      const q = e.question;
      const re = new RegExp(`(^|[^0-9.,–-])${String(q.answer).replace('.', '\\.')}(?![0-9]|[.,][0-9])`);
      expect(re.test(`${q.prompt} ${q.context}`), e.id).toBe(false);
    }
  });
});

describe('explainWindow', () => {
  const q = CORE_INTRO.question; // 0..82 wins, answer 73

  it('explains a scoring hit, and that edges count', () => {
    const w = { lo: 66, hi: 73 };
    const f = explainWindow(q, w, scoreWindow(q, w));
    expect(f.kind).toBe('hit');
    expect(f.headline).toBe(`Inside: +${scoreWindow(q, w).points}.`);
    expect(f.detail).toMatch(/edges count/);
    expect(f.detail).toMatch(/half as wide would earn \d+/);
  });

  it('explains a catch for zero', () => {
    const w = { lo: 0, hi: 81 };
    const f = explainWindow(q, w, scoreWindow(q, w));
    expect(f.kind).toBe('zero');
    expect(f.detail).toMatch(/81 of the ruler’s 82 steps/);
  });

  it('explains a miss and the narrow-window risk', () => {
    const w = { lo: 60, hi: 70 };
    const f = explainWindow(q, w, scoreWindow(q, w));
    expect(f.kind).toBe('miss');
    expect(f.headline).toBe('Outside by 3 wins.');
    expect(f.detail).toMatch(/scores 0 however tight/);
  });

  it('a one-step catch is called the best a window can earn', () => {
    const w = { lo: 73, hi: 74 };
    const f = explainWindow(q, w, scoreWindow(q, w));
    expect(f.detail).toMatch(/earns 100 of 100, the most a window can earn/);
  });
});
