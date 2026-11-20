# Gymkhana

Gymkhana is a set of short driving challenges on open asphalt, opened from the title
screen. Each uses the handling mode chosen on the title and keeps its own personal best. There are four challenges on three
layouts.

| Challenge | Kind | What it asks |
|---|---|---|
| Precision 180 | Time | Through a gate, down a box to the turn zone, round, and back out nose first |
| Linked Drift | Score | Six gates through three alternating bends, scored by the game's drift rules |
| One Drift | Score | The Linked Drift course as a single combo |
| Slalom Sprint | Time | Seven cones to weave through on alternating sides, then a finish gate |

Each challenge awards Bronze, Silver and Gold medals, separately for each handling mode
(see [Medals](#medals)).

## Playing

**Gymkhana** on the title opens a sheet. Left and Right choose the challenge, H changes
the handling mode as it does on the title, Enter starts and Esc goes back. The sheet
shows the challenge's rules, its personal best and medal in the selected handling mode,
the three medal targets and what the next medal takes. The
chosen challenge is remembered for the visit, not between visits.

While driving, R starts the challenge again at any time, P pauses and Esc returns to the
title. The clock starts at the first pedal press. When the run ends, completed or
failed, a results sheet appears: Enter or R tries again, **Challenges** goes back to the
sheet, and **Return to title** leaves.

On a controller, A confirms and B goes back on every sheet, the D-pad chooses, Menu
pauses, and X starts the challenge again while driving. A challenge has no ghost, so X
has no ghost to toggle there.

## Precision 180

The car starts 36 m from a gate 8 m wide. Behind the gate is a painted box, 30 m long
and 14 m wide, open at the near end. The far 14 m of the box is the turn zone.

- The clock runs from the first pedal press until the car crosses the gate on the way out.
- The car must go in through the gate, reach the turn zone, turn round, and come back
  out through the gate nose first.
- Each cone touched adds 2 seconds. There are seven: two at the gate, four at the box's
  corners and one in the middle of its far end. Cones do not deflect the car.
- The run fails if the car leaves the box by a side or the far end, comes back out
  before reaching the turn zone, comes out backwards, or takes more than 30 seconds.

The result is the driving time plus penalties. Lower is better.

The box is narrower than a grip U-turn needs at any useful speed, so a handbrake turn is
the quick way round. A slow U-turn on grip and a three-point turn are both legal, and in
scripted runs cost about two and three and a half seconds more. The turn zone rule is
there because without it the quickest run crawled in and turned at the mouth of the box.

## Linked Drift

A 45 m run-up, then three bends that turn right, left and right, with a gate at the
middle of each bend, a gate where each bend meets the next, and a finish gate: six gates
over 285 m. The course is 20 m wide and each gate is 16 m wide.

- Drifts score exactly as they do on a circuit: the same angle, speed, combo and
  multiplier rules, including the low-speed fade. See the scoring notes in the README.
- Only new ground along the course pays, so circling in a bend earns nothing.
- Leaving the painted course counts as leaving the road, for the scoring only.
- Touching a cone, spinning or leaving the course loses the unbanked combo.
- The finish gate banks the combo the car is carrying.
- The run fails if a gate is missed (the car is 10 m past it along the course) or it
  takes more than 60 seconds.

The result is the score at the finish. Higher is better. A failed run scores nothing,
whatever it had banked.

## One Drift

The Linked Drift course and scoring, with one difference: the run is the first combo.

- When that combo banks, by straightening up or at the finish gate, the run is complete
  with what it banked.
- If that combo is lost, to a spin, a cone or the edge of the course, the run fails.
- A missed gate fails the run, as in Linked Drift.

## Slalom Sprint

A standing start, seven cones in a line 22 m apart (the practice pad's own slalom spacing),
and a finish gate 8 m wide. The car starts 36 m before the first cone, on the line of cones,
and the gate is 30 m past the last. A painted lane reaches 12 m either side of the cones.

- The clock runs from the first pedal press until the car crosses the finish gate.
- Pass the first cone on its left, the next on its right, and so on. Each cone has an arrow
  on the side to pass it, and the next cone's gate is drawn in cyan.
- A cone is passed when the car's centre draws level with it. At that moment the centre must
  be on the required side and inside the lane, so no cone can be skipped or taken twice, and
  a car driven straight over the cones fails at the first.
- Each cone touched adds 2 seconds, including the two at the finish gate.
- The run fails on the wrong side of a cone, outside the lane, past the finish outside its
  gate, or after 40 seconds.

The result is the driving time plus penalties, to the millisecond. Lower is better. The
results sheet shows the driving time, the penalties and the total.

Unlike the other three, the quickest run is tidy rather than sideways: in scripted runs the
best clean times barely slide, and going a little too fast costs cones before it fails.

## Records

Gymkhana records are separate from the circuit records and stored under their own key,
`mini-drifters-gymkhana-v1`. Circuit runs never change them, and they never change a
circuit record.

A record's identity is challenge + handling mode + rules:

| Challenge | Record | Filed under |
|---|---|---|
| Precision 180 | Lowest total time, penalties included | `precision-180-1` |
| Linked Drift | Highest score | `linked-drift-1` + the scoring version |
| One Drift | Highest score | `one-drift-1` + the scoring version |
| Slalom Sprint | Lowest total time, penalties included | `slalom-sprint-1` |

**Qualification.** Only a run that completes its challenge sets a record. Failed,
restarted and abandoned runs never do. Ties do not improve a record. Zero is a real
score, so a Linked Drift run finished without a drift records 0.

**Rules ids.** A challenge's layout and rules are pinned by a test to its rules id
(`rules` in `src/gymkhana.js`). A change that alters what a result is worth, such as
moving a gate or changing the cone penalty, needs a new id, which starts a new, empty
record. The old one stays in storage untouched and is not shown. Scores are also filed
under the scoring version (`SCORING_VERSION` in `src/scoring.js`), so a change to what
drifts pay starts new score records without touching times.

**Storage.** One JSON entry, schema 1:

```json
{
  "version": 1,
  "challenges": {
    "precision-180": { "classic": { "precision-180-1": { "best": 7.358 } } },
    "linked-drift": { "revised": { "linked-drift-1+scoring-2": { "best": 1240 } } }
  }
}
```

Times are in seconds, to the millisecond. `revised` is Power's stable id. The storage
rules are the circuit records' own: nothing is written on load, only a successful write
makes a record or a NEW BEST, the key is re-read before every write so another tab's
records are kept, corrupt data is replaced by the next improvement, and a later schema
is never written. Unknown challenges, modes, rules ids and fields are carried through
every write. If storage is unavailable the challenges still play, and a note says that
improvements cannot be saved.

## Medals

A medal is worked out from a result, never stored. The personal best above decides the
medal a challenge holds, so a best saved by any version since v0.4.0 earns its medal as
soon as this version loads, nothing is written to award one, and a worse run never takes
one away. A time must meet or beat a target and a score must meet or exceed it, compared
at the precision a record is saved at: a time to the millisecond, a score in whole points.
A failed run earns nothing. A completed run that misses Bronze is still a record.

These targets originated as provisional R0 research values (scripted drivers) and were
owner-approved unchanged for v0.7.0 R1 after human gameplay testing across all four
challenges:

| Challenge | Classic Gold / Silver / Bronze | Power Gold / Silver / Bronze |
|---|---|---|
| Precision 180 | 7.600 s / 8.300 s / 30.000 s | 7.600 s / 8.300 s / 30.000 s |
| Linked Drift | 850 / 450 / 1 | 950 / 450 / 1 |
| One Drift | 800 / 400 / 1 | 850 / 400 / 1 |
| Slalom Sprint | 14.800 s / 18.500 s / 40.000 s | 14.800 s / 18.500 s / 40.000 s |

Bronze for a time challenge is its time limit: any finish within it, penalties included.
Bronze for a score challenge is 1 point: any completed run that scored. Timed medal
targets are shown to three decimal places, and timed results within 10 ms of any target
also display to three decimal places (with the millisecond miss noted when slower) so a
qualifying time such as `7.604 s` never appears equal to a `7.600 s` Gold target. The
targets live only in `src/medals.js`, filed by challenge, record rules (with the scoring
version for a score) and handling mode. A record filed under rules the table does not know
has no medal.

The sheet marks each challenge's medal on its button, as a disc carrying the medal's
initial. While driving, the panel shows the medal the saved best holds and the next
target, never a medal for the run in progress. The results sheet shows the run's medal.
It says NEW MEDAL only when a saved NEW BEST holds a better medal than the record it
replaced, and "not saved" when the run's medal could not be kept.

## How it is built

| Path | Contents |
|---|---|
| `src/gymkhana.js` | The challenges: layouts, rules, and the step that judges each tick |
| `src/gymkhana-records.js` | Their personal bests |
| `src/gymkhana-draw.js` | Painting a challenge on its pad and on the minimap |
| `src/gymkhana-ui.js` | The sheet, the HUD panel and the results sheet |
| `src/medals.js` | Medal targets, and the medal a result earns |
| `test/gymkhana.test.mjs`, `test/gymkhana-records.test.mjs` | Rules, sessions and records |
| `test/slalom.test.mjs` | Slalom Sprint's rules, retries and records, and a v0.4.0 tab's writes |
| `test/gymkhana-browser.mjs` | The mode on the real page, in Chromium and Firefox |
| `test/medals.test.mjs`, `test/medals-browser.mjs` | Medals: boundaries, older records, and the page |
| `test/dockyard-slalom-browser.mjs` | Slalom Sprint on the real page, by keyboard and controller |
| `test/support/gymkhana-drivers.mjs` | Scripted drivers for all of the above |

A gymkhana session is `game.mode === 'gymkhana'`. `game.js` gives it the challenge's own
pad, steps the challenge once per simulation tick after the car has moved, and ends the
session when the challenge's run is over. The car, the handling modes and the scoring
rules are read and never changed, and a circuit run after a challenge drives exactly as
one that never saw it.

## Known limits

- Human acceptance of the integrated Precision 180, Linked Drift and One Drift gameplay,
  penalties, scoring, difficulty, records and handling separation passed on November 14,
  2026. Owner human acceptance of v0.7.0 R1 Gymkhana medals and all four challenges'
  layouts, rules and thresholds passed on November 19, 2026.
- The car cannot pivot at low speed: a handbrake turn needs about 13 m/s on entry.
  Power can spin up a donut from a standstill and Classic cannot, so challenges built
  on spins would differ between modes more than these do.
- In scripted runs Precision 180 is the same in both handling modes to within a tenth of
  a second, while Linked Drift has a higher ceiling in Power. Each mode keeps its own
  record.
- Holding the handbrake through every bend of Linked Drift scores, though well under a
  controlled drift.
- Slalom Sprint passed the owner's prototype review on November 15, 2026, with no changes
  requested. Its records start under `slalom-sprint-1`; the prototype's, under its own rules
  id, are not carried over or shown.
- The slalom is longer than the screen: from the start you see the first four cones, and the
  minimap shows all seven.
- Owner acceptance of physical controller operation and normal circuit gameplay passed
  on November 14, 2026. The automated check uses a mocked standard-mapped controller;
  exhaustive device mapping and disconnect/reconnect coverage is not established.

## Human acceptance

**PASS - November 14, 2026.** The owner approved all five integration acceptance checks:
Precision 180; Linked Drift; One Drift; Gymkhana records, handling separation and circuit
record isolation; and physical controller operation with normal circuit gameplay.

**PASS - November 19, 2026 (v0.7.0 R1 medals).** Following human playtesting across all
four challenges (Gold achieved on Precision 180, Linked Drift and One Drift; Slalom Sprint
Gold target kept unchanged as approved), the owner approved the existing challenge layouts,
rules, handling behavior and medal thresholds above.
The checklist below remains a reference for future changes.

Run `npm start` and open http://127.0.0.1:4190 in desktop Chromium, then Firefox.

1. On the title, check **Gymkhana** opens its own four challenges, and that the title
   still fits the window.
2. Open it. Check the three challenges, their rules, `--` for each best, and that Left,
   Right, H, Enter and Esc do what the sheet says.
3. Start Precision 180. Before moving, check that the gate, the box and the turn zone
   are in view and the instruction can be followed without having read this page.
4. Complete it. Check the time, NEW BEST, and the details on the results sheet.
5. Fail it three ways: slide out of the box, turn before the turn zone, and reverse
   out. Check each is explained and none changes the record.
6. Touch a cone. Check the banner, the HUD line and the 2 seconds on the result.
7. Press R mid-run and on the results. Check the car, clock and cones all reset.
8. Drive Linked Drift. Check the score, combo and banners behave as on a circuit, that
   gates count up, and that a missed gate fails the run with nothing saved.
9. Drive One Drift. Bank a drift before the finish, then lose one. Check the first
   completes with its score and the second fails.
10. Switch handling and check each challenge shows a separate best.
11. Reload. Check the bests are still there and the circuit records are unchanged.
12. Drive a normal three-lap run and the practice pad. Check both are as before.
13. With a controller: open the sheet, choose, start, drive, retry with X, pause, and
    work the results sheet with A and B.
14. After ten attempts at each challenge, note whether you still wanted another.
