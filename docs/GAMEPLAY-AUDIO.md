# Gameplay audio

The owner listened to all three lab engines and chose **Coyote Hybrid**. This work connects it, and the existing sampled tire effect, to actual driving.

**Nobody has listened to this while driving yet.** Automated checks show that signal reaches the output, that RPM and tire values move as designed, and that silence is silent. They can't show that it sounds good. Whether it does is what the [driving worksheet](GAMEPLAY-AUDIO-WORKSHEET.md) is for.

## Listen to it locally

You need Node 24 and the four private Coyote loops in `audio-lab/assets/coyote-local/`. A public checkout doesn't have them. To generate them, from the repository root:

```powershell
node scripts/coyote-process.mjs --source D:/Projects/mini-drifters/audio-lab/assets
$env:PORT='4198'
node server.mjs
```

Open <http://127.0.0.1:4198/>, press Enter and drive. Hover over the Sound button to see which engine is playing:

| Tooltip | Engine |
|---|---|
| Engine: Coyote Hybrid (local recordings) | The owner's recordings |
| Engine: synthesized fallback (not a recording) | The public fallback, or a missing or damaged Coyote bank |

To hear what a public visitor would get, set `$env:COYOTE_LOCAL='off'` before starting the server.

## How it fits together

| File | Job |
|---|---|
| `src/audio-telemetry.js` | Pure mapping from car telemetry to RPM, load and tire values, plus all the audio tuning |
| `src/audio.js` | One AudioContext, one engine voice, one tire voice, lifecycle, mute and failure handling |
| `src/audio-voices.js` | Web Audio voices shared with the lab |
| `src/coyote.js`, `src/coyote-model.js` | The Coyote voice and its mapping, shared with the lab |
| `src/main.js` | Calls the controller from gestures, focus changes and each rendered frame |

Audio only reads the game. `readTelemetry` copies ten values from the car, and the controller otherwise looks only at `game.state` and `game.paused`. No audio module imports the simulation or its tuning, and the simulation doesn't know audio exists.

A run builds 5 sources with Coyote (4 engine layers and 1 tire loop) or 7 with the fallback (6 engine and 1 tire). The lab builds 15. Parameter updates reach the audio graph at most 30 times a second, and only when a value has changed, so a steady idle schedules nothing.

## Engine RPM

The car has no gearbox, so RPM is an audio-only estimate in the lab's 750–7000 range:

```
target = coast curve (speed) + throttle flare + wheelspin flare
```

- **Coast curve:** rises from 750 to 5000 at 42 m/s (about 94 mph), climbing fastest at low speed.
- **Throttle flare:** adds 2000 RPM at a standstill, shrinking to 900 at top speed. RPM therefore rises at launch before the car has much speed, and drops when you lift.
- **Wheelspin flare:** adds up to 1400 RPM with throttle and rear slip. It stops the pitch sagging in a power drift when the car scrubs off speed.
- **Reverse:** uses its own line, with a ceiling of 2850 RPM.

RPM then eases toward the target (0.11 s rising, 0.34 s falling) with a rate limit (5500 and 3000 RPM per second), so it can't jump. Throttle is smoothed separately and sets the engine's character through gain and brightness, without changing pitch. The Coyote mapping limits playback rate to 0.65–1.65.

All of these numbers are starting estimates in `AUDIO_TUNING`, apart from the driving physics. Here's how the model compares with the lab presets, using each preset's speed, throttle and slip:

| Lab preset | Preset RPM | Model RPM | Model tire target |
|---|---|---|---|
| Idle | 750 | 750 | 0.00 |
| Gentle acceleration | 2200 | 2642 | 0.00 |
| Hard acceleration | 5200 | 4589 | 0.03 |
| High-speed cruising | 3800 | 5225 | 0.00 |
| Drift initiation | 4300 | 4758 | 0.70 |
| Sustained power drift | 5600 | 6232 | 0.99 |
| Drift recovery | 2800 | 3120 | 0.06 |
| Spinout | 6200 | 4978 | 0.81 |

The two largest gaps are deliberate. A single speed curve can't both cruise at 3800 RPM and pull hard at the same speed, because that takes gears, and gears are out of scope. A spinout loses speed quickly, so its RPM falls with it. Listen for both.

In scripted driving, the drift driver's held power drifts averaged about 5700 RPM and sagged no more than about 230 RPM.

## Tires

Tire level comes from physical slip and speed. It doesn't read the handbrake key or the score, so a slide that earns no points still sounds like a slide.

| Situation | Level |
|---|---|
| At or below 0.5 m/s | Exactly 0, whatever the slip reads |
| Straight line | 0, even with the rear loosened by the handbrake |
| Ordinary cornering | Up to about 0.14 of scrub |
| Rear slip from 6° to 30° | Rises progressively to full |
| Lower speed | Scales down to 60% of the level at 30 m/s and above |
| Grass | 0.32 of the level, with a much darker filter and slightly lower pitch |

In scripted driving, tire level averaged about 0.005 on straights, 0.12 in grip cornering and 0.81 in held power drifts. It's one continuous loop that changes level, never a retriggered sample.

The tire loop is a 2.2-second excerpt of studio foley, not a recording of a real car sliding, so repetition may be audible. The lab notes already flag this.

## Lifecycle

| State | Sound |
|---|---|
| Menu | Silent, with no AudioContext created |
| Ready | Idle engine |
| Racing | Dynamic engine and tires |
| Paused, muted, focus lost or tab hidden | Gone within about 50 ms, then the context suspends |
| Focus returns | Stays silent, because the game is still paused |
| Finished | Tires fall to silence and the engine fades over about 1.5 s, then the context suspends |
| Restart | Brief 0.35 s gap, then idle from the same graph |

The AudioContext is created or resumed only inside a gesture: Enter, the Start button, R, P or the Sound button. Focus and visibility changes call the controller directly, because animation frames stop in a hidden tab.

If sound fails, the button says **Sound Unavailable** and the game carries on. That covers a browser with no Web Audio, a refused context, a refused or hung output (with an 8 s deadline) and a closed context. Clicking the button or starting a new run tries again. A missing tire file leaves the engine playing, and a missing or damaged Coyote layer switches to the fallback engine.

## Sound control

The **Sound On / Sound Off** button sits under the score. The choice is saved in `localStorage` where that's available, and it defaults to on.

- **Mouse:** a click hands the keyboard straight back to the car.
- **Keyboard:** Tab to the button, then press Enter. Space also works, except while driving, when Space is always the handbrake.

## Private recordings and public hosting

The Coyote recordings stay private until redistribution rights are confirmed:

- The masters and processed loops are not committed. `.gitignore`, the shared `info/exclude` and a test all guard this.
- No audio bytes are embedded in any tracked file.
- `server.mjs` adds a `<meta name="mini-drifters-engine">` tag to the page only when all four loops exist on disk. Without that tag the game never requests them, so public hosting produces no 404s and no sign of them.
- The server still serves only its explicit list of files.

The public build uses the synthesized engine and the CC0 tire recording. Its button never calls that engine a recording or Coyote.

### What this adds to the public site

When this work eventually reaches `main`, the deploy job adds two files to the site: `audio-lab/assets/tire-foley.mp3` and `audio-lab/assets/ATTRIBUTION.md`. The tire file is the unmodified CC0 original by Joseph SARDIN / BigSoundBank, 1.19 MB. Visitors download it only when they start a run. The rest of the lab isn't deployed.

### Publishing Coyote later

**Don't do any of this until the owner has confirmed redistribution rights.** MIT and CC0 don't cover these recordings. Once rights are confirmed, make these changes in a dedicated pull request:

1. Record the permission and its scope in `audio-lab/assets/ATTRIBUTION.md`, and update `rights` in `docs/COYOTE-PROVENANCE.json`.
2. In `.gitignore`, replace `audio-lab/assets/coyote-local/` with `audio-lab/assets/coyote-local/incar-reference.wav`. Keep the `.local/` and `Mustang-Dyno*.wav` lines.
3. Commit exactly `idle.wav`, `mid.wav`, `load.wav` and `high.wav`, after checking their SHA-256 against the provenance file.
4. In the "Assemble the site" step of `.github/workflows/ci.yml`, add:
   ```sh
   mkdir -p _site/audio-lab/assets/coyote-local
   cp audio-lab/assets/coyote-local/idle.wav audio-lab/assets/coyote-local/mid.wav audio-lab/assets/coyote-local/load.wav audio-lab/assets/coyote-local/high.wav _site/audio-lab/assets/coyote-local/
   ```
5. In `index.html`, add `<meta name="mini-drifters-engine" content="coyote-local">` to the `<head>`. Remove the injection from `server.mjs`.
6. In `src/main.js`, change the tooltip wording, which currently says "local recordings".
7. Update the tests that enforce today's rule:
   - In `test/publish.test.mjs`, the deploy copy list, the tracked-audio list, the no-`.wav` check and the "never carries the tag" check.
   - In `test/browser-check.mjs` and `test/gameplay-audio-browser.mjs`, `siteFiles`.
   - The public pass in `test/gameplay-audio-browser.mjs`, which currently expects `fallback`.
8. Merging to `main` deploys. Afterwards, check the live site with `TEST_URL=https://libertaine.github.io/mini-drifters/ npm run test:browser`.

## Testing

| Command | Covers |
|---|---|
| `npm test` | Telemetry, lifecycle against a fake graph, determinism with and without audio, publishing rules |
| `npm run test:browser` | The original gameplay check, on exactly the published files |
| `npm run test:gameplay-audio:browser` | Real key presses and real Web Audio, measuring output level |
| `npm run test:audio:browser`, `npm run test:coyote:browser` | The lab |

`test:gameplay-audio:browser` reports each pass separately:

| Pass | Files | What it proves |
|---|---|---|
| `public` | Exactly what Pages publishes | The fallback lifecycle, and that Coyote is never requested |
| `fixture` | Synthetic sine WAVs, clearly labelled | The Coyote code path, in public CI too. **Not** authentic audio |
| `failures`, `coyote-failures` | Injected failures | Every failure leaves the game drivable |
| `owner` | The real local server and private loops | Authentic decoding and playback, verified against the provenance hashes |

Set `COYOTE_REQUIRED=1` to fail when the `owner` pass can't run. Hosted CI has no private recordings, says so in its log and never qualifies authentic audio.

### Limits of this coverage

- Measured output level shows that signal reached the Web Audio destination. It doesn't show that any speaker played it, or how it sounded.
- Device-less Linux Firefox keeps its documented limit. There, native `resume()` never settles, so CI verifies the bounded failure path and that the game stays drivable. It doesn't verify real-time playback on Linux.
- Firefox has no `cancelAndHoldAtTime`, so `smooth()` falls back to reading `param.value`. A real-time probe at the game's 30 Hz update rate showed Firefox 157 glides matching Chromium 156. This was a one-off measurement and isn't in the test suite.
- CPU use hasn't been profiled on low-power hardware. Headless frame rate while sliding stayed above 60 fps on the desktop used for testing.

## Open questions for listening

- Is the master level right? It's about 5 dB above the lab's bench level, which measured a quiet -30 dBFS RMS while driving. Set it with `masterLevel`.
- Do the short `load` and `high` loops (0.37 s and 0.32 s) repeat audibly at the RPM where the car spends much of its time? The median while racing is about 4700 RPM.
- Is the engine too high-pitched overall without gears?
- Does the foley tire loop hold up during a long drift?
