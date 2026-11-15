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
