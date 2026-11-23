// The last word for the required `test` check: did everything the plan asked for really run
// and pass? A skipped, cancelled or missing job, or a suite with no passing result, fails it.
//
//   node scripts/ci/verify-results.mjs --plan '["test:browser"]' --results-dir results \
//     --job plan=success --job unit=success --job browser=success
import { existsSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {{ planned: string[], jobs: Record<string, string>, results: { suite: string, status: string }[] }} input
 * @returns {string[]} the problems; empty means the check passes.
 */
export function verify({ planned, jobs, results }) {
  const problems = [];
  if (!Array.isArray(planned)) return ['the plan is missing, so nothing can be verified'];
  if (jobs.plan !== 'success') problems.push(`the plan job ended as "${jobs.plan}"`);
  if (jobs.unit !== 'success') problems.push(`the unit job ended as "${jobs.unit}"`);
  // The browser job may be skipped only when the plan selected no browser suite.
  if (planned.length === 0) {
    if (!['skipped', 'success'].includes(jobs.browser)) problems.push(`the browser job ended as "${jobs.browser}" with nothing to run`);
  } else if (jobs.browser !== 'success') {
    problems.push(`the browser job ended as "${jobs.browser}"`);
  }
  const passed = new Set(results.filter((r) => r.status === 'passed').map((r) => r.suite));
  for (const suite of planned) if (!passed.has(suite)) problems.push(`${suite} was planned but has no passing result`);
  for (const r of results) if (!planned.includes(r.suite)) problems.push(`${r.suite} ran but was not in the plan`);
  for (const r of results) if (r.status !== 'passed') problems.push(`${r.suite}: ${r.status}`);
  return [...new Set(problems)];
}

function readResults(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

if (process.argv[1]?.endsWith('verify-results.mjs')) {
  const argv = process.argv.slice(2);
  const jobs = {};
  let planned = null;
  let dir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--plan') {
      try { planned = JSON.parse(argv[++i]); } catch { planned = null; }
    } else if (argv[i] === '--results-dir') dir = argv[++i];
    else if (argv[i] === '--job') {
      const [name, result] = argv[++i].split('=');
      jobs[name] = result;
    }
  }
  const results = readResults(dir);
  const problems = verify({ planned, jobs, results });
  const lines = problems.length
    ? ['## Result: FAILED', '', ...problems.map((p) => `- ${p}`)]
    : ['## Result: passed', '', `Unit suite passed, and all ${planned.length} planned browser suite${planned.length === 1 ? '' : 's'} passed in Chromium and Firefox.`];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  process.exitCode = problems.length ? 1 : 0;
}
