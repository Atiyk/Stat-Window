import { expect, test, type Page } from '@playwright/test';
import { lockAndSettle, NBA_FIRST, next, openAt } from './helpers';

test.skip(!!process.env.LEADERBOARD_E2E, 'shipping-off guarantees run against the default release build');

async function finishToday(page:Page){
  await page.route('**/api/scores**',r=>r.fulfill({
    status:503,contentType:'application/json',body:'{"status":"disabled"}'
  }));
  await openAt(page,NBA_FIRST);
  for(let i=0;i<5;i++){await lockAndSettle(page);await next(page);}
  await expect(page.locator('.results-score')).toBeVisible();
}

test('V3 release never requests or shows global rankings for a fresh browser, even if backend responds OK',async({page})=>{
  const seen:string[]=[];
  await page.route('**/api/leaderboard*',route=>{
    seen.push(route.request().method());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      status:'ok',period:'day',entries:[{name:'TestUser',rank:1,score:500}],
      totalPlayers:1,asOf:NBA_FIRST.toISOString()
    })});
  });
  await finishToday(page);
  await expect(page.locator('.leaderboard')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Join global rankings'})).toHaveCount(0);
  await expect(page.locator('.results-score')).toBeVisible();
  await expect(page.getByRole('button',{name:'Challenge a friend'})).toBeVisible();
  expect(seen).toEqual([]); // No GET, POST or DELETE in a fresh, disabled browser.
});

test('old participant code exposes only a deletion retry; no GET or enrollment',async({page})=>{
  const key='X'.repeat(22);
  await page.goto('/');
  await page.evaluate(k=>localStorage.setItem('stat-window:leaderboard:v1',JSON.stringify({
    consent:true,key:k,sent:['2026-11-17']
  })),key);
  let deletions=0;
  const requests:string[]=[];
  await page.route('**/api/leaderboard*',route=>{
    const req=route.request();
    requests.push(req.method());
    if(req.method()!=='DELETE')throw new Error('disabled build attempted a leaderboard '+req.method());
    deletions++;
    const submitted=JSON.parse(req.postData()??'{}') as {player:string};
    expect(submitted.player).toBe(key);
    return route.fulfill({status:deletions===1?503:200,contentType:'application/json',
      body:deletions===1?'{"status":"disabled"}':'{"status":"ok","removed":1}'});
  });
  await finishToday(page);
  await expect(page.getByRole('heading',{name:'Previous leaderboard data'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Join global rankings'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Delete any previous rankings'})).toBeVisible();
  await page.getByRole('button',{name:'Delete any previous rankings'}).click();
  await expect(page.getByText(/Deletion could not be confirmed/)).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').key)).toBe(key);
  await page.getByRole('button',{name:'Delete any previous rankings'}).click();
  await expect(page.getByText('Your linked leaderboard data was removed or no longer exists.')).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').key)).toBeNull();
  expect(requests).toEqual(['DELETE','DELETE']);
});
