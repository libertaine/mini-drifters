// Chooses what CI runs for a change: the tier, the browser suites, and why. See docs/CI-TESTING.md.
//
//   node scripts/ci/select-tests.mjs --event pull_request --base <sha> --head <sha>
//   node scripts/ci/select-tests.mjs --event push            (always the full regression)
//   node scripts/ci/select-tests.mjs --event workflow_dispatch (always the full regression)
//   node scripts/ci/select-tests.mjs --event full --reason "..."   (the workflow's own full run)
//   node scripts/ci/select-tests.mjs --files src/tutorial.js,README.md   (a local dry run)
//
// It reads only the list of changed files and package.json: never a PR's title, description,
// labels or commit messages, so nothing an author writes can lower the tier. Anything it can't
// classify gets the full regression, and anything it can't determine (the changed files
// themselves) is an error, which fails the required check. The decisions all come from
// test-plan.config.mjs.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as CONFIG from './test-plan.config.mjs';

const FULL_EVENTS = Object.freeze({
  push: 'A push to main: the full regression, before Pages may deploy',
  workflow_dispatch: 'Requested by hand (workflow_dispatch): the full regression',
});
// A browser suite is any package.json script named test:browser or test:<name>:browser.
const SUITE_SCRIPT = /^test:(?:[\w-]+:)?browser$/;

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** The browser suites package.json defines, in its order. */
export function suitesIn(packageJson) {
  return Object.keys(packageJson.scripts ?? {}).filter((name) => SUITE_SCRIPT.test(name));
}

// Each registered suite's own test file is a tier 2 rule that runs just that suite.
function allRules(config) {
  const own = Object.entries(config.SUITES).map(([suite, { file }]) => ({
    id: `suite-file:${suite}`, tier: 2, paths: [file], suites: [suite], why: `The ${suite} suite's own test file`,
  }));
  return [...config.RULES, ...own].map((rule) => ({ ...rule, patterns: rule.paths.map(globToRegExp) }));
}

/** Every rule that covers this path. */
export function rulesFor(path, config = CONFIG) {
  return allRules(config).filter((rule) => rule.patterns.some((re) => re.test(path)));
}

const deployed = (path, config) => config.DEPLOYED.some((glob) => globToRegExp(glob).test(path));

/**
 * One changed file's verdict.
 * @param {{ status: string, path: string, oldPath?: string }} change git's name-status letter
 *   (A, M, D, R, C, T...) and the path; renames and copies also carry the old path.
 */
export function classifyChange(change, available, config = CONFIG) {
  const paths = change.oldPath && change.status === 'R' ? [change.oldPath, change.path] : [change.path];
  const verdict = { ...change, tier: 1, rules: [], suites: new Set(), reasons: [], deployed: paths.some((p) => deployed(p, config)) };
  for (const path of paths) {
    const rules = rulesFor(path, config);
    if (!rules.length) {
      verdict.tier = 3;
      verdict.reasons.push(`${path} is not covered by any rule, so it gets the full regression`);
      continue;
    }
    for (const rule of rules) {
      verdict.rules.push(rule.id);
      verdict.tier = Math.max(verdict.tier, rule.tier);
      verdict.reasons.push(rule.why);
      for (const suite of rule.suites ?? []) {
        if (!available.includes(suite)) {
          verdict.tier = 3;
          verdict.reasons.push(`rule ${rule.id} selects ${suite}, which package.json does not define, so the full regression runs instead`);
        } else verdict.suites.add(suite);
      }
    }
  }
  // Removing, moving or retyping anything beyond documentation can break whatever imports,
  // serves or runs it, wherever that is.
  const structural = { D: 'deleted', R: 'renamed', T: 'changed type' }[change.status];
  if (structural && verdict.tier > 1) {
    verdict.tier = 3;
    verdict.reasons.push(`a file outside tier 1 was ${structural}`);
  }
  if (!['A', 'M', 'D', 'R', 'C', 'T'].includes(change.status)) {
    verdict.tier = 3;
    verdict.reasons.push(`git reported an unusual status (${change.status})`);
  }
  verdict.rules = [...new Set(verdict.rules)];
  return verdict;
}

function groupsFor(selected, config) {
  const order = [...config.GROUPS, 'unassigned'];
  const byGroup = new Map(order.map((group) => [group, []]));
  for (const suite of selected) byGroup.get(config.SUITES[suite]?.group ?? 'unassigned').push(suite);
  return order.filter((group) => byGroup.get(group).length).map((group) => ({ group, suites: byGroup.get(group) }));
}

/**
 * The whole plan.
 * @param {{ event: string, changes?: object[], available: string[], config?: object }} input
 *   `available`: the suites package.json defines (suitesIn). `changes`: for a pull request.
 */
export function plan({ event, changes = [], available, config = CONFIG, reason = null }) {
  if (!Array.isArray(available) || !available.includes(config.SMOKE)) {
    throw new Error(`package.json does not define the smoke suite ${config.SMOKE}; refusing to plan`);
  }
  const why = new Map(); // suite -> reasons
  const add = (suite, reason) => {
    if (!why.has(suite)) why.set(suite, []);
    if (!why.get(suite).includes(reason)) why.get(suite).push(reason);
  };
  let tier;
  let verdicts = [];
  let summary;
  if (FULL_EVENTS[event]) {
    tier = 3;
    summary = FULL_EVENTS[event];
  } else if (event === 'full') {
    // The workflow's own decision to run everything, such as a base branch with no selector yet.
    if (!reason) throw new Error('a full regression needs a reason');
    tier = 3;
    summary = `Full regression: ${reason}`;
  } else if (event === 'pull_request') {
    if (!changes.length) throw new Error('no changed files were found for this pull request; refusing to guess');
    verdicts = changes.map((change) => classifyChange(change, available, config));
    tier = Math.max(...verdicts.map((v) => v.tier));
    const top = verdicts.filter((v) => v.tier === tier);
    summary = `Tier ${tier}: ${top.length} of ${verdicts.length} changed file${verdicts.length === 1 ? '' : 's'} decided it`;
  } else {
    throw new Error(`unknown event "${event}"; refusing to plan`);
  }

  if (tier === 3) {
    const cause = FULL_EVENTS[event] || event === 'full' ? summary
      : `full regression: ${verdicts.filter((v) => v.tier === 3).map((v) => v.path).join(', ')}`;
    for (const suite of available) add(suite, cause);
  } else {
    for (const v of verdicts) {
      for (const suite of v.suites) add(suite, `${v.path} (${v.rules.join(', ')})`);
    }
    if (tier === 2) add(config.SMOKE, 'smoke test: every tier 2 change');
    for (const v of verdicts.filter((x) => x.deployed)) add(config.SMOKE, `smoke test: ${v.path} is published`);
  }

  const selected = available.filter((suite) => why.has(suite));
  return {
    event,
    tier,
    full: tier === 3,
    summary,
    unit: true,
    changes: verdicts.map((v) => ({ status: v.status, path: v.path, oldPath: v.oldPath, tier: v.tier, rules: v.rules,
      reasons: [...new Set(v.reasons)], suites: [...v.suites] })),
    selected: selected.map((suite) => ({ suite, group: config.SUITES[suite]?.group ?? 'unassigned', reasons: why.get(suite) })),
    skipped: available.filter((suite) => !why.has(suite)).map((suite) => ({ suite, group: config.SUITES[suite]?.group ?? 'unassigned' })),
    groups: groupsFor(selected, config),
  };
}

/** git's `diff --name-status -z` output, as changes. */
export function parseNameStatus(raw) {
  const parts = raw.split('\0');
  if (parts.at(-1) === '') parts.pop();
  const changes = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    const status = code[0];
    if (!status || !/^[A-Z]/.test(status)) throw new Error(`unreadable git status "${code}"`);
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++];
      const path = parts[i++];
      if (!oldPath || !path) throw new Error(`incomplete ${status} entry in git output`);
      changes.push({ status, oldPath, path });
    } else {
      const path = parts[i++];
      if (!path) throw new Error(`incomplete ${status} entry in git output`);
      changes.push({ status, path });
    }
  }
  return changes;
}

/** The pull request's own changes: from the merge base with the base branch to its head. */
export function changedFiles({ base, head, cwd = '.', git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }) {
  if (!/^[0-9a-f]{7,40}$/i.test(base ?? '') || !/^[0-9a-f]{7,40}$/i.test(head ?? '')) {
    throw new Error(`base and head must be commit SHAs (got "${base}" and "${head}")`);
  }
  const mergeBase = git(['merge-base', base, head]).trim();
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error(`git merge-base gave "${mergeBase}"`);
  const changes = parseNameStatus(git(['-c', 'core.quotepath=off', 'diff', '--no-ext-diff', '--no-color', '--name-status', '-z', '-M', mergeBase, head]));
  return { mergeBase, changes };
}

const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;

/** The GitHub step summary: what was decided, from what, and what was left out on purpose. */
export function markdown(p, { mergeBase = null, classifier = null } = {}) {
  const lines = [`## Test plan: tier ${p.tier}${p.full ? ' (full regression)' : ''}`, '', p.summary, ''];
  if (classifier) lines.push(`Classifier: ${classifier}`, '');
  if (mergeBase) lines.push(`Compared with merge base ${code(mergeBase.slice(0, 12))}.`, '');
  lines.push(`The unit suite (including the publishing checks) runs in every tier. ${p.selected.length} of ${p.selected.length + p.skipped.length} browser suites run, each in Chromium and Firefox.`, '');
  if (p.changes.length) {
    lines.push('### Changed files', '', '| Status | File | Tier | Rules | Why |', '|---|---|---|---|---|');
    for (const c of p.changes) {
      const file = c.oldPath ? `${code(c.oldPath)} → ${code(c.path)}` : code(c.path);
      lines.push(`| ${c.status} | ${file} | ${c.tier} | ${c.rules.join(', ') || '(none)'} | ${c.reasons.join('; ')} |`);
    }
    lines.push('');
  }
  lines.push('### Browser suites that run', '');
  if (p.selected.length) {
    lines.push('| Suite | Group | Why |', '|---|---|---|');
    for (const s of p.selected) lines.push(`| ${code(s.suite)} | ${s.group} | ${s.reasons.join('; ')} |`);
  } else lines.push('None: no file that runs in the browser changed.');
  lines.push('', '### Browser suites left out on purpose', '');
  if (p.skipped.length) {
    lines.push('Not affected by these changes according to the rules in `scripts/ci/test-plan.config.mjs`. Pushes to main run all of them before deploying.', '');
    lines.push(p.skipped.map((s) => code(s.suite)).join(', '));
  } else lines.push('None.');
  return `${lines.join('\n')}\n`;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const opts = args(argv);
  const available = suitesIn(JSON.parse(readFileSync(opts.package ?? 'package.json', 'utf8')));
  let changes = [];
  let mergeBase = null;
  let event = opts.event;
  if (opts.files) {
    event ??= 'pull_request';
    changes = opts.files.split(',').filter(Boolean).map((path) => ({ status: 'M', path }));
  } else if (event === 'pull_request') {
    ({ mergeBase, changes } = changedFiles({ base: opts.base, head: opts.head, cwd: opts.repo ?? '.' }));
  }
  const p = plan({ event, changes, available, reason: opts.reason ?? null });
  const outputs = {
    tier: String(p.tier),
    full: String(p.full),
    suites: JSON.stringify(p.selected.map((s) => s.suite)),
    matrix: JSON.stringify({ include: p.groups.map((g) => ({ group: g.group, suites: g.suites.join(' ') })) }),
    browser: String(p.selected.length > 0),
  };
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
  const summary = markdown(p, { mergeBase, classifier: opts.classifier ?? null });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  if (opts.json) console.log(JSON.stringify({ ...p, outputs }, null, 2));
  else console.log(summary);
  return p;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const message = `Test selection failed, so nothing is run and the check fails: ${error.message}`;
    console.error(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test plan: FAILED\n\n${message}\n\nRe-run the workflow, or run the full regression by hand (docs/CI-TESTING.md).\n`);
    }
    process.exitCode = 1;
  }
}
