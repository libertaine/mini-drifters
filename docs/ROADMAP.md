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
