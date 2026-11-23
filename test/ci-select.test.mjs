// The CI test selection (scripts/ci): which tier and suites a change gets, that it fails
// closed, and that its rules still match the repository and the workflow. See docs/CI-TESTING.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CONFIG from '../scripts/ci/test-plan.config.mjs';
import { changedFiles, globToRegExp, parseNameStatus, plan, rulesFor, suitesIn } from '../scripts/ci/select-tests.mjs';
import { verify } from '../scripts/ci/verify-results.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const AVAILABLE = suitesIn(pkg);
// The suite list once PR #37's analytics suite is in package.json.
const WITH_ANALYTICS = [...AVAILABLE.filter((s) => s !== 'test:analytics:browser'), 'test:analytics:browser'];
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n/g, '\n');

const pr = (files, available = AVAILABLE) => plan({ event: 'pull_request', available,
  changes: files.map((f) => (typeof f === 'string' ? { status: 'M', path: f } : f)) });
const names = (p) => p.selected.map((s) => s.suite).sort();
const SMOKE = 'test:browser';

// --- 1. The scenarios ----------------------------------------------------------------------------
test('README only: tier 1, the unit suite and no browser suite', () => {
  const p = pr(['README.md']);
  assert.equal(p.tier, 1);
  assert.equal(p.full, false);
  assert.deepEqual(names(p), []);
  assert.equal(p.unit, true);
  assert.equal(p.skipped.length, AVAILABLE.length, 'every suite is listed as left out');
});

test('README image replacement and other documentation: tier 1', () => {
  for (const files of [['docs/media/title_screen.png'], ['docs/media/mini_drifter1.gif', 'README.md'], ['docs/GHOST.md', 'docs/ROADMAP.md'],
    ['LICENSE-AUDIO.md'], ['.gitignore'], ['Start Game.cmd'], ['test/physics.test.mjs'], ['docs/COYOTE-PROVENANCE.json']]) {
    const p = pr(files);
    assert.equal(p.tier, 1, files.join());
    assert.deepEqual(names(p), [], files.join());
  }
});

test('published attribution text: tier 1 with the smoke test, because it is deployed', () => {
  for (const file of ['radio/ATTRIBUTION.md', 'audio-lab/assets/ATTRIBUTION.md']) {
    const p = pr([file]);
    assert.equal(p.tier, 1, file);
    assert.deepEqual(names(p), [SMOKE], file);
    assert.match(p.selected[0].reasons.join(), /published/);
  }
});

test('tutorial hint change: tier 2, the lesson suite and the smoke test', () => {
  const p = pr(['src/tutorial.js']);
  assert.equal(p.tier, 2);
  assert.deepEqual(names(p), [SMOKE, 'test:tutorial:browser'].sort());
  assert.match(p.selected.find((s) => s.suite === 'test:tutorial:browser').reasons[0], /src\/tutorial\.js \(tutorial\)/);
  // A change to the lesson and its tests is still tier 2.
  assert.equal(pr(['src/tutorial.js', 'test/tutorial.test.mjs', 'test/tutorial-browser.mjs']).tier, 2);
});

test('analytics only: tier 2 once its suite exists, and the full regression until then', () => {
  const files = ['src/analytics.js', 'src/analytics-tracker.js', 'test/analytics.test.mjs', 'docs/ANALYTICS.md'];
  const after = pr(files, WITH_ANALYTICS);
  assert.equal(after.tier, 2);
  assert.deepEqual(names(after), [SMOKE, 'test:analytics:browser'].sort());
  for (const suite of ['test:ghost:browser', 'test:dockyard-slalom:browser', 'test:wheelspin:browser', 'test:getaway:browser']) {
    assert.ok(after.skipped.some((s) => s.suite === suite), `${suite} is not needed for analytics`);
  }
  if (!AVAILABLE.includes('test:analytics:browser')) {
    const before = pr(files);
    assert.equal(before.tier, 3, 'a rule pointing at a suite package.json lacks fails safe');
    assert.match(before.changes[0].reasons.join(), /does not define/);
  }
});

test('radio change: tier 2, radio and gameplay audio', () => {
  const p = pr(['src/radio.js']);
  assert.equal(p.tier, 2);
  assert.deepEqual(names(p), [SMOKE, 'test:gameplay-audio:browser', 'test:radio:browser'].sort());
  assert.equal(pr(['radio/test-tracks/synth-fm-test.wav']).tier, 2);
  // The station list is served by most suites' own servers, so it is not a radio-only change.
  assert.equal(pr(['src/radio-stations.js']).tier, 3);
});

test('ghost and records persistence: tier 3', () => {
  for (const file of ['src/ghost-store.js', 'src/ghost.js', 'src/reference-ghost.js', 'src/records.js', 'src/gymkhana-records.js',
    'src/getaway-records.js', 'src/handling-preferences.js', 'src/audio-preferences.js', 'src/ghost-preferences.js']) {
    assert.equal(pr([file]).tier, 3, file);
  }
});

test('physics, handling, scoring and laps: tier 3', () => {
  for (const file of ['src/physics.js', 'src/tuning.js', 'src/handling.js', 'src/scoring.js', 'src/laps.js', 'src/controls.js']) {
    const p = pr([file]);
    assert.equal(p.tier, 3, file);
    assert.equal(p.full, true);
    assert.deepEqual(names(p), [...AVAILABLE].sort(), `${file}: every suite`);
  }
});

test('shared game lifecycle, glue, page and circuits: tier 3', () => {
  for (const file of ['src/game.js', 'src/main.js', 'src/render.js', 'index.html', 'style.css', 'src/track.js', 'src/obstacles.js',
    'src/scenery-original.js', 'src/gymkhana.js', 'src/getaway-urban.js', 'src/medals.js', 'src/getaway-missions.js']) {
    assert.equal(pr([file]).tier, 3, file);
  }
});

test('a new Getaway Driver integration: tier 3', () => {
  const p = pr([{ status: 'A', path: 'src/getaway-driver.js' }, { status: 'A', path: 'src/getaway-driver-ui.js' },
    { status: 'A', path: 'test/getaway-driver-browser.mjs' }, { status: 'A', path: 'test/getaway-driver.test.mjs' },
    'src/main.js', 'src/gymkhana-ui.js', 'index.html', 'style.css']);
  assert.equal(p.tier, 3);
  assert.equal(p.full, true);
  // Even alone, the mission and its saved counts are tier 3.
  assert.equal(pr([{ status: 'A', path: 'src/getaway-driver.js' }]).tier, 3);
  assert.equal(pr(['src/getaway-driver-records.js']).tier, 3);
  // Its browser suite is registered (v0.8.0 R1): a change to it alone runs it, with the smoke suite.
  const suite = pr(['test/getaway-driver-browser.mjs']);
  assert.equal(suite.tier, 2);
  assert.deepEqual(suite.groups.flatMap((g) => g.suites).sort(), ['test:browser', 'test:getaway-driver:browser']);
  // And the Getaway sheet, drawing and controller changes select it.
  for (const file of ['src/gymkhana-ui.js', 'src/getaway-urban-draw.js', 'src/controller.js']) {
    assert.ok(pr([file]).groups.flatMap((g) => g.suites).includes('test:getaway-driver:browser'), file);
  }
});

test('a change to CI or the test selection itself: tier 3', () => {
  for (const file of ['.github/workflows/ci.yml', 'scripts/ci/select-tests.mjs', 'scripts/ci/test-plan.config.mjs', 'scripts/ci/run-suites.mjs',
    'package.json', '.gitattributes', 'test/support/drivers.mjs', 'test/fixtures/records-v0.5.0.json']) {
    assert.equal(pr([file]).tier, 3, file);
  }
  // The classifier's own unit tests are tier 1 by their rule, but never alone in practice.
  assert.equal(pr(['scripts/ci/select-tests.mjs', 'test/ci-select.test.mjs']).tier, 3);
});

test('unknown files: tier 3', () => {
  for (const file of ['src/new-thing.js', 'new-folder/file.txt', 'notes.txt', 'test/new-browser.mjs', 'scripts/new-tool.mjs', 'audio-lab/assets/new.wav']) {
    const p = pr([{ status: 'A', path: file }]);
    assert.equal(p.tier, 3, file);
    assert.match(p.changes[0].reasons.join(), /not covered by any rule/, file);
  }
});

test('renamed or deleted critical files: tier 3; documentation moves stay tier 1', () => {
  assert.equal(pr([{ status: 'D', path: 'src/tutorial.js' }]).tier, 3);
  assert.equal(pr([{ status: 'R', oldPath: 'src/tutorial.js', path: 'src/lesson.js' }]).tier, 3);
  assert.equal(pr([{ status: 'R', oldPath: 'src/radio.js', path: 'src/radio-player.js' }]).tier, 3);
  assert.equal(pr([{ status: 'D', path: 'test/tutorial-browser.mjs' }]).tier, 3);
  assert.equal(pr([{ status: 'T', path: 'src/tutorial.js' }]).tier, 3);
  assert.equal(pr([{ status: 'D', path: 'docs/R3-REVIEW.md' }]).tier, 1);
  assert.equal(pr([{ status: 'R', oldPath: 'docs/GHOST.md', path: 'docs/GHOSTS.md' }]).tier, 1);
  // Renaming documentation into the source tree is judged by where it lands.
  assert.equal(pr([{ status: 'R', oldPath: 'docs/notes.md', path: 'src/notes.js' }]).tier, 3);
  // A copy is judged by the new file; a strange status by nothing at all.
  assert.equal(pr([{ status: 'C', oldPath: 'src/tutorial.js', path: 'docs/tutorial-copy.md' }]).tier, 1);
  assert.equal(pr([{ status: 'U', path: 'README.md' }]).tier, 3);
});

test('mixed changes: the highest tier wins and the suites add up', () => {
  const doc2 = pr(['README.md', 'src/tutorial.js']);
  assert.equal(doc2.tier, 2);
  const two = pr(['src/tutorial.js', 'src/radio.js']);
  assert.equal(two.tier, 2);
  assert.deepEqual(names(two), [SMOKE, 'test:gameplay-audio:browser', 'test:radio:browser', 'test:tutorial:browser'].sort());
  const three = pr(['src/tutorial.js', 'docs/ROADMAP.md', 'src/physics.js']);
  assert.equal(three.tier, 3);
  assert.deepEqual(names(three), [...AVAILABLE].sort());
  assert.deepEqual(three.skipped, []);
  assert.equal(pr(['README.md', 'radio/ATTRIBUTION.md']).tier, 1);
});

test('changed-file detection that fails, fails closed', () => {
  const fake = (out) => (args) => { if (args[0] === 'merge-base') return `${'a'.repeat(40)}\n`; return out(); };
  assert.throws(() => changedFiles({ base: 'abc1234', head: 'def5678', git: () => { throw new Error('fatal: no merge base'); } }), /no merge base/);
  assert.throws(() => changedFiles({ base: '', head: 'def5678' }), /must be commit SHAs/);
  assert.throws(() => changedFiles({ base: 'main', head: 'HEAD' }), /must be commit SHAs/, 'names that could be anything are refused');
  assert.throws(() => changedFiles({ base: 'abc1234', head: 'def5678', git: (args) => (args[0] === 'merge-base' ? 'oops' : '') }), /merge-base gave/);
  assert.throws(() => changedFiles({ base: 'abc1234', head: 'def5678', git: fake(() => 'M\0') }), /incomplete/);
  assert.throws(() => changedFiles({ base: 'abc1234', head: 'def5678', git: fake(() => 'R100\0src/a.js\0') }), /incomplete/);
  assert.throws(() => parseNameStatus('?\0src/a.js\0'), /unreadable/);
  // No changed files at all is not a reason to run nothing.
  const { changes } = changedFiles({ base: 'abc1234', head: 'def5678', git: fake(() => '') });
  assert.deepEqual(changes, []);
  assert.throws(() => plan({ event: 'pull_request', changes, available: AVAILABLE }), /no changed files/);
  assert.throws(() => plan({ event: 'pull_request_target', changes: [{ status: 'M', path: 'README.md' }], available: AVAILABLE }), /unknown event/);
  assert.throws(() => plan({ event: 'pull_request', changes: [{ status: 'M', path: 'README.md' }], available: [] }), /smoke suite/);
  assert.throws(() => plan({ event: 'full', available: AVAILABLE }), /needs a reason/);
});

test('the command line fails, and says so in the summary, when it cannot read the changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'md-ci-'));
  try {
    const summary = join(dir, 'summary.md');
    const output = join(dir, 'output.txt');
    const run = spawnSync(process.execPath, ['scripts/ci/select-tests.mjs', '--event', 'pull_request', '--base', '0'.repeat(40), '--head', 'f'.repeat(40)],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output } });
    assert.equal(run.status, 1);
    assert.match(readFileSync(summary, 'utf8'), /Test plan: FAILED/);
    assert.equal(existsSync(output), false, 'no outputs, so no job can run on a guess');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a push to main and a manual run are always the full regression', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    // Whatever the changes are said to be: these events don't look at them.
    const p = plan({ event, changes: [{ status: 'M', path: 'README.md' }], available: AVAILABLE });
    assert.equal(p.tier, 3, event);
    assert.equal(p.full, true, event);
    assert.deepEqual(names(p), [...AVAILABLE].sort(), event);
    assert.deepEqual(p.skipped, []);
  }
  const bootstrap = plan({ event: 'full', reason: 'the base branch has no test selector yet', available: AVAILABLE });
  assert.equal(bootstrap.full, true);
  assert.match(bootstrap.summary, /no test selector/);
});

test('nothing an author writes can lower the tier: only the changed files are read', () => {
  const source = readFileSync(join(root, 'scripts/ci/select-tests.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source,/GITHUB_EVENT_PATH|\.labels|pull_request\.(title|body)|commit message|git log/i);
  // The workflow hands the selector the event name and two SHAs, and nothing from the PR's text.
  const plan = workflow.slice(workflow.indexOf('  plan:'), workflow.indexOf('  unit:'));
  const expressions = [...plan.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
  for (const e of expressions) assert.match(e, /^(github\.event_name|github\.event\.pull_request\.(base|head)\.sha|steps\.select\.outputs\.\w+)$/, e);
  // A pull request is judged by the selector on its base branch, not the one it brings.
  assert.match(plan, /git archive "\$base" scripts\/ci/);
  assert.match(plan, /node "\$trusted\/scripts\/ci\/select-tests\.mjs" --event pull_request/);
});

// --- 2. The rules match the repository ------------------------------------------------------------
test('every browser suite in package.json is registered, grouped and reachable by the full regression', () => {
  assert.ok(AVAILABLE.length >= 23, `${AVAILABLE.length} suites`);
  for (const suite of AVAILABLE) {
    const entry = CONFIG.SUITES[suite];
    assert.ok(entry, `${suite} is not in scripts/ci/test-plan.config.mjs SUITES: register it (docs/CI-TESTING.md)`);
    assert.ok(!entry.pending, `${suite} now exists: remove its "pending" note from SUITES`);
    assert.ok(CONFIG.GROUPS.includes(entry.group), `${suite}: unknown group ${entry.group}`);
    assert.equal(pkg.scripts[suite], `node ${entry.file}`, `${suite} runs its registered file`);
    assert.ok(existsSync(join(root, entry.file)), entry.file);
  }
  for (const [suite, entry] of Object.entries(CONFIG.SUITES)) {
    if (!AVAILABLE.includes(suite)) assert.ok(entry.pending, `${suite} is registered but package.json does not define it`);
  }
  const full = plan({ event: 'push', available: AVAILABLE });
  assert.deepEqual(full.groups.flatMap((g) => g.suites).sort(), [...AVAILABLE].sort(), 'every suite is in exactly one group');
  assert.ok(!full.groups.some((g) => g.group === 'unassigned'));
  assert.equal(new Set(full.groups.flatMap((g) => g.suites)).size, AVAILABLE.length);
});

test('a suite package.json gains but the config lacks still runs in the full regression', () => {
  const p = plan({ event: 'push', available: [...AVAILABLE, 'test:brand-new:browser'] });
  assert.ok(p.groups.find((g) => g.group === 'unassigned').suites.includes('test:brand-new:browser'));
});

test('every rule names registered suites and real files, and no tracked file is unknown', () => {
  for (const rule of CONFIG.RULES) {
    assert.ok([1, 2, 3].includes(rule.tier), rule.id);
    assert.ok(rule.why, rule.id);
    for (const suite of rule.suites ?? []) assert.ok(CONFIG.SUITES[suite], `${rule.id}: ${suite}`);
    if (rule.tier === 2) assert.ok(rule.suites?.length, `${rule.id}: a tier 2 rule must name its suites`);
  }
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return; // no git here; the hosted unit job has it
  }
  const unknown = tracked.filter((file) => !rulesFor(file).length);
  assert.deepEqual(unknown, [], 'tracked files no rule covers (each would force tier 3)');
  // Every glob in a rule matches at least one tracked file, apart from files still to come.
  const future = new Set(['src/analytics.js', 'src/analytics-tracker.js', 'src/getaway-driver*.js', 'package-lock.json']);
  for (const rule of CONFIG.RULES) {
    for (const glob of rule.paths) {
      if (future.has(glob)) continue;
      assert.ok(tracked.some((file) => globToRegExp(glob).test(file)), `${rule.id}: ${glob} matches nothing`);
    }
  }
});

test('the published files in the rules are exactly what the deploy job copies', () => {
  const deploy = workflow.slice(workflow.indexOf('  deploy:'));
  const copied = deploy.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('cp '))
    .flatMap((l) => l.replace(/^cp (-r )?/, '').split(/\s+/).slice(0, -1));
  assert.deepEqual(copied.map((f) => (['src', 'radio'].includes(f) ? `${f}/**` : f)).sort(), [...CONFIG.DEPLOYED].sort());
});

test('a tier 2 module is used only by the browser glue or its own area', () => {
  // If a tier 3 module starts importing one, a change to it could reach the simulation, rules or
  // storage, and its rule must move to tier 3.
  const src = join(root, 'src');
  const files = readdirSync(src).filter((f) => f.endsWith('.js'));
  const importers = (target) => files.filter((f) => readFileSync(join(src, f), 'utf8').includes(`from './${target}'`));
  const glue = new Set(['main.js', 'render.js']);
  for (const rule of CONFIG.RULES.filter((r) => r.tier === 2)) {
    for (const file of files.filter((f) => rule.paths.some((g) => globToRegExp(g).test(`src/${f}`)))) {
      for (const importer of importers(file)) {
        const tiers = rulesFor(`src/${importer}`).map((r) => r.tier);
        assert.ok(glue.has(importer) || Math.max(...tiers) === 2, `${file} (tier 2, ${rule.id}) is imported by ${importer}, which is tier ${Math.max(...tiers)}`);
      }
    }
  }
});

test('a browser suite that imports a tier 2 module is selected with it', () => {
  for (const [suite, { file, pending }] of Object.entries(CONFIG.SUITES)) {
    if (pending) continue;
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, module] of text.matchAll(/from '\.\.\/src\/([\w-]+\.js)'/g)) {
      for (const rule of rulesFor(`src/${module}`).filter((r) => r.tier === 2)) {
        assert.ok(rule.suites.includes(suite), `${suite} imports src/${module}, so rule ${rule.id} must select it`);
      }
    }
  }
});

test('the groups stay roughly balanced by measured time', () => {
  const totals = Object.fromEntries(CONFIG.GROUPS.map((g) => [g, 0]));
  for (const suite of AVAILABLE) totals[CONFIG.SUITES[suite].group] += CONFIG.SUITES[suite].seconds;
  const values = Object.values(totals);
  assert.ok(Math.max(...values) <= 1.5 * Math.min(...values), JSON.stringify(totals));
  assert.ok(Math.max(...values) < 15 * 60, 'no group should approach the job timeout');
});

test('globs: * stays in a folder, ** crosses folders, and dots are literal', () => {
  assert.ok(globToRegExp('docs/**').test('docs/media/a.png'));
  assert.ok(!globToRegExp('test/*.test.mjs').test('test/support/x.test.mjs'));
  assert.ok(globToRegExp('test/*.test.mjs').test('test/ci-select.test.mjs'));
  assert.ok(!globToRegExp('src/main.js').test('src/mainXjs'));
  assert.ok(!globToRegExp('radio/*/**').test('radio/ATTRIBUTION.md'));
  assert.ok(globToRegExp('radio/*/**').test('radio/test-tracks/a.wav'));
});

// --- 3. Real git: renames, deletions and the merge base -------------------------------------------
test('changed files come from the merge base, with renames and deletions', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'md-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    try {
      git('init', '-q', '-b', 'main');
    } catch {
      t.skip('git is unavailable');
      return;
    }
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'user.name', 'CI test');
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'src/tutorial.js'), 'export const a = 1;\n'.repeat(20));
    writeFileSync(join(dir, 'src/radio.js'), 'export const r = 1;\n');
    writeFileSync(join(dir, 'docs/A.md'), '# A\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    git('mv', 'src/tutorial.js', 'src/lesson.js');
    git('rm', '-q', 'src/radio.js');
    writeFileSync(join(dir, 'docs/B.md'), '# B\n');
    git('add', '.');
    git('commit', '-qm', 'feature');
    const head = git('rev-parse', 'HEAD').trim();
    // main moves on after the branch: its changes are not the pull request's.
    git('checkout', '-q', 'main');
    writeFileSync(join(dir, 'src/physics.js'), 'export const p = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'main moves on');
    const base = git('rev-parse', 'HEAD').trim();
    const { changes, mergeBase } = changedFiles({ base, head, cwd: dir });
    assert.notEqual(mergeBase, base);
    assert.deepEqual(changes.map((c) => `${c.status} ${c.oldPath ? `${c.oldPath} -> ` : ''}${c.path}`).sort(),
      ['A docs/B.md', 'D src/radio.js', 'R src/tutorial.js -> src/lesson.js']);
    assert.ok(!changes.some((c) => c.path === 'src/physics.js'), 'the base branch\'s own change is not counted');
    assert.equal(plan({ event: 'pull_request', changes, available: AVAILABLE }).tier, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- 4. The workflow ---------------------------------------------------------------------------
test('the workflow: the required check keeps its name and fails closed', () => {
  assert.match(workflow, /\n {2}test:\n {4}needs: \[plan, unit, browser\]\n {4}if: always\(\)\n/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf('\n  test:')), /^ {4}name:/m, 'the job id is the check name `test`');
  assert.match(workflow, /--plan "\$PLANNED"/);
  assert.match(workflow, /--job "browser=\$BROWSER_RESULT"/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.match(workflow, /set -euo pipefail/);
});

test('the workflow: only a fully tested push to main deploys, with no new permissions', () => {
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.plan\.outputs\.full == 'true'\n/);
  assert.match(deploy, /needs: \[plan, test\]/);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  const writes = [...workflow.matchAll(/^\s+([\w-]+): write$/gm)].map((m) => m[1]);
  assert.deepEqual(writes, ['pages', 'id-token'], 'only the deploy job writes, as before');
  assert.equal(workflow.match(/actions\/deploy-pages/g).length, 1);
  assert.match(workflow, /^ {2}workflow_dispatch:\n/m);
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]\n/m);
  // Cancelling superseded runs applies to pull requests only.
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});

// --- 5. The final check ----------------------------------------------------------------------------
test('the final check passes only when everything planned ran and passed', () => {
  const ok = { plan: 'success', unit: 'success', browser: 'success' };
  const passed = (suites) => suites.map((suite) => ({ suite, status: 'passed' }));
  assert.deepEqual(verify({ planned: ['a', 'b'], jobs: ok, results: passed(['a', 'b']) }), []);
  assert.deepEqual(verify({ planned: [], jobs: { ...ok, browser: 'skipped' }, results: [] }), [], 'tier 1: nothing to run');
  assert.match(verify({ planned: ['a'], jobs: { ...ok, browser: 'skipped' }, results: [] }).join(), /browser job ended as "skipped"/);
  assert.match(verify({ planned: ['a', 'b'], jobs: ok, results: passed(['a']) }).join(), /b was planned but has no passing result/);
  assert.match(verify({ planned: ['a'], jobs: ok, results: [{ suite: 'a', status: 'failed' }] }).join(), /a: failed/);
  assert.match(verify({ planned: ['a'], jobs: { ...ok, browser: 'failure' }, results: passed(['a']) }).join(), /failure/);
  assert.match(verify({ planned: ['a'], jobs: { ...ok, browser: 'cancelled' }, results: passed(['a']) }).join(), /cancelled/);
  assert.match(verify({ planned: ['a'], jobs: { ...ok, unit: 'failure' }, results: passed(['a']) }).join(), /unit job/);
  assert.match(verify({ planned: null, jobs: { plan: 'failure', unit: 'success', browser: 'skipped' }, results: [] }).join(), /plan is missing/);
  assert.match(verify({ planned: [], jobs: { ...ok, plan: 'failure', browser: 'skipped' }, results: [] }).join(), /plan job/);
  assert.match(verify({ planned: ['a'], jobs: ok, results: passed(['a', 'z']) }).join(), /z ran but was not in the plan/);
});

test('the suite runner refuses to pass with nothing to run, or with an unknown suite', () => {
  for (const args of [[], ['test:no-such:browser'], ['README.md']]) {
    const run = spawnSync(process.execPath, ['scripts/ci/run-suites.mjs', ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
    assert.equal(run.status, 1, args.join() || '(none)');
  }
});
