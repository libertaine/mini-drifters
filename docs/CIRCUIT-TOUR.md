# Circuit Tour (v0.9.0 R2 research build)

Circuit Tour is a short championship across the seven circuits. It is a **research build** on
`research/v0.9.0-r2-circuit-tour`. It appears only on a page opened with `?research=tour`, and
nothing about the game changes without that switch. The research report, with the data, the formats
that were rejected, and the human evaluation guide, is kept with the harness in
`D:\Projects\mini-drifters-research-v0.9-r2-tour\REPORT.md`.

## The rules

- **A Tour is a few rounds.** A Sprint Tour is 4 circuits and a Grand Tour all 7. The circuits are
  drawn at random from all seven, with no repeats, and the order is shown on every round sheet.
- **Each round is an ordinary three-lap circuit run**, driven with the same physics, drift scoring
  and lap validation as any other run. The Tour reads only the run's final counted score.
- **The field posts first, and you drive last.** Five fictional rivals post their scores for the
  round before you start, so you always know what it takes. During the run the HUD shows your place
  among them, the next score to beat, and *Bank it → P2* when banking the combo you are holding
  would move you up. Passing a rival pops a banner.
- **Points by finishing place**, of six: 10, 7, 5, 3, 2, 1. **The final round counts double for
  everyone.** Your **Joker** doubles your own points in one other round, and you choose it on the
  round sheet before you drive.
- **Before each round, the sheet says what it decides**, worked out from the posted scores. For
  example, *Final round: you are champion if you finish P2 or better*.
- **Restarts belong to the whole Tour**: 2 in a Sprint and 3 in a Grand. Restarting on the grid
  is free. Once the car has moved, a restart uses one. Leaving a round from its sheet or from the
  grid costs nothing. Leaving once the car has moved, including closing the page, uses a restart;
  with none left, the round is a DNF (last, no points). The Tour is saved at every round boundary.
- **Handling is fixed for the Tour**, taken from the title when it starts.
- **Field strength**: Club, National or Pro. It is the same five rivals in better form.
- **The end** shows the final standings, a trophy for a podium, your rounds, and your Tour bests
  for those settings. Its buttons are *Rematch* (the same circuits against the same posted
  scores), *New Tour* (same settings, a new draw) and the Tour menu.
- **Targets** (research alternative): the same flow with no rivals. Each round has fixed Gold,
  Silver and Bronze scores worth 3, 2 and 1 points, and a Tour medal is awarded for the share of
  the maximum earned.

## Why finishing places, not drift totals

From the research sweep (3,584 scripted three-lap runs, all 7 circuits, both handling modes):

| | Raw drift total | Normalised (score ÷ PAR) | Finishing places |
|---|---|---|---|
| Share of a Grand Tour decided by each circuit (ideal 14%) | 6–27% (Runway 27 and Original dominate, Dockyard and Redline Mesa barely count) | 10–20% | 12–16% |
| Same player, Power ÷ Classic | ×1.34 | ×1.06 | even at mid skill |
| One 3× round + three 0.6× rounds vs 1.2× every round | tie | tie | 0% vs 74% titles |
| Ranks players by true skill (single run: 0.52–0.64) | 0.75–0.89 | 0.76–0.89 | 0.70–0.85 |

A finishing place costs a little skill signal compared with a normalised total. In return it
treats every circuit and both handling modes alike, it rewards driving well everywhere, and it
gives the standings that the rest of the design is built on.

## Calibration (provisional)

`PAR` in `src/tour.js` is the scripted median counted score for each circuit and handling mode.
It sets each circuit's relative scale. The rivals post `PAR × field scale × their level`, with
their own run-to-run spread, an occasional blunder, and favourite circuits. Field scales are
Club 0.95, National 1.3 and Pro 1.7. A player who scores about 1.0×, 1.35× or 1.75× the scripted
median wins about half their Sprint Tours in Club, National or Pro. Humans are not scripted
drivers, so these numbers need one human calibration pass before they are final, as the
Gymkhana medal targets did.

## Architecture

| File | Role |
|---|---|
| `src/tour.js` | Pure rules: lineup, rivals, a round's worth, standings, stakes, the Joker and the double final, restarts and leaving, outcome, and validation of saved Tours (`isTour`). No browser, storage, clock or `Math.random`: a Tour is decided by its seed. Imports only `track.js`. |
| `src/tour-store.js` | The Tour's storage (below). Imports only `tour.js`. |
| `src/tour-ui.js` | The Tour sheet, round sheet, round result, final sheet and HUD panel. Draws only. |
| `src/main.js` | The wiring, gated by `TOUR_RESEARCH`. A round is started with `startRun` like any circuit run, with the round sheet over the paused grid, and the run's `finish` event hands `game.results.score` to `recordRound`. |
| `src/analytics-tracker.js` | `researchScenario()` reads `?research=` (the game reads the address only here). |
| `index.html`, `style.css` | The Tour's sections and styles, hidden unless used. |

The physics, tuning, handling, scoring, laps, tracks, records, ghost store, Gymkhana, Getaway,
practice pad and lesson are unchanged.

## Storage

Circuit Tour keeps one key of its own, `mini-drifters-r2-tour`:

```
{ version: 1,
  active:  <the Tour in progress, as tour.js makes it, plus `driving`> | null,
  history: [ <the last 12 finished or retired Tours: settings, outcome, each round> ],
  bests:   { "<format>|<length>|<field>|<handling>": { finished, champion, podium, sweeps,
                                                       bestPlace, bestTrophy, bestPoints } } }
```

- The key name says "r2": it is research storage. The production format can be chosen later
  without migrating anything.
- It follows the same rules as `records.js`. Nothing is written on load. Every write re-reads the
  key first. A later version is never written. Damaged data reads as empty and is replaced. A
  saved Tour that fails `isTour` is set aside and never resumed.
- A round's result is written only if the stored Tour is still the same Tour at the same round, so
  a second tab can't overwrite a Tour that has moved on.
- If storage is denied or full, the Tour plays on in that window and says so.
- **Records and ghosts.** A Tour round is a normal run, so it can set the ordinary circuit records
  (score, combo and fastest lap, for its circuit and handling mode) and save reference ghosts,
  exactly as a run from the Tracks menu would. That is deliberate: the rules are identical, and
  the Tour's own rules (limited restarts) can only make a run harder. The Tour never writes the
  records', ghosts', Gymkhana's, Getaway's or the preferences' keys itself.

## Analytics

None. A page with `?research=tour` is never counted (`research` is a scenario parameter), and no
Tour data is ever sent. A production Circuit Tour would need its own analytics decision.

## Tests

- `test/tour.test.mjs` covers the rules and the calibration pins. It checks that the Tour layer is
  pure, the lineups' variety, rival scaling, points, standings, stakes, the double final, the Joker,
  restarts and leaving, the Targets format, that skill decides a Tour, the storage contract, and
  that a Tour round is a normal run that sets the ordinary records.
- `test/tour-browser.mjs` (`npm run test:tour:browser`) runs in Chromium and Firefox. It covers
  the whole loop by keyboard, mouse and controller, sheet fit at 1024×600, 1366×768 and 1920×1080,
  resume after a reload, storage isolation and denied storage. It is registered in
  `scripts/ci/test-plan.config.mjs`, in group `audio-lessons`.

## Known limitations

- The calibration is from scripted drivers (see above).
- The rivals are posted scores, not cars on the track.
- Lap counts are fixed at the game's three.
- A player can start a new Tour until round 1's posted scores look easy. Later rounds aren't shown
  until they are reached.
- The Tour menu lists only the Tour in progress and the bests. History is kept, but not yet shown.
