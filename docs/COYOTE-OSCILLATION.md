# Full-throttle oscillation: diagnosis and fix

The owner reported that the Coyote engine had a distracting oscillation at sustained full throttle, while idle and drifting sounded good. This records what caused it, what changed and what the numbers can't tell us.

**Everything here measures the signal. Nobody has listened to the corrected engine yet**, so whether the oscillation is gone to the ear is still an open question. See [Listening checks](#listening-checks).

## Cause

The main cause is in the source loops, not the gameplay mapping. Each short pull loop contained part of a rising engine note. Every time a loop restarted, its pitch fell back, so the engine repeated a small sawtooth a few times a second.

| Hypothesis | Evidence | Verdict |
|---|---|---|
| Pitch sweep inside `load` and `high` | `load` swings 266 cents (more than two semitones) and `high` 34 cents. The strongest pitch modulation sits exactly at the loop repeat rate, with the harmonics a sawtooth produces | **Main cause** |
| Interference between adjacent layers | The `load` anchor was wrong, so at 5500 RPM the two layers played about 3.4 semitones apart. Correcting anchors alone lowers band modulation there (mid 3.85 to 2.64 dB, upper 4.16 to 2.95 dB) | **Real, but secondary** |
| Fluctuating RPM or throttle in gameplay | With the throttle held, RPM moves at most 35 RPM RMS around its trend, with no narrow peak above about 1 RPM, and load stays at 1.0 | **Ruled out** |
| The mix compressor (added check) | Level modulation is the same with and without it | **Ruled out** |

### Where the loops really sit

The first bank's anchors were labelled as estimates. The recording's half-order harmonics give a continuous track through the dyno pull, from about 3150 RPM at 50 s to 6900 RPM at 55 s, which reads as a tachometer:

| Loop | Anchor in the first bank | Measured source | Sweep inside the loop |
|---|---|---|---|
| `mid` | 2700 | 2736 | 9.5 cents, steady |
| `load` | 4400 | 3308 to 3783 | **14.4%** in 0.37 s |
| `high` | 6600 | 6391 to 6537 | 2.3% in 0.32 s |

This assumes the harmonic family is what it appears to be. It stays consistent across the whole pull, but no tachometer recording confirms it.

## Fix

The smallest change that addressed the source and the anchors:

1. **`load` and `high` are reprocessed from the same dyno pull.** Each is resampled against the measured crank speed so it holds one engine speed, then phase-locked and looped over a whole number of engine cycles. Slow level changes are flattened over 0.2 s. No random pitch, denoising or added sound.
2. **The loops are longer.** `load` goes from 0.37 s to 0.60 s and `high` from 0.32 s to 1.00 s, so they repeat less often: at normal speed `load` goes from 2.69 to 1.67 times a second and `high` from 3.17 to 1.
3. **Anchors now match the loops.** `load` is exactly 4400 and `high` exactly 6600, by construction. `mid` moves from 2700 to its measured 2736. Adjacent layers now play the same note at every RPM.

`idle.wav` and `mid.wav` are byte-identical to the first bank, because the owner accepted them. The gameplay mapping and tire code did not change. This fix doesn't rely on the gear shifting, which came later and works separately.

`scripts/coyote-process.mjs` reproduces all of this from the masters, which are read and never changed. The first bank is not published. It's kept for comparison in the ignored `.local/coyote/derived-v1/`, and its hashes are listed under `previousDerived` in [COYOTE-PROVENANCE.json](COYOTE-PROVENANCE.json).

## Before and after

Each row is 20 seconds at a fixed RPM and full throttle, rendered by the game's real voice and mix compressor in Chromium. `v1` is the first bank, and `v2` is this one. "Repeat-rate peak" is the size of the strongest periodic change.

Each cell reads `v1` → `v2`.

| RPM | Pitch swing, P1 to P99 (cents) | Strongest pitch peak | Level swing, P1 to P99 (dB) | Strongest level peak |
|---|---|---|---|---|
| 4400 | 266 → **11** | 73 cents at 2.69 Hz → 2 cents | 2.67 → 3.56 | 0.45 dB at 5.37 Hz → 0.60 dB at 1.67 Hz |
| 4700 | 266 → **11** | 73 cents at 2.87 Hz → 2 cents | 2.64 → 3.58 | 0.45 dB at 5.75 Hz → 0.64 dB at 1.78 Hz |
| 5500 | 37 → **9** | 11 cents at 2.65 Hz → 1 cent | 2.20 → 2.47 | 0.21 dB at 5.29 Hz → 0.35 dB at 2.09 Hz |
| 5700 | 36 → **9** | 12 cents at 2.73 Hz → 1 cent | 2.10 → 2.43 | 0.29 dB at 5.48 Hz → 0.23 dB at 1.72 Hz |
| 5900 | 35 → **7** | 12 cents at 2.83 Hz → 1 cent | 1.94 → 2.69 | 0.33 dB at 5.68 Hz → 0.26 dB at 1.78 Hz |
| 6600 | 34 → **8** | 12 cents at 3.17 Hz → 1 cent | 1.75 → 2.84 | 0.34 dB at 3.17 Hz → 0.33 dB at 1 Hz |

A third variant, `v1-anchored`, plays the first bank with corrected anchors. It leaves `load`'s 250+ cent swing in place, so only reprocessing removes it.

### What got worse or changed

- **Short-term level movement is wider.** The P1 to P99 level swing rose at every RPM. The longer loops include more of the recording's natural variation, and the strongest periodic level peak changed little except at 4400–5500 RPM.
- **`load` has a slow low-frequency pulse.** Around 4400 RPM the 80–300 Hz band moves 8.3 dB (P1 to P99), against 5.9 dB in `v1`, repeating at 1.67 Hz. Moving the seam barely changed it. The likely reason is that orders pass through fixed resonances during this fast part of the pull, but that isn't proven.
- **Seams are not perfectly coherent.** Overlap correlation is 0.25 on `load` and 0.29 on `high`, against 0.42 and 0.47 in `v1`, whose overlaps were much shorter (25 ms against about 160 ms).
- **Tone near drift RPM has changed.** At 5700 RPM third-octave bands above 1 kHz stay within about 1 dB. Below 500 Hz, individual bands moved by up to about 9 dB, because what were two detuned notes are now one. The overall level is about 0.5 dB lower. The owner liked the drift sound, so this is the main risk of the fix.

## Reproduce it

```powershell
node scripts/coyote-process.mjs --source D:/Projects/mini-drifters/audio-lab/assets
node scripts/coyote-oscillation.mjs <playwright index.mjs> `
  --bank v1=.local/coyote/derived-v1 `
  --bank v1-anchored=.local/coyote/derived-v1 --anchors v1-anchored=1100,2736,3550,6470 `
  --bank v2=audio-lab/assets/coyote-local `
  --master D:/Projects/mini-drifters/audio-lab/assets/Mustang-Dyno.wav
```

Results go to the ignored `.local/coyote/oscillation/`, which holds `report.json` and these captures for listening:

| Capture | Compare |
|---|---|
| `v1-fixed-5900.wav`, `v2-fixed-5900.wav` | Sustained full throttle near top speed |
| `v1-fixed-4400.wav`, `v2-fixed-4400.wav` | The worst case for the old loops, and the slow pulse in the new ones |
| `v1-gameplay-full-throttle.wav`, `v2-gameplay-full-throttle.wav` | A real full-throttle run, replayed through the voice |
| `v1-gameplay-drift-lap.wav`, `v2-gameplay-drift-lap.wav` | Whether the drift sound survived |

`v1-anchored-*.wav` isolates the effect of correcting anchors alone. All captures are engine only, without tires.

`test/coyote-oscillation.test.mjs` guards the result: pitch held across a repeat, whole engine cycles, and anchors that match what each loop actually plays.

## Listening checks

- At sustained full throttle, is the oscillation gone?
- Around 4400–4700 RPM, is there a slow pulse (about 1.7 times a second)?
- Does drifting still sound as good? It lost the slight doubling of two detuned notes.
- Is the engine now too high-pitched in the 3000–5000 RPM range? `load` used to sound about 19% lower than its label, and it now plays at its labelled speed.
