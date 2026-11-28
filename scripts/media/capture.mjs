// Review-only captures of the canonical, untimed teaching inventory.
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const port=Number(process.env.MEDIA_PORT || 4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid local preview port');
const origin='http://127.0.0.1:'+port;
const reviewRoot=fileURLToPath(new URL('../../build/media-review/',import.meta.url));
await mkdir(reviewRoot,{recursive:true});
const out=await mkdtemp(join(reviewRoot,'capture-'));
const examples=[
  {key:'intro',id:'teach-intro-warriors-73',prompt:'How many regular-season games did the 2015–16 Golden State Warriors win?',lo:70,hi:75},
  {key:'recall',id:'teach-recall-kobe-12-threes',prompt:'On January 7, 2003, Kobe Bryant set the NBA record for threes in a game. How many did he make?',lo:11,hi:14},
  {key:'reference',id:'teach-reference-dirk-wilt-free-throws',prompt:'Wilt Chamberlain made 28 free throws in his 100-point game. In the 2011 West finals, how many did Dirk Nowitzki make without a miss?',lo:22,hi:26},
  {key:'missing-point',id:'teach-missing-best-records',prompt:'Each bar is a team with the NBA’s best regular-season record. How many games did the 2023–24 Celtics win?',lo:62,hi:66},
];
const layouts=[
  {name:'portrait',viewport:{width:390,height:844},width:1080,height:1920,states:['question','adjusted','reveal']},
  {name:'landscape',viewport:{width:1200,height:800},width:1200,height:630,states:['adjusted']},
  {name:'square',viewport:{width:768,height:920},width:1080,height:1080,states:['reveal']},
];
const records=[];
const stamp=new Date().toISOString();
let browser;
const wantVideos=process.env.MEDIA_VIDEO==='1';
const run=promisify(execFile);
// Omit overlaid guide navigation and date-specific entry buttons in the media crops.
const captureStyle=`
  .guide-head, .topbar .day-label, .onboarding-skip,
  .onboarding-play[data-phase="resolved"] .onboarding-actions { visibility: hidden; }
`;

async function fresh(viewport,video=false){
  const context=await browser.newContext({viewport,deviceScaleFactor:video?1:2,reducedMotion:video?'no-preference':'reduce'});
  try{
    await context.route('**/*',route=>{
      const req=route.request();const u=new URL(req.url());
      if(u.origin!==origin||!['GET','HEAD'].includes(req.method())||/^\/(api|_vercel)(\/|$)/.test(u.pathname))return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(12000);
    // A fixed prelaunch clock and a fresh isolated browser. Never click Play or Skip.
    await page.clock.setFixedTime(new Date('2026-11-27T15:00:00Z'));
    await page.goto(origin+'/?qa=1');
    await page.locator('.home').getByRole('heading',{name:'How well do you know ball?',exact:true}).waitFor();
    return {context,page};
  }catch(error){await context.close();throw error;}
}
async function guard(page,example,phase){
  if(new URL(page.url()).origin!==origin)throw new Error('Unexpected origin');
  const practice=page.locator('.teaching-play:visible');
  await practice.waitFor({state:'visible'});
  if(await practice.count()!==1||await practice.getAttribute('data-example')!==example.id)throw new Error('Unexpected teaching example; capture refused');
  await practice.getByRole('heading',{name:example.prompt,exact:true}).waitFor();
  await page.locator('.teaching-play[data-phase="'+phase+'"]:visible').waitFor();
  if(await page.locator('.shot-clock:visible').count()){
    const clock=await page.locator('.shot-clock:visible').allTextContents();
    if(clock.some(value=>value.trim()!=='No timer'))throw new Error('Timed game detected');
  }
  if(await page.locator('.question:visible').count())throw new Error('Official question visible; capture refused');
  return practice;
}
async function openExample(page,example){
  if(example.key==='intro'){
    await page.getByRole('button',{name:'Try a practice question first',exact:true}).click();
  }else{
    await page.locator('.home').getByRole('button',{name:/How to play/}).click();
    await page.locator('dialog[open] [data-guide-open="'+example.key+'"]').click();
  }
  await page.evaluate(()=>document.fonts.ready);
  return guard(page,example,'ready');
}
async function typeBound(practice,which,value){
  const label=which==='lo'?'Low end':'High end';
  await practice.getByRole('button',{name:new RegExp('^'+label+':')}).click();
  const input=practice.getByRole('textbox',{name:new RegExp('^'+label)});
  await input.fill(String(value));
  await input.press('Enter');
}
async function adjust(page,example){
  const practice=await guard(page,example,'ready');
  // Exercise the real slider first, then type a reproducible window via the real readout.
  await practice.getByRole('slider',{name:'Low end of your window'}).press('ArrowRight');
  await typeBound(practice,'hi',example.hi);
  await typeBound(practice,'lo',example.lo);
  await page.evaluate(()=>document.activeElement?.blur());
  await practice.getByRole('button',{name:'Lock the window',exact:true}).waitFor();
  return guard(page,example,'ready');
}
async function dragIntro(page,example,miss){
  const practice=await guard(page,example,'ready');
  const low=practice.getByRole('slider',{name:'Low end of your window'});
  const high=practice.getByRole('slider',{name:'High end of your window'});
  const track=await practice.locator('.ruler-track').boundingBox();
  const min=Number(await low.getAttribute('aria-valuemin'));
  const max=Number(await high.getAttribute('aria-valuemax'));
  for(const [slider,target] of [[high,miss?example.lo-1:example.hi],[low,miss?example.lo-3:example.lo]]){
    const grip=await slider.locator('.bracket-grip').boundingBox();
    if(!grip||!track||max<=min)throw new Error('Cannot locate the real practice brackets');
    const x=grip.x+grip.width/2;
    const y=grip.y+grip.height/2;
    const delta=(target-Number(await slider.getAttribute('aria-valuenow')))*track.width/(max-min);
    await page.mouse.move(x,y);
    await page.mouse.down();
    for(let step=1;step<=20;step++){
      await page.mouse.move(x+delta*step/20,y);
      await pause(23);
    }
    await page.mouse.up();
    if(Number(await slider.getAttribute('aria-valuenow'))!==target)throw new Error('Practice bracket did not land on its target');
    await pause(480);
  }
}
async function reveal(page,example){
  const practice=await guard(page,example,'ready');
  await practice.getByRole('button',{name:'Lock the window',exact:true}).click();
  await practice.locator('.teaching-story').waitFor();
  return guard(page,example,'resolved');
}
async function image(page,example,layout,state){
  const phase=state==='reveal'?'resolved':'ready';
  const practice=await guard(page,example,phase);
  // Capture actual UI, then fit uniformly onto a canvas of the requested social size.
  // No stretching, fabricated game UI or answer overlays.
  const raw=await practice.screenshot({animations:'disabled',style:captureStyle,timeout:10000});
  const png=await page.evaluate(async ({raw,width,height})=>{
    const img=new Image();img.src='data:image/png;base64,'+raw;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('No canvas');
    ctx.fillStyle='#F7F4EE';ctx.fillRect(0,0,width,height);
    const pad=Math.round(Math.min(width,height)*.035);
    const scale=Math.min((width-2*pad)/img.width,(height-2*pad)/img.height);
    const w=img.width*scale,h=img.height*scale;
    ctx.drawImage(img,(width-w)/2,(height-h)/2,w,h);
    return canvas.toDataURL('image/png').split(',')[1];
  },{raw:raw.toString('base64'),width:layout.width,height:layout.height});
  const id=example.key+'-'+layout.name+'-'+state;
  const file=id+'.png';const path=join(out,file);
  await writeFile(path,Buffer.from(png,'base64'));
  const bytes=await readFile(path);
  if(bytes.readUInt32BE(16)!==layout.width||bytes.readUInt32BE(20)!==layout.height)throw new Error('Incorrect image dimensions');
  records.push({id,file,kind:'screenshot',width:layout.width,height:layout.height,bytes:bytes.length,capturedAt:stamp,source:example.id,description:'Untimed '+example.key+' teaching example — '+state,alt:example.prompt+' ('+state+', teaching example)',demonstration:true,reviewStatus:'pending',spoilerSafe:false,platforms:layout.name==='portrait'?['Instagram','TikTok','YouTube Shorts','X','Threads']:layout.name==='square'?['Instagram','Threads','X']:['X','directories','Product Hunt']});
}
async function captureScorecards(){
  // Bundle only the production canvas renderer and synthetic inputs. The QA entry
  // stays outside public/ and is never part of the deployed app.
  const result=await build({
    configFile:false,logLevel:'error',
    build:{write:false,lib:{entry:fileURLToPath(new URL('./scorecards.ts',import.meta.url)),name:'MediaScorecards',formats:['iife']}},
  });
  const bundle=result[0].output.find(item=>item.type==='chunk');
  if(!bundle)throw new Error('Scorecard renderer unavailable');
  const {context,page}=await fresh({width:390,height:844});
  try{
    await page.addScriptTag({content:bundle.code});
    for(const sample of ['daily','weekly']){
      const bytes=Buffer.from(await page.evaluate(kind=>MediaScorecards.demoScorecard(kind),sample));
      const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
      const id=sample+'-scorecard-demo',file=id+'.png';
      if(width!==1080||height!==(sample==='daily'?1080:1920))throw new Error('Incorrect scorecard dimensions');
      await writeFile(join(out,file),bytes);
      records.push({
        id,file,kind:'scorecard',width,height,bytes:bytes.length,capturedAt:stamp,
        source:'src/ui/share-card.ts',description:'Illustrative '+sample+' scorecard rendered by Stat Window',
        alt:'Stat Window '+sample+' demonstration scorecard with fictional results',
        demonstration:true,reviewStatus:'pending',spoilerSafe:false,platforms:['Instagram','Threads','X','directories'],
      });
    }
  }finally{await context.close();}
}
async function video(example,miss){
  const viewport={width:390,height:844};
  const {context,page}=await fresh(viewport,true);
  const id=example.key+'-portrait-'+(miss?'miss':'hit')+'-video';
  const raw=join(out,id+'.webm');
  const file=id+'.mp4',path=join(out,file);
  const width=1080,height=1920;
  try{
    await openExample(page,example);
    await page.addStyleTag({content:captureStyle});
    await page.screencast.start({path:raw,size:viewport});
    await pause(1400);
    await dragIntro(page,example,miss);
    await pause(1400);
    const practice=await reveal(page,example);
    await practice.locator('.reveal-answer').scrollIntoViewIfNeeded();
    await pause(3600);
    await guard(page,example,'resolved');
    await page.screencast.stop();
  }finally{await context.close();}
  await run('ffmpeg',[
    '-v','error','-i',raw,'-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xF7F4EE,setsar=1`,
    '-an','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path,
  ]);
  const {stdout}=await run('ffprobe',[
    '-v','error','-select_streams','v:0','-show_entries','stream=width,height,sample_aspect_ratio:format=duration','-of','json',path,
  ]);
  const metadata=JSON.parse(stdout);
  const stream=metadata.streams[0];
  if(stream.width!==width||stream.height!==height||stream.sample_aspect_ratio!=='1:1'){
    throw new Error('Incorrect video display dimensions');
  }
  await rm(raw);
  records.push({
    id,file,kind:'video',width,height,bytes:(await stat(path)).size,capturedAt:stamp,source:example.id,
    durationSeconds:Number(metadata.format.duration),
    description:'Untimed Warriors teaching gameplay — '+(miss?'miss':'hit'),
    alt:miss?'The brackets miss the correct total and the court marker stays put':'The brackets catch the correct total and the court marker advances',
    demonstration:true,reviewStatus:'pending',spoilerSafe:false,platforms:['X','Threads','Instagram','TikTok','YouTube Shorts'],
  });
}

try{
  browser=await chromium.launch({executablePath:process.env.MEDIA_CHROMIUM});
  for(const example of examples){
    for(const layout of layouts){
      const {context,page}=await fresh(layout.viewport);
      try{
        await openExample(page,example);
        if(layout.states.includes('question'))await image(page,example,layout,'question');
        if(layout.states.includes('adjusted')||layout.states.includes('reveal'))await adjust(page,example);
        if(layout.states.includes('adjusted'))await image(page,example,layout,'adjusted');
        if(layout.states.includes('reveal')){await reveal(page,example);await image(page,example,layout,'reveal');}
      }finally{await context.close();}
    }
  }
  await captureScorecards();
  if(wantVideos)for(const miss of [false,true])await video(examples[0],miss);
  await writeFile(join(out,'review-manifest.json'),JSON.stringify({schemaVersion:1,approval:'pending',assets:records},null,2)+'\n');
  console.log('Review-only output: '+out+' ('+records.length+' assets). Inspect every asset before publishing.');
}catch(error){
  // Nothing from an unexpected or incomplete capture survives as an approved candidate.
  await rm(out,{recursive:true,force:true});
  throw error;
}finally{await browser?.close();}
