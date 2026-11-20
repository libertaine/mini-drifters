// R4C page qualification: HUD geometry, results, real impact scheduling and generated audio.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium,firefox}=await import(process.argv[2]?pathToFileURL(process.argv[2]):'playwright');
const root=new URL('../',import.meta.url),dir=new URL('artifacts/screens-r4c/',root);
await mkdir(dir,{recursive:true});
await mkdir(new URL('artifacts/results/', root), { recursive: true });
const types={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.wav':'audio/wav','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;const f=p==='/'?'index.html':p.slice(1);if(!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/[\w-]+\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(f)||f.includes('..')){res.writeHead(404);res.end();return;}try{res.writeHead(200,{'Content-Type':types[extname(f)]});res.end(await readFile(new URL(f,root)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/`;
const evidence=[];
function harness(){
 localStorage.setItem('mini-drifters-sound','off');window.__writes=[];
 const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){window.__writes.push(k);return set.call(this,k,v);};
 window.requestAnimationFrame=f=>{window.__nextFrame=f;return 1;};let now;
 window.__frames=(n=2)=>{now??=performance.now();for(let i=0;i<n;i++){now+=1000/60;window.__nextFrame(now);}};
 window.__smash=kind=>{
   const {game:g,input}=window.__miniDrifters,b=g.challengeDef.geometry.city.breakables.find(b=>b.kind===kind);
   const e=b.edge===null?null:g.challengeDef.geometry.city.edges[b.edge],dx=e?e.dx:0,dy=e?e.dy:1;
   Object.assign(input,{up:false,down:false,left:false,right:false,handbrake:false});
   const x=e?b.cx-dx*7:b.minX-1,y=b.cy-dy*7;
   Object.assign(g.car,{x,y,heading:Math.atan2(dy,dx),vx:dx*28,vy:dy*28});Object.assign(g.prev,{x,y,heading:g.car.heading});
   g.state='racing';g.scoring.combo={points:100,tier:2,grace:2,tierGround:0,linkGround:0,stallTimer:0,stallGround:0,side:1};
   for(let i=0;i<60&&!g.challenge.broken[b.index];i++)window.__frames(1);
   return {hit:g.challenge.broken[b.index],combo:!!g.scoring.combo,bonus:g.challenge.smashBonus,sounds:window.__miniDrifters.smashSounds()};
 };
 window.__drive=async()=>{
   const {urbanGrip}=await import('/test/support/urban-drivers.mjs'),{game:g,input}=window.__miniDrifters,driver=urbanGrip({lateral:9});
   for(let i=0;i<130*60&&g.state!=='finished';i++){Object.assign(input,driver(g));window.__frames(1);}return g.challenge.result;
 };
}
try{
for(const [name,engine]of [['chromium',chromium],['firefox',firefox]].filter(([name])=>!process.argv[3]||name===process.argv[3])){
 const browser=await engine.launch({headless:true});try{
 const ctx=await browser.newContext({viewport:{width:1366,height:768}});await ctx.addInitScript(harness);const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const frames=()=>page.evaluate(()=>window.__frames(2));
 const key=async k=>{await page.keyboard.press(k);await frames();};
 const open=async(variant='downtown',mode='classic')=>{await page.goto(base);await page.waitForFunction(()=>window.__miniDrifters,null,{polling:50});await frames();await page.click('#getaway');await page.click('#get-the-footage');await frames();await page.locator(`#challenges input[value="getaway-urban-${variant}"]`).evaluate(e=>e.click());await frames();if(await page.evaluate(()=>window.__miniDrifters.selectedHandling())!==mode)await key('KeyH');await page.click('#gymkhana-start');await frames();};
 const shot=async label=>page.screenshot({path:fileURLToPath(new URL(`${name}-${label}.png`,dir))});
 const bounds=async state=>page.evaluate(state=>{
  const g=window.__miniDrifters.game,W=innerWidth,H=innerHeight;
  const rect=sel=>{const e=document.querySelector(sel),r=e.getBoundingClientRect();return {sel,x:r.x,y:r.y,w:r.width,h:r.height,visible:!e.hidden&&r.width>0&&r.height>0};};
  if(state==='hud'){
   const nav=rect('#nav'),others=['#bust','.gauges','#gym-panel','#sound'].map(rect),b=g.challengeDef.geometry.bounds;
   const scale=Math.min(210/(b.maxX-b.minX),150/(b.maxY-b.minY)),map={x:W-16-(b.maxX-b.minX)*scale-6,y:H-16-(b.maxY-b.minY)*scale-6,w:(b.maxX-b.minX)*scale+12,h:(b.maxY-b.minY)*scale+12};
   return {W,H,nav,others,map,overflow:document.documentElement.scrollWidth>W};
  }
  return {W,H,sheet:rect('#gymkhana-results .sheet'),controls:[...document.querySelectorAll('#gymkhana-results button')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})};
 },state);
 const inside=(r,W,H)=>r.x>=-1&&r.y>=-1&&r.x+r.w<=W+1&&r.y+r.h<=H+1;
 const overlap=(a,b)=>a.x<b.x+b.w-1&&a.x+a.w>b.x+1&&a.y<b.y+b.h-1&&a.y+a.h>b.y+1;
 for(const variant of ['downtown','industrial']){
  await open(variant);await page.evaluate(()=>{window.__miniDrifters.input.up=true;window.__frames(240);window.__miniDrifters.input.up=false;});
  for(const fallback of [false,true]){
   await page.evaluate(f=>{const s=document.documentElement.style;for(const k of ['--poster','--display','--body'])if(f)s.setProperty(k,'Arial, sans-serif');else s.removeProperty(k);},fallback);
   for(const [width,height]of [[1024,600],[1366,768],[1920,1080]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(50);await frames();const b=await bounds('hud');
    assert.ok(b.nav.visible&&inside(b.nav,width,height),JSON.stringify(b));assert.equal(b.overflow,false);
    for(const other of [...b.others,b.map])assert.equal(overlap(b.nav,other),false,`${name}/${variant}/${width}/fallback=${fallback}: navigation overlaps ${other.sel??'map'}`);
    const labels=await page.evaluate(()=>{
      const call=document.getElementById('nav-call'),goal=document.getElementById('nav-goal'),box=document.getElementById('nav').getBoundingClientRect();
      const old=[call.textContent,goal.textContent];call.textContent='TURN AROUND';goal.textContent='BACK FOR CAM 4 · 1,200 m';
      const fits=[call,goal].every(e=>{const r=document.createRange();r.selectNodeContents(e);const b=r.getBoundingClientRect();return b.left>=box.left&&b.right<=box.right-8;});
      [call.textContent,goal.textContent]=old;return fits;
    });assert.ok(labels,`${name}/${variant}/${width}/fallback=${fallback}: navigation text fits its panel`);
    evidence.push({browser:name,variant,fallback,width,height,hud:b});await shot(`${variant}-hud-${width}-${fallback?'fallback':'native'}`);
   }
  }
 }
 // The actual chip reads the same cue as the pure module; wrong-way recovery stays stable.
 await open('industrial');
 await page.evaluate(()=>{const {game:g,input}=window.__miniDrifters;Object.assign(input,{up:false});Object.assign(g.car,{x:100,y:4,vx:-20,vy:0,heading:Math.PI});Object.assign(g.prev,{x:100,y:4,heading:Math.PI});g.state='racing';g.challenge.nextCamera=1;g.challenge.missed[1]=true;g.challenge.guideIn=0;window.__frames(2);});
 for(let i=0;i<15;i++){await frames();assert.equal(await page.locator('#nav-call').textContent(),'TURN AROUND');assert.match(await page.locator('#nav-goal').textContent(),/^BACK FOR CAM 2/);}
 await shot('wrong-way-recovery');
 const chip=await page.evaluate(async()=>{const n=await import('/src/getaway-nav.js'),g=window.__miniDrifters.game;return n.cueText(g.challenge,n.cueForGame(g),g.challengeDef.geometry.cameras);});assert.equal(await page.locator('#nav-call').textContent(),chip.call);
 for(const variant of ['downtown','industrial']){await open(variant,'revised');assert.equal(await page.evaluate(()=>window.__miniDrifters.game.handling.id),'revised');const r=await page.evaluate(()=>window.__drive());assert.equal(r.ended,'escaped');evidence.push({browser:name,variant,handling:'revised',result:r});}
 // Trigger real effects through main.js and the actual effects path.
 await open();await page.click('#sound');try { await page.waitForFunction(()=>window.__miniDrifters.audio().contextState==='running',null,{timeout:12000,polling:50}); } catch(e) { console.log('REALTIME FAILURE',name,JSON.stringify(await page.evaluate(()=>window.__miniDrifters.audio())),JSON.stringify(errors));throw e; }
 for(const kind of ['fruit','barricade']){
  await key('KeyR');await page.waitForTimeout(400);const before=await page.evaluate(()=>window.__miniDrifters.smashSounds().played);
  const hit=await page.evaluate(k=>window.__smash(k),kind);assert.equal(hit.hit?.by,'car');assert.equal(hit.combo,true);assert.equal(hit.sounds.played,before+1);
  assert.equal(hit.bonus,kind==='fruit'?150:250);await shot(`smash-${kind}`);
  await page.evaluate(()=>window.__frames(20));assert.equal(await page.evaluate(()=>window.__miniDrifters.smashSounds().played),before+1,'debris never repeats');
  await key('KeyP');const t=await page.evaluate(()=>window.__miniDrifters.game.challenge.time);await page.evaluate(()=>window.__frames(20));assert.equal(await page.evaluate(()=>window.__miniDrifters.game.challenge.time),t);await key('KeyP');
 }
 await key('KeyR');await page.evaluate(()=>{const e=document.getElementById('effects-volume');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});
 let before=await page.evaluate(()=>window.__miniDrifters.smashSounds());let hit=await page.evaluate(()=>window.__smash('fruit'));assert.equal(hit.sounds.played,before.played);assert.equal(hit.sounds.silent,before.silent+1);
 await key('KeyR');await page.click('#sound');before=await page.evaluate(()=>window.__miniDrifters.smashSounds());hit=await page.evaluate(()=>window.__smash('barricade'));assert.equal(hit.sounds.played,before.played);
 // A real successful escape, then success and failure sheets under both font sets.
 await open();const result=await page.evaluate(()=>window.__drive());assert.equal(result.ended,'escaped');assert.equal(result.value,result.score+result.smashBonus);
 assert.match(await page.locator('#gr-stats').textContent(),/Banked drift.*Destruction.*Total Showmanship/s);
 for(const failed of [false,true]){
  if(failed){await key('KeyR');await page.evaluate(()=>window.__smash('fruit'));await page.evaluate(()=>{const m=window.__miniDrifters;Object.assign(m.input,{up:false,down:false,left:false,right:false,handbrake:false});m.game.challenge.time=m.game.challengeDef.timeLimit;window.__frames(2);});assert.equal(await page.locator('#gr-value').textContent(),'--');assert.equal(await page.locator('#gr-medal').isVisible(),false);assert.match(await page.locator('#gr-stats').textContent(),/not counted/);}
  for(const fallback of [false,true]){await page.evaluate(f=>{for(const k of ['--poster','--display','--body'])document.documentElement.style.setProperty(k,f?'Arial, sans-serif':'');},fallback);
   for(const [width,height]of [[1024,600],[1366,768],[1920,1080]]){await page.setViewportSize({width,height});await frames();const b=await bounds('results');assert.ok(inside(b.sheet,width,height),`${name} results sheet ${JSON.stringify(b)}`);assert.ok(b.controls.every(c=>inside(c,width,height)));await shot(`${failed?'failed':'success'}-${width}-${fallback?'fallback':'native'}`);}
  }
 }
 // Web Audio render: distinct nonzero waves, exact effects scaling, silence and cancellation.
 const sound=await page.evaluate(async()=>{
  const {playSmash}=await import('/src/getaway-sfx.js');
  async function render(kind,gain=1,cancel=false){const c=new OfflineAudioContext(1,28800,48000),bus=c.createGain();bus.gain.value=gain;bus.connect(c.destination);const v=playSmash(c,bus,kind);if(cancel)v.stop();const a=(await c.startRendering()).getChannelData(0);let sum=0,peak=0,checksum=0;for(let i=0;i<a.length;i++){sum+=a[i]*a[i];peak=Math.max(peak,Math.abs(a[i]));checksum+=a[i]*(i%31);}return {rms:Math.sqrt(sum/a.length),peak,checksum};}
  return {fruit:await render('fruit'),barricade:await render('barricade'),quarter:await render('fruit',.0625),off:await render('fruit',0),cancel:await render('barricade',1,true)};
 });
 assert.ok(sound.fruit.rms>.001&&sound.barricade.rms>.001);assert.notEqual(sound.fruit.checksum,sound.barricade.checksum);assert.ok(Math.abs(sound.quarter.rms/sound.fruit.rms-.0625)<.00001);assert.equal(sound.off.rms,0);assert.equal(sound.cancel.rms,0);assert.ok(sound.fruit.peak<1&&sound.barricade.peak<1);evidence.push({browser:name,sound});
 const writes=await page.evaluate(()=>window.__writes.filter(k=>/^mini-drifters-(records|gymkhana|ghosts)/.test(k)));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 console.log(`${name}: all R4C checks passed (12 HUD layouts, 12 result layouts, two live impacts, mute/volume/pause, offline audio signal and storage isolation)`);
 }finally{await browser.close();}
}
await writeFile(new URL('artifacts/results/r4c-browser-evidence.json',root),JSON.stringify(evidence,null,2));
}finally{server.close();}
