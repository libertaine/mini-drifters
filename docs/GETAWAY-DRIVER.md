# Getaway Driver

**Getaway → Getaway Driver → Downtown.** Get the car to the safehouse, top right of town,
without drawing the police. If they spot you, lose them before the safehouse will open.

Getaway Driver is the second Getaway mission. It uses Get the Footage's Downtown without the
cameras. It has no score, medal or personal best. Instead, the game counts how often you reach
the safehouse each way.

## Attention

ATTENTION (0–100%) rises when you:

- speed (over 45 mph),
- drift (a slide past 15°, in full from 40°, above 8 m/s),
- hit something solid (from 3 m/s) or smash a fruit stand or barricade.

Everything counts four times over while a police car can see you. A watching police car within
30 m notices even calm driving. Drive calmly out of sight for 1.5 s and ATTENTION drains (20 s
from full).

| ATTENTION | Shown as | What happens |
|---|---|---|
| Below 35% | Unnoticed | Nothing |
| 35% or more | Suspicious | Nothing yet, but the run is no longer a Ghost run |
| 70% or more | Hot | A police car that keeps you in sight for 0.6 s gives chase |
| 100%, unseen | Reported | The nearest patrol car is sent, lights on, to where you were |

## The police

Three patrol cars drive fixed loops of the streets with their lights off, and a fourth is parked
past the safehouse, watching the way in. Every run has the same patrols. A patrol car sees 65 m
ahead within 50° either side of its nose, and 14 m all round, never through a building.

A chase uses Get the Footage's police driving and BUST RISK. Another car that sees you during a
chase joins in.

## Losing them

Stay out of every police car's sight, and 45 m or more from every pursuer, for 5 seconds. The
escape bar under BUST RISK shows the progress, and being seen drains it. Once you have lost
them, they search where they last saw you for 6 s, then return to patrol. ATTENTION drops to
60%. The safehouse stays shut while anyone is chasing.

## Three ways home

| Outcome | How |
|---|---|
| **Ghost run** | Never reached Suspicious |
| **Low profile** | Reached Suspicious (or was reported), but never chased |
| **Lost them** | Chased at least once, and lost every pursuer |

A bust or the 150 s clock ends the run with no outcome. While driving, the HUD shows which
outcome the run is still on for. The results sheet names the outcome and says what the next
cleaner one takes.

## Completion counts

The game counts each outcome per environment and handling mode, so Classic and Power each keep
their own counts. They are shown on the mission sheet and after each run. Only a completed
run counts. A bust, a timeout, a retry or a run left for the title counts nothing.

The counts are saved in this browser under `mini-drifters-getaway-driver-v1`, apart from every
other record:

```
{ "version": 1, "environments": { "downtown": { "classic": { "ghost": 2, "low-profile": 1, "lost-them": 0 } } } }
```

The storage rules match the Getaway personal bests. The key is re-read before each write, so
counts from another tab are kept. Nothing is written on load. Damaged data reads as zero and is
replaced by the next completion. Data saved by a newer version is shown as nothing and never
overwritten. Fields this version does not know are carried through. If storage is unavailable,
the run plays normally and the sheet says finishes cannot be counted.

Completion counts and outcomes are never sent to analytics. A Getaway Driver run is counted only
as a `getaway` run, like Get the Footage (see [ANALYTICS](ANALYTICS.md)).

## The accepted mechanics

The numbers above are the R0 prototype the owner playtested in Classic and Power and accepted
for integration (v0.8.0). `DRIVER` and `DRIVER_PATROLS` in `src/getaway-driver.js` hold them,
and `test/getaway-driver.test.mjs` pins both the numbers and whole scripted runs to R0, so any
balance change is deliberate. Police collisions, other environments, progression and balance
changes were left out of R1.
