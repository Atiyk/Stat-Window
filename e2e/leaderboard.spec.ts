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
}

test.describe('real leaderboard UI fail-closed and consent states', () => {
  for (const privacyMode of ['gpc','dnt'] as const) {
    test(`browser ${privacyMode.toUpperCase()} signal blocks global ranking Join and sends no score`, async ({ page }) => {
      await page.addInitScript((signal: 'gpc' | 'dnt') => {
        if (signal==='gpc') Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,value:true});
        else Object.defineProperty(navigator,'doNotTrack',{configurable:true,value:'1'});
      },privacyMode);
      let posts=0;
      await page.route('**/api/leaderboard*', route => {
        if(route.request().method()==='POST'){posts++;return route.fulfill({status:503,contentType:'application/json',body:'{"status":"unavailable"}'});}
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          status:'ok',period:'day',entries:[],totalPlayers:0,asOf:'2026-11-17T15:00:00Z',unverified:true,
        })});
      });
      await finishToday(page);
      await expect(page.getByText(/new leaderboard submissions are blocked/)).toBeVisible();
      await expect(page.getByRole('button',{name:'Join global rankings'})).toHaveCount(0);
      expect(posts).toBe(0);
      expect(await page.evaluate(()=>localStorage.getItem('stat-window:leaderboard:v1'))).toBeNull();
    });
  }

  test('GPC enabled after opting in hides personal identifier on GET but still allows erasure', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,value:true});
    });
    const code='a'.repeat(22);
    await page.goto('/');
    await page.evaluate(value => localStorage.setItem('stat-window:leaderboard:v1',
      JSON.stringify({consent:true,key:value,sent:[]})),code);
    let getHeaders=0,deleted=0;
    await page.route('**/api/leaderboard*', route => {
      const request=route.request();
      if(request.method()==='GET'){
        getHeaders++;
        expect(request.headers()['x-stat-window-player']).toBeUndefined();
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          status:'ok',period:'day',entries:[],totalPlayers:0,asOf:'2026-11-17T15:00:00Z',unverified:true,
        })});
      }
      if(request.method()==='DELETE'){
        deleted++;
        const data=JSON.parse(request.postData()??'{}') as {player?:string};
        expect(data.player).toBe(code);
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":1}'});
      }
      throw new Error('privacy-signal browser unexpectedly submitted a leaderboard score');
    });
    await finishToday(page);
    await expect(page.getByRole('button',{name:'Leave and delete my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    await expect(page.getByText('Your linked rankings were removed.')).toBeVisible();
    expect(deleted).toBe(1);
    expect(getHeaders).toBeGreaterThan(0);
  });

  test('disabled service hides unavailable rankings from visitors, leaving the real results and sharing', async ({ page }) => {
    await page.route('**/api/leaderboard*', route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ status: 'disabled' }),
    }));
    // Await an actual 503 fetch, not just the initial zero-component render,
    // so this regression would catch an unavailable section appearing later.
    const denied=page.waitForResponse(r=>r.url().includes('/api/leaderboard?period=day')&&r.status()===503);
    await finishToday(page);
    await denied;
    await expect(page.locator('.leaderboard')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join global rankings' })).toHaveCount(0);
    await expect(page.locator('.results-score')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Challenge a friend' })).toBeVisible();
  });

  test('disabled backend preserves erasure for an existing opted-in ranking', async ({ page }) => {
    const code='a'.repeat(22);
    await page.goto('/');
    await page.evaluate(value=>localStorage.setItem('stat-window:leaderboard:v1',
      JSON.stringify({consent:true,key:value,sent:[]})),code);
    let deletions=0;
    await page.route('**/api/leaderboard*',route=>{
      if(route.request().method()==='DELETE'){
        deletions++;
        expect(JSON.parse(route.request().postData()??'{}').player).toBe(code);
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":1}'});
      }
      return route.fulfill({status:503,contentType:'application/json',body:'{"status":"disabled"}'});
    });
    await finishToday(page);
    await expect(page.getByRole('heading',{name:/Global leaderboard/i})).toBeVisible();
    await expect(page.getByRole('button',{name:'Leave and delete my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    await expect(page.getByText('Your linked rankings were removed.')).toBeVisible();
    expect(deletions).toBe(1);
    const local=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
    expect(local).toMatchObject({consent:false,key:null});
    // After a reload, there is no useless leaderboard section for a newcomer.
    await page.reload();
    await expect(page.locator('.leaderboard')).toHaveCount(0);
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
      await page.getByRole('button',{name:period.charAt(0).toUpperCase()+period.slice(1),exact:true}).click();
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
    await expect(page.getByText(/New submissions are off.*retry deletion/)).toBeVisible();
    const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
    expect(pending).toMatchObject({consent:false});
    expect(pending.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await expect(page.getByRole('button',{name:'Join global rankings'})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button',{name:'Retry deleting my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Retry deleting my rankings'}).click();
    await expect(page.getByText('Your linked rankings were removed.')).toBeVisible();
    expect(deletes).toBe(2);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').consent)).toBe(false);
  });
  test('malformed HTTP 200 deletion result cannot erase retry key or claim success',async({page})=>{
    let deleted=0;
    await page.route('**/api/leaderboard*',route=>{
      if(route.request().method()==='DELETE'){
        deleted++;
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":null}'});
      }
      if(route.request().method()==='POST')
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"stored","score":250}'});
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        status:'ok',period:'day',entries:[],totalPlayers:0,asOf:'2026-11-17T15:00:00Z',unverified:true
      })});
    });
    await finishToday(page);
    await page.getByRole('button',{name:'Join global rankings'}).click();
    await expect(page.getByRole('button',{name:'Leave and delete my rankings'})).toBeVisible();
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    expect(deleted).toBe(1);
    await expect(page.getByRole('button',{name:'Retry deleting my rankings'})).toBeVisible();
    await expect(page.getByText('Your linked rankings were removed.')).toHaveCount(0);
    const local=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
    expect(local.consent).toBe(false);
    expect(local.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('withdrawing while POST is in flight waits before deleting and never re-enrolls',async({page})=>{
    const observed:string[]=[];
    let releasePost:()=>void=()=>undefined;
    let acknowledgeStart:()=>void=()=>undefined;
    const started=new Promise<void>(resolve=>{acknowledgeStart=resolve;});
    const held=new Promise<void>(resolve=>{releasePost=resolve;});
    await page.route('**/api/leaderboard*',async route=>{
      const method=route.request().method();
      if(method==='POST'){
        observed.push('POST sent');
        acknowledgeStart();
        await held;
        observed.push('POST responded');
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"stored","score":100}'});
      }
      if(method==='DELETE'){
        observed.push('DELETE');
        return route.fulfill({status:200,contentType:'application/json',body:'{"status":"ok","removed":1}'});
      }
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        status:'ok',period:'day',entries:[],totalPlayers:0,asOf:'2026-11-17T15:00:00Z',unverified:true
      })});
    });
    await finishToday(page);
    await page.getByRole('button',{name:'Join global rankings'}).click();
    await started;
    await page.getByRole('button',{name:'Leave and delete my rankings'}).click();
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}').consent)).toBe(false);
    expect(observed).toEqual(['POST sent']);
    releasePost();
    await expect(page.getByText('Your linked rankings were removed.')).toBeVisible();
    expect(observed).toEqual(['POST sent','POST responded','DELETE']);
    await expect(page.getByText('Your score is on the board.')).toHaveCount(0);
    const local=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
    expect(local).toMatchObject({consent:false,key:null});
  });


  for(const code of [429,503] as const) {
    test(`a failed ${code} enrollment can explicitly retry with the same browser code, including after reload`,async({page})=>{
      let submits=0;
      const players:string[]=[];
      await page.route('**/api/leaderboard*',route=>{
        const req=route.request();
        if(req.method()==='POST'){
          submits++;
          const body=JSON.parse(req.postData()??'{}') as {player:string;rounds:unknown[];consent:string};
          players.push(body.player);
          expect(body.player).toMatch(/^[A-Za-z0-9_-]{22}$/);
          expect(body.rounds).toHaveLength(5);
          expect(body.consent).toBe('granted');
          if(submits===1)return route.fulfill({status:code,contentType:'application/json',
            body:JSON.stringify({status:code===429?'limited':'unavailable'})});
          return route.fulfill({status:200,contentType:'application/json',body:'{"status":"stored","score":200}'});
        }
        if(req.method()==='DELETE')throw new Error('A retry must not delete the player identity.');
        const saved=submits>=2;
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
          status:'ok',period:'day',
          entries:saved?[{rank:1,name:'SteadyPlayer-1234',score:200}]:[],
          totalPlayers:saved?1:0,asOf:'2026-11-17T15:00:00Z',unverified:true,
          ...(saved?{mine:{name:'SteadyPlayer-1234',rank:1,score:200,days:1}}:{}),
        })});
      });
      await finishToday(page);
      await page.getByRole('button',{name:'Join global rankings'}).click();
      await expect(page.getByText('Could not submit your score. Retry your submission below.')).toBeVisible();
      await expect(page.getByRole('button',{name:'Retry submitting today’s score'})).toBeVisible();
      expect(submits).toBe(1);
      const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('stat-window:leaderboard:v1')??'{}'));
      expect(first).toMatchObject({consent:true});
      expect(first.key).toBe(players[0]);
      // The retry path must survive reload rather than strand a consented identity.
      await page.reload();
      await expect(page.getByRole('button',{name:'Retry submitting today’s score'})).toBeVisible();
      await page.getByRole('button',{name:'Retry submitting today’s score'}).click();
      await expect(page.getByText('Your score is on the board.')).toBeVisible();
      expect(submits).toBe(2);
      expect(players).toEqual([first.key,first.key]);
      await expect(page.getByRole('button',{name:'Retry submitting today’s score'})).toHaveCount(0);
    });
  }


});
