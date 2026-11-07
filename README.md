# Mini Drifters

A tiny top-down arcade drifting game for the browser. Race a small muscle car around a circuit, throw it sideways with the handbrake, and earn points for keeping it there.

## [▶ Play Mini Drifters](https://libertaine.github.io/mini-drifters/)

It runs in a desktop browser and needs a keyboard. There's nothing to install and no account to create.

## Status

**Early playable prototype.** Mini Drifters is here to find out whether the driving is fun, and it isn't feature-complete. There is one car, one track and simple engine and tire sound, and handling and scoring may change. See the [roadmap](docs/ROADMAP.md) for what might come next.

## Controls

| Key | Action |
|---|---|
| Up | Accelerate |
| Down | Brake, then reverse when nearly stopped |
| Left / Right | Steer |
| Space | Handbrake |
| R | Restart |
| P | Pause |
| G | Show or hide the ghost |
| N | Next radio station |
| O | Options, from the title, pause or results screen |
| D | Debug display |

Enter also starts a run from the title and results screens.

The **Sound** button under the score is the master switch for all sound, and remembers your choice. It works with the mouse, or with Tab and Enter.

**Options** has the radio station, music volume and sound effects volume, all remembered between visits. The radio is off by default. Its three stations currently play [temporary test loops](docs/RADIO.md), not finished music.

### How to drift

1. Steer into a corner and pull the handbrake for about a quarter of a second, until the tail steps out.
2. Stay on the throttle and steer the other way to hold the slide.
3. Lift off the throttle to straighten up.

The longer you pull, the bigger the slide. A very short tap only unsettles the car, and holding the handbrake spins it.

## Gameplay

**Sessions.** A run is three counted laps. The clock starts when you first press a pedal, and the end screen shows your score, best lap, total time, highest combo and spinouts.

**Drift scoring.** Sliding at speed on the road builds unbanked points. Bigger angles and higher speeds earn more, up to a point: the best angles are 25° to 50°, and hanging on to the handbrake earns much less than sliding under power. Only ground you haven't covered yet pays, so donuts and repeat passes earn nothing.

**Combos.** Keep drifting, link drifts within two seconds, or flick from one side to the other to climb the multiplier from ×1 through ×1.5 and ×2 to ×3. The multiplier applies to the whole combo when it's banked.

**Spinouts and penalties.** Straighten up and the combo banks into your score. If you spin past 75°, hit the wall hard, stay on the grass for more than 1.5 seconds or stop making progress, you lose the unbanked combo. Points you've already banked are safe.

**Ghost.** After your first valid lap, a translucent blue car replays your previous valid lap so you can race it. It can't touch you and doesn't affect your score or lap times, and G hides it. A restart clears it. This is an experiment: see [the ghost notes](docs/GHOST.md).

**Lap timing.** A lap counts only if you pass every checkpoint in order. Cutting across the grass voids that lap, and timing restarts at the finish line so you never have to turn back. Your best valid lap is kept for the run. Running wide on the outside of a corner costs time but doesn't void the lap.

## Development

The game is plain HTML, CSS and JavaScript on a Canvas, with no build step and no runtime dependencies. You need [Node.js](https://nodejs.org/) 22 or newer to run the local server and tests. CI uses Node 24.

### Run locally

On Windows, double-click **`Start Game.cmd`**. It starts a local server and opens the game. Leave its window open while you play, and close it to stop.

Anywhere else:

```
node server.mjs
```

Then open <http://127.0.0.1:4190>.

For the separate, development-only engine and tire listening bench, open
<http://127.0.0.1:4190/audio-lab/>. See [the audio lab notes](docs/AUDIO-LAB.md)
for controls, sample licenses, comparison limits and listening checks. The lab
is excluded from Pages and does not connect to the driving game.

The game plays recordings of the project owner's Mustang with a CC0 tire recording, and
falls back to a synthesized engine if the recordings can't load. See
[the gameplay audio notes](docs/GAMEPLAY-AUDIO.md) for how to listen and how the sound
responds to the car.

### Test

```
npm test
```

This runs the physics, scoring, lap, session, ghost, audio and publishing tests.

The browser check drives the game with real key presses in Chromium and Firefox, served the same way as on GitHub Pages. It needs Playwright, which the game itself doesn't depend on:

```
npm install --no-save --no-package-lock playwright@1.64.1
npx playwright install chromium firefox
npm run test:browser
```

To run the same check against the live site, set `TEST_URL=https://libertaine.github.io/mini-drifters/` first. It also confirms the live files match your checkout.

Screenshots and a report go to `artifacts/`, which isn't tracked.

Changes reach `main` through a pull request, and the `test` check must pass before it can merge.

### Project layout

| Path | Contents |
|---|---|
| `src/tuning.js` | Every handling and scoring number, with comments |
| `src/physics.js` | The car |
| `src/track.js`, `src/laps.js` | The circuit and lap validation |
| `src/scoring.js` | Drift detection and combos |
| `src/ghost.js` | Recording and replaying the previous valid lap |
| `src/game.js` | The session, on a fixed 120 Hz timestep |
| `src/render.js`, `src/main.js` | Drawing, input and the HUD |
| `src/audio.js`, `src/audio-telemetry.js` | Sound, and how the car's telemetry maps to it |
| `src/audio-voices.js`, `src/coyote.js`, `src/coyote-model.js` | Engine and tire voices, shared with the audio lab |
| `src/radio-stations.js`, `src/radio.js`, `src/audio-preferences.js` | Station and track data, music playback and saved sound settings |
| `radio/` | Radio audio and its attribution |
| `test/` | Automated tests and the scripted drivers they use |

Press D in the game to see live slip angles, grip, drift qualification and checkpoint progress.

### How the car works

The car is a lightweight two-axle model. Heading and velocity are separate, and slides come from tyre forces rather than animation.

- **Handbrake:** this lowers rear grip rather than rotating the car, so it does nothing to a car driving straight or parked.
- **Throttle in a slide:** once the rear has broken loose, throttle keeps it loose and lifting lets it hook back up. Throttle sets the angle, and steering sets the direction.
- **Countersteer:** steering toward a slide earns extra wheel angle, which lets the rear catch up.
- **Arcade help:** the front wheels trail the slide slightly, and a mild pull straightens the nose past 48° of slip unless the handbrake is held.

### Tuning

These values in `src/tuning.js` have the most effect on feel:

| Constant | Effect |
|---|---|
| `rearPowerSlideGrip` | The most important one. Lower makes drifts easier to keep but quicker to spin. Below about 0.64, even a 0.1 s tap becomes a full slide. Higher values make slides die sooner. |
| `handbrakeLateralGrip`, `handbrakeEngageRate` | How hard and how quickly the handbrake lets go of the rear |
| `driftRecovery` | How quickly rear grip returns on release |
| `yawDamping`, `yawInertia` | How eagerly the car rotates, and how quickly rotation settles |
| `counterSteerAuthority`, `casterAssist` | How forgiving catching a slide is |

Several tests check that drifts stay holdable and that controlled driving out-scores handbrake abuse, so run them after changing these.

## Known limitations

- Grass affects the whole car at once, based on its centre, so there's no two-wheels-off behaviour.
- The only barrier is a simple perimeter wall.
- Fishtailing down a straight still scores. It costs speed, but it isn't prevented.
- A careful driver can occasionally slide by accident and score, and a bad drifting run can score less than a good reckless one.
- Drifting is slower than grip driving in the scripted test runs, so points and lap time pull in different directions.
- It's keyboard and desktop only, and scores aren't saved.

## License

The code is [MIT](LICENSE). The audio recordings aren't: see [LICENSE-AUDIO.md](LICENSE-AUDIO.md).
In particular, the Mustang engine recordings are owned by the project owner, distributed
with Mini Drifters by permission, and not licensed for other uses.
