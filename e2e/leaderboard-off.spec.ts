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

test('privacy lets a historical player retry erasure without first completing a new game',async({page})=>{
  const key='Z'.repeat(22),methods:string[]=[];
  await page.addInitScript(code=>localStorage.setItem('stat-window:leaderboard:v1',
    JSON.stringify({consent:true,key:code,sent:[]})),key);
  await page.route('**/api/leaderboard*',route=>{
    methods.push(route.request().method());
    if(route.request().method()!=='DELETE')throw new Error('Dormant ranking attempted an API request outside erasure.');
    return route.fulfill({status:503,contentType:'application/json',body:'{"status":"disabled"}'});
  });
  await page.goto('/?privacy=1');
  const erase=page.getByRole('button',{name:'Delete any previously submitted rankings'});
  await expect(erase).toBeVisible();
  await erase.click();
  await expect(page.getByText('Removal is not confirmed. Your browser code is saved so you can retry later.')).toBeVisible();
  expect(methods).toEqual(['DELETE']);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').key)).toBe(key);
});

test('privacy can confirm deletion of old rankings without ever showing the public feature',async({page})=>{
  const key='Y'.repeat(22),methods:string[]=[];
  await page.addInitScript(code=>localStorage.setItem('stat-window:leaderboard:v1',
    JSON.stringify({consent:true,key:code,sent:[]})),key);
  await page.route('**/api/leaderboard*',route=>{
    methods.push(route.request().method());
    if(route.request().method()!=='DELETE')throw new Error('Dormant leaderboard attempted enrollment or public read');
    expect(JSON.parse(route.request().postData()??'{}').player).toBe(key);
    return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":1}'});
  });
  await page.goto('/?privacy=1');
  await page.getByRole('button',{name:'Delete any previously submitted rankings'}).click();
  await expect(page.getByText('Your previous rankings were removed according to the server.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Delete any previously submitted rankings'})).toHaveCount(0);
  expect(methods).toEqual(['DELETE']);
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
  expect(saved).toMatchObject({consent:false,key:null});
});

test('privacy deletion button blocks concurrent DELETEs while an old-code request is pending',async({page})=>{
  const code='W'.repeat(22);
  let release:()=>void=()=>undefined,starting:()=>void=()=>undefined;
  const started=new Promise<void>(resolve=>{starting=resolve;});
  const pending=new Promise<void>(resolve=>{release=resolve;});
  let deletes=0;
  await page.addInitScript(value=>localStorage.setItem('stat-window:leaderboard:v1',
    JSON.stringify({consent:true,key:value,sent:[]})),code);
  await page.route('**/api/leaderboard*',async route=>{
    if(route.request().method()!=='DELETE')throw Error('Public ranking request during deferred mode');
    deletes++;
    starting();
    await pending;
    return route.fulfill({status:503,contentType:'application/json',body:'{"status":"disabled"}'});
  });
  await page.goto('/?privacy=1');
  const erase=page.getByRole('button',{name:'Delete any previously submitted rankings'});
  await erase.click();
  await started;
  await expect(erase).toBeDisabled();
  expect(deletes).toBe(1);
  release();
  await expect(page.getByText(/Removal is not confirmed/)).toBeVisible();
  await expect(erase).toBeEnabled();
  expect(deletes).toBe(1);
});
