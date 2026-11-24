# Analytics

From v0.8.0 the published game reports a few anonymous counts to
[Umami Cloud](https://umami.is/). They answer four questions: how many people visit,
how many of them start driving, how far their runs get, and whether they play for a
meaningful time. Nothing else is collected, and the simulation knows nothing about it.

Code: [src/analytics-tracker.js](../src/analytics-tracker.js) (who is counted, and the
loader) and [src/analytics.js](../src/analytics.js) (what is sent, and when). Tests:
[test/analytics.test.mjs](../test/analytics.test.mjs) and
[test/analytics-browser.mjs](../test/analytics-browser.mjs).

## One website, two games

Mini Drifters deliberately shares Steeped in Trouble's Umami website,
`6f121a0f-990e-4457-8269-6f4833c81820`. The two never mix:

- **Pageviews** are told apart by their path: `/mini-drifters/` here, and
  `/Steeped-in-Trouble/` there.
- **Events** are told apart by name: every Mini Drifters event starts with `md_`.
  Steeped's events have no prefix.

Steeped in Trouble's tracking is unchanged by this.

## When the tracker loads

`index.html` contains no tracker. `startAnalytics()` adds one script element as
`main.js` starts, and only when all of these hold:

| Condition | Check |
|---|---|
| Published host | protocol is `https:` and hostname is exactly `libertaine.github.io` |
| Published page | path is exactly `/mini-drifters/` or `/mini-drifters/index.html` |
| No opt-out | `?analytics=off` is absent (the value ignores case and spaces) |
| No test scenario | none of `SCENARIO_PARAMS` is in the URL: `debug`, `driver`, `replay`, `research`, `seed`, `scenario`, `test`, `lab` |
| Not automated | `navigator.webdriver` is not set |
| No Do Not Track | `doNotTrack` and its variants do not say so |

Otherwise `startAnalytics()` returns `null`, adds nothing to the page, and `main.js`
calls nothing further.

**Why there is no build flag.** Steeped in Trouble is built with Vite and checks
`import.meta.env.PROD`. Mini Drifters has no build step: GitHub Pages serves the
repository's own files. So "production" is the address itself. Local play
(`server.mjs` on `127.0.0.1`), the browser checks (`127.0.0.1` and
`navigator.webdriver`), a copy on any other host, another path on the same host, plain
HTTP and `file://` all fail the first two rows.

The game itself reads no URL parameters today. Circuit Tour, a research build behind
`?research=tour` during v0.9.0 R2, is a normal title-menu mode from v0.9.0 and reads none.
`?research` stays a scenario parameter, so such a page is still never counted. `?debug` and `?driver` (the retired Getaway
Driver research switch, which no longer does anything) are listed so that they stay uncounted. A unit test
fails if any source file starts reading a URL parameter that is not sorted into
`SCENARIO_PARAMS` or `PREFERENCES`. The in-game debug display (the `D` key) is not a
URL scenario: it sends nothing extra and changes nothing that is sent.

`?analytics=off` applies to that page load. It is not remembered, because the game
keeps no analytics data in the browser.

The script is `https://cloud.umami.is/script.js`, loaded `async` with these attributes:

```text
data-website-id="6f121a0f-990e-4457-8269-6f4833c81820"   public configuration, not a credential
data-domains="libertaine.github.io"
data-exclude-search="true"
data-exclude-hash="true"
data-do-not-track="true"
```

Error capture (`data-errors`), performance telemetry (`data-performance`) and
`data-distinct-id` are left off, which is Umami's default. No element has
`data-umami-event`, so there are no automatic click events. Umami has no session replay
in this script. The tracker sends its requests to `gateway.umami.is`.

If the script is blocked or fails, there is no retry, the few events waiting for it (at
most 16) are dropped, and the game carries on. Exceptions and rejected promises from the
tracker are swallowed, and the observer itself is wrapped so that nothing it does can
throw into the game loop.

## Event contract

| Event | Properties | Sent | At most, per page load |
|---|---|---|---|
| (pageview) | Umami's own | When the script runs | Once |
| `md_game_start` | none | With the first counted run start | Once |
| `md_run_start` | `category`: `tracks`, `gymkhana` or `getaway` | When a run's clock starts | 100 (`MAX_COUNTED_RUNS`) |
| `md_lap_milestone` | `lap`: 1, 2 or 3 | A valid circuit lap of a counted run | 3 per counted run |
| `md_run_complete` | `category`, as above | A counted run reaches its normal completed result | Once per counted run |
| `md_engaged_30s`, `md_engaged_1m`, `md_engaged_3m`, `md_engaged_5m` | none | Cumulative active driving time | Once each |

A page load is what all of this is counted in: reloading starts a new one, and nothing is
carried over or replayed. The most a page load can send is 1 + 100 + 300 + 100 + 4
custom events.

Every event comes from the game's own run events (`onRunEvent` in `game.js`) or its
frame loop, never from what is drawn on the screen.

### Categories

| `category` | Session |
|---|---|
| `tracks` | A scored circuit run (`game.mode === 'normal'`) on any of the seven circuits, from the Tracks sheet or as a Circuit Tour round |
| `gymkhana` | A Gymkhana challenge |
| `getaway` | A Getaway mission (a challenge on the `urban` layout): Get the Footage or Getaway Driver |
| none | The driving lesson (Try It) and the practice pad. Nothing is sent for them, and their time is not counted |

The circuit, challenge, mission, environment and handling mode are not sent. Nor is a Getaway
Driver outcome (Ghost run, Low profile, Lost them) or its completion counts: those stay in the
browser (see [GETAWAY-DRIVER](GETAWAY-DRIVER.md)).

### Circuit Tour

Decided in v0.9.0, without changing the contract. A Circuit Tour round is an ordinary circuit
run, so it is counted exactly as a Tracks run is, and only once:

- The Tour sheet, a round's sheet and the paused grid send nothing. The round's `md_run_start`
  `{ category: 'tracks' }` is sent at its first press off the grid, as for any circuit run.
- Its laps send the usual `md_lap_milestone`, and a finished round sends one `md_run_complete`
  `{ category: 'tracks' }`.
- A restart once moving is a new run, and a round left mid-run completes nothing, as in Tracks.
- There is no Tour event, property or category. Rival names, posted scores, places, points,
  standings, the Joker, restarts, lengths, fields and Tour results are never sent.

So the `tracks` counts include Tour rounds and can't tell them apart. Counting Tours separately
would need a new event or category value, which needs the owner's approval first.
`test/analytics-browser.mjs` drives a Tour round on the published address to check all of this.

### `md_game_start` and `md_run_start`

A run starts when its clock does: the first accelerator or brake press that takes the
car off the grid. That is the moment `game.state` goes from `ready` to `racing`.

- **On the grid:** Start, Try Again, `R` and Return to Title from the grid start nothing.
  Only driving does.
- **Retries:** each driven retry is a new run, with its own `md_run_start`.
- **Pause:** pausing and carrying on is the same run.
- **`md_game_start`:** sent once, with the first counted run start of the page load,
  so `md_game_start / pageviews` stays a true visit-to-play ratio.

After 100 counted runs in one page load, further runs are not counted, and nothing
follows them (no laps or completions). Engagement time still counts.

### `md_lap_milestone`

Sent from the game's `lap` event when the lap is valid. `lap` is the number of valid
laps the run has completed: 1, 2 or 3. A voided lap (a missed checkpoint) sends nothing
and does not move the count. Each number is sent at most once per run. Only circuit runs
have laps.

### `md_run_complete`

| Category | Completed when |
|---|---|
| `tracks` | The game's `finish` event: three valid laps done |
| `gymkhana` | The `challenge` event with `completed: true` |
| `getaway` | The `challenge` event with `completed: true`: an escape (Get the Footage) or reaching the safehouse (Getaway Driver) |

Nothing is sent for a failed challenge, a bust, a timeout, a retry, a restart, or a run
left for the title. A retry or return to the title takes effect as the game's own `start`
or `abandon` event, so a late event from the old run can't be credited to the new one.

### `md_engaged_*`

Cumulative active driving time in the current page load, measured with
`performance.now()` rather than the simulation's capped step.

| Situation | Counts |
|---|---|
| A counted category's run is racing, the page is visible and focused, and some driving input was held in the last 30 s (`IDLE_MS`) | Yes |
| The title, menus, Options, How to Play | No |
| On the grid before the first press, paused, or on a results screen | No |
| The driving lesson and the practice pad | No |
| The page hidden, or the window unfocused | No |
| 30 s with no driving input held (keyboard or controller) | No, until the next input |

Only the fact that some driving input is held is used, never which or how much. Time
never catches up: a gap of over one second between frames (`MAX_FRAME_GAP_MS`) means a
suspended tab or a sleeping machine and is discarded, as is any frame whose predecessor
was not counting. The game also pauses itself when focus is lost.

## What is not sent

Scores, lap times, combo or multiplier amounts, medals, records, ghosts, saved
preferences, any browser storage, keyboard or controller input values, coordinates,
headings or trajectories, track, challenge or handling choices, player or session
identifiers, full query strings or URL fragments, and debug or error information.

`umami.identify()` is never called. The game creates no identifiers, cookies or storage
entries for analytics, and the analytics code reads no storage. (Umami's script itself
reads a `umami.disabled` localStorage key if one exists, and sends no cookies.)

Umami receives what any such request carries: the page URL without its query and
fragment, the page title, the referrer, screen size, language, and the browser and network
details it derives its anonymous counts and device type from.

## Disclosure and opt-out

The title screen says, under the main menu:

> The published game counts visits, runs and play time with cookie-free Umami analytics.
> No scores, inputs or saves are sent. Add `?analytics=off` to the address to opt out.

To opt out, open `https://libertaine.github.io/mini-drifters/?analytics=off`. The
browser's Do Not Track setting and content blockers are respected too.

## Owner checks in the Umami dashboard

These need the owner's login.

1. **Overview:** filter the path to `/mini-drifters/` to see this game's visitors and pageviews.
2. **Events:** `md_game_start`, `md_run_start`, `md_lap_milestone`, `md_run_complete` and the
   `md_engaged_*` events appear, separate from Steeped's unprefixed ones.
3. **Event data:** `md_run_start` and `md_run_complete` have a `category`, `md_lap_milestone`
   a numeric `lap`, and nothing else has properties.

Useful ratios: `md_game_start / pageviews` (visit to play), `md_run_complete / md_run_start`
per category (completion), and `md_lap_milestone` lap 1 → 3 (circuit drop-off). Each run
counts, so these describe runs, not people.

## Removing it

Delete `src/analytics.js` and `src/analytics-tracker.js`, their imports and the two
`analytics?.` calls in `src/main.js`, the `#analytics-note` paragraph and its style, the
tests and their npm script and CI step, the analytics test in `test/publish.test.mjs`, and
this file. No gameplay code, record or save format refers to it.

## Testing

Automated tests never reach the service. The unit tests use a fake window with no
network. The browser checks run on `127.0.0.1` in a browser marked `navigator.webdriver`,
which the gate refuses twice over. `test/analytics-browser.mjs` serves the published
address from the checkout by request interception, answers the tracker's address with a
local stub (or blocks it), aborts every other Umami address and fails if anything tries
one.

`test/publish.test.mjs` keeps the rest of the game free of outside services: the
tracker's address may appear only in `src/analytics-tracker.js`, and neither analytics
file may use storage, cookies, `fetch`, beacons or `identify`.

To see the real thing, use an ordinary browser's network panel on the published page and
expect `script.js` from `cloud.umami.is`, then `POST`s to `gateway.umami.is/api/send`.
Such a visit is real traffic and is counted. Add `?analytics=off` to avoid that.
