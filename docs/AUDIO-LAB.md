# Engine and tire audio laboratory

Run `node server.mjs`, then open http://127.0.0.1:4190/audio-lab/ . Click **Start
Audio**, choose a preset, and adjust the driving dials. Use the mode selector to
crossfade between A and B while retaining the same parameters and mix. Set engine
volume to zero to isolate tires, or tire volume to zero to isolate the engine.
The eight presets set driving parameters and road surface; the mix and mode are
preserved. Individual sliders remain adjustable. Preset values update immediately
on screen; audio targets ease toward them over roughly 0.4-0.9 seconds.

This is an independent listening bench. It never imports or mutates the game.
`src/physics.js`, `src/game.js`, `src/main.js`, `src/tuning.js`, controls, scoring,
track and the main HTML/CSS remain unchanged. The existing Pages assembly copies
only `index.html`, `style.css`, and `src/`, so the lab is excluded from production.
There is no game UI link and no runtime dependency or new build step.

## Architecture

| File | Responsibility |
|---|---|
| `audio-lab/model.js` | Unit bounds, defaults, presets, pure audio-target mapping |
| `audio-lab/voices.js` | Disposable procedural/sample graphs, smoothing and sample decode/seam processing |
| `audio-lab/audio.js` | One context/session, channel mix, A/B crossfade, mute, loading and cleanup |
| `audio-lab/lab.js` | Accessible controls, status and visibility lifecycle |
| `audio-lab/assets/ATTRIBUTION.md` | Source URLs, checked licenses, hashes and asset limitations |

The mapping uses lab RPM (750-7000), speed in mph (0-120), angle in degrees (0-90),
throttle (0-1), and rear grip (0.15-1). Engine pulse frequency is RPM/60 * 4, a
V8-inspired four-stroke firing rate used as an arcade synthesis dial. Throttle
changes intensity, filter openness and roughness separately from pitch. RPM is
not a drivetrain change, gear simulation or claim of mechanical accuracy.

Tires combine smooth speed, slip-angle and rear-grip-loss terms. Speed zero
maps to exactly zero intensity, even at maximum slip/grip loss. Normal straight
travel with full grip is silent. Grip loss contributes scrubbing independently
of angle. Grass reduces intensity and tonal squeal and lowers filter cutoff.
No scoring, drift qualification or handbrake boolean enters the mapping.

A uses four triangle/sawtooth engine layers, slow amplitude flutter, filtered
intake noise, and separate filtered-noise/tonal tire layers. B uses the two
recorded engine pitch variants and a provisional tire-foley excerpt. Engine
blend gains sum to one; rate and filtering change independently. Each sample
gets a short end/head overlap in an AudioBuffer, then native BufferSource looping;
there are no per-loop timers. The tire excerpt needs subjective seam assessment.

Both voices run while auditioning so the mode switch can crossfade immediately.
There are eight procedural sources and three sample sources after loading, no
AudioWorklet or ScriptProcessor, and no animation/audio polling loop. Fixed graph
size supports a small experiment; CPU performance has not been benchmarked on
low-power hardware. Noise has a private deterministic generator.

Parameter automation holds current values and approaches new targets, preventing
stacked ramps during fast slider movements. Master starts at 35%, with additional
output attenuation, conservative voice gains and a fast 12:1 compressor. Immediate
mute and Stop use the final output gate after the compressor. This deliberately
prioritizes immediate silence; Stop is not a slow musical fade. Unmute/start ramp
up. Perceptual loudness is not matched between A and B: use the mix while comparing.

`resume()` follows a click before fetches. Repeated Start reuses the active session.
Stop zeroes the output, aborts loads, stops/disconnects all sources and closes the
context. A stale resume/decode cannot attach to a restarted session. Hidden/pagehide
and context interruptions stop audio; resuming requires Start. Mute persists through
restart. Fetches time out after 12 seconds. Missing or corrupt recordings are reported;
missing layers stay silent. With one surviving engine recording, it spans the RPM
range. Sample mode never silently substitutes synthesis. Stop/Start retries loads.

## Comparison report

Objective design properties (not listening results):

| Dimension | A: procedural | B: sample-based hybrid |
|---|---|---|
| Sound source | Layered oscillators and noise | Recorded engine material and tire foley; provenance documented |
| Response | RPM, load, angle, grip and surface map directly to synthesis | Same inputs map to rate, blend, gain and filters |
| External assets | None | Three local recordings; around 1.3 MB total; no external requests at runtime |
| Range limitation | Harmonic model can become buzzy/tonal; no measured engine acoustics | One engine source at two pitches; no independently recorded high-load timbre; foley may repeat or contain gaps |
| Loop handling | Native oscillators and a repeated noise buffer | Native looping with 60 ms seam overlap; no subjective guarantee of inaudible repetition |
| Likely integration work | Read-only telemetry adapter, RPM approximation, lifecycle policy and tuning | Same adapter/lifecycle work plus better recordings, reference RPM, loop edits and loudness matching |

The current game exposes `car.speed` in m/s, throttle, signed body/axle slip in
radians, rear grip and surface (`road`, `curb`, `grass`). A future adapter would
copy those values, convert units, decide which axle slip to use and how to treat
curbs/reverse, and derive an audio-only RPM estimate. It must not write to the
simulation. Game pause/menu/focus policy and listening under actual maneuvers
remain separate future work. Neither approach is ready for production integration.

**Subjective listening:** not performed in this implementation session. Automated
browser rendering checks verify output, finite samples, conservative peak levels,
stationary-tire silence and response logic; they cannot establish muscle-car
character, tire realism, smoothness to the ear, loop artifacts or a quality winner.
There is no declared winner. B is a useful infrastructure/control comparison, but
its current asset limitations prevent a representative production-quality contest.

## Verification and listening worksheet

Automated commands:

```sh
npm test
npm run test:browser
npm run test:audio:browser
```

The browser scripts accept an optional absolute path to Playwright's `index.mjs`,
so an existing development-only install can be reused. Otherwise use the pinned
Playwright setup in README. CI runs both browser scripts. The lab check serves
through the actual development server and writes screenshots and render metrics
to ignored `artifacts/audio-lab-*` files. The game check continues to serve the
production-only file list. These are headless browser checks, not physical-device
testing, subjective listening, or an audio-device compatibility benchmark.

Local verification on Windows, 2026-11-06:

- 106/106 Node tests passed (94 existing plus 12 focused lab tests).
- Existing gameplay browser checks passed in Chromium 156 and Firefox 157.
- Lab browser checks passed in both, including missing/corrupt samples, resume
  and load cancellation, repeated starts/stops, mute, simulated visibility and
  desktop/320px layouts. Desktop and narrow screenshots were inspected.
- Each browser rendered 22 one-second test buffers. Maximum peaks before channel
  volume, master attenuation and compressor were 0.6842 (Chromium) and 0.6871
  (Firefox), including all dials at maximum; stationary isolated tires were zero
  in both modes. This is a bounded stress check, not a proof of all possible output.
- An initial mute assertion read `AudioParam.value` before the audio thread's next
  quantum and failed. The harness now waits for that update (one-second timeout).
  The full lab check passed after that harness correction; no listening claim is
  inferred from the diagnostic gate value.
- Git comparison confirmed no changes to `src/`, `index.html` or `style.css`.

Hosted CI evidence belongs to the draft PR; local checks alone do not establish it.

The first Ubuntu CI lab run passed Chromium but Firefox timed out awaiting the
real-time AudioContext on the container's device-less audio backend. On Linux,
the Firefox harness now requests Mozilla's test-only fake output devices via
`media.cubeb.force_mock_context`. Native Web Audio graph processing and the
OfflineAudioContext renders still run. This is emulated output, not a hardware
audio check; Windows keeps the normal backend. Failure snapshots are logged and
screenshotted. The preference is implemented in Mozilla's source:
https://github.com/mozilla-firefox/firefox/blob/main/dom/media/CubebUtils.cpp .

Human listening remains required; record browser, headphones/speakers, levels,
mode and impressions for each row:

| Audition | Listen for | Result |
|---|---|---|
| Idle, slow RPM sweep up/down | Deep idle, pitch continuity, return to idle | Not yet evaluated |
| Gentle vs hard throttle at fixed RPM | Load character without pitch jumps | Not yet evaluated |
| Drift initiation -> sustained -> recovery | Progressive onset and recovery, no volume cliff | Not yet evaluated |
| Speed zero, slip 90, grip 15% | Silent tire channel after the short recovery ramp | Not yet evaluated |
| Road vs grass with engine muted | Quieter/textured grass instead of piercing squeal | Not yet evaluated |
| Sample loops held 30+ seconds at several RPMs | Clicks, pumping, periodic gaps and recognizable repetition | Not yet evaluated |
| Mode switching at equal parameters | Character and loudness differences; adjust mix to compare fairly | Not yet evaluated |
| Fast slider edits, repeated Start/Stop/Mute, hide/return | No duplicate engines, leaked sound or unexpected auto-resume | Not yet evaluated |

Keep favorable impressions separate from the objective measurements above. Replace
individual voices or recordings through their existing interfaces before deciding
whether either approach belongs in the game.
