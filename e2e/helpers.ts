import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { puzzleStartUtcMs } from '../src/engine/daily';

/** Day 1 at 15:00 UTC. Every test pins the clock so the slate is deterministic. */
export const DAY1 = new Date('2026-11-15T15:00:00Z');
export const DAY2 = new Date('2026-11-16T15:00:00Z');
/** First, middle and last days of the NBA calendar, read from data/nba/calendar.json so a reschedule needs no test edits. */
const calendar = JSON.parse(readFileSync(new URL('../data/nba/calendar.json', import.meta.url), 'utf8')) as { cutover: string; days: { date: string }[] };
export const NBA_DAYS = calendar.days.map((d) => d.date);
export const NBA_CUTOVER = calendar.cutover;
const at3pm = (day: string) => new Date(`${day}T15:00:00Z`);
export const NBA_FIRST = at3pm(NBA_DAYS[0]!);
export const NBA_MIDDLE = at3pm(NBA_DAYS[24]!);
export const NBA_LAST = at3pm(NBA_DAYS.at(-1)!);
/** Ten minutes after midnight Eastern on a given day. */
export const justAfterMidnight = (day: string) => new Date(puzzleStartUtcMs(day) + 10 * 60_000);

export async function openAt(page: Page, when: Date, path = '/') {
  await page.clock.setFixedTime(when);
  await page.goto(path);
  const skip = page.getByRole('button', { name: 'Skip tutorial and start' });
  const start = page.getByRole('button', { name: "Start today's five" });
  if (await skip.isVisible()) await skip.click();
  else if (await start.isVisible()) await start.click();
  await expect(page.locator('.question')).toBeVisible();
}

export const lowBracket = (page: Page) => page.getByRole('slider', { name: 'Low end of your window' });
export const highBracket = (page: Page) => page.getByRole('slider', { name: 'High end of your window' });

/** Sets an exact window by typing into the two big numbers. */
export async function typeWindow(page: Page, lo: number, hi: number) {
  // Set high first when moving up so the low end never collides with it.
  await page.getByRole('button', { name: /^High end/ }).click();
  await page.getByRole('textbox', { name: /^High end/ }).fill(String(hi));
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /^Low end/ }).click();
  await page.getByRole('textbox', { name: /^Low end/ }).fill(String(lo));
  await page.keyboard.press('Enter');
}

/** Locks the current window; if it is still the untouched full scale, nudges the low bracket in first. */
export async function lockAndSettle(page: Page) {
  if (await page.getByRole('button', { name: 'Pull the brackets in first' }).isVisible()) {
    await lowBracket(page).focus();
    await page.keyboard.press('ArrowRight');
  }
  await page.getByRole('button', { name: 'Lock the window' }).click();
  await expect(page.locator('.story')).toBeVisible({ timeout: 5000 });
}

export async function next(page: Page) {
  await page.getByRole('button', { name: /Next question|See your day/ }).click();
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}
