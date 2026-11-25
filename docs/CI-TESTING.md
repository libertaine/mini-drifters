# CI testing: risk-based test selection

Every pull request runs the unit suite. Which **browser** suites it also runs depends on
the files it changes. A push to `main` always runs every suite before GitHub Pages
deploys.

The selection is explicit configuration, not inference. It lives in
[scripts/ci/test-plan.config.mjs](../scripts/ci/test-plan.config.mjs), and
[scripts/ci/select-tests.mjs](../scripts/ci/select-tests.mjs) applies it. Both are tested
by [test/ci-select.test.mjs](../test/ci-select.test.mjs), which is part of `npm test`.

## The three tiers

| Tier | When | Runs |
|---|---|---|
| **1** | Only documentation, README media, licences, unit tests, local-only checks, repository metadata or offline asset tools changed | The unit suite. The smoke suite (`test:browser`) runs as well if a published file changed (the two `ATTRIBUTION.md` files) |
| **2** | Only files in one or more bounded areas changed: the lesson, analytics, the radio, the sound engine and voices, recordings, the audio lab, the local server, controller reading, tyre effects, scenery drawing, the Gymkhana/Getaway sheets and drawing, or a single browser test | The unit suite, the smoke suite, and each area's suites |
| **3** | Anything else, and always for pushes to `main` and manual runs | The unit suite and every browser suite |

Every browser suite runs in Chromium and Firefox, as before. The unit suite includes the
publishing checks (`test/publish.test.mjs`), so every tier checks what Pages would publish.

**Tier 3 is mandatory** for:

- the simulation (`physics`, `tuning`, `handling`, `game`, `controls`, `scoring`, `laps`)
- circuits, pads and scenery collision shapes
- Gymkhana and Getaway rules, missions, police, city and medals
- every saved record, ghost or preference
- `src/main.js` and `src/render.js`
- `index.html` and `style.css`
- `src/radio-stations.js`, whose file list most browser suites serve
- `package.json`, `.gitattributes`, `test/support/`, `test/fixtures/`
- the workflow and `scripts/ci/`
- any file no rule covers
- deleting, renaming or changing the type of any file outside tier 1

`src/main.js` is tier 3 for every change. It wires every mode, screen, input path and
observer together, so a file name says nothing about which of them an edit reaches. The
same holds for `render.js`, `index.html` and `style.css`: the layout checks in most suites
depend on them. Splitting `main.js` into smaller modules is what would make finer selection
there safe.

## How a pull request is classified

1. The `plan` job checks out the full history. It finds the merge base of the PR's head
   and its base branch, and lists the changed files with
   `git diff --name-status -M <merge-base> <head>`, the same view as GitHub's *Files changed*.
2. It runs the selector and rules **from the base branch**, not the ones the PR brings. A
   change to the selector or its rules is judged by the existing rules, which put
   `scripts/ci/` in tier 3. If the base has no selector yet (the PR that introduces it),
   everything runs.
3. Each file is matched against the rules. A file can match several rules: the highest tier
   wins, and the suites add up. A file no rule covers is tier 3. A browser test file is a tier
   2 rule for its own suite.
4. The PR's tier is the highest of its files'. Tier 3 selects every suite that `package.json`
   defines (`test:browser` and `test:<name>:browser`), so a new suite is never left out of a
   full run, even before it is registered.
5. The selected suites run in up to four parallel `browser (<group>)` jobs. A group with
   nothing selected is not created.

Only the changed files and `package.json` are read. Titles, descriptions, labels and commit
messages are ignored, so nothing an author writes can lower the tier.

### Failing closed

| Situation | Result |
|---|---|
| The changed files can't be determined (no merge base, git error, unreadable output) or the list is empty | The `plan` job fails, nothing runs, and the required check fails. The summary says why |
| A rule selects a suite that `package.json` doesn't define | That file becomes tier 3 |
| An unknown file, or a deleted, renamed or retyped non-documentation file | Tier 3 |
| A browser job is skipped, cancelled or fails, or a planned suite reports no pass | The required check fails |
| A suite runner is given no suite, or an unknown one | That job fails |

## The required check

Branch protection requires the check named **`test`**. It is now a small job that always
runs and passes only when all of these hold:

- the plan was made
- the unit suite passed
- every planned browser suite uploaded a passing result

It also fails if a suite that wasn't planned ran. The browser jobs may be skipped only when
the plan selected no browser suite. A run that is cancelled, or a matrix job that never
starts, fails it rather than leaving it skipped, because GitHub treats a skipped required
check as passed.

## Deployment

The `deploy` job runs only for a push to `main`, only when the plan was the full regression
(`full == 'true'`), and only after `test` passed. Pull requests and manual runs never deploy.

Pushes to `main` are always fully tested because a merge combines changes that were tested
apart. A tier 2 PR tested its own area against the `main` it branched from, and the full run
on `main` is the first test of the result as it will be published. If that run fails,
nothing is deployed, and the last deployment stays live.

## Asking for the full regression

- **Release candidates:** a version bump changes `package.json` and the badge in
  `index.html`, so it is tier 3 anyway.
- **On request, for any branch:** Actions > *CI and Pages* > *Run workflow*, and choose the
  branch. This is `workflow_dispatch`: it runs every suite on that branch and never deploys.
  Its `test` check is attached to the branch's commit, so it also shows on that commit's PR.
  `gh workflow run ci.yml --ref <branch>` does the same, and works for any branch whose
  `ci.yml` has the trigger. The *Run workflow* button appears once `main`'s `ci.yml` has it.

A label or a line in the description can't request it. Raising the tier by those means was
left out to keep one way in, and lowering it isn't possible at all.

## Reading a run

The run's summary page shows:

- **Test plan:** the tier, the classifier that decided it, the merge base, and every
  changed file with its tier, its rules and why.
- **Browser suites that run:** each suite with every reason it was selected.
- **Browser suites left out on purpose:** the rest. Nothing is left out silently: a suite is
  either in one list or the other.
- **One table per browser group:** each suite's result and time.
- **Result:** the required check's verdict, listing every problem it found.

A run shows only the `browser (...)` jobs it needs. In a tier 1 run the browser job is
skipped, and GitHub lists it as `browser (${{ matrix.group }})` because a skipped matrix job
has no group to name. That is expected, and `test` still checks that nothing was planned for it.

## Adding a browser suite

1. Add the script to `package.json` as `test:<name>:browser`, running `node test/<file>.mjs`.
2. Register it in `SUITES` in `scripts/ci/test-plan.config.mjs`, with its file, a group,
   its measured seconds (from the run's group table) and a one-line description.
3. Add it to the `suites` of every tier 2 rule whose area it exercises. If it imports a tier
   2 module from `src/`, a unit test insists on this.
4. Run `npm test`. It fails if any `package.json` suite is unregistered, mis-grouped or
   points at another file. Until the suite is registered, full runs still run it, in an
   `unassigned` group.

The suite's own test file automatically selects the suite when it changes. If the suite
exists in a pending PR, register it with `pending: 'PR #nn'` (as `test:analytics:browser`
was until PR #37 arrived in v0.8.0). A change that would select it then gets the full
regression until the suite exists, and a unit test asks for `pending` to be removed once it does.

**New gameplay modes:** registering the mode's browser suites here is part of the feature's
acceptance criteria. A mode is not ready for release until its suites appear in the tier 3
run on `main`. Getaway Driver's `test:getaway-driver:browser` was registered with the mode
in v0.8.0 R1.

## Shared dependencies

The rules encode what each area reaches. The unit tests keep them honest:

- **Every tracked file is covered by a rule**, and every rule's paths match a tracked file.
- **A tier 2 module is used only by the glue or its own area.** If `game.js`, a record
  store or another tier 3 module starts importing `tutorial.js`, a change to the lesson
  could reach the simulation, so the test fails until the rule moves to tier 3.
- **A browser test that imports a tier 2 module is selected with it.**
- **The published files in the rules are exactly what the deploy job copies.**

When a module starts being used somewhere new, move its rule up a tier or add the suites
that now exercise it. If in doubt, tier 3.

## Investigating a wrong classification

Dry-run the selector locally:

```
node scripts/ci/select-tests.mjs --files src/tutorial.js,README.md
node scripts/ci/select-tests.mjs --event pull_request --base <base sha> --head <head sha>
node scripts/ci/select-tests.mjs --files src/radio.js --json
```

The output is the same summary CI writes. Fix the rule in `test-plan.config.mjs`, and add the
case to `test/ci-select.test.mjs`. A PR that changes the rules runs the full regression
itself, judged by the old rules. The new rules apply to the PRs after it merges.

## Parallel groups

The 28 browser suites (v0.9.0) run in four jobs, balanced by measured time (seconds on GitHub's runners). A tier 3 run, on `main` or when asked for, runs all of them:

| Group | Suites | Measured |
|---|---|---|
| `circuits` | tracks, records, ghost, reference ghost, scoring, environment, v0.8.0 R2 polish, v0.9.0 seven-circuit integration | 545 s |
| `menus-input` | handling, controller, menus, the smoke test, analytics | 500 s |
| `gymkhana-getaway` | gymkhana, medals, categories, getaway, showmanship, Getaway records, Dockyard/Slalom | 503 s |
| `audio-lessons` | tutorial, gameplay audio, radio, wheelspin, audio lab, Coyote, Getaway Driver, Circuit Tour | 538 s (Circuit Tour's 40 s estimated) |

Each job repeats the setup: about 25 s to start the Playwright container, a few seconds for
checkout, Node and Playwright. Each job is its own virtual machine, so ports, artifacts and
CPU are not shared. A group keeps running after a failing suite, so one run reports every
failure. Screenshots from a failed group are kept as `browser-artifacts-<group>`.

## Known limits

- **File rules can't see behaviour.** A tier 2 change can still reach an area its rule
  doesn't name. Three things limit the damage: the smoke suite loads every module and drives
  a run in every tier 2 PR, the unit suite always runs, and `main` runs everything before it
  deploys.
- **The workflow file belongs to the PR.** GitHub runs a PR's own `ci.yml`, so a PR could
  rewrite the workflow itself. The selector and rules come from the base branch, but the
  workflow that calls them doesn't. Workflow changes need review, and `main`'s full run before
  deploy is the backstop.
- **The suite times are from a single run.** Group balance is by measurement, not a
  guarantee. A unit test only checks that no group is over 1.5 times another, or near the
  timeout.
