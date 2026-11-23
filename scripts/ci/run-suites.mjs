// Runs browser suites one after another with `npm run`, exactly as a developer would, and keeps
// going after a failure so that every failure is reported. Writes a result per suite (for the
// final check, verify-results.mjs) and a table to the GitHub step summary.
//
//   node scripts/ci/run-suites.mjs --results results.json test:browser test:tutorial:browser
//
// Exits non-zero if any suite failed, if a suite isn't a package.json script, or if no suite
// was given: running nothing is never a pass.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { suitesIn } from './select-tests.mjs';

const argv = process.argv.slice(2);
let resultsFile = null;
const requested = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--results') resultsFile = argv[++i];
  else requested.push(...argv[i].split(/\s+/).filter(Boolean));
}

const available = suitesIn(JSON.parse(readFileSync('package.json', 'utf8')));
const results = [];
let failed = requested.length === 0;
if (failed) console.error('No suites were given to run.');
for (const suite of requested) {
  if (!available.includes(suite)) {
    console.error(`${suite} is not a browser suite in package.json.`);
    results.push({ suite, status: 'unknown', seconds: 0 });
    failed = true;
    continue;
  }
  console.log(`::group::${suite}`);
  const start = Date.now();
  const run = spawnSync('npm', ['run', suite], { stdio: 'inherit', shell: process.platform === 'win32' });
  const seconds = Math.round((Date.now() - start) / 1000);
  console.log('::endgroup::');
  const passed = run.status === 0;
  if (!passed) {
    failed = true;
    console.log(`::error title=${suite} failed::${suite} exited with ${run.status ?? run.signal ?? run.error?.message} after ${seconds} s`);
  }
  results.push({ suite, status: passed ? 'passed' : 'failed', seconds });
}

if (resultsFile) writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
const table = ['| Suite | Result | Seconds |', '|---|---|---|', ...results.map((r) => `| \`${r.suite}\` | ${r.status === 'passed' ? 'passed' : `**${r.status}**`} | ${r.seconds} |`)];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table.join('\n')}\n`);
console.log(table.join('\n'));
process.exitCode = failed ? 1 : 0;
