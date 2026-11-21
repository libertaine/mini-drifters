# Development

Notes for working on Mini Drifters: running it, testing it, where things live and how the car is put together. The [README](../README.md) covers what the game is and how to play it.

The game is plain HTML, CSS and JavaScript on a Canvas, with no build step and no runtime dependencies. You need [Node.js](https://nodejs.org/) 22 or newer to run the local server and tests. CI uses Node 24.

## Run locally

On Windows, double-click **`Start Game.cmd`**. It starts a local server and opens the game. Leave its window open while you play, and close it to stop.

Anywhere else:

```
node server.mjs
```

Then open <http://127.0.0.1:4190>. If port 4190 is taken by another copy of the game, stop that copy first or set the `PORT` environment variable to another number.

For the separate, development-only engine and tire listening bench, open
<http://127.0.0.1:4190/audio-lab/>. See [the audio lab notes](AUDIO-LAB.md)
for controls, sample licenses, comparison limits and listening checks. The lab
is excluded from Pages and does not connect to the driving game.

The game plays recordings of the project owner's Mustang with a CC0 tire recording, and
falls back to a synthesized engine if the recordings can't load. See
[the gameplay audio notes](GAMEPLAY-AUDIO.md) for how to listen and how the sound
responds to the car. In Power, spinning rear wheels show as smoke and rubber and are heard in
the engine: see [the wheelspin notes](WHEELSPIN.md).

Press D in the game to see live slip angles, grip, drift qualification and checkpoint progress.

## Test

```
npm test
```

This runs the physics, scoring, lap, track, session, ghost, tutorial, controller, local records, gymkhana, audio, radio and publishing tests.

### Browser checks

The browser checks drive the game with real key presses (and mocked controllers) in Chromium and Firefox, served the same way as on GitHub Pages. They need Playwright, which the game itself doesn't depend on:

```
npm install --no-save --no-package-lock playwright@1.64.1
npx playwright install chromium firefox
npm run test:browser
```

To run `test:browser` against the live site, set `TEST_URL=https://libertaine.github.io/mini-drifters/` first. It also confirms the live files match your checkout.

Each script below runs in Chromium and Firefox, and CI runs all of them on every pull request. Several take a few minutes.

| Script | Checks |
|---|---|
| `npm run test:browser` | The game served as on Pages, driven with real key presses |
| `npm run test:audio:browser` | The development audio lab |
| `npm run test:coyote:browser` | The Coyote engine voice in the audio lab |
| `npm run test:gameplay-audio:browser` | Gameplay audio on the published files, and the fallback engine |
| `npm run test:ghost:browser` | The previous-lap ghost |
| `npm run test:radio:browser` | The radio |
| `npm run test:menus:browser` | The title screen and menus |
| `npm run test:tutorial:browser` | Plays the whole lesson with real key presses at each supported window size, and Return to Title |
| `npm run test:tracks:browser` | The track choice, and a lap of Switchback with real key presses |
| `npm run test:scoring:browser` | Voided-lap warnings and results |
| `npm run test:controller:browser` | Mocked Gamepad snapshots and controller menus. Physical hardware is not required |
| `npm run test:records:browser` | Per-track saving, reloads, qualification, storage failures and controller navigation |
| `npm run test:handling:browser` | Choosing handling by keyboard, mouse and controller, remembering the choice, the practice pad, the lesson staying on Classic, records kept apart by handling, and the migration of v0.2.0 records |
| `npm run test:gymkhana:browser` | The Gymkhana sheet by keyboard, mouse and controller; Precision 180, Linked Drift and One Drift driven to completed and failed results; retries, cone penalties, the challenges' own records, and that the circuit records are never written |
| `npm run test:dockyard-slalom:browser` | Three laps of Dockyard in Classic and Power, and Slalom Sprint to completed, penalised and failed results, by keyboard, mouse and controller. That the title and the Gymkhana sheet fit every supported window with fallback fonts, and that records saved by v0.4.0 are read and kept |
| `npm run test:getaway-records:browser` | Getaway personal bests in fresh profiles: first escape, improvement, lower escape, bust, reload, browser restart, separate environment and handling bests, corrupt/later-version/denied/full storage, untouched circuit, Gymkhana and ghost keys, and sheet fit at 1024×600, 1366×768 and 1920×1080 |
| `npm run test:environment:browser` | Functional scenery on all three circuits in both handling modes, Dockyard concrete/off-course behavior, obstacle collision messaging and debug outlines |
| `npm run test:wheelspin:browser` | Power and Classic on the practice pad and Power on Dockyard: that Power's wheelspin raises smoke, rubber and an engine flare, that the effects stay inside their limits, that pause, focus loss, restart, Sound Off and the title handle them correctly, and that Classic shows none of it. See [the wheelspin notes](WHEELSPIN.md) |

`test/scenery-browser.mjs` retains Dockyard's visual checks against the v0.5.0 R2 build (`259eb41`), plus unchanged title and Practice Pad frames. `test/scenery-r2-browser.mjs` compares the release to the environmental R1 prototype: Original/Switchback road and minimap identity, unchanged Dockyard/title/Practice Pad frames, both handling modes, console errors and frame costs. Both accept a reference-tree path after the Playwright path and run locally; the reference worktrees are not CI dependencies. See the historical [R1](ENVIRONMENT-R1.md) and [R2](ENVIRONMENT-R2.md) reports.

Screenshots and a report go to `artifacts/`, which isn't tracked.

### Pull requests and Pages

Changes reach `main` through a pull request, and the `test` check must pass before it can merge. Every push to `main`, including a documentation-only merge, runs the full check again and then redeploys GitHub Pages from `.github/workflows/ci.yml`. Pages publishes only the files the game needs: not the README, the docs, the tests or the audio lab page.

## Project layout

| Path | Contents |
|---|---|
| `src/tuning.js` | Every handling and scoring number, with comments |
| `src/physics.js` | The car |
| `src/handling.js` | The handling modes: each one a named, fixed set of car tuning |
| `src/handling-preferences.js` | Remembers the last chosen handling mode |
| `src/practice-pad.js` | The practice pad's surface and markers |
| `src/gymkhana.js`, `src/gymkhana-records.js` | The Gymkhana challenges, and their personal bests |
| `src/gymkhana-draw.js`, `src/gymkhana-ui.js` | Painting a challenge, and its sheet, HUD panel and results |
| `src/track.js`, `src/laps.js` | The three circuits and lap validation |
| `src/dockyard-scenery.js` | Dockyard's picture and shared solid-prop layout |
| `src/scenery.js`, `src/scenery-original.js`, `src/scenery-switchback.js`, `src/scenery-draw.js` | Original and Switchback layouts, shared solidity rules and rendering |
| `src/obstacles.js` | Static collision shapes and contact response for the three environments |
| `src/scoring.js` | Drift detection, the low-speed fade, combos and the scoring version |
| `src/records.js` | Local personal bests by track, handling and scoring version, run qualification, and reading the older records keys |
| `src/ghost.js` | Recording and replaying the previous valid lap |
| `src/game.js` | The session, on a fixed 120 Hz timestep |
| `src/tutorial.js` | The driving lesson. It watches a session and never writes to it |
| `src/tyre-effects.js` | What the tyres leave behind each frame: smoke and rubber, including Power's wheelspin |
| `src/render.js`, `src/main.js` | Drawing, input and the HUD |
| `src/controls.js`, `src/controller.js` | One driving-command shape for keyboard and controller, and the standard-mapped Gamepad reading |
| `src/audio.js`, `src/audio-telemetry.js` | Sound, and how the car's telemetry maps to it |
| `src/audio-voices.js`, `src/coyote.js`, `src/coyote-model.js` | Engine and tire voices, shared with the audio lab |
| `src/radio-stations.js`, `src/radio.js`, `src/audio-preferences.js` | Station and track data, music playback and saved sound settings |
| `radio/` | Radio audio and its attribution |
| `test/` | Automated tests and the scripted drivers they use |

## How the car works

The car is a lightweight two-axle model. Heading and velocity are separate, and slides come from tyre forces rather than animation.

- **Handbrake:** this lowers rear grip rather than rotating the car, so it does nothing to a car driving straight or parked.
- **Throttle in a slide:** once the rear has broken loose, throttle keeps it loose and lifting lets it hook back up. Throttle sets the angle, and steering sets the direction.
- **Countersteer:** steering toward a slide earns extra wheel angle, which lets the rear catch up.
- **Arcade help:** the front wheels trail the slide slightly, and a mild pull straightens the nose past 48° of slip unless the handbrake is held.
- **Power handling** (internal id `revised`) adds one thing: the rear tyres share a grip budget between driving and cornering, and asking for more throttle than they can take, below about 29 m/s, spins the wheels up gradually. Spinning wheels corner less well. Classic never enters this code.

## Tuning

These values in `src/tuning.js` have the most effect on feel. They are Classic's, and the other handling modes in `src/handling.js` start from them:

| Constant | Effect |
|---|---|
| `rearPowerSlideGrip` | The most important one. Lower makes drifts easier to keep but quicker to spin. Below about 0.64, even a 0.1 s tap becomes a full slide. Higher values make slides die sooner. |
| `handbrakeLateralGrip`, `handbrakeEngageRate` | How hard and how quickly the handbrake lets go of the rear |
| `driftRecovery` | How quickly rear grip returns on release |
| `yawDamping`, `yawInertia` | How eagerly the car rotates, and how quickly rotation settles |
| `counterSteerAuthority`, `casterAssist` | How forgiving catching a slide is |

Several tests check that drifts stay holdable and that controlled driving out-scores handbrake abuse, so run them after changing these. `test/handling.test.mjs` pins every handling mode's numbers, because records are only comparable while they hold: a change big enough to matter should get a new mode id, not new numbers under the old one.
