import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, NBA_FIRST, next, openAt } from './helpers';

/** Browser UI tests stub only the API. The real EVAL scripts use Redis in server/leaderboard-redis.test.ts. */
async function finishToday(page: Page) {
  await page.route('**/api/scores**', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ status: 'disabled' }),
  }));
  await openAt(page, NBA_FIRST);
  for (let i = 0; i < 5; i++) {
    await lockAndSettle(page);
    await next(page);
  }
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Global leaderboard/i })).toBeVisible();
}

test.describe('real leaderboard UI fail-closed and consent states', () => {
  test('disabled service shows honest state and does not offer fake Join', async ({ page }) => {
    await page.route('**/api/leaderboard*', route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ status: 'disabled' }),
    }));
    await finishToday(page);
    await expect(page.getByText('Global rankings are not enabled yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join global rankings' })).toHaveCount(0);
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeVisible();
  });

  test('opt-in sends only consented official windows, shows personal rank and all four periods', async ({ page }) => {
    let savedPlayer: string | null = null;
    let submits = 0;
    const queried: string[] = [];
    await page.route('**/api/leaderboard*', async route => {
      const req=route.request();
      const url=new URL(req.url());
      if(req.method()==='POST') {
        const body=JSON.parse(req.postData()??'{}') as Record<string,unknown>;
        expect(body.consent).toBe('granted');
        expect(body.test).toBeUndefined();
        expect(Array.isArray(body.rounds)?body.rounds.length:0).toBe(5);
        expect(body.day).toBe(NBA_FIRST.toISOString().slice(0,10));
        expect(typeof body.player).toBe('string');
        expect(String(body.player)).toMatch(/^[A-Za-z0-9_-]{22}$/);
        savedPlayer=String(body.player);submits++;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'stored',day:body.day,score:200})});
      }
      if(req.method()!=='GET')throw new Error('unexpected request');
      const period=url.searchParams.get('period')??'day';
      queried.push(period);
      // A fresh visitor cannot see personal standings before explicitly joining.
      const code=req.headers()['x-stat-window-player'];
      expect(code).toBe(savedPlayer??undefined);
      const score=period==='day'?200:period==='week'?320:period==='month'?810:1200;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        status:'ok',period,entries:savedPlayer?[{rank:2,name:'SwiftHooper-1234',score}]:[],
        totalPlayers:savedPlayer?3:0,asOf: '2026-11-17T15:00:00Z',unverified:true,
        ...(savedPlayer?{mine:{rank:2,score,days:period==='day'?1:4,name:'SwiftHooper-1234'}}:{}),
      })});
    });
    await finishToday(page);
    await expect(page.getByText('No opt-in scores yet for this day. Be the first.')).toBeVisible();
    await page.getByRole('button',{name:'Join global rankings'}).click();
    await expect(page.getByText('Your score is on the board.')).toBeVisible();
    await expect(page.getByText(/Your rank: #2/)).toBeVisible();
    expect(submits).toBe(1);
    for(const period of ['week','month','season'] as const){
      await page.getByRole('button',{name:period[0].toUpperCase()+period.slice(1),exact:true}).click();
      await expect.poll(()=>queried.includes(period)).toBe(true);
      await expect(page.getByText(/Your rank: #2/)).toBeVisible();
    }
    expect(queried).toEqual(expect.arrayContaining(['day','week','month','season']));
    expect(await page.evaluate(()=>localStorage.getItem('stat-window:leaderboard:v1'))).toContain('"consent":true');
  });

  test('limited deletion never claims success; retry leaves and clears consent', async ({ page }) => {
    let joined=false;let deletes=0;
    await page.route('**/api/leaderboard*', async route => {
      const req=route.request();
      if(req.method()==='POST'){
        joined=true;
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"stored","score":250}'});
      }
      if(req.method()==='DELETE'){
        deletes++;
        if(deletes===1)return route.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'120'},body:'{"status":"limited"}'});
        joined=false;
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":1}'});
      }
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        status:'ok',period:new URL(req.url()).searchParams.get('period')??'day',
        entries:joined?[{rank:1,name:'QuietHooper-1234',score:250}]:[],totalPlayers:joined?1:0,
        asOf:'2026-11-17T15:00:00Z',unverified:true,
      })});
    });
    await finishToday(page);
    await page.getByRole('button',{name:'Join global rankings'}).click();
    await expect(page.getByRole('button',{name:'Leave and delete my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    await expect(page.getByText(/Deletion failed. Please retry/)).toBeVisible();
    await expect(page.getByRole('button',{name:'Leave and delete my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    await expect(page.getByText('Your linked rankings were removed.')).toBeVisible();
    expect(deletes).toBe(2);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').consent)).toBe(false);
  });
});
