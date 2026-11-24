# Roadmap

Everything beyond Prototype 0.1 is provisional and may change as playtesting continues.

## Prototype 0.1: Driving Feel (complete)

Released as [v0.1.0](https://github.com/libertaine/mini-drifters/releases/tag/v0.1.0):

- Arcade driving physics.
- Handbrake drifting.
- Three-lap circuit.
- Drift scoring and combos.
- Basic timing and results.

Also built during Prototype 0.1:

- A previous-lap ghost.
- Recorded engine audio and tire effects.
- A three-station radio, with provisional music.
- A redesigned title screen and menus.
- An optional interactive driving lesson.

## Prototype 0.2: More Ways to Drift (complete)

Released as [v0.2.0](https://github.com/libertaine/mini-drifters/releases/tag/v0.2.0):

- Switchback, a second handcrafted track, chosen on the title screen: see
  [the Switchback notes](SWITCHBACK.md).
- Analog controller support for standard-mapped controllers: see
  [the controller notes](CONTROLLERS.md). Physical disconnect/reconnect coverage
  was not exhaustive.
- Per-track local personal bests: highest score, fastest valid lap and best combo,
  stored in the browser. See [the records notes](RECORDS.md).
- Scoring fixes: cutting back across the infield no longer earns new ground, and
  points banked on a voided lap don't count towards the score or records.

## Possible track variety work

Candidate work:

- More handcrafted tracks.
- Procedurally generated tracks.
- Reproducible track seeds.
- Different corner combinations.
- Track validation and playability testing.

Procedural generation is still only a possibility.

## Prototype 0.3: Competition and Replayability (complete)

Released as [v0.3.0](https://github.com/libertaine/mini-drifters/releases/tag/v0.3.0):

- Classic handling and Power handling, with the last choice remembered.
- An unscored practice pad for either handling mode.
- A low-speed scoring fade: slow slides keep their combos but pay less.
- Personal bests separated by track, handling and scoring version. Earlier scores
  and combos remain as legacy records, and fastest laps carry forward.
- Handling-specific ghosts, with the driving lesson kept on Classic.

## Prototype 0.4: Gymkhana (complete)

Released as [v0.4.0](https://github.com/libertaine/mini-drifters/releases/tag/v0.4.0):

- Precision 180: a timed gate, turn-zone and return challenge, with cone penalties.
- Linked Drift: six gates scored with the existing drift and combo rules.
- One Drift: the harder single-combo variant on the Linked Drift course.
- Classic and Power handling, with separate challenge records by handling and rules version.
- Title-screen selection, instructions, results, retry, pause and controller navigation.

See [the Gymkhana notes](GYMKHANA.md). Owner acceptance passed on November 14, 2026.
Existing circuit gameplay and records are preserved. Gymkhana records remain local to
the browser/device; there is no online leaderboard or medal system. Medal thresholds
and additional courses remain outside this release.

## Prototype 0.5: Dockyard and Slalom Sprint (complete)

Version 0.5.0 contains:

- Dockyard, a third handcrafted circuit: a right-hander that tightens, a quick chicane and
  one long bend back onto the quay. See [the Dockyard notes](DOCKYARD.md).
- Dockyard's own scenery: a concrete apron, warehouses, containers, barriers and loading
  stripes, with four corner boards. All of it is decorative, with no collision.
- Slalom Sprint, a fourth Gymkhana challenge: seven cones on alternating sides, timed, with
  cone penalties.
- Wheelspin feedback in Power: smoke, rubber marks and an engine flare driven by the
  physics' own wheelspin. See [the wheelspin notes](WHEELSPIN.md).

Owner acceptance passed for Dockyard, Slalom Sprint and the wheelspin feedback on
November 15, 2026, and for the scenery on November 16, 2026. Physics, tuning, handling and
scoring are unchanged from v0.4.0. Records, ghosts and saved settings work as before, and
Dockyard and Slalom Sprint records sit beside the existing ones in the same storage.
Medal thresholds and online leaderboards remain outside this version.

## Prototype 0.6: Functional environments (complete)

Version 0.6.0 adds solid environmental scenery to all three circuits: a club-racing setting for Original, a wooded hillside for Switchback, and paved concrete recovery ground at Dockyard. The existing track layouts and Classic/Power handling remain. Record identities are retained. Dockyard's chicane shortcut remains an explicitly accepted TODO. See [the release notes](RELEASE-v0.6.0.md).

## Prototype 0.7: Medals, reference ghosts and Getaway (complete)

Version 0.7.0 contains:

- Bronze, Silver and Gold medals for all four Gymkhana challenges, separately for each handling mode, worked out from the saved personal bests. See [the Gymkhana notes](GYMKHANA.md#medals).
- A saved reference ghost: the fastest recorded flying lap for each circuit and handling mode, kept between visits. **Options → Ghost** chooses Previous Lap, Saved Reference or Off. See [the ghost notes](GHOST.md#the-saved-reference).
- Getaway: **Get the Footage** in Downtown and Industrial. Film four cameras, escape one pursuing cruiser and score Showmanship, with a saved best and medal for each environment and handling mode. See [the Getaway notes](GETAWAY.md).
- A title menu reorganized into Tracks, Gymkhana and Getaway.

Physics, handling and scoring are unchanged from v0.6.0. Existing circuit and Gymkhana records keep their formats and identities. See [the release notes](RELEASE-v0.7.0.md).

## Prototype 0.8: Getaway Driver and Polish (complete)

Released as [v0.8.0](https://github.com/libertaine/mini-drifters/releases/tag/v0.8.0):

- **Getaway Driver** in Downtown: stealth-and-pursuit safehouse run with ATTENTION, cruising/investigating/pursuing police, losing-them escape mechanic, three outcome classifications (Ghost run, Low profile, Lost them) and local completion counts by handling mode. See [the Getaway Driver notes](GETAWAY-DRIVER.md).
- **Urban city, pursuit and audio polish**: dusk street atmosphere, realistic patrol interceptors, pursuit telemetry/vignette, procedural sirens/impacts/cues, decluttered HUD, tiered results styling, and an offline retro-arcade **"BUSTED!"** announcer voice (Kokoro-82M, Apache License 2.0) with siren ducking.
- **Tracks, Practice Pad and Gymkhana polish**: circuit-themed start/finish gantries with live race-light pods, corner rubber grooves, upgraded trackside scenery and ambient life, Dockyard weathered concrete apron and harbor seawall, `SKIDPAD 01` Practice Pad airfield with painted drill zones and minimap, 3D Gymkhana cones/corridors/apex curbs/weave guidance, SVG circuit previews, balanced 2×2 Gymkhana picker, combo heat and medal stripes, apex curb rumble and milestone/medal audio cues.
- **Privacy-respecting Umami analytics** (`md_` event contract with `?analytics=off` opt-out and local/automation/DNT gating) and a **tutorial stationary-steering reminder**. See [the analytics notes](ANALYTICS.md).
- **Risk-based parallel CI** running unit tests plus 26 Chromium and Firefox browser suites across four balanced groups. See [the CI testing notes](CI-TESTING.md).

Physics, handling, scoring, medal thresholds, ghost compatibility and existing record formats are unchanged from v0.7.0. Dockyard's chicane shortcut remains an accepted TODO. See [the release notes](RELEASE-v0.8.0.md).

## Prototype 0.9: Seven circuits and Circuit Tour (release candidate)

Version 0.9.0 contains:

- **Four more racing circuits**, for seven in all: **Runway 27** (abandoned airfield), **Redline Mesa** (desert proving ground), **Headland Run** (seaside cliff) and **Nightshift Viaduct** (midnight expressway). Each is a three-lap circuit in Classic and Power, with its own records and saved reference ghosts. See [the v0.9.0 circuit notes](CIRCUITS-v0.9.0.md).
- **A redesigned Tracks sheet**: a grid of seven circuit cards with silhouettes and settings, above a panel for the selected circuit's description, personal bests and the Practice Pad.
- **Circuit Tour**: a championship against five fictional rivals who post their scores first. Sprint (4 circuits) or Grand (7), Club, National or Pro fields, 10-7-5-3-2-1 points, a double-points final, one Joker per Tour, Tour-wide restarts, save and resume, Rematch and New Tour. See [Circuit Tour](CIRCUIT-TOUR.md).
- **Expanded ghost storage**: the reference-ghost store's cap was raised to fit all fourteen circuit and handling slots.
- **Hardened local test servers**: browser and publishing tests start the local server on a free port and check that it really is the game.
- Presentation, documentation and qualification work: the Joker's explanation, the Tour's browser and analytics checks, and the CI classifier registration of both new suites.

Physics, handling, drift scoring, record formats, ghost compatibility and the analytics contract are unchanged from v0.8.0. Dockyard's chicane shortcut remains an accepted TODO. See [the release notes](RELEASE-v0.9.0.md).

## Upcoming versions

- **v0.10.0** focuses on technical cleanup, an architectural review and project direction.

### Research candidates

- **Gymkhana progression:** medal-based unlocks and harder challenge variants. These remain a future research candidate, not a commitment.
