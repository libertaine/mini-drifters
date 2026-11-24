# Mini Drifters v0.8.0 — Getaway Driver and Polish

Version 0.8.0 adds **Getaway Driver**, delivers a full visual, UI and procedural audio polish pass across urban Getaway missions, all three circuits, the Practice Pad and Gymkhana, introduces cookie-free analytics and a tutorial usability fix, and ships on the risk-based parallel CI pipeline.

## What's new

- **Getaway Driver.** Under **Getaway → Getaway Driver → Downtown**, reach the safehouse without drawing the police. Speeding, drifting and crashes build **ATTENTION** (four times faster in a patrol cruiser's line of sight). If a patrol car gives chase, break contact and stay out of sight and 45 m clear of every pursuer for 5 seconds before the safehouse opens. Finishes classify as **Ghost run**, **Low profile**, or **Lost them**, with local completion counts per environment and handling mode stored under `mini-drifters-getaway-driver-v1`. See [Getaway Driver](GETAWAY-DRIVER.md).
- **Urban city, police and pursuit overhaul.** Dusk city lighting, detailed rooftops, street lamps, slipstream debris, realistic patrol interceptors with lightbars/vision cones/pursuit tire marks, crisp attention-to-pursuit HUD transitions, edge-of-screen critical vignette, procedural pursuit sirens, spotting radar ticks, impact/camera/escape audio cues, and distinct outcome racing stripes on results.
- **Offline "BUSTED!" announcer voice.** Getting busted by police triggers a punchy, offline retro-arcade announcer callout (`audio-lab/assets/busted-voice.wav`, generated locally with Kokoro-82M under the Apache License 2.0 and studio-mastered) while briefly ducking the active pursuit siren. Loaded lazily only in urban Getaway runs, with full mute, effects-volume, pause, focus-loss, restart-cancellation, and synthesized fallback support. See [LICENSE-AUDIO.md](../LICENSE-AUDIO.md) and [`audio-lab/assets/ATTRIBUTION.md`](../audio-lab/assets/ATTRIBUTION.md).
- **Tracks polish (Original, Switchback and Dockyard).** Circuit-themed overhead start/finish gantries positioned behind the checkered line with five live race-light pods, painted `P1` starting stalls and timing strips, smooth corner racing-line rubber grooves, bevelled outer curbs, upgraded pit garages/control tower/grandstands/foliage, fluttering marshal flags on Original, drifting hillside leaves on Switchback, and a weathered concrete Dockyard apron with crane rails, yard stencils, animated harbor water, seawall coping/fenders/bollards, ISO shipping containers, warehouse bays, motorsport corner boards, and gliding harbor gulls.
- **Practice Pad airfield (`SKIDPAD 01`).** Transformed into a weathered concrete airfield skidpad with 20 m bays, expansion joints, runway threshold bars, safety apron, painted drill zones (`DONUT PAD`, `FIGURE 8`, `180 TURN`, `SLALOM LANE`), 3D cones/pylons, and a live Practice Pad minimap.
- **Gymkhana visual and audio polish.** 3D-shaded autocross cones with smooth knock-over slide visuals and `+2 s` penalty pills, dark tarmac corridors, painted inside apex clipping curbs, pulsing gate beacons/chevrons, Precision 180 Turn-Zone activation flash (`TURN!`), Linked/One Drift gate-clear ripples (`SIDEWAYS!`), and Slalom Sprint sinusoidal weave guidance. Paired with tactile apex curb rumble on circuits, lap/best-lap/voided-lap chimes, combo tier-up and lost cues, wrong-way nudge, Turn-Zone lock, grip vs drifted gate pass, an ascending 7-note pentatonic Slalom Sprint scale, and tiered Gold/Silver/Bronze and New-Best finish fanfares.
- **Menus and HUD usability.** Live inline SVG circuit silhouettes and one-line circuit blurbs in **Tracks**, balanced 2×2 Gymkhana challenge grid, escalating drift combo heat (`×2` / `×3`) and low-grace warning, lap-cross panel glow, tiered medal/new-best racing stripes on results, and deterministic run-start banner reset.
- **Tutorial stationary-steering reminder.** Standing still during the steering step of **Try It** now prompts `Hold ↑ to get moving` so new players aren't stuck trying to steer at 0 mph.
- **Privacy-respecting Umami analytics.** The published GitHub Pages site counts visits, run starts/completions, valid laps, and active foreground play time using cookie-free Umami events under the `md_` namespace. No scores, times, inputs, records, ghosts or identifiers are sent, nothing is stored in the browser, Do Not Track / local play / automated browsers are never counted, and `?analytics=off` opts out cleanly. See [ANALYTICS](ANALYTICS.md).
- **Risk-based parallel CI.** Pull requests run targeted tiers determined from the base branch's classifier, while `main` and release qualification run the full unit suite plus all 26 Chromium and Firefox browser suites across four balanced parallel jobs before deploying to GitHub Pages. See [CI-TESTING](CI-TESTING.md).

## Compatibility

- Classic and Power handling physics, drift scoring, Gymkhana/Getaway medal thresholds, deterministic simulation and `GHOST_COMPATIBILITY` (`src/dockyard-scenery.js` untouched) are unchanged from v0.7.0.
- Existing circuit records (`mini-drifters-records-v3`), Gymkhana records (`mini-drifters-gymkhana-v1`), Get the Footage bests (`mini-drifters-getaway-v1`), reference ghosts (`mini-drifters-ghosts-v1`), and preferences keep their exact formats and keys.
- Getaway Driver stores completion counts under its own key (`mini-drifters-getaway-driver-v1`) and leaves all other keys untouched.
- If browser storage is unavailable, full or refused, gameplay continues cleanly and sheets note what could not be saved; data written by a newer schema version is preserved without modification.

## Known limits

- **Dockyard's chicane shortcut remains an accepted limitation.** Straight-lining across the concrete apron is approximately 1.6–1.8 seconds faster in scripted runs; its regression check in `test/environment.test.mjs` stays explicitly marked `TODO`.
- **Desktop browser focus.** Keyboard and standard-mapped controllers are supported; there are no touch controls.
- **Local-only storage.** Records, ghosts and Getaway Driver counts stay in this browser with last-write-wins behavior across simultaneous tabs and no in-game reset.
- **Controller test coverage.** Automated checks verify mocked standard controllers rather than exhaustive physical disconnect/reconnect hardware matrices.

## Qualification

Integrated via [PR #45](https://github.com/libertaine/mini-drifters/pull/45) → [PR #44](https://github.com/libertaine/mini-drifters/pull/44) → [PR #43](https://github.com/libertaine/mini-drifters/pull/43) → `main` (incorporating [PR #37](https://github.com/libertaine/mini-drifters/pull/37) on top of [PR #42](https://github.com/libertaine/mini-drifters/pull/42)).

- **Unit, session, publishing and CI-classifier suite (`npm test`)**: **949 total — 948 passed, 0 failed, 0 skipped, 1 accepted TODO** (Dockyard chicane).
- **Browser regression**: **All 26 CI browser suites passed in both Chromium and Firefox** (52 browser suite runs, zero page errors).
