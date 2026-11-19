# v0.6.0 R1: Dockyard environmental interaction prototype

> Historical prototype report. The owner subsequently accepted R1/R2 gameplay and scenery for v0.6.0. The chicane shortcut is accepted, records keep their existing identities, and hard scenery-hit wording is corrected in the release. Current decisions and release scope: [v0.6.0 notes](RELEASE-v0.6.0.md). The prototype evidence and evaluation instructions below describe the earlier gate.

**Status: prototype, stopped at the human evaluation gate.** Nothing here is committed, pushed,
merged, tagged or deployed. Human driving is the acceptance gate for feel. The scripted drivers
below measure rules and integrity, not feel.

| | |
|---|---|
| Worktree | `D:\Projects\mini-drifters-environment-v0.6.0-r1` |
| Branch | `feature/environment-v0.6.0-r1` (local, no upstream, no commits) |
| Baseline | `f7ad948754fad0cdad7c3b57394d251239033c62` (`origin/main`). Its code is identical to the v0.5.0 tag (`a044dde`); only `README.md` and `docs/DEVELOPMENT.md` differ. |
| Play it | Double-click `tmp\environment-r1\Start Prototype.cmd`, or run `PORT=4280 node server.mjs` in the worktree, then open <http://127.0.0.1:4280> |

Port 4280 is a browser origin no Mini Drifters build has used, so records saved while playing
the prototype stay there. They never reach the live game (GitHub Pages) or the usual local port
(4190).

## What changed

### 1. Physical surface separate from the competition rules

- `track.js`: each circuit can name its **apron**, the physical ground beyond the curbs. Dockyard's
  is `concrete`; any circuit that names none keeps `grass`. `surfaceFromDistance` returns road,
  curb or the apron. A new `isOnCourse(track, distance)` is the rule: the course is the road and
  curbs, whatever lies beyond them.
- `physics.js`: concrete drives **exactly as asphalt** (traction 1, engine 1, no extra drag) in both
  handling modes. No grip difference was introduced. Grass and curb are untouched.
- `scoring.js`: the "off road" drift reason and the 1.5 s off-track combo loss read `offCourse`
  instead of `surface === 'grass'`. Without the flag they fall back to grass, which is what the
  gymkhana pads (which already did this split) and older callers pass.
- `game.js`: each step computes `game.onCourse` and hands it to the scoring.
- `TUNING`, both handling modes, the scoring identity (`scoring-2`), laps, checkpoints and records
  are unchanged. Original and Switchback have grass aprons and drive bit-for-bit as before.

### 2. Solid scenery

- New `src/obstacles.js` turns Dockyard's existing scenery layout (`dockyard-scenery.js`, the same
  data the picture is drawn from) into axis-aligned collision boxes. No coordinate is repeated.
  - **Solid:** 3 warehouses, 9 containers and 7 concrete barriers.
  - **Not solid:** the painted loading bays, the slab joints and the corner boards.
- **Filled gaps:** gaps narrower than 7 m between two solid props are filled, so the 4.4 m car
  can't wedge into them. There are 12 fillers: between stacked containers, between the barrier
  pieces and in the container group's 6 m alley. A filled gap is hit as what it joins.
- **The car's shape:** it is the 2.2 m circle the perimeter wall already uses.
- **Contact:**
  - The car is pushed out to the surface and keeps 30% of its speed into it as bounce, the same
    restitution as the perimeter wall.
  - It loses speed along the surface in proportion to how hard it hit: a glancing touch slides
    on, a square hit stops it.
  - Spin is damped by up to 40% on a significant hit.
  - A hit at 6 m/s or more into the surface (the existing `barrierSignificantImpact`) loses the
    unbanked combo, as the wall does.
  - Moves longer than 0.5 m are swept, so no speed tunnels through. Top speed covers 0.35 m per
    step and the thinnest solid is 6.4 m deep once the car's radius is added.
- **Placement:**
  - Contact runs inside the fixed 120 Hz step, so it is deterministic and independent of the
    frame rate.
  - The perimeter wall is unchanged.
  - Every solid box is at least 20 m from the centreline, 8 m past the curb, so nothing solid
    touches a car on the road or curbs.
- **The warehouses are solid but stand beyond the perimeter wall**, as v0.5.0 placed them. The wall
  is what a car meets first, so in play only containers and barriers can be hit.

### 3. Debug view (D only)

The debug view adds:
- the collision boxes, with filled gaps dashed;
- the car's contact circle, green when on the course and red when off it;
- the last hit, as a marker that fades over a second (red if it was significant).

The panel gains `course` (on, or OFF with no drift points) and `contact` (kind, speed, HARD,
age). Nothing new is drawn or shown in normal driving, and the browser check counts the overlay's
pixels to confirm it.

## Track integrity (Phase 3)

### Method

All of this was measured with the real car, through the real physics, contact, laps and scoring.
- **Drivers:** the repo's own `gripDriver` and `driftDriver`, each steered along a scripted line
  (a chord, or an offset from the centreline). The line is built into a track by the same builder
  the circuits use. They press on/off keys 15 times a second and back off when pinned, as a
  person would.
- **Environments:**
  - **v050**: grass apron, no solids.
  - **concrete**: concrete apron, no solids.
  - **proto**: this build.
- **Harness:** `tmp/environment-r1/integrity.mjs`, `chord-sweep.mjs` and `legit-cost.mjs`, with
  their outputs beside them.

### Results

| Scenario | v0.5.0 | Prototype |
|---|---|---|
| On-road reference lap, Classic / Power | 29.62 / 29.89 s | identical, bit for bit |
| 1. Bypassing the Hook (quay to acceleration zone) | void | void |
| 1. Straight across the Hook's opening or tightening | counts, slower than the road | counts, still slower than the road |
| 2. Across the loading areas and infield to the chicane | void | void |
| 3. Straight-lining the chicane (s 360 to 560) | counted only when slower than the road | **counts, 1.64 s (Classic) / 1.81 s (Power) faster** |
| 4. Across the Basin | void | void |
| 4. Late rejoin of the Basin | counts, 2.8 s slower | counts, 0.9 s slower |
| 5. Drift points while off the course | 0 | **0 in every run** |
| 6. Running wide 16 or 28 m in every corner | valid, very slow | valid, far less punishing |
| 6. Handbrake-hauler spinning off and recovering | 0 voids (Classic), 1 to 8 (Power) | **0 voids** (it no longer crawls on grass) |

Two pins in `test/dockyard.test.mjs` encoded "the apron is grass", and both were updated:
- the grip driver's "no grass" is now "never off the course";
- the Power handbrake-hauler's 1 to 8 voids at the Basin entry are now 0, with the reason
  recorded.

### The open problem: the chicane cut

The checkpoints were designed when off-road was slow. On concrete, a straight line from the end
of the acceleration zone across the insides of both chicane bends to the Basin entry gives a
**counted lap about 1.6 to 1.8 s (6%) faster than the road**.
- It crosses checkpoint 8 at its inside tip, 22 m from the centreline (10 m past the curb), and
  checkpoint 9 near its tip.
- Sweeping every chord of the lap, 588 per configuration, found every meaningful gain around the
  chicane, plus one from the Hook's exit into it.
- The checkpoint system as it stands **cannot** tell this cut apart from a driver running deep on
  the inside.
- It is recorded as an explicit `todo` test in `test/environment.test.mjs`, so it is visible
  without failing the suite.

**Proposed smallest correction, for your choice (neither is implemented):**

| Option | Change | Best counted gain from cutting (Classic / Power) | Cost to legitimate drivers |
|---|---|---|---|
| none (this prototype) | | 1.64 / 1.81 s | |
| **B. Apex blocks (recommended)** | Solid blocks or bollards on the inside of both chicane apexes, 17 m from the centreline (5 m past the curb). Scenery, not rules: it uses this R1 foundation as a physical track limit. | 0.37 / 0.45 s, the same as the v0.5.0 noise floor of 0.42 s | 0 extra voids; the Classic hauler brushed them 25 times in 36 laps (score −4%) |
| A. Tighter inside checkpoints on Dockyard | Dockyard-only inside margin 10 m → 4 m (each inside tip 16 m from the centreline). | 0.67 s (Classic) | 1 extra void in 37 Power hauler laps |

Option B needs a visual design pass, because its blocks are new props. Option A changes
Dockyard's pinned checkpoints, which are the accepted circuit, and doesn't fully close the cut.
Original and Switchback are affected by neither. "Noise floor" is how much the scripted grip
driver gains on v0.5.0 just by having its line tidied on the road.

## Automated qualification (Phase 5)

### Unit: `npm test`

**683 tests: 682 pass, 0 fail, 1 todo** (the chicane cut above). The baseline before any change was
659/659.
- 24 new tests are in `test/environment.test.mjs`.
- 4 assertions were updated in `test/dockyard.test.mjs`, as described under Results.

The new tests cover:
- **Surfaces:**
  - which apron each circuit has, and what counts as on the course;
  - concrete has asphalt factors in both modes;
  - road, curb and grass match v0.5.0's physics to 6 decimals, pinned against `a044dde`;
  - concrete is bit-for-bit road;
  - the transition off Dockyard's road keeps full traction, while Original's blends to grass.
- **Collisions:**
  - the boxes are exactly the layout's props, plus filled gaps;
  - no box can touch a car on the road or curbs;
  - warehouse, container and barrier impacts, including a barrier at top speed;
  - no tunnelling, even at a synthetic 2,400 m/s;
  - a glancing touch slides and keeps more than 90% of its speed without being a hard hit;
  - a low-speed push rests without jitter or creep;
  - escape from a face and from a concave container corner;
  - paint, slab joints and boards are never solid;
  - determinism at 30, 60 and 120 Hz.
- **Scoring and laps:**
  - off-course concrete pays nothing;
  - the 1.5 s combo loss;
  - "off road" in the live game;
  - a hard hit loses the combo and a nudge doesn't;
  - drifting 20 m outside every corner pays 0 off the course and voids nothing;
  - the obvious shortcuts still void on concrete;
  - circling on the apron earns nothing.
- **Regression:**
  - Original, Switchback, the practice pad and all four gymkhana pads have no solids and no new
    surface;
  - full drift runs on Original and Switchback never touch scenery.
  - The existing Classic and Power baselines (`keyboard-baseline.json`, `power-drive-baseline.json`)
    and every Original, Switchback, practice-pad and gymkhana test pass unchanged.

### Browser (Chromium and Firefox, Playwright 1.64.1)

**All 18 browser checks pass.** That is every `test:*:browser` script, the local-only
`scenery-browser.mjs` and the new `environment-browser.mjs`. Each ran in sequence, with logs in
`tmp/environment-r1/browser/`.

- **New `test/environment-browser.mjs`.** It chooses Dockyard by keyboard in Classic and in Power,
  and checks:
  - the apron drives as concrete (traction 1) and is off the course;
  - a container stops the car;
  - the debug view shows the boxes, `course` and `contact` only after D, and draws no collision
    outline in normal driving (checked by counting the overlay's pixels);
  - there are no page errors.
- **`dockyard-slalom-browser`** drives Dockyard for three laps in Classic and in Power on the real
  page, with the solid scenery in place.
- **`scenery-browser`** compares against the v0.5.0 R2 build. Original, Switchback, practice and
  the title are pixel-identical, and Dockyard's drawing is unchanged.
- **One flake.** `menus-browser` timed out once in Chromium (a 30 s `waitForFunction`, on a step
  that starts a normal run on Original, not Dockyard). Firefox passed that run. Rerun on its own,
  it passed in both browsers. That page path doesn't touch anything this prototype changed.

## Records and compatibility (Phase 6)

**Nothing about records was changed.**
- No key, schema, scoring id or handling id is new. Dockyard records still go under
  `mini-drifters-records-v3` → `dockyard` → mode.
- Browser tests run on throwaway origins and random ports, and the playable prototype runs on its
  own port.

Are v0.5.0 Dockyard records comparable with the prototype? **Not fairly.** Measured with the
repo's drivers, median of 6 starts:

| | v0.5.0 | Prototype |
|---|---|---|
| Clean grip laps, Classic / Power | 29.52 / 29.70 s | identical |
| Classic drifter score | 4,337 | identical |
| Power drifter, best lap / score | 40.42 s / 9,385 | 39.70 s / 10,486 (+12%) |
| Handbrake-hauler score, Classic / Power | 898 / 959 | 1,074 / 1,340 (+20% / +40%) |
| Chicane cut | slower than the road | 1.6 to 1.8 s a lap faster |

Clean driving is unchanged. But any excursion off the road is now far cheaper, and the chicane
cut is open, so new Dockyard times and scores would beat v0.5.0 ones for reasons other than skill.

**Recommended policy (not implemented):**
1. Give Dockyard's environment a stable identity, for example `dockyard-env-1`, the way
   `scoring-2` names the scoring rules.
2. File new Dockyard bests under it, and show v0.5.0's Dockyard bests as "legacy (v0.5.0 layout)",
   as `scoring-1` legacy bests are shown today.
3. Original and Switchback records are unaffected and need nothing.
4. Fix the identity only after the chicane correction is chosen, because that correction moves
   lap times again.

## Known limitations and open defects

1. **The chicane cut counts on concrete**, as described above. It is the one open integrity defect.
2. **The car is a 2.2 m circle** for contact, as it already is for the perimeter wall.
   - Nose-on, it stops where its nose meets the face.
   - Side-on, it stops about a metre short of the paint.
3. **The warehouses can't be reached.** They are solid but stand beyond the perimeter wall, so
   only containers and barriers matter in play. Moving them inside would be a layout change.
4. **One concave container bay**, around (−20, −40), faces the acceleration zone from about 30 m.
   - A car that wanders into it can need a three-point turn.
   - It reverses out freely (tested).
   - A scripted wandering driver that never reverses got pinned there; a person won't.
5. **A hard hit on scenery reports "hit the wall"** in the combo message, as the perimeter does.
6. **Corner boards are decorative**, as specified for R1.
7. **CI is untouched.** `test/environment-browser.mjs` has an npm script
   (`test:environment:browser`) but isn't wired into `ci.yml`.

## Suggested human test route (about 15 minutes)

Start the prototype, choose **Dockyard**, and drive each step in **Classic**, then in **Power**.

1. **Two clean laps.** Does Dockyard feel the same as v0.5.0 on the road? It should: nothing on
   the road changed.
2. **Run wide on purpose** at the Hook's exit and the Basin, then rejoin. Does the concrete feel
   natural, and does the recovery feel fair rather than punishing? The lap should still count.
3. **Drift out onto the concrete.** The combo should stop earning at once and be lost after
   1.5 s. Press **D** to watch `course` and `surface`.
4. **Hit things:**
   - the containers inside the Hook, square at speed and then glancing;
   - the barrier row beyond the quay's outside edge;
   - the barriers south of the acceleration zone.

   Does contact feel consistent with the perimeter wall and the arcade handling? Is anything
   sticky, jittery or explosive? Does a hard hit lose the combo, and a scrape not?
5. **Get stuck if you can**, in the container group south of the quay and its bay. Reverse out.
6. **Try to cheat:**
   - cut the chicane in a straight line from the end of the acceleration zone to the Basin entry
     (expected to count: the open problem);
   - cut across the Hook and the Basin (expected to void).
7. **Overall:** does solid scenery make Dockyard more interesting to drive? Is any placement
   frustrating? Does either mode behave unexpectedly?

**Decisions this needs from you:**
1. The chicane correction: B, A, or something else.
2. The records policy.
3. Whether the contact feel (the bounce and the 0.3 scrub) is right before it is tuned at all.

## Rerunning

From the worktree, with Node 24 on PATH:

```
npm test
node test/environment-browser.mjs D:/Projects/Steeped-in-Trouble/node_modules/playwright/index.mjs
node tmp/environment-r1/integrity.mjs               # Phase 3 scenarios, three environments
node tmp/environment-r1/chord-sweep.mjs 10 proto classic [apex]   # every chord; [margin env mode]
node tmp/environment-r1/legit-cost.mjs              # cost of options A and B to legitimate drivers
node tmp/environment-r1/records-compare.mjs         # Phase 6 comparison
sh tmp/environment-r1/run-browser.sh                # every browser check, logs in tmp/environment-r1/browser
```
