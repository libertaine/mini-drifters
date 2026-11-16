# v0.5.0 R3 environmental polish review

16 November 2026. Local development candidate. **Status: R3 locally qualified, awaiting human acceptance.**

The first session was interrupted by a usage limit. A second session resumed it the same day. It kept the implementation and all completed evidence. It closed the remaining gaps and ran the performance comparison. The [Qualification](#qualification) section separates the two sessions' work.

## Final source identity

The baseline is the unchanged HEAD `259eb41d44a906bb14f869aba2ea24d846ce8411`, qualified R2. R3 is uncommitted on top of it. The qualified working tree is exactly that commit plus these files, given as git blob hashes from `git hash-object`:

| Status | Blob | File |
|---|---|---|
| Modified (R2 blob `d2e2474`) | `2107a1635fda4494088d72058c9115395b8ddcef` | `src/render.js` |
| New | `a3994d3710d28dbb5d51ce4a429c0e2e25bf7b3a` | `src/dockyard-scenery.js` |
| New | `7b9df404d4a328364c4ace136cf761907e574c9e` | `test/dockyard-scenery.test.mjs` |
| New | `126f33ca61ca58c15edccec0be0f02fc2edac173` | `test/scenery-browser.mjs` |
| New | this report | `docs/R3-REVIEW.md` |

No other file differs from 259eb41, tracked or untracked. `artifacts/` and `tmp/` hold the evidence and harnesses. R2's existing `.gitignore` already excludes both, and it is unchanged. The production source was last edited at 10:32 (`render.js`) and 10:33 (`dockyard-scenery.js`). Every qualification log was written after those times. The two R3 test files changed later, at 10:39 and 10:52, and the closeout runs below cover both.

## Build and isolation

- Worktree: `D:\Projects\mini-drifters-v0.5.0-r3`.
- Branch: `feature/v0.5.0-r3`.
- Unchanged HEAD and exact starting point: `259eb41d44a906bb14f869aba2ea24d846ce8411`.
- R1 [PR #25](https://github.com/libertaine/mini-drifters/pull/25) and R2 [PR #26](https://github.com/libertaine/mini-drifters/pull/26) were checked through the GitHub connector: both Draft, open and unmerged. R2's head matches the supplied qualified commit.
- Local build: <http://127.0.0.1:4270/>. The server binds only to `127.0.0.1`.
- No commit, push, PR mutation, merge, tag, release or deployment. Version remains **0.4.0**.
- Browser tests use new ephemeral contexts and random localhost ports. They never open the owner's browser profile or reuse the review origin's records.
- Existing worktree heads, status, tracked diffs and untracked file fingerprints are recorded in `artifacts/r3/other-worktrees-before.json` and checked again at closeout.

To start the build if it is no longer running, open PowerShell:

```powershell
Set-Location D:\Projects\mini-drifters-v0.5.0-r3
$env:PORT = '4270'
& D:\Projects\_tools\node-v24.22.1-win-x64\node.exe server.mjs
```

Open <http://127.0.0.1:4270/> in Chromium or Firefox. Keep the server running. Select Dockyard on the title screen, choose Classic or Power, and start. Use the normal keyboard or controller controls. Reuse this exact origin during review; existing origins keep their independent records.

## Changed files

| File | Purpose |
|---|---|
| `src/dockyard-scenery.js` | Fixed procedural industrial layout, viewport culling, ground, props and boards |
| `src/render.js` | Cache Dockyard's layout with the course; branch only its background/scenery rendering |
| `test/dockyard-scenery.test.mjs` | Four focused layout, clearance, isolation and direction tests |
| `test/scenery-browser.mjs` | Chromium/Firefox rendering comparisons, viewport checks, camera stability and visual evidence |
| `docs/R3-REVIEW.md` | Review instructions, qualification and release proposal |

The existing tests, package scripts, workflow, HTML, CSS, audio, tyre effects, physics, tuning, handling, scoring, tracks, laps, records, ghosts and Gymkhana code are unchanged from qualified R2. No dependencies or external artwork were added.

## Scenery and readability

Dockyard replaces its grass presentation with a muted concrete apron and low-contrast, world-anchored slab joints. The racing asphalt, white edge lines, red/white curbs, centre dashes, finish line and perimeter wall keep their original geometry and rendering.

Three ribbed warehouse silhouettes sit beyond the north/south perimeter. Nine muted rust, teal and olive containers form loading groups in the infield. Seven short concrete barriers and two restrained striped loading areas add industrial detail beside the quay and infield. All are decorative. There are **21 fixed props and four boards**, independent of elapsed time and effects state.

The course owns the layout, built once and reused on track switches. Props are culled against the camera, including their shadows. Ground joints cover only the visible region. No per-frame spawning, additional random generator, texture download or new rendering system is involved.

Boards have dark faces, cream rims/text and yellow route diagrams. The diagrams follow world-space travel direction; the entry and exit headings are tested against the actual track tangents.

| Board | Centre in world metres | Guidance |
|---|---|---|
| HOOK | `(100, -102)` | Quay approach heading east, bending south |
| TIGHTENS | `(190, -17)` | Outer Hook, heading south then west through the tightening section |
| CHICANE | `(8, -10)` | Westbound approach, left/right transition toward the south-west |
| BASIN | `(-88, 102)` | Westbound entry into the long clockwise return toward the quay |

Props are listed by centre in world metres, then width × height. All are decorative, with no collision.

| Kind | Count | Centres and size |
|---|---|---|
| Warehouse | 3 | `(-108, -149)` 72 × 26; `(35, -151)` 94 × 30; `(-24, 151)` 84 × 26. All three sit outside the perimeter wall. |
| Container | 9 | `(-67, -43)`, `(-37, -43)`, `(-7, -43)`, `(-67, -32)` and `(-37, -32)` at 24 × 8, in the infield group; `(110, -33)` and `(110, -44)` at 22 × 8, inside the Hook; `(-93, 30)` and `(-93, 41)` at 24 × 8, inside the Basin |
| Barrier | 7 | `(-60, -104)`, `(-46, -104)`, `(-32, -104)` and `(-18, -104)`, north of the quay; `(12, 52)`, `(26, 52)` and `(40, 52)`, south of the chicane exit. All are 10 × 2. |
| Loading stripes | 2 | `(-37, -56)` 82 × 5; `(-93, 53)` 26 × 5 |

Each board is 15 x 8 metres. At the smallest supported window and the fast-camera scale, its face is at least 92 x 49 CSS pixels. Every prop/board footprint, including shadow allowance, clears every road segment and curb by **at least four metres**. The road draws over the background; tyre marks, ghost, car and smoke draw afterwards. HUD and scoring feedback keep their original presentation. The minimap receives no scenery or new symbols.

## Visual evidence

The [local comparison gallery](../artifacts/r3/gallery.html) presents matched R2/R3 views. The renderer-only images use the same fixed car/camera and deliberately posed smoke/rubber in both trees, so they compare scenery without random tyre effects. They are visual evidence, not human playtest results. Real driven captures are also retained by the existing browser suites in `artifacts/`.

| View | Qualified R2 | R3 |
|---|---|---|
| Whole course | [Before](../artifacts/r3/chromium-r2-overview.png) | [After](../artifacts/r3/chromium-r3-overview.png) |
| Quay | [Before](../artifacts/r3/chromium-r2-quay.png) | [After](../artifacts/r3/chromium-r3-quay.png) |
| Hook entry | [Before](../artifacts/r3/chromium-r2-hook.png) | [After](../artifacts/r3/chromium-r3-hook.png) |
| Hook tightening | [Before](../artifacts/r3/chromium-r2-tightening.png) | [After](../artifacts/r3/chromium-r3-tightening.png) |
| Chicane | [Before](../artifacts/r3/chromium-r2-chicane.png) | [After](../artifacts/r3/chromium-r3-chicane.png) |
| Basin entry | [Before](../artifacts/r3/chromium-r2-basin.png) | [After](../artifacts/r3/chromium-r3-basin.png) |

Equivalent Firefox comparisons, both handling modes at 1024 x 600 and 1366 x 768, and DPR 2 captures are in the same folder. Automated bounds checks additionally cover 1280 x 720 and 1920 x 1080.

**Gallery validation (second session).** The isolated harness gives its canvas the same rules as the real page's `canvas#view`: a block element that fills the viewport, with no body margin. The backing store is then sized by the unchanged `resize()` at `innerWidth × min(DPR, 2)`. Both DPR 2 captures are 2048 × 1200 pixels, exactly 1024 × 600 × 2. They show the whole view, including the minimap in the bottom-right corner, so the earlier crop is gone.

Each R2/R3 pair uses one function, with the same car pose, camera position, zoom, viewport and posed effects. The overview pair overlays exactly in road geometry. The views cover the whole course, the quay, the Hook entry, the Hook tightening, the chicane and the Basin entry, in both engines.

Visual inspection found:
- All four boards are legible in the captures at 1024 × 600, 1366 × 768 and DPR 2.
- Their arrows point the way the car travels.
- No prop or shadow touches the asphalt, edge lines or curbs.

Original, Switchback, the practice pad and the title are checked by full-buffer fingerprints: 24 frames per browser, R2 against R3, all identical. Dockyard's minimap drawing operations are also identical to R2.

To rule out stale evidence, the second session first copied the gallery images, `gallery.html` and `scenery-results.json` to `artifacts/r3/preserved-session1/`. It then reran the scenery check on the final harness. All 58 PNGs and the results JSON came out byte-identical to the copies.

## Qualification

All results below are for the final tree in [Final source identity](#final-source-identity). They ran on Windows 11 with Node 24.22.1 and Playwright 1.64.1, using Chromium 156.0.8078.4 and Firefox 157.0, both headless.

| Check | Result | Evidence (`artifacts/r3/qualification/`) | Session |
|---|---|---|---|
| Unit tests | **659 / 659 pass, 0 skipped, 0 todo, 0 cancelled.** R2 had 655; R3 adds 4. | `unit.txt` (10:37, before the final edit to the board-direction assertion); `unit-final.txt` (10:46, after it); `unit-closeout.txt` (exit 0 recorded) | 1, and closeout rerun in 2 |
| 16 existing R2 browser suites | **16 / 16 pass in both Chromium and Firefox**, first attempt, exit 0, no retries | `summary.json` and one log per suite | 1 (confirmed complete in 2) |
| R3 scenery browser check | **Pass in both engines.** It covers 4 viewports, both handling modes, all 4 boards, 24 unchanged frames per engine, DPR 2, camera stability, the cached layout and effect resets. | `scenery-browser.txt` (session 1); `scenery-browser-final.txt` (closeout, exit 0) | 1, and rerun in 2 |
| R2 → R3 identity comparison | **11 / 11 pass.** 24 circuit runs and 12 Gymkhana runs are identical to R2 tick for tick. | `r2-r3-identity.txt`; `r2-r3-identity-final.txt` (closeout, exit 0) | 1, and rerun in 2 |
| Other worktrees untouched | **All 13 unchanged** in HEAD, status, tracked diff and untracked-file hashes | `../other-worktrees-before.json` and `../other-worktrees-after.json` | 2 |
| Play server | Serves the current R3 bytes: the `render.js`, `dockyard-scenery.js` and `index.html` hashes match the files on disk | — | 2 |

In session 1, the suites ran one at a time. The 16 suites are browser-check, audio-lab, coyote, gameplay-audio, ghost, radio, menus, tutorial, tracks, scoring, controller, records, handling, gymkhana, dockyard-slalom and wheelspin. I checked every log for two things. Each has both a Chromium and a Firefox section, and none has a failure marker. Every match for "skip", "retry" or "fail" is in a test's name, such as "steps can be skipped" or "Try again retry". None marks a skipped or retried test. Wheelspin also confirms that storage writes only to existing keys.

Coverage of the R3 scope by these checks:
- Physics, tuning, handling, scoring, game, laps, track, ghost, records, controls and controller are byte-identical to 259eb41.
- index.html, style.css, server, audio assets, radio, package.json and the version (0.4.0) are unchanged.
- There is no new storage key, and the records schemas are the same.
- The simulation imports neither the effects nor the audio.
- `tyre-effects.js` is byte-identical, so R2's accepted wheelspin behaviour cannot have changed. The wheelspin suite passes in both engines.

## Performance

These were measured in the second session after every qualification run had finished, with no test load running. Idle local servers on ports 4173, 4240, 4260 and 4270 stayed up. R2 and R3 were served from their own worktrees. Rounds alternated R2/R3 three times per scene, each in a fresh browser.

The conditions were headless desktop rendering, a 1366 × 768 viewport and DPR 1. Firefox's `privacy.reduceTimerPrecision` was off, so measured timer resolution was 0.02 ms in Firefox and 0.1 ms in Chromium. **This is relative evidence only. It says nothing about low-power or mobile devices.**

**Render-only harness** (`tmp/r3-perf-render.mjs` → `artifacts/r3/performance-render.json`). Each timed frame is `drawFrame` followed by a 1-pixel readback, so rasterisation is included. The camera uses the fast-camera zoom, the widest driving view.

Effects are posed at saturation:
- 1,800 skid segments, which is the cap, spread over a full lap, so all are drawn every frame.
- 110 live smoke puffs.

The "heaviest" pose is the centreline point with the most scenery inside the view: `(15, -78)` on the quay straight, with 13 of 25 items visible. The sweep moves the camera along all 416 centreline points for three laps.

| Scene: mean frame (p95), ms | Chromium R2 | Chromium R3 | Δ | Firefox R2 | Firefox R3 | Δ |
|---|---|---|---|---|---|---|
| Quay | 2.39 (2.87) | 2.16 (2.73) | −0.24 | 2.62 (3.05) | 2.47 (2.86) | −0.14 |
| Hook entry | 2.91 (3.47) | 2.71 (3.60) | −0.19 | 3.11 (3.49) | 2.90 (3.25) | −0.22 |
| Hook tightening | 2.92 (3.30) | 2.72 (3.10) | −0.21 | 3.23 (3.65) | 3.10 (3.50) | −0.13 |
| Chicane | 2.73 (3.33) | 2.43 (2.97) | −0.30 | 2.97 (3.43) | 2.79 (3.17) | −0.19 |
| Basin entry | 3.53 (4.50) | 3.18 (4.20) | −0.35 | 3.57 (3.93) | 3.40 (3.81) | −0.16 |
| Heaviest scenery view | 2.49 (2.97) | 2.19 (2.83) | −0.30 | 2.59 (2.85) | 2.49 (2.75) | −0.10 |
| Lap sweep, no effects | 1.67 (2.20) | 1.38 (1.83) | −0.29 | 1.68 (2.05) | 1.50 (1.87) | −0.18 |
| Lap sweep, saturated smoke + rubber | 2.93 (3.73) | 2.58 (3.23) | −0.36 | 3.13 (3.67) | 2.96 (3.54) | −0.17 |

R3 draws Dockyard slightly faster than R2 on average in every scene and in both engines. Across all paired rounds, R3 was lower in 46 of 48. The two exceptions were Chromium's Hook and Basin in round 2, which were within noise. Chromium's Hook p95 was also 0.13 ms higher for R3, also within noise.

A flat concrete fill with culled rectangles costs less to rasterise than the grass stripes, speckles and trees it replaces. Saturated smoke and rubber cost about the same extra in both trees: sweep with effects minus sweep without is about +1.2 ms in Chromium and +1.45 ms in Firefox. So the scenery does not make the effects more expensive.

**Culling and canvas calls per frame.** Counted along the centreline, untimed:

| | R2 | R3 |
|---|---|---|
| Scenery items drawn per frame | — | min 2, mean 5.7, max 13 of 25 |
| Canvas calls per frame | 149 – 167 (mean 152) | 220 – 536 (mean 323) |
| Whole course, nothing culled | 418 | 911 |

R3 makes more canvas calls, mainly for the slab joints, the ribbing on props and the board diagrams. Culling keeps that well under the unculled figure, and the timings show the calls are cheaper than R2's raster work.

**Bounded allocation.** The layout is built once per course and is the same object after 13 saturated laps (5,408 frames): 21 props, 4 boards and one cached course. Skids stay at the 1,800 cap and smoke at 110.

Chromium retained heap was measured after garbage collection, three rounds each, and gave the same numbers every round:

| | R2 | R3 |
|---|---|---|
| Before the sweep | 1,322,056 B | 1,380,096 B (+57 KiB of code and layout) |
| After 3 laps | +179,952 B | +179,868 B |
| After 10 more laps | +6,960 B | +8,340 B |

Growth over the last 10 laps is a few kilobytes in both trees, with no trend that depends on the scenery.

**Full game frame** (the prepared `tmp/r3-perf.mjs` → `artifacts/r3/performance.json`). This times the page's own animation-frame callback, which covers simulation, effects, drawing and the audio model. The page loop runs for 40 s per run, with real drivers, three rounds and alternating trees. The skid count reached the cap in every Dockyard run, and smoke was active.

| Scene: mean (p95), ms | Chromium R2 | Chromium R3 | Firefox R2 | Firefox R3 |
|---|---|---|---|---|
| Power donut on the practice pad, as a control with no scenery | 2.34 (0.20) | 2.33 (0.20) | 2.84 (3.80) | 2.83 (3.79) |
| Power drift driver on Dockyard | 2.00 (0.20) | 1.73 (0.30) | 2.26 (2.85) | 2.21 (2.79) |
| Classic drift driver on Dockyard | 1.81 (0.20) | 1.69 (0.30) | 2.02 (2.53) | 1.96 (2.47) |

In Chromium this callback only records canvas commands, which take about 0.1–0.3 ms per frame. Its mean is dominated by a few stalls of about 0.75–1.3 s that appear in **both** trees and every scene, the scenery-free pad included. They are probably deferred raster or GC under the mocked frame loop. They are not R3-related, and R3's worst stall on Dockyard was lower. That is why the render-only harness above is the main comparison. In Firefox the callback includes drawing, and R3 is 0.05–0.06 ms faster on Dockyard while the pad control is unchanged.

**Conclusion:** no performance regression was measured. No optimisation was attempted or is recommended.

### Qualification history

While developing the new checks, an incorrect practice-pad import was fixed and the clearance test caught boards that needed moving farther from the road. The first new minimap comparison also included the landscape showing through its translucent panel; the corrected check records the native minimap drawing operations instead. Visual inspection then caught missing CSS canvas sizing in the isolated screenshot harness at DPR 2; it was corrected to match the real page before regenerating the evidence. These were development corrections to new checks, not retries or changes to the existing R2 assertions. The full unit suite was run again after strengthening the new board-direction assertion to use real track tangents; both unit logs are retained. The final focused browser check was logged separately after the harness correction.

The second session changed no production or test source. It made only these harness and evidence changes:
- Turned off Firefox timer clamping in `tmp/r3-perf.mjs`, recorded the end-of-run effect counts there, and fixed its usage line.
- Added `tmp/r3-perf-render.mjs`.
- Added the `*-final.txt`, `unit-closeout.txt` and `perf-*.txt` logs, the after-inventory and `preserved-session1/`.

No existing evidence was deleted.

Evidence and reproduction commands:

```powershell
# Unit tests (set the Node folder on PATH if npm is unavailable)
$env:PATH = 'D:\Projects\_tools\node-v24.22.1-win-x64;' + $env:PATH
npm test

# All 16 existing browser suites, with separate logs (uses the existing pinned Playwright 1.64.1 installation)
node tmp/r3-run-matrix.mjs

# R3 focused browser checks and matched R2/R3 images
node test/scenery-browser.mjs D:/Projects/mini-drifters-scoring-v0.3.0/node_modules/playwright/index.mjs D:/Projects/mini-drifters-v0.5.0-r2

# Original R1/R2 comparison and its R3/R2 adaptation
node D:/Projects/mini-drifters-v0.5.0-r2-review/harness/verify-unchanged.mjs
node tmp/verify-r3.mjs

# Alternating R2/R3 frame-callback cost comparison
node tmp/r3-perf.mjs D:/Projects/mini-drifters-scoring-v0.3.0/node_modules/playwright/index.mjs

# Render-only R2/R3 cost per area, culling census and retained-heap check
node tmp/r3-perf-render.mjs D:/Projects/mini-drifters-scoring-v0.3.0/node_modules/playwright/index.mjs

# Re-inventory the other worktrees and compare with the session-1 snapshot
node tmp/r3-audit.mjs artifacts/r3/other-worktrees-after.json
```

Generated harnesses and evidence under `tmp/` and `artifacts/` are deliberately untracked. The focused browser comparison needs an R2 source directory; its optional final argument supports another location. It has not been added to hosted CI in this local-only phase. The four new unit tests are included by the existing `npm test` glob.

## Limits and human acceptance

Scenery has no collision geometry, including the decorative barriers and containers. Existing off-track surface behaviour remains unchanged under the apron artwork. Board positions are fixed; they do not provide racing-line or checkpoint instructions. The industrial palette and lettering are intentionally restrained; the owner must judge their usefulness at driving speed.

Known limitations for the reviewer:
- **The off-track surface now looks like concrete.** In R2 it was obviously grass. Its physics are unchanged: off-track is still off-track. The asphalt is darker than the apron, and the white edge lines and red/white curbs are unchanged, but whether the edge reads clearly at speed is a human judgement.
- **Board lettering is small at speed in the smallest window.** The label is about 10 CSS pixels at the fast-camera zoom at 1024 × 600, about 13 px at 1366 × 768 and about 18 px at 1920 × 1080. It is roughly 40% larger when the car is slow. The arrow diagram carries most of the meaning.
- **Boards stand beside their corners, not well before them.** Whether they are seen early enough at speed is a judgement for the reviewer.
- **The performance figures come from headless desktop runs.** They say nothing about integrated-GPU laptops, high-DPR displays at 4K or phones. Chromium's full-frame numbers include unexplained long stalls that occur equally in both trees.
- **The scenery check is not in hosted CI.** It needs a checkout of R2 to compare against.

Headless screenshots and scripted drives cannot establish human readability, enjoyment, physical controller feel or performance on another computer. Posed screenshots are labelled separately from driven evidence. R1/R2 human acceptance is already settled; this review concerns R3 and a short regression smoke check.

1. [ ] **Identity:** Dockyard reads as an industrial dockside, with apron, warehouses, containers, barriers and loading stripes, and it does not distract from sustained drifts.
2. [ ] **Hook and chicane boards:** in **Classic and Power**, HOOK, TIGHTENS and CHICANE are seen in time, are readable at speed, and their arrows match the corner.
3. [ ] **Basin entry:** the BASIN board makes the long clockwise return understandable on the approach, not only once you are in it.
4. [ ] **Sustained Power drifting:** through the Hook and Basin, the asphalt and curb edge stays obvious against the concrete apron. No prop hides the car, the road or scoring feedback.
5. [ ] **Effects:** smoke, rubber marks and the car stay easy to see on the darker scene, including after repeated drifts.
6. [ ] **Smoothness:** frame-rate feel and camera movement are smooth. Restart, pause/resume and switching tracks away and back show no hitch, at 1024 × 600 and at your usual window size, in Chromium and Firefox.
7. [ ] **Smoke checks elsewhere:** drive Original and Switchback briefly, drive one run in Classic, and start and retry one Gymkhana challenge. All look and play as they did in R2, including the accepted wheelspin smoke and engine note.

Record **R3 Human acceptance: PASS**, or identify the corner, handling mode, browser/window and requested visual correction. No commit or remote action is authorised by this review.

## Proposed v0.5.0 integration and release sequence

1. Obtain R3 human acceptance. Keep the accepted R1/R2 gameplay and wheelspin behaviour fixed. Any R3 correction gets fresh relevant checks; a changed candidate gets fresh qualification before delivery.
2. With separate authorisation, commit/push R3 and open a Draft PR stacked on qualified R2. Add the focused scenery browser check to the hosted setup with an exact R2 comparison checkout; qualify the exact R3 head locally and on hosted Chromium/Firefox.
3. Prepare one isolated final integration branch from then-current `main`, containing the accepted R1, R2 and R3 trees plus explicitly authorised v0.5.0 metadata/release notes. Prefer a single final integration PR so intermediate feature-only states do not reach production. Keep the existing Draft PRs and worktrees until their disposition is authorised.
4. Run the full final unit suite, all 16 existing browser suites plus the scenery comparison, simulation/storage compatibility checks, and hosted checks against the exact integration head. Review the final diff and preserve all evidence. Do not repeat settled routine human acceptance without a concrete regression.
5. Merge only under explicit merge/deployment authorisation. The current workflow deploys every push to `main`; merging is consequently also a production deployment decision. Verify the merge tree, hosted run, deployed asset hashes and live Chromium/Firefox smoke checks.
6. Under release authorisation, create the annotated `v0.5.0` tag and GitHub release against the verified final merge SHA, and verify the published release and site. Preserve all worktrees, earlier records and qualification evidence.

**Stop at the R3 human acceptance gate.** None of the proposed remote or release steps have been performed.
