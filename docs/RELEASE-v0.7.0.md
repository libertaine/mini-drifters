# Mini Drifters v0.7.0

Version 0.7.0 gives the Gymkhana challenges medals, lets a circuit run race a saved reference lap, and adds a new kind of mission, Getaway. The title menu is reorganized around them.

## What's new

- **Gymkhana medals.** Precision 180, Linked Drift, One Drift and Slalom Sprint each award Bronze, Silver and Gold, with separate targets for Classic and Power. A medal is worked out from the saved personal best and never stored, so bests saved by earlier versions earn their medals as soon as v0.7.0 loads. The challenge sheet shows the targets and what the next medal takes, and results say **NEW MEDAL** only when a saved new best holds a better medal. See [the Gymkhana notes](GYMKHANA.md#medals).
- **Saved reference ghosts.** **Options → Ghost** chooses **Previous Lap** (the default, unchanged), **Saved Reference** or **Off**. The saved reference is the fastest recorded valid flying lap for each circuit and handling mode. It survives reloads and joins as lap two starts. G, or X on a controller, still shows or hides the chosen ghost. See [the ghost notes](GHOST.md#the-saved-reference).
- **Getaway: Get the Footage.** In Downtown or Industrial, film four cameras in order and get through the escape gate within 120 seconds while one pursuing cruiser fills Bust Risk. Showmanship is banked drift plus 150 per fruit stand and 250 per wooden barricade. Any escape earns Bronze, and Silver and Gold targets depend on the environment and handling. Each environment and handling pair keeps its best Showmanship and medal in this browser. See [Getaway](GETAWAY.md).
- **Tracks, Gymkhana and Getaway.** The title now opens three categories. **Tracks** holds Original, Switchback, Dockyard and the Practice Pad, with circuit personal bests on its sheet. **Gymkhana** holds the four challenges, and **Getaway** holds Get the Footage. Classic and Power share one remembered handling choice. Esc, or B on a controller, goes back one level at a time.

## Compatibility

- Physics, handling, tuning and scoring are unchanged from v0.6.0.
- Circuit records (`mini-drifters-records-v3`) and Gymkhana records (`mini-drifters-gymkhana-v1`) keep their formats and identities, including the Classic and Power split.
- Reference ghosts are stored under their own key, `mini-drifters-ghosts-v1`, and the ghost choice under `mini-drifters-ghost-mode`. Getaway bests are stored under `mini-drifters-getaway-v1`. Getaway writes only its own key.
- Getaway bests weren't saved before v0.7.0, so there was nothing to migrate. Records set before v0.7.0 have no lap recording, so no reference ghost is invented for them.
- If storage is unavailable, full or refused, play continues and results say what couldn't be saved. Data saved by a newer version is left untouched.

## Known limits

- **Dockyard's chicane shortcut is still unresolved by owner choice.** Cutting across the concrete is about 1.6–1.8 seconds faster in scripted runs. Its regression test is explicitly TODO, not passing.
- Saves from two tabs at once are last-write-wins for every saved record and ghost. Each save re-reads storage first, which covers normal use.
- Records, ghosts and Getaway bests stay in this browser. Clearing the site's data removes them, and there is no in-game reset.
- Controller checks use mocked devices. The release doesn't claim additional physical-device coverage.
- An unexplained Chromium startup timeout happened twice in heavily loaded local test matrices, and not in 13 later ones. Its cause is unconfirmed.

## Qualification

Integrated through [PR #32](https://github.com/libertaine/mini-drifters/pull/32). Local qualification on its final head gave **848 unit tests: 847 passed, 0 failed, 0 skipped, 1 accepted TODO** (the Dockyard chicane), and all 26 local Chromium and Firefox lanes passed. Hosted CI on `main` passed the unit tests and all 23 browser suites, and deployed to Pages ([run 44863613187](https://github.com/libertaine/mini-drifters/actions/runs/44863613187)).
