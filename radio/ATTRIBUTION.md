# Radio audio sources

**No final music is installed.** Every track below is a temporary test loop, there so the radio can be built and tested. None of them is finished content.

## Temporary test loops

These are synthesized from scratch by [`scripts/radio-test-tracks.mjs`](../scripts/radio-test-tracks.mjs). They contain no samples, no third-party audio and no melody taken from an existing work, as far as the author of the script knows. No one has checked them against existing music. They're under the repository's MIT License, like the script.

| File | SHA-256 | Station | Length | Size |
|---|---|---|---|---|
| test-tracks/garage-rock-test.wav | `a01d443ff813465b2ac089f65306769ad3ce097e6a03fb5783f8f05ffbda223a` | Garage Rock | 13.91 s | 613,610 bytes |
| test-tracks/synth-fm-test.wav | `c419bbfaa6abd7bcef0bab8afb6f782a7a28b77f8773274d1c2bf0be1be83eee` | Synth FM | 10.00 s | 441,044 bytes |
| test-tracks/redline-radio-test.wav | `b4f1056530b652061cd4f3c230836764384f28bf1bf7bff490389b658a184715` | Redline Radio | 10.91 s | 481,134 bytes |

## Final music

For each final track, add a row here with its file, hash, author, source, license and proof of permission, and add the track to `src/radio-stations.js` with its license and without `status: 'test'`. The steps are in [docs/RADIO.md](../docs/RADIO.md).
