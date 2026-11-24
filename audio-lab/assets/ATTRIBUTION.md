# Recorded audio sources

The repository's MIT license covers its code, not these recordings. This folder holds
two kinds of audio with different terms, summarized in LICENSE-AUDIO.md:

- **Mustang engine recordings**, owned by the Mini Drifters project owner. They are not
  CC0 and not MIT. See [the last section](#mustang-engine-recordings-not-cc0).
- **Third-party recordings** under CC0, in the sections before it. Their source and
  license pages were checked on 2026-11-06. They are redistributed unmodified, and all
  trimming, seam treatment, filtering and pitch changes happen in memory.

The game's public deployment includes `tire-foley.mp3`, `busted-voice.wav`, the four Mustang loops and this
file. The CC0 engine recordings below are used only by the development lab and aren't
deployed.

## Engine

- Work: Racing car engine sound loops
- Author/editor: domasx2
- Original source and license declaration:
  https://opengameart.org/content/racing-car-engine-sound-loops
- License: CC0 1.0 Universal Public Domain Dedication
  https://creativecommons.org/publicdomain/zero/1.0/
- `engine-low.wav`: original `loop_0.wav`
  https://opengameart.org/sites/default/files/loop_0.wav
- `engine-high.wav`: original `loop_5.wav` (download URL has `_0` suffix)
  https://opengameart.org/sites/default/files/loop_5_0.wav
- The uploader describes these as edits of a public-domain recording, formerly at
  http://www.pdsounds.org/sounds/start_up_car_with_seat_belt_warning_beep .
  That historical source has not been independently recovered here. The current
  OpenGameArt submission explicitly applies CC0 to its replacement loops. Its old
  comments discuss an earlier sample/license; the current description identifies
  the replacement public-domain source.
- Important limitation: these files differ in pitch only. They are recorded audio,
  but are **not independent idle and high-RPM/load recording sessions**. The lab's
  low/high names describe their playback roles, not measured recording RPM.
- Runtime changes: 60 ms linear seam overlap, peak attenuation if needed, pitch,
  low-pass filtering, dynamic gain and RPM crossfade.

## Tire foley

- Work: Tire squeal, sound number 500
- Author: Joseph SARDIN / BigSoundBank (LaSonotheque)
- Original source and per-asset CC0 declaration:
  https://bigsoundbank.com/tire-squeal-s0500.html
- Download:
  https://bigsoundbank.com/UPLOAD/mp3/0500.mp3
- Local file: `tire-foley.mp3`
- License: CC0 (public domain), confirmed by the asset page; license details:
  https://bigsoundbank.com/licenses.html
  https://creativecommons.org/publicdomain/zero/1.0/
- The author classifies this as studio foley: a 30-second collection of 17 tire
  screeches. **It is not a continuous recording of a real car sliding.**
- Runtime changes: excerpt from 0.3 to 2.5 seconds, 60 ms seam overlap, conservative
  normalization, playback-rate/gain changes and surface filtering. This is a
  provisional continuous playback experiment; gaps and repetition need listening.

## Busted announcer voice

- Work: Offline retro-arcade announcer callout ("BUSTED!")
- Local file: `busted-voice.wav` (24 kHz mono PCM16 WAV, 0.892 s, 42,886 bytes)
- Generator: Kokoro-82M v1.0 (`kokoro-v1.0.onnx` / `voices-v1.0.bin`, voice style blend `0.70 * am_santa + 0.30 * am_fenrir`), synthesized locally offline via `kokoro-onnx`
- Source model & license: https://huggingface.co/hexgrad/Kokoro-82M (Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0)
- Offline post-processing: `ffmpeg` formant-preserved pitch weight (`0.92`), broadcast EQ (`+4.8 dB @ 118 Hz`, `-3.2 dB @ 350 Hz`, `+4.5 dB @ 3.2 kHz`), compression, parallel soft-clip grit, custom dark plate reverb tail, and `-0.9 dBFS` peak normalization. No runtime TTS service or browser speech synthesis is used.

## Original-file SHA-256

| Local file | SHA-256 |
|---|---|
| engine-low.wav | `69d74b106509037ce547429e4c3f9ae906b0fffe88d0bb8b3b5a8b0cfc239048` |
| engine-high.wav | `e0c65476764931770e46308dec744a196d8ecf996f8c7675f125805d28609b34` |
| tire-foley.mp3 | `af16113a4a279ca8a87b41727684afba2840a7ff00e8e7ba6b3291e8fead01fa` |
| busted-voice.wav | `4f48470a2dce841a2b3a23394a1e1623c079b24314af79267f06359ddba60fd2` |

## Research exclusions and remaining asset needs

- OpenGameArt's Car tire squeal skid loop, by audible-edge (Tom Haigh), edited by
  qubodup, is **CC BY 3.0**, not CC0:
  https://opengameart.org/content/car-tire-squeal-skid-loop . It is not bundled.
- Freesound was searched, but no additional continuous CC0 tire loop was selected
  and verified. Search-result license summaries alone were not used to add assets.
- Still wanted for a stronger B comparison: an independently recorded muscle-car
  idle and steady high-RPM/load loop with known reference RPM, and a continuous
  real-tire squeal recording, each with a verified redistribution license.
- No commercial-game recordings or synthesized substitutes are labeled as samples.

## Mustang engine recordings (not CC0)

- Files: `coyote-local/idle.wav`, `mid.wav`, `load.wav` and `high.wav`, the game's
  Coyote Hybrid engine
- Source: dyno recording of the project owner's Mustang (`Mustang-Dyno.wav`)
- Rights: the Mini Drifters project owner ([libertaine](https://github.com/libertaine))
  owns all rights and authorizes their distribution with Mini Drifters
- License: **none beyond that.** The project's MIT license and the CC0 dedications above
  do not apply, and nothing here permits reuse apart from Mini Drifters

These are short processed loops, not the original recordings. Together they run for about
3.7 seconds of a 77-second master. The full masters and the in-car reference recording
are not published.

Processing: mono, filtered, reduced to 24 kHz and looped. `load` and `high` were also
resampled to hold one engine speed. They are not raw recordings of the engine at those
speeds. See [docs/COYOTE-PROVENANCE.json](../../docs/COYOTE-PROVENANCE.json) for source
timestamps and SHA-256 hashes of the masters and loops,
[docs/COYOTE-OSCILLATION.md](../../docs/COYOTE-OSCILLATION.md) for why they changed, and
[docs/COYOTE-AUDIO.md](../../docs/COYOTE-AUDIO.md) for the original analysis.
