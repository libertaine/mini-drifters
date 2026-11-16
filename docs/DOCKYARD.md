# Dockyard

The third circuit: compact and technical, and driven Hook-first. It is one handcrafted track,
not a generator, and it uses the same car, physics, scoring, road width, checkpoint rules and
road markings as Original and Switchback. Its surroundings are a dockside of its own.

## Try it

1. On Windows, double-click **`Start Game.cmd`** in this checkout. Elsewhere, run `node server.mjs` and open <http://127.0.0.1:4190>.
2. On the title screen, press **Right** twice (or click **Dockyard**) under the tagline.
3. Choose the handling with **H**, and press Enter.

The track choice works as it does for Switchback: Left and Right change it from anywhere on
the title, Restart and Drive Again stay on it, and a new visit starts on Original.

## The lap

1. **Quay straight**, 170 m, heading east. The line is 45 m along it.
2. **The Hook**, a 178° right that opens at a 64 m radius and tightens to 24 m.
3. **Acceleration zone**, about 115 m, heading west.
4. **Chicane**, left 75° then right 75°, both about 29 m.
5. **The Basin**, a 180° right at 69 to 80 m, entered almost straight from the chicane and
   leading back onto the quay.

## Compared with the other circuits

Measured from the built circuits and with the repository's scripted drivers (medians of 16
three-lap runs per case, v0.5.0 research):

| | Original | Switchback | Dockyard |
|---|---|---|---|
| Lap length | 1287 m | 1319 m | 832 m |
| Corners over 25° | 6 | 11 | 4 |
| Tightest radius | 15.8 m | 19.8 m | 24.0 m |
| Longest straight | 212 m | 192 m | 170 m |
| Closest separate sections | 51 m | 58 m | 65 m |
| Grip lap, Classic / Power | 45.8 / 47.1 s | 49.3 / 49.7 s | 29.4 / 29.5 s |
| Drift driver's 3-lap run | 167 s | 185 s | 110 s |
| Straight-line cuts saving 25 m+ that still count | 2 | 27 | 1 |

- Runs are short: three laps take under two minutes.
- It leans toward Power. The scripted drifter scored about 2.4 times as much in Power as in
  Classic here. Records are kept per handling mode, so the two never compete.
- Its one counted cut saves 27 m by crossing 106 m of grass.

## Acceptance

The owner drove the v0.5.0 prototype and passed Dockyard on November 15, 2026, with Power
the preferred handling for it and no gameplay changes requested. The circuit here uses that
prototype's control points unchanged. `test/dockyard.test.mjs` pins them and the built shape.

## Known limits

- **The Basin's entry can void a lap.** Checkpoint 11 sits 40 m into the Basin and, like every
  checkpoint on the inside of a corner, reaches 22 m inside the centreline, 10 m past the curb.
  Only one scripted driver ever crossed inside it: the one that holds the handbrake through
  every corner, in Power (7 of 151 laps), after spinning out of the chicane and crawling across
  the grass. That is the lap rule working, and the layout is unchanged. Lengthening the link
  from the chicane to the Basin from 25 m to 55 m removed it in scripted runs, if it ever needs
  removing.
- **The scenery is decorative.** Warehouses, containers, concrete barriers and corner boards
  have no collision. The off-track ground is drawn as a concrete apron, but it behaves exactly
  as grass does on the other circuits, and the lap rules above still call it grass.

## Scenery

Added in v0.5.0 R3 and accepted by the owner on November 16, 2026. Dockyard draws a muted
concrete apron with slab joints in place of grass and trees, three warehouses beyond the wall,
nine containers in loading groups, seven short concrete barriers and two striped loading areas:
21 fixed props, all decorative. Four corner boards (HOOK, TIGHTENS, CHICANE and BASIN) show
each corner's shape with an arrow drawn in the direction of travel. Everything clears the road
and curbs by at least 4 m, and only what the camera can see is drawn. The road, curbs, finish
line, wall, minimap and HUD are drawn as before, and Original, Switchback, the practice pad and
the title are unchanged. See [the R3 review](R3-REVIEW.md).

## How it's checked

`test/dockyard.test.mjs` checks the circuit with the real simulation: its pinned control
points and shape, that it is closed and evenly sampled, never crosses itself, keeps separate
sections apart, has the Hook and the Basin at their radii, has its 16 checkpoints in order and
clear of other road, counts full laps, voids the obvious shortcuts, never counts a lap driven
backward, and never voids for running wide. The grip, drift and handbrake drivers get round in
Classic and in Power without touching the wall. It also checks the ghost is Dockyard's alone
and per handling mode, that Dockyard records save beside the others, and that a v0.4.0 tab
writing records keeps them.

`npm run test:dockyard-slalom:browser` chooses Dockyard on the title by keyboard and mouse,
drives it for three laps in Classic and in Power, and starts, drives and pauses it by
controller, in Chromium and Firefox. It saves screenshots to `artifacts/`.

`test/dockyard-scenery.test.mjs` checks the scenery layout: its clearance from the road, that
building it never changes the track, that it belongs to Dockyard alone, and that each
board's arrow matches the track's direction. `test/scenery-browser.mjs` compares the drawn
scenery with the v0.5.0 R2 build in Chromium and Firefox. It needs a separate checkout of that
build, so it runs locally and not in CI.
