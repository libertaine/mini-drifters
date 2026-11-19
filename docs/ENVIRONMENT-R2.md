# v0.6.0 R2: Original and Switchback environmental design

> Historical prototype report. The owner subsequently accepted R1/R2 gameplay and scenery for v0.6.0. The chicane shortcut is accepted, records keep their existing identities, and hard scenery-hit wording is corrected in the release. Current decisions and release scope: [v0.6.0 notes](RELEASE-v0.6.0.md). The prototype evidence and evaluation instructions below describe the earlier gate.

**Status: prototype, stopped at the human evaluation gate.** Nothing here is committed, pushed,
merged, tagged or deployed. Human driving is the acceptance gate for look and feel.

| | |
|---|---|
| Worktree | `D:\Projects\mini-drifters-environment-v0.6.0-r2` |
| Branch | `feature/environment-v0.6.0-r2` (local, no upstream, no commits) |
| Baseline | `f7ad948754fad0cdad7c3b57394d251239033c62`, plus R1's uncommitted work, copied in byte for byte |
| R1 | Untouched in `D:\Projects\mini-drifters-environment-v0.6.0-r1`. A full snapshot of its uncommitted work is in `D:\Projects\_snapshots\mini-drifters-environment-v0.6.0-r1-20261118`. |
| Play it | Double-click `tmp\environment-r2\Start Prototype.cmd`, or run `PORT=4290 node server.mjs` in the worktree, then open <http://127.0.0.1:4290> |

Port 4290 is a browser origin no Mini Drifters build has used, so records saved while playing stay
there. R1 keeps 4280.

## What the two circuits look like now

### Original: a grassroots club circuit

An established circuit kept up on a small budget. The track, its width, its curbs and markings are
unchanged.

- **The main straight:**
  - Race control, the pit garages and the main grandstand are built into the north perimeter, with
    hand-painted sponsor boards between them.
  - The paddock road, a car park and the team transporters on gravel lie beyond the wall.
- **The infield paddock, on the grass:**
  - the clubhouse and the scrutineering shed;
  - vans with gazebos pitched against them, trailers and the fire tender;
  - "3, 2, 1" marker boards before the sweeper.
- **The infield:** copses, an avenue of trees inside the back straight, and a mown marshals'
  service track.
- **The hairpin:**
  - a small grandstand on the outside and a spectator bank;
  - a marshal post, an ambulance, and "2, 1" boards on the approach.
- **The south-east corner:** a maintenance yard with a workshop, tyre piles and the mower.
- **The perimeter:**
  - tyre walls on the outside of the corners;
  - steel armco and a catch fence in place of the dashed wall;
  - beyond them, woods, the access road and a spectator car park.
- **The ground:** v0.5.0's mown stripes, plus worn grass where cars run wide.

### Switchback: a wooded hillside course

The course is cut into a hillside. It doesn't look like a stadium, and it doesn't look like
Dockyard.

- **The hill:**
  - It rises to the north-east across the line of the switchbacks.
  - The ground is shaded uphill and lit from the top left, with contour lines. The ground itself is
    flat, as before.
- **Retaining walls:**
  - They hold the slope back on the outside of each right-hander of the switchbacks.
  - Bare earth and scree sit above them, then boulders, pines and two rock outcrops.
- **The valley inside the lap:**
  - broadleaf woodland in stands, around a clearing with a ranger's cabin, benches and wild
    flowers;
  - a dry wash that drains south under the bottom straight.
- **Gravel shoulders and a ditch line the road.** They are drawn as gravel and **drive as the
  existing off-road surface** (grass physics). That surface already slows the car and throws dust,
  so no new surface was added.
- **Signs:**
  - a winding-road sign before the switchbacks;
  - a sharp-right sign and a long chevron board on the outside of the tight right.
- **The perimeter:** a guardrail on timber posts in place of the dashed wall, with dense forest
  beyond. A scenic overlook (a lay-by, railing, bench and parked car) sits beyond the east
  guardrail.

### Dockyard

Unchanged from R1. Its frames are pixel-identical to R1's in both browsers, with and without the
debug view. The chicane shortcut stays deferred, and its `todo` test is untouched (see Known
limitations).

## How it is built

| File | What it does |
|---|---|
| `src/scenery.js` (new) | The rules: which kinds are solid, the clearance and gap rules, deterministic helpers (a seeded generator, convex hulls, rounded outlines, stand filling), and `sceneryFor(track)`, built once per circuit. No browser code. |
| `src/scenery-original.js`, `src/scenery-switchback.js` (new) | Each circuit's layout in world metres. Structures are placed by hand; trees and texture come from a seeded scatter filtered by the same rules. |
| `src/scenery-draw.js` (new) | Draws the layouts in Dockyard's manner: flat shapes, a thin outline, a modest bottom-right shadow. Everything static is grouped once by layer, style and 64 m cell, and each frame draws one path per style per visible cell. |
| `src/obstacles.js` (R1, extended) | Two collision shapes beside R1's boxes: a **capsule** (a tree, a rock, or one piece of a rail or wall) and a **convex polygon** (a stand of woodland). The box code and Dockyard's colliders are unchanged. |
| `src/render.js` (R1, extended) | Original and Switchback draw their landscape in place of the plain grass, wall and tree scatter. Tree tops go over the car, as v0.5.0's trees did. The debug view (D) now draws each collider's true shape. The road, curbs, markings, cars, effects, minimap and HUD are untouched. |

### Decorative, solid, driveable

| | Rule | Examples |
|---|---|---|
| **Solid** | Every raised thing the car can reach. Its collider is built from the same numbers it is drawn from. | buildings, grandstands, vehicles, gazebos, boards, signs, tyre walls, retaining walls, trees, stands of woodland, rocks |
| **Decorative** | Raised things wholly beyond the perimeter wall. The wall stops the car first, so they get no collider. | the woods, car parks and transporters, the overlook |
| **Driveable** | Everything flat. It drives as the ground it lies on did in v0.5.0: road, curb or grass, by distance from the centreline. | worn grass, footpaths, the spectator bank, the meadow, the dry wash, gravel shoulders, bare earth |

Paved ground (roads, car parks, gravel lots, the overlook) lies **wholly beyond the wall**. No new
paved or faster surface exists anywhere the car can reach, so there is no new route to score on.

### Placement rules (tested)

1. Every reachable solid is **at least 24 m from the centreline**, which is 12 m of grass past the
   curb. Dockyard's R1 minimum is 20 m.
   - The closest are 24.5 m on Original and 24.3 m on Switchback.
   - Switchback's retaining walls are traced 32 m out (31.2 m to their face) and stand only beside
     right-handers and straights.
2. Two solids, or a solid and the perimeter wall, **either touch or leave at least 7 m**, R1's seal
   gap, so the 4.4 m car can't wedge.
   - Things built against the wall cross its line.
   - Stands that run on through the wall reach 8 m past it.
3. **All open ground inside the wall is one connected space.** A 1.5 m flood fill of every place the
   car's centre can be finds no enclosed pocket.
4. **Every checkpoint gate is open** from its inside tip to 22 m from the centreline.
5. **No speed tunnels through anything.** R1's swept contact covers the new shapes, and contact is
   identical at 30, 60 and 120 Hz.

**One layout change was driven by the existing tests.** Switchback's south-east woods are two stands
either side of a ride. That ride is the line the voided-lap tests cut across. Their scripted cutter
never reverses, and a single stand there pinned it for the whole hour the test allows. The lap
still voids, and no test was changed for it.

## What did not change

- **Unchanged:** centrelines, road widths, curbs, markings, checkpoints, lap rules, both handling
  modes, the drift scoring (`scoring-2`), Gymkhana, the practice pad, the ghost, and records
  (`mini-drifters-records-v3`, schema 3, the same track and handling ids).
- **Surfaces:** Original and Switchback keep grass beyond the curbs (`track.apron`).
- **Same runs, same results:**
  - The grip, drift and reckless drivers, in Classic and Power, on both circuits, produce the
    **identical run** with and without the solid scenery: score, times, laps, combo and every
    step's position.
  - None of them touches the scenery.

## Automated qualification

### Unit tests (`npm test`)

**699 tests: 698 pass, 0 fail, 1 todo.** The todo is R1's Dockyard chicane cut. It still reproduces
(a 27.97 s cut lap against 29.62 s on the road) and is unchanged, still labelled as a known
limitation. R1 ended at 683 tests, with 682 passing and 1 todo.

**New: `test/scenery-r2.test.mjs`, 16 tests:**
- **Layouts:**
  - deterministic: two builds are identical;
  - pinned by prop count, collider count and content hash;
  - building a layout never touches the circuit.
- **Placement:**
  - the 24 m clearance;
  - the touch-or-7 m gaps, between solids and to the wall;
  - the flood fill (no enclosed pocket);
  - every gate open.
- **No invisible collision:**
  - every collider belongs to a drawn, raised prop and lies within what is drawn;
  - every raised prop in reach has a collider, and nothing flat has one;
  - paved ground lies only beyond the wall.
- **Surfaces:** everything flat drives as road, curb or grass by distance alone, and the gravel
  shoulders drive as grass.
- **Driving:**
  - grip, drift and reckless drivers in both modes give identical runs with and without the scenery;
  - running 16 m wide through every corner never meets the scenery and voids nothing;
  - scoring and records identities are untouched.
- **Contact:**
  - a tree, a pine, a rock, a stand and a retaining wall each stop the car at their outline, with no
    overlap;
  - a car centre inside a stand, or on a tree, is pushed out;
  - nothing tunnels at 2,400 m/s;
  - contact is identical at 30, 60 and 120 Hz.
- **Regression and cost:**
  - Dockyard's 31 R1 boxes are exactly as R1 built them;
  - layouts build in under 500 ms, and contact costs under 50 µs a step.

**Changed on purpose, with the reasons recorded in the tests:**
- **`test/environment.test.mjs`.** R1's "Original, Switchback, the practice pad and every gymkhana
  pad have no solid scenery" now reads: the pads have none, and Original and Switchback keep grass
  beyond the curbs and carry their R2 scenery.

### Browser tests (Chromium and Firefox, Playwright 1.64.1)

**All 19 browser checks pass**, run once in sequence on the final code, with logs in
`tmp/environment-r2/browser/`. The 19 are:
- every `test:*:browser` script;
- R1's `environment-browser.mjs`;
- the local-only `scenery-browser.mjs`;
- the new `scenery-r2-browser.mjs`.

None needed a rerun. R1's one `menus-browser` timeout didn't recur.

Two earlier attempts were aborted while the code was still changing: a stopped runner kept going
alongside a new one. They were discarded, and nothing from them is reported.

**New: `test/scenery-r2-browser.mjs`.** It compares against the R1 worktree, whose Original and
Switchback are v0.5.0's pixel for pixel.

| Check | Result (both browsers, 1366×768 and 1024×600) |
|---|---|
| Original and Switchback: road, curbs, markings and start line, under a mask 0.5 m and 2 px inside their edges | Pixel-identical at 10 poses × 2 modes |
| Original and Switchback minimap | Identical drawing commands |
| Dockyard at four corners and in the debug view, the practice pad, the title poster | Pixel-identical, whole frame |
| The real page: each circuit chosen by keyboard, Classic and Power, 10 s of driving | No page errors |

**Changed on purpose: `test/scenery-browser.mjs`** (R1's local-only v0.5.0 comparison).
- It compared Original's and Switchback's driving frames to v0.5.0 whole; the brief says not to
  require that.
- It now compares their title frames and every practice pad frame whole, and leaves the driving
  frames to the masked check above.
- The DPR 2 comparison uses the practice pad in place of Switchback.
- Dockyard's checks in it are unchanged.

### Rendering cost

Mean and 95th-percentile milliseconds to draw one frame, posed every 6 m around the lap with the
camera following, at 1366×768. Headless browsers render on the CPU, so a GPU-backed browser will be
faster; a 60 fps frame allows 16.7 ms.

| | Chromium, before | Chromium, R2 | Firefox, before | Firefox, R2 |
|---|---|---|---|---|
| Original | 1.70 / 2.2 | 2.34 / 3.5 | 1.82 / 3 | 2.53 / 4 |
| Switchback | 1.81 / 2.3 | 5.38 / 6.2 | 2.01 / 3 | 5.68 / 7 |
| Dockyard | 1.45 / 2 | 1.46 / 2 | 1.72 / 3 | 1.60 / 2 |

On the real page, each frame (simulation included) on Switchback took about 4.1 ms (Chromium) and
5.3 ms (Firefox).

**The first frame on a circuit builds its picture once.** That takes about 13 to 15 ms on Original
and 70 to 100 ms on Switchback (it was 230 to 330 ms before the hill was baked from one shared
height grid). It happens on the grid before the clock starts.

What made Switchback affordable:
- the hill is a 2 m-per-pixel image baked once and drawn without smoothing, instead of a gradient;
- the shoulders and ditches are drawn in 32 m pieces, and only the pieces in view;
- beyond the guardrail is darkened only where it is in view.

### Screenshots

- Before and after pairs for every pose, both browsers, and the collision view:
  `artifacts/r2/`.
- Whole-map overviews: `tmp/environment-r2/shots/`.
- A local page with everything side by side: `tmp/environment-r2/review.html`.

## Known limitations

1. **Dockyard's chicane can still be cut on the concrete for a counted lap**, about 1.6 s faster.
   This is R1's open defect, deferred as instructed. Its `todo` test is unchanged.
2. **Switchback's gravel shoulders, dry wash and bare earth drive as grass.** It's the existing loose
   surface, and the debug panel's `surface` says `grass` there. No new surface physics was added.
3. **Tree tops are drawn over the car**, as v0.5.0's trees were.
   - A tree's collider is 55% of its canopy, and a pine's 50%.
   - A stand's collider is its outline, about 2 m inside the canopy's edge.
   - So the car's nose tucks a little under the foliage when it touches.
4. **Running far wide in Power can scrape a Switchback retaining wall.**
   - At 16 m wide, there is no contact in either mode, on either circuit.
   - At 22 m wide (10 m past the curb), Classic never touches. Power touched retaining walls 4 times
     in 3 laps, at up to 2.7 m/s, 31 m from the centreline. That is well below the 6 m/s that loses
     a combo.
5. **Switchback's south-east woods leave a ride open** along the line the existing voided-lap tests
   cut across (see above). It reads naturally as a woodland ride, but its placement was chosen for
   the tests.
6. **Most of what lies beyond the wall is rarely on screen while driving.**
   - The camera shows about 47 m above and below the car, and the wall is 48 m from the track's
     outermost points.
   - What's beyond the wall shows mainly to either side on wide windows, near the wall and in the
     overview. That's why the visible detail was placed inside the wall, 24 to 47 m from the line.
7. **No weathering on the road.** The brief keeps road markings unchanged, so the worn, patched
   pavement is on the paddock and access roads beyond the wall.
8. **A hard hit on scenery reports "hit the wall"** in the combo message (R1).
9. **CI is untouched.**
   - The new unit tests run wherever `npm test` does.
   - `scenery-r2-browser.mjs` is local-only, because it needs a reference tree. It has no npm script,
     like R1's `scenery-browser.mjs`.
10. **Switchback is the most expensive circuit to draw** (about 5.5 ms in headless browsers against
    about 2.4 for Original). It's within budget, but worth watching on low-end phones.

## Human evaluation

Start the prototype, then drive each circuit in **Classic** and in **Power**. Press **D** at any time
to see the true collision outlines (orange) and the checkpoint gates.

**Original:**
1. Two clean laps. Does it still drive exactly as before, with clear racing lines?
2. Look along the main straight (pit garages, race control, grandstand), the infield paddock and the
   hairpin grandstand. Does it read as a believable small club circuit?
3. Spin off into the infield and recover. Is any copse, van or board somewhere you didn't expect
   something solid?
4. Run wide at the sweeper and the final corner, up to the tyre walls.

**Switchback:**
1. Two clean laps. Do the retaining walls and woods make the switchbacks feel more like a hillside
   road, and is the tight right well signposted?
2. Run wide out of the right-handers toward the retaining walls, especially in Power.
   - Is 19 m of grass and gravel past the curb enough?
   - Does a scrape feel fair?
3. Cut into the valley and drive back out. Do the woods feel solid where they look solid?

**Dockyard:** one lap, to confirm it looks and drives as R1.

**Questions for you:**
- Does Original now feel like a believable small racing circuit?
- Does Switchback have a distinct visual identity?
- Is either environment too cluttered?
- Do the backgrounds make driving more engaging?
- Are any obstacles frustrating or unexpectedly solid?
- Are racing lines still clear?
- Does the overall presentation feel consistent across all three circuits?

**Decisions this needs from you:** whether to keep, change or remove any particular feature, the
retaining-wall distance on Switchback, and whether to commit R1 and R2 together or separately.
R1's three decisions are still open too: the chicane fix, the records policy and the contact feel.

## Rerunning

From the worktree, with Node 24 on PATH:

```
npm test
node test/scenery-r2-browser.mjs D:/Projects/Steeped-in-Trouble/node_modules/playwright/index.mjs   # against R1 by default
sh tmp/environment-r2/run-browser.sh               # every browser check, logs in tmp/environment-r2/browser
node tmp/environment-r2/audit.mjs                  # clearance and gaps of every collider
node tmp/environment-r2/probe2.mjs                 # running wide by 16 and 22 m, both modes
node tmp/environment-r2/shots.mjs                  # before/after posed screenshots (tmp/environment-r2/shots)
node tmp/environment-r2/gallery.mjs                # tmp/environment-r2/review.html
```
