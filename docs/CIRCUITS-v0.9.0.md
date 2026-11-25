# The v0.9.0 circuits

Version 0.9.0 adds four racing circuits, bringing the total to seven. Each is an ordinary
three-lap circuit run, scored on drifting, in Classic and Power. Each keeps its own records and
saved reference ghosts, like Original, Switchback and Dockyard, and each can be drawn in a
[Circuit Tour](CIRCUIT-TOUR.md).

They were designed and tuned in the v0.9.0 R0 research build (`research/v0.9.0-r0-circuits`,
`06911a5`), accepted by the owner after human testing, and integrated unchanged in R1
([PR #46](https://github.com/libertaine/mini-drifters/pull/46)): the control points, surfaces,
checkpoints, scenery and colliders match R0 exactly.

| Circuit | Setting | Length | Character |
|---|---|---:|---|
| **Runway 27** (`runway-27`) | Abandoned airfield | 1,228 m | Wide sweeping bends linked by fast tarmac chutes around a disused cross-runway. Rewards high-speed slides. |
| **Redline Mesa** (`redline-mesa`) | Desert proving ground | 1,095 m | Three wide opposing drift hairpins joined by linkable chutes, with a flowing canyon-rim return. |
| **Headland Run** (`headland-run`) | Seaside coastal cliff | 1,164 m | A fast cliff sweeper, a deep marina cove and an opening-radius lighthouse carousel. |
| **Nightshift Viaduct** (`nightshift-viaduct`) | Midnight expressway | 1,071 m | A 205° cloverleaf on-ramp into a sweeping freight yard, lit by headlights and sodium lamps. |

## Scenery and surfaces

- **Runway 27:** airfield tarmac, runway markings, perimeter walls, and an animated windsock.
- **Redline Mesa:** desert terrain with elevation contours, rock and canyon edges, and blowing dust.
- **Headland Run:** a coastal cliff above an animated ocean, a marina, and a lighthouse with a
  sweeping beam.
- **Nightshift Viaduct:** a night scene with headlights, sodium lamp pools, and blinking viaduct
  beacons.

Off the road, the apron of every new circuit uses the established grass surface. Reachable solid
scenery (walls, barriers and structures) has collision, as on the first three circuits.
Decorative markings and ground details don't.

## Tracks selection

The **Tracks** sheet was redesigned for seven circuits. It is a 4×2 grid of circuit cards, each with:

- its accent colour
- a circuit silhouette drawn from the real geometry
- a setting tag

Below the grid is a panel for the selected circuit, with its description and the personal bests
for your handling mode, plus the **Practice Pad**. Left and Right (or the D-pad) move through the
cards, H changes handling, Enter starts, and Esc goes back. Mouse and controller work the same.
The sheet fits without scrolling at 1024×600, 1280×720, 1366×768 and 1920×1080.

## Records and ghosts

- Records use the existing key and scoring version (`mini-drifters-records-v3`, `scoring-2`). The
  new circuits simply add track ids, and saves from v0.8.0 load unchanged.
- Each new circuit has a permanent ghost-compatibility fingerprint, pinned in
  `test/ghost-store.test.mjs`. The first three circuits' identities are unchanged, so their saved
  reference ghosts still play. `GHOST_COMPATIBILITY` is still 1.
- With 14 reference-ghost slots (7 circuits × 2 handling modes), the ghost store's whole-key cap
  (`MAX_STORE_CHARS`) was raised from 2,000,000 to 2,500,000 characters, so every slot fits even at
  its five-minute worst case. See [GHOST](GHOST.md#storage).

## Scripted reference runs (R1 = R0)

These are single scripted three-lap runs, used to prove that R1 drives exactly like R0. They aren't
targets.

| Circuit | Classic grip lap / drift score | Power grip lap / drift score |
|---|---|---|
| Runway 27 | 41.63 s / 9,627 | 41.63 s / 11,046 |
| Redline Mesa | 40.78 s / 3,893 | 40.93 s / 16,943 |
| Headland Run | 40.72 s / 5,735 | 40.88 s / 8,185 |
| Nightshift Viaduct | 38.17 s / 12,714 | 38.25 s / 8,634 |

Scores differ a lot from circuit to circuit and between handling modes. That's why Circuit Tour
scores each round by finishing place against a field scaled to that circuit and mode, rather than
by adding up drift scores. See [CIRCUIT-TOUR](CIRCUIT-TOUR.md#calibration).

## Tests

- `test/circuits-r1.test.mjs`: geometry, checkpoints, scenery and colliders against R0, simulated
  runs, records, reference ghosts, v0.8.0 save compatibility and isolation from R0 research keys.
- `test/circuits-r1-browser.mjs` (`npm run test:circuits-r1:browser`): the seven-circuit Tracks
  sheet by keyboard, mouse and controller, driving each new circuit in both modes, records, saved
  reference ghosts, Drive Again, reload persistence and layouts.
- `test/tracks-browser.mjs` covers the seven-circuit sheet. The environment and ghost suites
  still cover the first three circuits, which are unchanged.

## Known limitations

- The new circuits' grass aprons use the established whole-car surface model: there's no
  two-wheels-off behaviour.
- Their scenery is decorative where it can't be reached. Like every circuit, they keep their own
  records per handling mode, and scores aren't comparable between circuits.
