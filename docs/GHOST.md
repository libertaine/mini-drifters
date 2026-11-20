# The previous-lap ghost

A prototype to find out whether racing your own last lap makes repeat laps more fun. On each lap after your first valid one, a translucent blue car replays your previous valid lap. It can't touch you, and it doesn't affect your score or lap times.

It's an experiment. The question is in the [playtesting checklist](#playtesting-checklist), and the feature only earns its place if the answer is yes.

## Try it

1. On Windows, double-click **`Start Game.cmd`** in this checkout. Elsewhere, run `node server.mjs` and open <http://127.0.0.1:4190>.
2. Press Enter, then drive a clean first lap. There's no ghost yet.
3. Cross the line. The ghost fades in as your second lap starts, and a blue dot joins the minimap.
4. Press **G** at any time during a run to hide or show the ghost. The small tag under the Sound button shows the current setting.

Port 4190 may already be in use if another copy of the game is running. Stop that copy first, or set the `PORT` environment variable to another number.

## How it behaves

| Situation | What the ghost does |
|---|---|
| First lap | Nothing to show |
| After a valid lap | Replays that lap from the moment you cross the line |
| After a voided lap | Keeps the last valid recording, and restarts it at the line with you |
| First attempt voided | Still no ghost, until a lap counts |
| You're slower than it | It reaches the line, fades out over half a second and stays gone until your next lap |
| Pause | Freezes with the game |
| Restart, or a new run | The ghost is cleared. The G setting stays until the page reloads |
| Run finished | Hidden |
| Try It lesson | Not recorded at all. The G key does nothing there, so the setting carries through unchanged |
| It overlaps your car | Drawn underneath, and thins out within 9 m so your car stays clear |

It leaves no skid marks or smoke, makes no sound and has no collisions.

## Laps that don't line up

The ghost plays back exactly what happened, measured from where the official lap timer starts. Lap timing wasn't changed to make it line up, so the first lap's recording differs from the later ones in two ways:

- **It starts at rest.** The timer starts on your first pedal press, so that recording begins with a standing start, while you cross the line at speed on lap 2.
- **It starts 6 m ahead.** The grid is 6 m past the line, so the ghost appears there at the moment you cross the line.

In practice you'll usually pull ahead of the first ghost straight away. A lap 3 ghost is the fair race, because both laps are flying laps measured from the line. A voided first attempt has the same benefit: the next valid lap is timed from the line.

A lap on which you roll backward over the line and return, with nothing else done, isn't a new lap under the existing rules, and the recording carries on through it too.

The gap can still be large on a flying lap. In the scripted test drivers, the car and the ghost were typically 30 to 90 m apart, which is close to the edge of the screen. The minimap dot is there so you can still tell where the ghost is. Human gaps haven't been measured yet.

## How it works

The code is in `src/ghost.js`, with small hooks in `src/game.js`, `src/render.js` and `src/main.js`.

- **Recording.** The session passes the ghost module plain numbers after each racing tick: position, heading and what `updateLaps` returned. It keeps a pose every 4 ticks (30 per second at the 120 Hz simulation rate), plus one on the exact tick of the line crossing.
- **The clock.** Time is an integer count of simulation ticks, reset on the same events as the lap timer. Browser timestamps aren't involved, so pausing and frame rate can't affect it, and a recording lasts exactly as long as its official lap time.
- **Playback.** The player's car is drawn between its last two simulation steps, so the ghost is sampled at that same moment. Position is interpolated linearly, and heading takes the shortest way round.
- **Isolation.** Nothing in the simulation reads from the ghost. `physics.js`, `scoring.js`, `laps.js`, `track.js`, `tuning.js` and the audio files are unchanged, and a test confirms they don't mention it. G only changes whether the ghost is drawn, so recording carries on while it's hidden.
- **Drawing.** The car's artwork is painted once into an off-screen image in the ghost's colours, then drawn with one call per frame. Using one image also stops the translucent layers showing through each other.
- **Memory.** Recordings live in memory and are lost on restart or reload. A lap of about a minute takes around 1,800 samples. A lap over 15 minutes isn't kept, and the previous ghost stays.

### Recording format

```js
{
  format: 1,            // this layout
  track: 'ab12cd34',    // fingerprint of the circuit's geometry
  rules: '56ef78ab',    // fingerprint of the tuning the lap was driven with (its handling mode)
  tickRate: 120,
  sampleEvery: 4,       // ticks between samples
  durationTicks: 5768,  // the lap's length
  ticks: [], x: [], y: [], heading: [],  // the poses, in matching order
}
```

A ghost whose format, track, rules or tick rate doesn't match the running game isn't shown.

From v0.3.0, `rules` is the fingerprint of the handling mode's tuning (`src/handling.js`),
which holds every rule as well as the car's physics. Classic's tuning is the shipped
`tuning.js` object, so a Classic ghost is byte-for-byte what v0.2.0 recorded, and a lap
driven in one handling mode is never shown in another. A new run, including a mode
change, always starts with no ghost. The practice pad never has one.

**This is a picture of a lap, not proof of one.** It holds where the car went, not the inputs that took it there. It can't reproduce a lap, and it can't show that a lap was driven legitimately. The `rules` fingerprint covers the tuning values only, so changes to the physics code don't alter it. Anything competitive, such as shared ghosts or leaderboards, would need separate input replay and validation.

## The saved reference

From v0.7.0, **Options → Ghost** chooses which ghost a circuit run shows:

| Choice | What it shows |
|---|---|
| Previous lap (default) | Everything above, unchanged |
| Saved reference | Your best recorded flying lap on this circuit in this handling mode, kept between visits |
| Off | No ghost |

The choice is remembered (`mini-drifters-ghost-mode`), and is only written when you change it. **G** (or X on a controller) still only shows or hides the chosen ghost. Lessons, the practice pad and Gymkhana never show either ghost.

### Which laps are saved

- Only a valid lap, on a normal circuit run, timed from the line: a **flying lap**. A run's first lap is a standing start on the grid, so it is never saved. After a voided first lap, the next valid lap is timed from the line and does count.
- A lap is saved when nothing showable is saved for that circuit and mode, or when it is **strictly faster** than the saved lap. Ties, slower laps, voided, abandoned and restarted laps never replace anything.
- Laps keep being saved whichever ghost is chosen, including Off.
- A saved lap is labelled a **personal best** only when that same lap has just set the fastest-lap record in the records ([RECORDS.md](RECORDS.md)). Otherwise it is a **reference**: the fastest recorded flying lap. Records set before v0.7.0, and records set on a first lap, have no recording. Nothing is invented for them, and they are never changed. Options shows both times when the record is faster than the reference.
- The records are written first (on the lap event), then the ghost. They are separate keys, so there are two partial outcomes, both shown honestly: the record saved but the ghost write failed (the old reference stays and the banner says REFERENCE NOT SAVED), or the record couldn't be saved (the lap is saved only as a reference).

### When it plays

The reference is a flying lap, so it joins at the first line crossing and restarts with the lap timer on every lap after it. It does not appear on the standing-start first lap, where a car already at speed would pass you on the grid and compare nothing useful. It runs on the same simulation-tick clock as the previous-lap ghost, so pausing and frame rate can't move it. A lap that saves is announced in the lap banner (REFERENCE SAVED) when Saved reference is chosen, and the run switches to it straight away.

### Storage

One key, `mini-drifters-ghosts-v1`, separate from the records and every preference:

```js
{ version: 1, ghosts: { <trackId>: { <handlingId>: {
  format: 1,                 // this entry layout
  compatibility: 1,          // GHOST_COMPATIBILITY, below
  trackId, handlingId,       // the slot
  track, rules,              // ghost.js's fingerprints, a second line of defence
  tickRate: 120, sampleEvery: 4, durationTicks, lapTime,
  kind: 'best' | 'reference',
  n,                         // samples: tick 0, every 4 ticks, and the line crossing
  dx, dy, dh,                // centimetres and milliradians, delta-coded integers
  checksum,                  // FNV-1a over all of the above
} } } }
```

A typical lap is 8–20k characters; the five-minute cap is about 120k; all six slots at that worst case are about 1 MiB, against a measured 5 MiB-per-origin quota. Laps over five minutes still play as the previous-lap ghost but aren't saved.

Rules: nothing is written on load; the key is re-read before every write, and every other track, mode and unknown field is kept; a save is only reported once `setItem` returns; an unparseable key, or an entry failing any check (shape, lengths, integer columns, sample count against duration, lap time against duration, positions, headings, speed between samples, checksum), reads as "no reference" and is replaced by the next qualifying lap; a later store version, or an entry from a later compatibility version, is kept and never written. The checksum only catches accidental damage. **A saved lap is a picture, not proof**: anyone can write one by hand.

### Compatibility

`GHOST_COMPATIBILITY` in `src/ghost-store.js` is an explicit, hand-raised version. **Raise it, in the same change, whenever anything can move the car or change how a lap is timed or judged**: `physics.js`, tuning or handling values, surfaces, barriers, obstacles and scenery collision, track geometry, lap timing or validation, or the simulation step. Saved laps from any other version are then never shown, and the next qualifying flying lap replaces them.

The fingerprints alone aren't enough: they were identical between v0.5.0 and v0.6.0, yet v0.6.0's Dockyard drives up to 119 m differently. Version 1 is v0.6.0's physics and environments.

`test/ghost-store.test.mjs` keeps a row of reviewed values per version and fails when any changes:

- **drive**: grip and reckless scripted runs on every circuit in every mode, every tick (catches changes in `game.js` too);
- **geometry**: every circuit's shape and its solid scenery;
- **sources**: the text of the simulation's modules (`test/support/ghost-compatibility.mjs` lists them).

When one fails, decide: if the change can affect driving or laps, raise `GHOST_COMPATIBILITY` and add a row; if it can't (a comment, say), update the row. Print the current values with `node test/support/ghost-compatibility.mjs`. Never update a row without that decision.

## Testing

```
npm test
npm run test:ghost:browser
npm run test:reference-ghost:browser
```

`test/ghost.test.mjs` drives whole laps through the real session, including a tick-by-tick comparison of runs with the ghost shown, hidden and removed. `test/ghost-browser.mjs` uses real keys, frames and pixels in Chromium and Firefox, including a run throttled to about 12 fps. Screenshots go to `artifacts/`.

`test/ghost-store.test.mjs` covers the encoding, validation, damage, quota, denied storage, other tabs and the compatibility tripwire; `test/reference-ghost.test.mjs` covers which laps are saved, through whole runs with the real records. `test/reference-ghost-browser.mjs` covers the Options choice by mouse, keyboard and controller, reloads, two tabs, quota and denied storage, what is drawn when, and the sheet's fit, in fresh browser profiles.

## Playtesting checklist

Automated tests can only show that the ghost works. These questions decide whether to keep it. Play at least three full runs and, if you can, watch someone who hasn't tried the game play too.

**Seeing it**
- [ ] Is the ghost easy to see on the road, on the grass and at speed?
- [ ] Do you always know which car is yours, including mid-slide and when the two overlap?
- [ ] Is it distracting? Did you press G to hide it, and if so, when?
- [ ] Does the minimap dot help, or is it clutter?

**Racing it**
- [ ] Does it make the second and third laps more interesting than they were without it?
- [ ] Does the lap 2 ghost feel fair, given its standing start? Is it too easy to beat?
- [ ] Is it close enough to race, or usually off screen?
- [ ] Does the moment it vanishes on a slow lap feel clear, or like a bug?
- [ ] Does it help you spot better driving lines?

**What it does to the game**
- [ ] Does racing it push you to drive faster at the expense of drifting and score? Compare your scores with G on and off.
- [ ] Is a fast, tidy ghost discouraging when you're trying to score by sliding?

**The question that matters most**
- [ ] **Do you want to run it again to beat your ghost?** Note whether you restarted without thinking about it.

Keep it if that last answer is a clear yes. If it's a no, the ghost has done its job as an experiment, and it comes out cleanly.
