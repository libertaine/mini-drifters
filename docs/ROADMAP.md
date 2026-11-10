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

## Current candidate: Local records

**Switchback is complete** and available alongside Original on the title screen:
see [the Switchback notes](SWITCHBACK.md).

Controller support merged in PR #16 after satisfactory owner driving/drifting review
on both tracks. Physical disconnect/reconnect coverage was not exhaustive; see
[the controller notes](CONTROLLERS.md).

**Local best scores and records are implemented on this candidate branch:** independent
score, fastest valid lap and best banked combo for Original and Switchback, stored
locally in the browser. See [the records notes](RECORDS.md). Human acceptance is pending.
Neither feature implies a version bump: whether they justify v0.2.0 will be decided after implementation
and human testing. There is no new release or publication in this phase.

## Possible track variety work

Candidate work:

- More handcrafted tracks.
- Procedurally generated tracks.
- Reproducible track seeds.
- Different corner combinations.
- Track validation and playability testing.

Procedural generation is still only a possibility. A v0.2.0 release would be a future candidate, not a commitment.

## Prototype 0.3: Competition and Replayability

Candidate work:

- Improved scoring balance.
- Local best scores (implemented on the current candidate branch; see above).
- Better player feedback.
