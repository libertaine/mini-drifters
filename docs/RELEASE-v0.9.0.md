# Mini Drifters v0.9.0 — Seven circuits and Circuit Tour

Version 0.9.0 adds four racing circuits for seven in all, redesigns the Tracks sheet around them,
and adds **Circuit Tour**, a short championship against five rival drifters.

## What's new

- **Four new circuits.** **Runway 27** (abandoned airfield), **Redline Mesa** (desert proving
  ground), **Headland Run** (seaside cliff) and **Nightshift Viaduct** (midnight expressway). Each
  is a three-lap circuit run in Classic and Power, with its own themed scenery, solid obstacles,
  records and saved reference ghosts. See [the v0.9.0 circuit notes](CIRCUITS-v0.9.0.md).
- **A redesigned Tracks sheet.** The seven circuits appear as a grid of cards, each with its circuit
  silhouette, setting and accent colour. Below them, a panel shows the selected circuit's
  description, its personal bests for your handling mode, and the Practice Pad. It works with the
  keyboard, mouse and controller, without scrolling, at desktop sizes down to 1024×600.
- **Circuit Tour.** A new title-menu mode. Five fictional rivals post their scores for each round
  first, and you drive last.
  - **Sprint Tour** (4 circuits) or **Grand Tour** (all 7), against a **Club**, **National** or
    **Pro** field.
  - Finishing places score **10-7-5-3-2-1**, and **the final round counts double**.
  - The HUD shows your live place, the next score to beat, and **Bank it → P2** when banking your
    combo would move you up. Passing a rival pops a banner.
  - The Tour is saved between rounds and resumes after a reload. **Rematch** replays the same
    circuits against the same posted scores.

  See [Circuit Tour](CIRCUIT-TOUR.md).
- **The Joker.** *Double your championship points in one round. Choose wisely.* You get one per
  Tour, played on a round's sheet before you drive, in any round but the double-points final. It
  is explained on the Tour sheet, its state (available, last chance, selected, used) is shown on
  every round sheet, and the round result spells out the doubling, for example
  *P2 = 7 pts × 2 Joker = 14 pts*.
- **Expanded ghost storage.** The reference-ghost store's cap was raised from 2,000,000 to
  2,500,000 characters, so all fourteen circuit and handling slots fit.
- **Hardened local test servers.** Browser and publishing tests start the local server on a free
  port and check that it is really the game before testing it.

## Circuit Tour rules in brief

| | |
|---|---|
| Rivals | Kit Calloway, Marisol Vega, Dutch Brennan, Juno Sato and Ozzie Pike (fictional). The same five in every field, stronger in National and Pro. |
| Rounds | Ordinary three-lap circuit runs. The circuits are drawn at random, without repeats. The rivals' scores are posted before each round. |
| Points | 10, 7, 5, 3, 2, 1 by finishing place. Beating a score means scoring strictly more than it. The final round counts double for everyone. |
| Joker | Doubles your points in one round, once per Tour, never in the final. It is spent only when that round's result is recorded. |
| Restarts | Shared by the whole Tour: 2 in a Sprint, 3 in a Grand. R on the grid, and leaving from the grid, are free. Once the car has moved, restarting or leaving uses one. With none left, leaving is a DNF (last place, no points). |
| Save and resume | Saved at every round boundary under `mini-drifters-tour-v1`. Continue picks up the Tour, and closing the page mid-round counts as leaving it. |
| The end | Final standings, a trophy for P1–P3, and your Tour bests for those settings. Rematch (same circuits and posted scores), New Tour, or back to the Tour menu. |

## Compatibility

- Classic and Power handling, physics, drift scoring (`scoring-2`), lap validation, Gymkhana and
  Getaway rules and medal thresholds are unchanged from v0.8.0.
- Original, Switchback and Dockyard are unchanged. Their record and ghost identities are preserved,
  `GHOST_COMPATIBILITY` stays 1, and the four new circuits have permanent identities of their own.
- Existing keys keep their formats:
  - circuit records (`mini-drifters-records-v3`)
  - reference ghosts (`mini-drifters-ghosts-v1`)
  - Gymkhana (`mini-drifters-gymkhana-v1`)
  - Get the Footage (`mini-drifters-getaway-v1`)
  - Getaway Driver (`mini-drifters-getaway-driver-v1`)
  - preferences

  Saves from v0.8.0 load unchanged.
- Circuit Tour adds one key, `mini-drifters-tour-v1`, and reads or writes no other. The v0.9.0 R2
  research build's key (`mini-drifters-r2-tour`) is never read, written or migrated.
- **Records from Tours.** Tour rounds are ordinary circuit runs. They set the ordinary circuit
  records and saved reference ghosts, as Tracks runs do.
- **Analytics.** The event contract is unchanged. A Tour round is counted once, exactly as a Tracks
  run (`category: 'tracks'`). No Tour data (rivals, scores, places, points, standings, the Joker or
  results) is sent. See [ANALYTICS](ANALYTICS.md#circuit-tour).
- If browser storage is unavailable, full or refused, play continues. A Tour carries on in that
  window, and the sheets say what could not be saved.

## Known limits

- **Dockyard's chicane shortcut remains an accepted limitation.** Straight-lining across the concrete
  is about 1.6–1.8 s faster in scripted runs, and its regression test stays explicitly `TODO`.
- **Circuit Tour's rivals are posted scores**, not cars on the track. Their strength was calibrated
  from scripted drivers and accepted after the owner's playtest. Lap counts are fixed at three, and
  lineups are drawn, not chosen.
- **Tour history** (the last 12 Tours) is kept but not yet shown in the game.
- **Desktop browsers only**, with a keyboard or a standard-mapped controller. There are no touch
  controls.
- **Local-only storage.** Records, ghosts and Tours stay in this browser, with no sync and no
  in-game reset.

## Qualification

The release was integrated through a stack of two pull requests, each merged with a merge commit:

- [PR #47](https://github.com/libertaine/mini-drifters/pull/47) (R3: Circuit Tour, the Joker
  explanation and release preparation) into the R1 branch
- [PR #46](https://github.com/libertaine/mini-drifters/pull/46) (R1: the four circuits and the
  Tracks redesign, now carrying R3) into `main`

The final candidate was qualified on its exact commit before release: the full unit suite, all 28
browser suites in both Chromium and Firefox, and the publishing, analytics and desktop layout
checks, locally and in the full hosted workflow. The one accepted `TODO` is the Dockyard chicane
regression test described under Known limits. The totals and hosted run links are recorded in the
pull requests and the GitHub release.

One test reliability fix was made during final qualification. A hosted Firefox run read the
reference-ghost suite's *REFERENCE NOT SAVED* banner after a fixed 150 ms pause, before the
game's next animation frame had written it. The check now waits for the banner, frame by frame
and for at most 5 seconds, then asserts the same text. No game code changed.

The README title image is now a v0.9.0 capture.
