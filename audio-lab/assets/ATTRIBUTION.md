# Recorded audio sources

These recordings are third-party assets under CC0, separately from the repository's
MIT code. Source/license pages were checked on 2026-11-06. Files are redistributed
unmodified; all trimming, seam treatment, filtering and pitch changes happen in memory.

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

## Original-file SHA-256

| Local file | SHA-256 |
|---|---|
| engine-low.wav | `69d74b106509037ce547429e4c3f9ae906b0fffe88d0bb8b3b5a8b0cfc239048` |
| engine-high.wav | `e0c65476764931770e46308dec744a196d8ecf996f8c7675f125805d28609b34` |
| tire-foley.mp3 | `af16113a4a279ca8a87b41727684afba2840a7ff00e8e7ba6b3291e8fead01fa` |

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

## Coyote Hybrid owner audio (local only)

Mustang-Dyno.wav and Mustang-Dyno_alt.wav were supplied by the owner. Public
redistribution rights are unconfirmed; the project MIT license and the CC0
licenses above do not cover these recordings. Masters and derived WAVs remain
out of Git. See docs/COYOTE-AUDIO.md and docs/COYOTE-PROVENANCE.json for source
timestamps, processing, SHA-256 hashes, limitations and local generation.
