# Radio

The radio has three music stations and Radio Off. It plays locally bundled files, with no streaming and no external services.

## Status

| Part | Status |
|---|---|
| Radio functionality | Complete |
| Built-in music | Provisional and replaceable. Each station plays one loop, synthesized by `scripts/radio-test-tracks.mjs`, and Options describes it as provisional |
| A better soundtrack | Optional follow-up, not a requirement |

The owner approved shipping the loops as they are. A listening review is deferred, so neither the music's quality nor its level against the engine has been judged by ear.

## Using it

| Control | Where | Effect |
|---|---|---|
| **N** | Anywhere except inside Options | Next station, including Radio Off, without touching the race |
| **O** or the Options button | Title, pause and results screens | Opens Options. **O** or **Esc** closes it |
| Sound button | Always visible | Master mute for music and effects |

Options has the station, Music Volume and Sound Effects Volume. The current station also shows quietly under the ghost status while driving.

The radio is **off by default**, and a player's saved choice always wins. `DEFAULT_STATION` in `src/radio-stations.js` sets the default.

## How it behaves

- **Across screens:** the track carries on through the title, driving, restarts, pause and results. Only changing station starts a different track.
- **Changing station:** the old track fades out over 0.35 s, and the new one fades in over 0.6 s after that, so they never overlap. Changing again partway through abandons the one that hadn't started.
- **Radio Off:** fades the music out and leaves engine and tire sounds alone.
- **Pause:** stops the engine and tires as before, but the radio keeps playing.
- **Finishing:** fades the engine and tires as before, but the radio keeps playing.
- **Losing focus or hiding the tab:** silences everything at once. The radio comes back when the page does, from where it stopped, while the engine waits for the game to be unpaused.
- **Autoplay:** nothing is created until the player does something. A saved station starts at the first key or click.
- **Failures:** a missing or damaged track tries the station's next track. If none load, the display says Unavailable and the game carries on with its effects. Selecting the station again retries it.

## How it fits together

| File | Job |
|---|---|
| `src/radio-stations.js` | Station and track data. The interface and the player read everything from here |
| `src/radio.js` | `RadioPlayer`: one track at a time, fades, track order and load failures |
| `src/audio-preferences.js` | Saved settings, and how a volume percentage becomes a gain |
| `src/audio.js` | `GameAudio` is still the only audio manager, and owns the context and the buses |
| `src/main.js` | Options, the driving display and the keys |

```
engine, tires -> compressor -> master -> gate -> effects volume -> output
radio track   -> fade -> music volume -> music gate --------------^
```

Each volume is on its own path, so neither can change the other. Mute closes both gates and leaves the settings alone, so unmuting restores them. Effects at 100% are exactly the mix that existed before this feature.

`MUSIC_LEVEL` in `src/radio.js` sets the music bus at 100%. It's set from measured output levels on the built-in loops, so that music at 100% is about level with the engine and the default 70% is 4 to 5 dB under it. Replacement music may need it revisited.

Settings are saved in `localStorage`: `mini-drifters-sound` is the existing mute choice and `mini-drifters-audio` holds the rest. Invalid saved values fall back to the defaults.

Tracks are decoded whole, like the game's other sounds, and the player keeps the last two decoded in memory. This keeps fades exact and means a suspended context really does stop the music. The cost is memory: a three-minute stereo track takes about 64 MB once decoded.

## Replacing the music

This is optional, and needs new track files and data, not changes to the radio itself.

1. Confirm the track is original, licensed or explicitly approved for this project.
2. Put it in `radio/<station-id>/`, with a lower-case name using only letters, digits and hyphens, as `.mp3` or `.wav`. MP3 at 128 kbps or less keeps files reasonable, but its encoder padding leaves a small gap if a single track loops.
3. Add it to the station's `tracks` in `src/radio-stations.js`, with a `license`, and without `status: 'provisional'` once a track is meant to stay. A station with one track loops it. A station with several plays them in order, and moves on when one ends.
4. Add a row with its hash and source to `radio/ATTRIBUTION.md`.
5. Remove any loop it replaces, including its entry and row. `test/publish.test.mjs` fails if the folder, the station list and the attribution disagree.

To regenerate the built-in loops, run `node scripts/radio-test-tracks.mjs`.

## Testing

`test/radio.test.mjs` covers the player and settings against a fake audio graph. `npm run test:radio:browser` uses real Web Audio in Chromium and Firefox, and measures signal or silence at the output. Set `TEST_URL` to run it against a deployed site. Neither one can say whether anything sounds good.

## Possible later work

None of this is needed for the radio to be complete:

- Better music, and a listening check of the balance against the engine.
- Moving the Options entry into the title screen and menu design when that work happens.
