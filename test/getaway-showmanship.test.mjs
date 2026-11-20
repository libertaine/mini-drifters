// R4C scoring contracts use the challenge step directly to isolate contact and qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createUrbanChallenge,SHOWMANSHIP,BREAKABLE} from '../src/getaway-urban.js';
import {createScoring} from '../src/scoring.js';
import {resolveObstacles} from '../src/obstacles.js';
import {updateDerived} from '../src/physics.js';
import {TUNING} from '../src/tuning.js';
function session(variant='downtown',options={}) {
  const def=createUrbanChallenge({variant,pursuer:{delay:1e9},...options});
  const run=def.createRun(),scoring=createScoring();
  const car={x:0,y:225,vx:0,vy:0,heading:0,speed:0,forwardSpeed:0,slipAngle:0,handbrake:false,yawRate:0};
  return {def,run,scoring,car,game:{challengeDef:def,challenge:run,scoring,car,ticks:0}};
}
const combo=()=>({points:100,tier:2,grace:2,tierGround:0,linkGround:0,stallTimer:0,stallGround:0,side:1});
function contact(s,br,speed=30,impact=0) {
  Object.assign(s.car,{x:br.cx,y:br.cy,vx:speed,vy:0,heading:0});updateDerived(s.car);
  s.def.step(s.run,s.game,br.cx-4,br.cy,impact);
}
function cross(s,g) {
  Object.assign(s.car,{x:g.cx+g.tx,y:g.cy+g.ty,vx:g.tx*15,vy:g.ty*15,heading:Math.atan2(g.ty,g.tx)});updateDerived(s.car);
  s.def.step(s.run,s.game,g.cx-g.tx,g.cy-g.ty,0);
}
function escape(s){for(const c of s.def.geometry.cameras)cross(s,c);cross(s,s.def.geometry.exit);return s.run.result;}

test('Showmanship: both kinds preserve a live multiplied combo at low and high speed',()=>{
  for(const speed of [8,42])for(const kind of ['fruit','barricade']) {
    const s=session(),br=s.def.geometry.city.breakables.find(b=>b.kind===kind);s.scoring.combo=combo();const live=s.scoring.combo;
    contact(s,br,speed);assert.equal(s.scoring.combo,live);assert.equal(s.scoring.combo.tier,2);
    assert.equal(s.run.smashBonus,SHOWMANSHIP.bonus[kind]);assert.equal(s.scoring.score,0);
    assert.ok(Math.abs(s.car.speed-speed*BREAKABLE[kind].keep)<1e-8);
  }
});
test('Showmanship: a same-step hit on adjacent solid geometry still loses the combo',()=>{
  const s=session(),br=s.def.geometry.city.breakables.find(b=>b.kind==='fruit');
  // The fruit stand sits beside its building. A move toward that wall contacts both.
  const ax=br.cx-5,ay=br.cy;
  Object.assign(s.car,{x:br.cx+4,y:br.cy,vx:30,vy:0,heading:0});updateDerived(s.car);
  const hit=resolveObstacles(s.car,s.def.geometry.city.colliders,ax,ay);
  assert.ok(hit.impact>=TUNING.barrierSignificantImpact,'actual city building impact');
  s.scoring.combo=combo();s.def.step(s.run,s.game,ax,ay,hit.impact);
  assert.equal(s.scoring.combo,null);assert.equal(s.run.smashBonus,150);
});
test('Showmanship: repeated contact and multiple objects pay one flat bonus apiece',()=>{
  const s=session();s.scoring.combo=combo();
  for(const br of s.def.geometry.city.breakables){contact(s,br);contact(s,br);}
  assert.equal(s.run.smashBonus,550);assert.equal(s.run.smashes,3);assert.equal(s.run.smashLog.length,3);
  assert.deepEqual(s.run.smashLog.map(x=>x.bonus),[250,150,150]);
  const fresh=s.def.createRun();assert.equal(fresh.smashBonus,0);assert.deepEqual(fresh.smashLog,[]);assert.ok(fresh.broken.every(x=>x===null));
});
test('Showmanship: a sweep touching two objects awards both exactly once',()=>{
  const s=session(),[a,b]=s.def.geometry.city.breakables.filter(b=>b.kind==='fruit');
  Object.assign(s.car,{x:b.cx,y:b.cy,vx:20,vy:0,heading:0});updateDerived(s.car);
  s.def.step(s.run,s.game,a.cx,a.cy,0);
  assert.equal(s.run.smashes,2);assert.equal(s.run.smashBonus,300);assert.equal(new Set(s.run.smashLog.map(x=>x.index)).size,2);
});
test('Showmanship: destruction-only escape stays below Silver in every layout and handling',()=>{
  for(const variant of ['downtown','industrial']) {
    const s=session(variant);for(const br of s.def.geometry.city.breakables)contact(s,br);
    const r=escape(s);assert.equal(r.ended,'escaped');assert.equal(r.score,0);assert.equal(r.value,s.run.smashBonus);
    for(const mode of ['classic','revised'])assert.ok(r.value<s.def.medalTargets[mode].silver);
  }
});
test('Showmanship: combined score is banked drift plus flat destruction, never combo-multiplied',()=>{
  const s=session();s.scoring.score=700;contact(s,s.def.geometry.city.breakables[0]);
  const r=escape(s);assert.equal(r.score,700);assert.equal(r.smashBonus,250);assert.equal(r.value,950);assert.equal(r.showmanship,950);
});
test('Showmanship: timeout, bust and strict missed camera never qualify accumulated bonuses',()=>{
  for(const failure of ['timeout','bust','missed']) {
    const s=session('downtown',{missPolicy:'strict'});contact(s,s.def.geometry.city.breakables[0]);s.scoring.score=900;
    if(failure==='timeout')s.run.time=s.def.timeLimit;
    if(failure==='bust'){s.run.time=1e9;s.run.meter=0.9999;Object.assign(s.run.pursuer,{x:s.car.x,y:s.car.y});}
    if(failure==='missed')cross(s,s.def.geometry.cameras[1]);
    else s.def.step(s.run,s.game,s.car.x,s.car.y,0);
    assert.equal(s.run.phase,'failed',failure);assert.equal(s.run.result.value,null);assert.equal(s.run.result.smashBonus,250);
  }
});
test('Showmanship: police destruction pays nothing and cannot be farmed by the player later',()=>{
  const s=session('industrial',{pursuer:{delay:0}}),br=s.def.geometry.city.breakables.find(b=>b.kind==='fruit');
  Object.assign(s.car,{x:br.cx-35,y:br.cy-10});Object.assign(s.run.pursuer,{x:br.cx,y:br.cy,prevX:br.cx,prevY:br.cy,speed:0});
  s.def.step(s.run,s.game,s.car.x,s.car.y,0);
  assert.equal(s.run.broken[br.index]?.by,'police');assert.equal(s.run.smashBonus,0);assert.deepEqual(s.run.smashLog,[]);
  contact(s,br);assert.equal(s.run.smashBonus,0);assert.equal(s.run.smashes,0);
});
