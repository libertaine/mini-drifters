// What a saved reference ghost depends on, as three hashes, for test/ghost-store.test.mjs. If any
// of them changes, GHOST_COMPATIBILITY in src/ghost-store.js has to be reviewed:
//   drive     scripted grip and reckless runs on every circuit in every handling mode, every
//             tick's car pose and lap state. Catches any change that moves the car or decides a
//             lap differently, wherever the code lives (game.js barriers and timing included).
//   geometry  every circuit's centreline, width, curbs, gates, line, bounds, start and apron,
//             and its solid scenery as the collision code sees it.
//   sources   the text of the modules that drive the car and judge laps, line endings ignored.
//             A comment-only change trips it too; that needs a review, not a version bump.
// Run directly to print the current values: node test/support/ghost-compatibility.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createGame, startRun, tick } from '../../src/game.js';
import { TRACKS, trackById } from '../../src/track.js';
import { HANDLING_MODES } from '../../src/handling.js';
import { obstaclesFor } from '../../src/obstacles.js';
import { gripDriver, recklessDriver } from './drivers.mjs';

export const SIMULATION_SOURCES = ['physics.js', 'tuning.js', 'handling.js', 'laps.js', 'track.js', 'obstacles.js',
  'controls.js', 'dockyard-scenery.js', 'scenery.js', 'scenery-original.js', 'scenery-switchback.js'];

export function driveHash() {
  const hash = createHash('sha256');
  for (const { id } of TRACKS) {
    for (const handling of HANDLING_MODES) {
      for (const makeDriver of [gripDriver, recklessDriver]) {
        const game = createGame(trackById(id));
        startRun(game, { handling });
        const driver = makeDriver();
        while (game.state !== 'finished' && game.ticks < 60000) {
          tick(game, driver(game));
          const { car, laps } = game;
          hash.update(JSON.stringify([car.x, car.y, car.heading, laps.completed, laps.voided, laps.next, laps.lapTime]));
        }
        hash.update(`|${id}/${handling.id}/${game.ticks}|`);
      }
    }
  }
  return hash.digest('hex');
}

export function geometryHash() {
  const hash = createHash('sha256');
  for (const { id } of TRACKS) {
    const track = trackById(id);
    const { name, ...shape } = track;
    hash.update(JSON.stringify(shape));
    hash.update(JSON.stringify(obstaclesFor(track)));
  }
  return hash.digest('hex');
}

export function sourcesHash() {
  const hash = createHash('sha256');
  for (const file of SIMULATION_SOURCES) {
    hash.update(`${file}\n`);
    hash.update(readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex');
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ drive: driveHash(), geometry: geometryHash(), sources: sourcesHash() }, null, 2));
}
