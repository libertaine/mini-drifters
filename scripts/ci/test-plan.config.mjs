// What CI runs for a change, written out by hand. See docs/CI-TESTING.md.
//
// The selector (select-tests.mjs) only reads this file: every decision it makes comes from a
// rule here, and anything no rule covers gets the full regression. Keep it explicit. A rule
// that is too broad costs minutes; a rule that is too narrow lets a regression through, so
// when in doubt, put the path in a tier 3 rule.

// Every browser suite, by its npm script. `group` is the parallel CI job it runs in, and
// `seconds` is what it took on GitHub's runners (run 45100415390, PR #37), used only to keep
// the groups balanced. A suite that package.json defines but this list doesn't still runs in
// a full regression (in an "unassigned" group), and a unit test fails until it is added here.
export const SUITES = Object.freeze({
  'test:browser': { file: 'test/browser-check.mjs', group: 'menus-input', seconds: 32, about: 'The game served as on Pages, driven with real keys (the smoke test)' },
  'test:audio:browser': { file: 'test/audio-lab-browser.mjs', group: 'audio-lessons', seconds: 14, about: 'The development audio lab' },
  'test:coyote:browser': { file: 'test/coyote-browser.mjs', group: 'audio-lessons', seconds: 14, about: 'The Coyote voice in the audio lab' },
  'test:gameplay-audio:browser': { file: 'test/gameplay-audio-browser.mjs', group: 'audio-lessons', seconds: 126, about: 'Gameplay audio on the published files, and the fallback' },
  'test:ghost:browser': { file: 'test/ghost-browser.mjs', group: 'circuits', seconds: 50, about: 'The previous-lap ghost' },
  'test:reference-ghost:browser': { file: 'test/reference-ghost-browser.mjs', group: 'circuits', seconds: 53, about: 'The saved reference ghost, its storage and Options' },
  'test:radio:browser': { file: 'test/radio-browser.mjs', group: 'audio-lessons', seconds: 57, about: 'The radio' },
  'test:menus:browser': { file: 'test/menus-browser.mjs', group: 'menus-input', seconds: 22, about: 'The title screen and menus' },
  'test:tutorial:browser': { file: 'test/tutorial-browser.mjs', group: 'audio-lessons', seconds: 159, about: 'The driving lesson and Return to Title' },
  'test:tracks:browser': { file: 'test/tracks-browser.mjs', group: 'circuits', seconds: 208, about: 'Track choice and Switchback' },
  'test:scoring:browser': { file: 'test/scoring-browser.mjs', group: 'circuits', seconds: 5, about: 'Voided-lap warnings and results' },
  'test:controller:browser': { file: 'test/controller-browser.mjs', group: 'menus-input', seconds: 52, about: 'Mocked controllers' },
  'test:records:browser': { file: 'test/records-browser.mjs', group: 'circuits', seconds: 157, about: 'Local personal records' },
  'test:handling:browser': { file: 'test/handling-browser.mjs', group: 'menus-input', seconds: 315, about: 'Handling modes and the practice pad' },
  'test:gymkhana:browser': { file: 'test/gymkhana-browser.mjs', group: 'gymkhana-getaway', seconds: 56, about: 'Gymkhana challenges and their records' },
  'test:medals:browser': { file: 'test/medals-browser.mjs', group: 'gymkhana-getaway', seconds: 26, about: 'Gymkhana medals' },
  'test:categories:browser': { file: 'test/categories-browser.mjs', group: 'gymkhana-getaway', seconds: 29, about: 'Gameplay categories' },
  'test:getaway:browser': { file: 'test/getaway-urban-browser.mjs', group: 'gymkhana-getaway', seconds: 50, about: 'The Getaway mission' },
  'test:showmanship:browser': { file: 'test/getaway-showmanship-browser.mjs', group: 'gymkhana-getaway', seconds: 102, about: 'Getaway Showmanship and impact audio' },
  'test:getaway-records:browser': { file: 'test/getaway-records-browser.mjs', group: 'gymkhana-getaway', seconds: 143, about: 'Getaway personal bests, reloads and storage failures' },
  'test:dockyard-slalom:browser': { file: 'test/dockyard-slalom-browser.mjs', group: 'gymkhana-getaway', seconds: 97, about: 'Dockyard and Slalom Sprint' },
  'test:wheelspin:browser': { file: 'test/wheelspin-browser.mjs', group: 'audio-lessons', seconds: 74, about: 'Wheelspin smoke, rubber and engine note' },
  'test:environment:browser': { file: 'test/environment-browser.mjs', group: 'circuits', seconds: 10, about: 'Functional environments and collision messages' },
  'test:analytics:browser': { file: 'test/analytics-browser.mjs', group: 'menus-input', seconds: 79, about: 'Analytics gate, events and disclosure' },
  // v0.8.0 R1 (run 45119922651, PR #43). In the shortest group, whatever its name, so the slowest
  // job does not grow.
  'test:getaway-driver:browser': { file: 'test/getaway-driver-browser.mjs', group: 'audio-lessons', seconds: 54, about: 'Getaway Driver: the sheet, outcomes, completion counts and storage' },
  // v0.8.0 R2 polish checks, placed in the shortest group (`circuits`) to keep parallel CI balanced.
  'test:r2-polish:browser': { file: 'test/r2-polish-browser.mjs', group: 'circuits', seconds: 30, about: 'v0.8.0 R2 presentation, HUD polish, procedural SFX/siren lifecycle and reduced motion' },
  // v0.9.0 R1 four-circuit production integration checks, placed in `circuits` to keep parallel CI balanced.
  'test:circuits-r1:browser': { file: 'test/circuits-r1-browser.mjs', group: 'circuits', seconds: 32, about: 'v0.9.0 R1 seven-circuit Tracks UI, four new circuits gameplay, records, reference ghosts and layouts' },
});

// The parallel jobs, in the order they are listed in the run. Measured totals (s): circuits 483,
// menus-input 500, gymkhana-getaway 503, audio-lessons 498 (444 + 54 for Getaway Driver).
export const GROUPS = Object.freeze(['circuits', 'menus-input', 'gymkhana-getaway', 'audio-lessons']);

// Run in every tier 2 change, and in tier 1 when a published file changes: the whole game
// loads, every module imports, a run is driven with real keys, and no request leaves the page.
export const SMOKE = 'test:browser';

// What GitHub Pages publishes (the copy lines of the deploy job, checked by a unit test).
export const DEPLOYED = Object.freeze([
  'index.html', 'style.css', 'src/**', 'radio/**',
  'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/busted-voice.wav', 'audio-lab/assets/ATTRIBUTION.md', 'audio-lab/assets/coyote-local/idle.wav',
  'audio-lab/assets/coyote-local/mid.wav', 'audio-lab/assets/coyote-local/load.wav', 'audio-lab/assets/coyote-local/high.wav',
]);

// Suites whose checks involve the sound engine's state (gameplay audio, radio, the sound
// toggle, or audio() snapshots), for changes to the engine itself.
const AUDIO_SUITES = ['test:gameplay-audio:browser', 'test:radio:browser', 'test:wheelspin:browser', 'test:showmanship:browser',
  'test:tutorial:browser', 'test:menus:browser', 'test:controller:browser', 'test:tracks:browser', 'test:handling:browser',
  'test:reference-ghost:browser', 'test:r2-polish:browser'];
// Suites that drive a mocked Gamepad (navigator.getGamepads).
const CONTROLLER_SUITES = ['test:controller:browser', 'test:categories:browser', 'test:dockyard-slalom:browser', 'test:getaway:browser',
  'test:gymkhana:browser', 'test:handling:browser', 'test:medals:browser', 'test:records:browser', 'test:reference-ghost:browser',
  'test:getaway-driver:browser', 'test:circuits-r1:browser'];
// Everything that opens the Gymkhana or Getaway sheets, HUD or results.
const CHALLENGE_SUITES = ['test:gymkhana:browser', 'test:medals:browser', 'test:categories:browser', 'test:getaway:browser',
  'test:showmanship:browser', 'test:getaway-records:browser', 'test:dockyard-slalom:browser', 'test:getaway-driver:browser',
  'test:r2-polish:browser'];
const GETAWAY_SUITES = ['test:getaway:browser', 'test:showmanship:browser', 'test:getaway-records:browser', 'test:categories:browser',
  'test:getaway-driver:browser', 'test:r2-polish:browser'];

// Path rules. `paths` are globs: `*` stays within a folder, `**` crosses folders. A file can
// match several rules: the highest tier wins and the suites add up. A changed file no rule
// matches is unknown, and unknown means tier 3. Browser test files get a rule of their own
// from SUITES (a change to one runs that suite), so they are not listed here.
//
// Tier 1: nothing that runs in the browser changes. The unit suite (which includes the
//   publishing checks) always runs; the smoke suite runs too if a published file changed.
// Tier 2: one well-bounded area. Unit suite + smoke suite + the area's suites.
// Tier 3: everything.
export const RULES = Object.freeze([
  // --- Tier 3: the simulation, rules, persistence, shared glue and the CI itself -------------
  { id: 'ci', tier: 3, paths: ['.github/**', 'scripts/ci/**'], why: 'The CI workflow or the test selection itself changed' },
  { id: 'package', tier: 3, paths: ['package.json', 'package-lock.json', '.gitattributes'], why: 'Scripts, versions or checkout settings shared by every test' },
  { id: 'test-shared', tier: 3, paths: ['test/support/**', 'test/fixtures/**'], why: 'Drivers, baselines and fixtures shared by many suites' },
  { id: 'page', tier: 3, paths: ['index.html', 'style.css'], why: 'The page and stylesheet every screen and every layout check depends on' },
  { id: 'glue', tier: 3, paths: ['src/main.js', 'src/render.js'], why: 'Browser glue and drawing for every mode: too broad to bound by file' },
  { id: 'simulation', tier: 3, why: 'Driving physics, handling, tuning, the session lifecycle, input commands or scoring',
    paths: ['src/physics.js', 'src/tuning.js', 'src/handling.js', 'src/game.js', 'src/controls.js', 'src/scoring.js', 'src/laps.js'] },
  { id: 'circuits', tier: 3, why: 'Circuit, pad or scenery geometry, which the simulation collides with',
    paths: ['src/track.js', 'src/practice-pad.js', 'src/obstacles.js', 'src/scenery.js', 'src/scenery-original.js', 'src/scenery-switchback.js',
      'src/scenery-helpers.js', 'src/scenery-runway.js', 'src/scenery-mesa.js', 'src/scenery-headland.js', 'src/scenery-nightshift.js', 'src/dockyard-scenery.js'] },
  { id: 'challenges', tier: 3, why: 'Gymkhana and Getaway rules, missions, police, city and medals',
    paths: ['src/gymkhana.js', 'src/getaway-urban.js', 'src/getaway-city.js', 'src/getaway-nav.js', 'src/getaway-pursuer.js', 'src/getaway-missions.js', 'src/getaway-driver*.js', 'src/medals.js'] },
  { id: 'persistence', tier: 3, why: 'Saved records, ghosts or preferences, and their storage formats',
    paths: ['src/records.js', 'src/gymkhana-records.js', 'src/getaway-records.js', 'src/getaway-driver-records.js', 'src/ghost.js', 'src/ghost-store.js', 'src/reference-ghost.js',
      'src/ghost-preferences.js', 'src/handling-preferences.js', 'src/audio-preferences.js'] },
  { id: 'radio-catalogue', tier: 3, paths: ['src/radio-stations.js'], why: 'The radio file list, which most browser suites serve files from' },

  // --- Tier 2: bounded areas -------------------------------------------------------------------
  { id: 'tutorial', tier: 2, paths: ['src/tutorial.js'], suites: ['test:tutorial:browser'], why: 'The driving lesson: only main.js reads it, only while a lesson runs' },
  { id: 'analytics', tier: 2, paths: ['src/analytics.js', 'src/analytics-tracker.js'], suites: ['test:analytics:browser'], why: 'The optional analytics observer, which changes nothing in the game' },
  { id: 'radio', tier: 2, paths: ['src/radio.js', 'radio/*/**'], suites: ['test:radio:browser', 'test:gameplay-audio:browser'], why: 'Radio playback and its music files' },
  { id: 'audio-voices', tier: 2, why: 'Engine, tyre and impact voices inside the sound engine',
    paths: ['src/audio-voices.js', 'src/audio-telemetry.js', 'src/coyote.js', 'src/coyote-model.js', 'src/getaway-sfx.js'],
    suites: ['test:gameplay-audio:browser', 'test:wheelspin:browser', 'test:showmanship:browser', 'test:radio:browser', 'test:r2-polish:browser'] },
  { id: 'audio-engine', tier: 2, paths: ['src/audio.js'], suites: AUDIO_SUITES, why: 'The sound engine, which several suites check the state of' },
  { id: 'audio-assets', tier: 2, why: 'Published engine, tyre and busted voice recordings',
    paths: ['audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/busted-voice.wav', 'audio-lab/assets/coyote-local/**'],
    suites: ['test:gameplay-audio:browser', 'test:coyote:browser', 'test:audio:browser', 'test:wheelspin:browser', 'test:r2-polish:browser', 'test:getaway-driver:browser'] },
  { id: 'audio-lab', tier: 2, why: 'The development audio lab, which is not published',
    paths: ['audio-lab/*.js', 'audio-lab/*.html', 'audio-lab/*.css', 'audio-lab/assets/engine-*.wav'], suites: ['test:audio:browser', 'test:coyote:browser'] },
  { id: 'local-server', tier: 2, paths: ['server.mjs'], suites: ['test:audio:browser', 'test:coyote:browser', 'test:gameplay-audio:browser'], why: 'The local server, which these suites start' },
  { id: 'controller', tier: 2, paths: ['src/controller.js'], suites: CONTROLLER_SUITES, why: 'Gamepad reading, used by the suites that mock a controller' },
  { id: 'tyre-effects', tier: 2, paths: ['src/tyre-effects.js'], suites: ['test:wheelspin:browser'], why: 'Smoke and rubber drawing, measured by the wheelspin suite' },
  { id: 'scenery-draw', tier: 2, paths: ['src/scenery-draw.js'], suites: ['test:environment:browser', 'test:tracks:browser', 'test:dockyard-slalom:browser', 'test:r2-polish:browser', 'test:circuits-r1:browser'], why: 'Drawing of circuit scenery (not its collision shapes)' },
  { id: 'challenge-ui', tier: 2, paths: ['src/gymkhana-ui.js', 'src/gymkhana-draw.js'], suites: [...CHALLENGE_SUITES, 'test:menus:browser', 'test:controller:browser'],
    why: 'The Gymkhana and Getaway sheets, HUD, results and drawing' },
  { id: 'getaway-draw', tier: 2, paths: ['src/getaway-urban-draw.js'], suites: GETAWAY_SUITES, why: 'Drawing of the Getaway city' },

  // --- Tier 1: nothing the browser runs changes --------------------------------------------------
  { id: 'docs', tier: 1, paths: ['README.md', 'docs/**', 'LICENSE', 'LICENSE-AUDIO.md'], why: 'Documentation, README media and licences (the publishing checks read some of them)' },
  { id: 'attribution', tier: 1, paths: ['radio/ATTRIBUTION.md', 'audio-lab/assets/ATTRIBUTION.md'], why: 'Published attribution text, checked against the files by the unit suite' },
  { id: 'repo-meta', tier: 1, paths: ['.gitignore', 'Start Game.cmd'], why: 'Repository metadata and the local launcher' },
  { id: 'unit-tests', tier: 1, paths: ['test/*.test.mjs'], why: 'A unit test: the unit suite runs it' },
  { id: 'local-checks', tier: 1, paths: ['test/scenery-browser.mjs', 'test/scenery-r2-browser.mjs'], why: 'Local comparison checks against reference trees, never run in CI' },
  { id: 'asset-tools', tier: 1, paths: ['scripts/coyote-*.mjs', 'scripts/radio-test-tracks.mjs'], why: 'Offline tools that generate committed assets; the assets themselves have their own rules' },
]);
