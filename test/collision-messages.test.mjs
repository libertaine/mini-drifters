import test from 'node:test';
import assert from 'node:assert/strict';
import { collisionReason, createScoring, updateScoring } from '../src/scoring.js';
import { createGame, startRun, tick } from '../src/game.js';
import { trackById, projectOnTrack } from '../src/track.js';
import { TUNING } from '../src/tuning.js';

const combo = () => ({ points: 500, tier: 0, grace: 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 });
test('wall-like contacts retain wall wording; scenery uses obstacle wording', () => {
  for (const kind of [undefined, 'wall', 'barrier', 'tyrewall', 'retaining', 'guardrail', 'fence']) assert.equal(collisionReason(kind), 'hit the wall');
  for (const kind of ['container', 'warehouse', 'building', 'tree', 'pine', 'rock', 'stand', 'van', 'sign']) assert.equal(collisionReason(kind), 'hit an obstacle');
});
test('collision wording preserves the significant-impact threshold and lost points', () => {
  for (const impactKind of ['wall', 'container', 'tree', 'retaining']) for (const hard of [false,true]) {
    const s = createScoring(); s.combo = combo();
    updateScoring(s, { speed: 20, forwardSpeed: 20, slipAngle: 0, surface: 'road', progressRate: 20,
      newGround: 1, impact: TUNING.barrierSignificantImpact + (hard ? 0 : -0.001), impactKind }, TUNING.simStep);
    assert.equal(s.score,0);
    assert.equal(s.combo === null,hard);
    if(hard) { assert.equal(s.event.type,'lost'); assert.equal(s.event.points,500); assert.equal(s.event.reason,collisionReason(impactKind)); }
    else assert.equal(s.event,null);
  }
});
test('the session reports a real Dockyard container hit as an obstacle', () => {
  const track = trackById('dockyard');
  const g = createGame(track); startRun(g); g.state='racing'; g.ghost=null;
  Object.assign(g.car,{x:96,y:-38,heading:0,vx:25,vy:0,yawRate:0});
  Object.assign(g.prev,{x:96,y:-38,heading:0});
  g.trackInfo=projectOnTrack(track,96,-38); g.trackS=g.trackInfo.s; g.scoring.combo=combo();
  for(let i=0;i<30 && g.scoring.combo;i++) tick(g,{});
  assert.equal(g.lastContact.kind,'container');
  assert.ok(g.lastContact.impact >= TUNING.barrierSignificantImpact);
  assert.equal(g.scoring.event.reason,'hit an obstacle');
  assert.equal(g.scoring.score,0);
});
