// Focused R4C guidance contracts. Real city graph and session replays where routing matters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV, planGuide, navCue, cueText, guidePlace, turnBearing } from '../src/getaway-nav.js';
import { locate, segmentHitsBox } from '../src/getaway-city.js';
import { cityFor, createUrbanChallenge } from '../src/getaway-urban.js';
import { handlingById } from '../src/handling.js';
import { urbanGrip, urbanDrift, driveUrban } from './support/urban-drivers.mjs';
const scenarios = {
  grip: () => urbanGrip({lateral:10}),
  moderate: (mode) => urbanDrift({lateral:mode==='revised'?10:11,tapSpeed:mode==='revised'?13:11}),
  recovery: (mode,variant) => urbanGrip({lateral:10,skip:variant==='downtown'?4:2}),
  deadEnd: (mode,variant) => urbanGrip({lateral:10,via:variant==='downtown'?{afterCamera:4,nodes:['C3','DE']}:{afterCamera:2,nodes:['N31','K3','DK']}}),
};
const carAt = (x, y, heading = 0, speed = 20) => ({x,y,heading,vx:Math.cos(heading)*speed,vy:Math.sin(heading)*speed});
const empty = {colliders:[]};
const cue = (points,car) => navCue(empty,{points},car);

test('navigation: normal intersection is announced at least three seconds ahead', () => {
  const c=cue([[0,0],[100,0],[100,80]],carAt(30,0));
  assert.equal(c.announce.side,'right'); assert.equal(c.announce.in,70); assert.equal(c.around,false);
  assert.equal(cueText({nextCamera:0,missed:[]},c,[{number:1}]).call,'RIGHT 70 m');
});
test('navigation: consecutive hard corners advance to the second real junction', () => {
  const points=[[0,0],[90,0],[90,40],[160,40]];
  assert.equal(cue(points,carAt(40,0)).announce.side,'right');
  const c=cue(points,carAt(90,10,Math.PI/2));
  assert.equal(c.announce.side,'left'); assert.equal(c.announce.in,30);
});
test('navigation: wrong-way instruction survives repeated replans, braking and a stop', () => {
  const city=cityFor('industrial'),gate=city.cameras[0];let previous=null;
  for(let i=0;i<50;i++) {
    const car=carAt(40-i*0.2,330,Math.PI,Math.max(0,12-i));
    previous=planGuide(city,locate(city,car.x,car.y),gate,{car,previous,next:city.cameras[1]});
    const c=navCue(city,previous,car);
    assert.equal(c.around,true);assert.equal(cueText({nextCamera:0,missed:[]},c,city.cameras).call,'TURN AROUND');
    assert.ok(previous.points.every(p=>p[0]<=66||p[1]!==330),'no junction-and-back diversion');
  }
});
test('navigation: a cross street at a junction does not invent a one-frame turn', () => {
  const city=cityFor('downtown'),car=carAt(225,74,Math.PI,23);
  const at=guidePlace(city,car);
  assert.ok(Math.abs(city.edges[at.edge].dx)>0.9);
  const p=planGuide(city,locate(city,car.x,car.y),city.exit,{car});
  const c=navCue(city,p,car);assert.equal(c.turn.x,180);assert.equal(c.turn.y,75);
});
test('navigation: the final two metres before a camera keep the approach and next turn', () => {
  const city=cityFor('downtown'),gate=city.cameras[1];
  for(const before of [20,2,1,0.1]) {
    const car=carAt(gate.cx-before,gate.cy);
    const p=planGuide(city,locate(city,car.x,car.y),gate,{car,next:city.cameras[2]});
    const c=navCue(city,p,car);assert.equal(c.around,false);assert.equal(c.announce.side,'right');
    assert.equal(c.turn.x,180); assert.equal(c.turn.y,75);
  }
});
test('navigation: future camera streets cannot steal progress from missed-camera recovery', () => {
  const city=cityFor('industrial'),car=carAt(100,4,Math.PI,20);
  const p=planGuide(city,locate(city,car.x,car.y),city.cameras[1],{car,next:city.cameras[2]});
  for(let i=0;i<20;i++) {
    const c=navCue(city,p,carAt(100-i*0.2,4,Math.PI));
    assert.ok(c.remaining>400);assert.equal(c.around,true);
  }
});
test('navigation: a dead-end route leads to its mouth and asks the nose-in car to turn round', () => {
  for(const variant of ['downtown','industrial']) {
    const city=cityFor(variant),e=city.edges.find(e=>e.kind==='deadend');
    const leafId=city.nodes[e.a].edges.length===1?e.a:e.b;
    const leaf=city.nodes[leafId],mouth=city.nodes[leafId===e.a?e.b:e.a];
    const x=(leaf.x*3+mouth.x)/4,y=(leaf.y*3+mouth.y)/4;
    const car=carAt(x,y,Math.atan2(leaf.y-mouth.y,leaf.x-mouth.x),4);
    const p=planGuide(city,locate(city,x,y),city.cameras[0],{car});
    const c=navCue(city,p,car);assert.equal(c.around,true);
    assert.ok((c.aim[0]-x)*(mouth.x-x)+(c.aim[1]-y)*(mouth.y-y)>0);
  }
});
test('navigation: blocked streets are detoured through reachable roads', () => {
  for(const variant of ['downtown','industrial']) {
    const city=cityFor(variant),car=carAt(city.start.x,city.start.y,city.start.heading);
    for(const gate of [...city.cameras,city.exit]) {
      const p=planGuide(city,locate(city,car.x,car.y),gate,{car});assert.ok(p);
      for(let i=1;i<p.points.length;i++)for(const b of city.blockades)assert.equal(segmentHitsBox(...p.points[i-1],...p.points[i],b,0),false);
    }
  }
});
test('navigation: intact barricade is avoided, broken barricade opens the shorter route', () => {
  const city=cityFor('downtown'),b=city.breakables.find(b=>b.kind==='barricade'),car=carAt(270,90,-Math.PI/2);
  const at=locate(city,car.x,car.y),p=planGuide(city,at,city.exit,{car});
  const broken=city.breakables.map(()=>null);broken[b.index]={by:'car'};
  const q=planGuide(city,at,city.exit,{car,broken,previous:p});
  const crosses=r=>r.points.some((v,i)=>i&&segmentHitsBox(...r.points[i-1],...v,b));
  assert.equal(crosses(p),false);assert.equal(crosses(q),true);assert.ok(q.length<p.length);
});
test('navigation: camera four continuation becomes escape guidance without a spurious turn', () => {
  const city=cityFor('industrial'),gate=city.cameras[3],car=carAt(0,gate.cy-20,Math.PI/2);
  const p=planGuide(city,locate(city,car.x,car.y),gate,{car,next:city.exit});
  assert.equal(navCue(city,p,car).turn,null);
  const after=carAt(0,gate.cy+1,Math.PI/2),q=planGuide(city,locate(city,after.x,after.y),city.exit,{car:after});
  assert.equal(navCue(city,q,after).around,false);
  assert.equal(cueText({exitOpen:true,nextCamera:4,missed:[]},navCue(city,q,after),city.cameras).goal,'ESCAPE GATE');
});
test('navigation: deterministic normal, recovery and dead-end replays have visible aims and no rapid turn oscillation', () => {
  for(const variant of ['downtown','industrial'])for(const mode of ['classic','revised'])for(const name of ['grip','moderate','recovery','deadEnd']) {
    const city=cityFor(variant),hist=[];let samples=0,previousCue=null;
    driveUrban(createUrbanChallenge({variant}),handlingById(mode),scenarios[name](mode,variant),{onTick:game=>{
      const r=game.challenge;if(r.phase!=='running'||!r.guide)return;
      const c=navCue(city,r.guide,game.car,{previous:previousCue});previousCue=c;samples++;
      assert.ok(!city.colliders.some(b=>segmentHitsBox(game.car.x,game.car.y,...c.aim,b,NAV.aimPad-0.05)),`${variant}/${mode}/${name} visible aim at ${r.time}`);
      const k=c.announce?`${Math.round(c.announce.x)},${Math.round(c.announce.y)},${c.announce.side}`:'-';
      if(hist.at(-1)?.k===k)return;
      if(k!=='-'){const back=hist.slice(0,-1).reverse().find(h=>h.k===k);assert.ok(!back||r.time-back.t>=2,`${variant}/${mode}/${name}: rapid turn oscillation`);}
      hist.push({k,t:r.time});
    }});assert.ok(samples>1000);
  }
});

test('navigation: braking retains an announced turn until the planned turn changes', () => {
  const p={points:[[0,0],[240,0],[240,200],[300,200]]};
  const first=navCue(empty,p,carAt(122,0,0,34));assert.equal(first.announce.in,118);
  const braking=navCue(empty,p,carAt(158,0,0,23),{previous:first});
  assert.equal(braking.announce.side,'right');assert.equal(braking.announce.in,82);
  const changed=navCue(empty,{points:[[0,0],[260,0],[260,-200]]},carAt(158,0,0,23),{previous:braking});
  assert.equal(changed.announce,null,'a different planned corner is not latched');
  const passed=navCue(empty,p,carAt(240,20,Math.PI/2,10),{previous:braking});
  assert.equal(passed.turn.x,240);assert.equal(passed.turn.y,200);assert.equal(passed.announce,null);
});

test('navigation: U-turn arrowhead points along the return road, including when stopped', () => {
  for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const speed of [0,20]){
    const car=carAt(0,0,heading,speed),cue={around:true,dir:heading+Math.PI};
    const head=turnBearing(cue,car)+Math.PI;
    assert.ok(Math.cos(head-cue.dir)>.999,'the U arrowhead returns along the road');
  }
  assert.equal(turnBearing({around:false,announce:{from:Math.PI/2}},carAt(0,0)),Math.PI/2);
});
