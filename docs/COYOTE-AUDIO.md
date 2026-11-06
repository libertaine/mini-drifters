# Coyote Hybrid owner-audio experiment

The owner has since chosen this engine for the game: see
[GAMEPLAY-AUDIO.md](GAMEPLAY-AUDIO.md). Its code now lives in `src/coyote.js` and
`src/coyote-model.js`, shared with the lab. The notes below record the experiment.

**Superseded:** `load.wav` and `high.wav` were later reprocessed to remove a full-throttle
oscillation, and the `mid` anchor moved to 2736. See
[COYOTE-OSCILLATION.md](COYOTE-OSCILLATION.md). The tables below describe the first bank.

This extends draft PR #5 at unchanged baseline
9fe61ed5c43193671b2d97863fd4d5510c7b768f. Worktree:
D:/Projects/mini-drifters-coyote; branch: experiment/coyote-hybrid.
The original checkout and its two untracked masters were preserved. This is a
stacked draft for experiment/audio-lab, with no gameplay integration or deployment.

## Local audition

Requires Node 24. The actual read-only source directory supplied by the owner is
D:/Projects/mini-drifters/audio-lab/assets. No substitute recordings are downloaded.
From the Coyote worktree:

~~~powershell
node scripts/coyote-process.mjs --source D:/Projects/mini-drifters/audio-lab/assets
$env:PORT='4197'
node server.mjs
~~~

Open http://127.0.0.1:4197/audio-lab/ and click Start Audio. Select **C · Coyote
Hybrid**, click **Isolate engine**, and use the RPM/throttle sliders or the eight
unchanged presets. **RPM sweep up/down** traverses 750 -> 7000 -> 750 over 24 seconds;
click again to hold the current RPM. Editing RPM, selecting a preset, Stop, hiding
the tab, or pagehide cancels the sweep. Throttle remains independent. Mode changes
retain driving conditions and mix. For a controlled engine comparison, keep tires
muted; alternatively pin Tire voice to either existing implementation. Follow mode
retains A procedural / B recorded tires, and C uses B tires.

All four Coyote files are required. Missing/corrupt/incomplete banks report the
filenames and leave C's engine silent. A/B and tires remain available. Stop/Start
retries. A public checkout intentionally contains no Coyote recordings. Its tests
use explicitly labeled synthetic graph fixtures; these never become runtime fallbacks.

Optional separate perspective audition:
http://127.0.0.1:4197/audio-lab/assets/coyote-local/incar-reference.wav .
It is not loaded by the lab, so listen separately at a low volume.

## Rights and preservation

**Superseded:** the owner has since confirmed their rights and authorized distribution of
the four runtime loops with the game. See [LICENSE-AUDIO.md](../LICENSE-AUDIO.md). The
masters and the in-car reference stay unpublished. The text below records the experiment.

Owner-supplied does not establish public redistribution rights. Neither masters,
processed WAVs, waveform plots nor intermediate audio are committed. The project
MIT license does not grant rights to these recordings. Explicit public audio
redistribution permission remains outstanding; do not add derived audio to Git or
Pages before it is established. Existing B assets retain their separate CC0
provenance in audio-lab/assets/ATTRIBUTION.md.

Runtime outputs live in ignored audio-lab/assets/coyote-local/. Analysis,
scientific overview.svg and the detailed manifest live in ignored .local/coyote/.
The server allows only five named derived WAVs; masters, intermediates and arbitrary
files are not served. The original source directory is read only. Metadata and
hashes are in [COYOTE-PROVENANCE.json](COYOTE-PROVENANCE.json); no audio bytes are
embedded there. The explicit game-only Pages allowlist remains unchanged.

## Recording analysis

Both masters are stereo 48 kHz PCM16. Dyno: 77.368896 s, 14,854,906 bytes, RMS
0.21350, peak 0.999969. In-car: 12.949333 s, 2,486,350 bytes, RMS 0.14647,
peak 0.999969. Exactly 1 dyno and 3 in-car channel samples reach the integer
full-scale threshold. This detects digital full-scale samples, not proof of analog
clipping or an unclipped recording. Mono downmix channel correlation is 0.837 dyno
and 0.456 in-car; different perspectives and stereo ambience are material.

The reproducible analyzer measures half-second dynamics and full-rate 65,536-point
Hann spectra (1.365 s windows, 0.732 Hz bins), peak families and a five-harmonic
comb. The comb is an investigation aid with octave/subharmonic ambiguity, not an
RPM detector. The SVG plots waveform envelopes and a 0-1200 Hz spectrogram; the
JSON retains numeric peaks and competing periodicity candidates. The 1.365 s
spectra characterize surrounding regions, not precise stationarity within a
0.3 s high-RPM excerpt. Correlation-based seam alignment works on the short
waveform itself. No engine-off reference exists to establish a calibrated SNR;
room/dyno/mechanical noise cannot be reliably separated from engine harmonics.
No claim is made about absence of speech or other audible distractions without listening.

Observed regions:

| Region | Evidence and decision |
|---|---|
| Dyno 0-13 s | Large amplitude changes; 129-140 Hz and 260-280 Hz features coexist with roughly 58-70 Hz energy. The quiet opening is an idle-character candidate, not confirmed steady idle/RPM. Avoid later amplitude surges. |
| Dyno 17-35 s | The 21-22 s region is particularly steady: peaks near 68.1, 137.0, 182.4, 251.2, 273.9 Hz persist in adjacent spectra. Later material changes pitch and level. Use the steady portion for midrange. |
| Dyno 44-49 s | Drops in level, then rises into the pull; competing roughly 61 Hz and 142 Hz families. Not selected: a weaker and less clearly stationary alternative. |
| Dyno 49-56 s | Clear changing harmonic families, including roughly 165.5/442.4/662.8 Hz around 53.5 s shifting toward 171/684 Hz near 54 s. Use two short narrow-range windows, never the full sweep. Residual sweep remains possible. |
| Dyno 56-73 s | Harmonics fall continuously, so no deceleration loop is added. Static load reduction supplies the current lift-off behavior. |
| In-car 0-4 s | Changing broad low-frequency energy and pitch; not a stable idle source. |
| In-car 4-8.5 s | Best stability around 6.5-7.7 s: approximately 157.5, 210, 314.9, 419.7 and 524-525 Hz. Export one separate reference. |
| In-car 8.5-end | Transition and falling frequencies; not used for a second runtime layer. |

Four firing events per crank revolution imply firingHz = RPM/15. The strongest
peak need not be that firing rate. For example, the midrange family is consistent
with multiples of roughly 22.8 Hz; treating its strongest 137 Hz peak as firing
rate would give about 2055 RPM, while an eight-events-per-two-revolution harmonic
interpretation permits about 2740 RPM. These are ambiguous hypotheses, not measured
RPM. Likewise the in-car roughly 52.5 Hz spacing supports more than one order
interpretation. There is no tachometer synchronization. Playback anchors below
are explicit tuning assumptions; they must be checked by ear and preferably
against owner-provided tachometer/reference data.

## Candidate extraction and loop construction

All times refer to unchanged original source timestamps. Search adjusts the end
by at most +/-15 ms; metadata records both requested and actual boundaries.

| Output | Source | Start -> actual end (s) | Overlap | Result duration | Bytes | Tuning anchor |
|---|---|---|---|---|---|---|
| idle.wav | Mustang-Dyno.wav | 0.150 -> 1.262500 | 60 ms | 1.052500 s | 50,564 | 1100 RPM |
| mid.wav | Mustang-Dyno.wav | 21.000 -> 22.136333 | 40 ms | 1.096333 s | 52,668 | 2700 RPM |
| load.wav | Mustang-Dyno.wav | 50.150 -> 50.546958 | 25 ms | 0.371958 s | 17,898 | 4400 RPM |
| high.wav | Mustang-Dyno.wav | 53.600 -> 53.940167 | 25 ms | 0.315167 s | 15,172 | 6600 RPM |
| incar-reference.wav | Mustang-Dyno_alt.wav | 6.500 -> 7.703708 | 40 ms | 1.163708 s | 55,902 | Unassigned |

Recipe: mono downmix; first-order 35 Hz rumble/DC removal with 100 ms pre-roll;
65-tap windowed-sinc 9.5 kHz anti-alias lowpass; decimate to 24 kHz; normalized
waveform correlation search for end alignment; cubic overlap of tail/head and
removal of duplicated head; static RMS target 0.22, peak ceiling 0.75, boost cap
3x; round to mono PCM16 WAV. Filtering uses neighboring samples for filter state.
No denoising, pitch/time stretching, added sounds or clipping repair is applied.
The resulting WAVs are already loop-ready and bypass B's runtime seam processing.

Overlap correlations: idle 0.767, mid 0.930, load 0.420, high 0.466, in-car 0.771.
The lower high/load correlations expose residual sweep/noise; they do not prove
inaudible seams. The high loop's native adjacent-sample seam difference is 0.1383
versus maximum interior difference 0.4196. A seam within ordinary waveform variation
is an objective bound, not a guarantee against audible repetition or pitch resets.
Short 0.3-0.4 s pull windows may repeat conspicuously. These are candidates for listening.

Re-run the same processing command to reproduce outputs; --analyze-only stops
before extraction. Compare all SHA-256 values with COYOTE-PROVENANCE.json. The
script uses only Node built-ins, no runtime or offline package dependencies.

## Runtime design, loudness and payload

C uses four looping BufferSources with adjacent log-RPM cubic gain blends (weights
sum to one), rate smoothing 180 ms, gain/filter smoothing 120 ms, and 60 ms mode
crossfade time constants. Pitch ratios cap at 0.65-1.65; this intentionally limits
extreme stretching, with some pitch tracking compression where layers contribute
outside that span. Unverified anchors can still cause beating or timbre/pitch
mismatch. Throttle changes gain, lowpass openness and a conservative -3..+3 dB
high shelf without changing rates or RPM-region weights. The heavy-throttle
recording is the 4400-anchor region, not a separately layered perspective.
No procedural reinforcement is added: these recordings already contain substantial
harmonics. Speed controls the independent existing tires; no speed/gear-based engine
pitch is added because RPM is the independent bench input.

A/B voices are preserved. All ready sources run during audition for immediate
crossfades: 8 A + 3 B + 4 C = 15 sources; C adds 10 voice nodes plus one engine
bus. No per-loop timer, worklet, new runtime dependency or game-state import exists.
The sweep uses one cancellable 20 Hz UI timer only while active. Stop/mute retain
an immediate post-compressor gate; Stop aborts loads, invalidates stale callbacks,
stops/disconnects every source/node and closes the one AudioContext.

Four runtime WAVs total **136,302 bytes (133.1 KiB)**. Optional in-car reference
adds 55,902 bytes on disk but is never fetched by the lab. PCM16 WAV avoids codec
compatibility/loss and is small enough here; masters total 17,341,256 bytes and
are never fetched. Decoded Coyote mono buffers occupy 272,252 bytes at 24 kHz or
roughly twice that at a 48 kHz real-time context, excluding browser graph overhead.
Both banks load on Start, even while listening to A, to make switching immediate.
Local native fetch/decode was a few milliseconds on this desktop; this is not a
cold-cache mobile, network or subjective loading-delay benchmark. CPU has not
been profiled on low-power hardware.

Static engine-only loudness reference matching uses A=1.00, B=1.15 (+1.21 dB),
C=1.00. B's trim compensates its lower RMS across idle, gentle acceleration,
hard acceleration and sustained drift. C's mean level was already close to A;
it remains about 2.3 dB louder at idle and about 1.7-1.9 dB quieter during heavy
presets, depending on browser. There is no automatic gain riding or new limiter.
These unweighted RMS references do not establish equal perceived loudness across
different spectra. Manual engine/master levels remain available. The existing
compressor can also affect a loud comparison; use moderate output and compare
several conditions rather than favoring a louder transient.

## Technical comparison and open listening questions

| Mode | What the experiment establishes | Remaining weakness |
|---|---|---|
| A procedural | Immediate continuous control, no recorded payload | Synthesized harmonic character needs human assessment |
| B existing samples | Existing sample/lifecycle path preserved; static trim improves reference level alignment | Two pitches of one source, provisional tire foley |
| C Coyote | Actual owner recording decodes, responds across the full dial range and supports independent load changes | Unverified RPM anchors/idle state, dyno noise, short high/load loops and residual sweep; no proven realism |

The steady dyno midrange aligns best by waveform correlation. Short pull windows
are technically usable but align less well. The in-car reference is more stable
than most changing material but is kept out of the runtime bank to avoid an
unvalidated perspective blend. This is an engineering choice from the source
analysis, not a listening result. No winning implementation is declared. Further
recording of steady idle/mid/high RPM at known tachometer readings and multiple
loads would remove much of the uncertainty. Human evaluation must decide whether
these candidates are useful before any integration or publication proposal.

## Verification and listening worksheet

~~~sh
npm test
npm run test:browser
npm run test:audio:browser
npm run test:coyote:browser
~~~

All browser scripts accept an optional absolute Playwright index.mjs path. Set
COYOTE_REQUIRED=1 for local qualification that must decode owner audio. Public CI
has no owner assets: C remains explicitly unavailable in the UI and graph-only
offline tests use labeled synthetic sine buffers. Reports distinguish owner audio
from fixtures; no synthetic source is used for the runtime C mode.

The original Linux Firefox output-device limitation remains: on device-less Linux,
native resume can fail to advance, so tests verify bounded startup failure and
cleanup plus native offline decoding/rendering, with realtimeOutput:false.
Windows browsers run actual native real-time graph lifecycle checks, not human
listening or physical-device qualification. Firefox additionally lacks
OfflineAudioContext.suspend in the tested version, so timed offline sweep/load/mode
renders run in Chromium; Firefox still renders static and 30 s held tones and
checks real-time controls when audio output is available. Reports state this gap.

Record browser, output device and manual mix levels. Leave subjective entries
blank until a human listens:

| Test | Evaluate | A | B | C |
|---|---|---|---|---|
| Idle | Convincing V8; source idle candidate credible? | | | |
| Gentle acceleration | Natural pitch transition | | | |
| Hard acceleration / sustained drift | Power and heavy-throttle character | | | |
| Sustained RPM | Repetitive loops, beating, pitch reset | | | |
| Throttle release at fixed RPM | Natural fall in intensity without pitch jump | | | |
| High RPM | Engine character retained | | | |
| Mode switching with tires muted | Distracting loudness differences | | | |
| 30+ seconds per mode | Clicks, gaps or unnatural fluctuations | | | |

Objective qualification evidence is recorded in the draft PR and ignored
artifacts/coyote-report.json. Automated finite-output, peak, adjacent-sample and
lifecycle bounds cannot establish these subjective answers.
