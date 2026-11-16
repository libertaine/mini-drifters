# Wheelspin feedback

In Power handling the rear tyres can spin under throttle (the rear grip budget in `src/physics.js`). Before v0.5.0 R2 nothing showed or sounded that. The smoke, skid marks and engine note followed body slip angle only, so Power's wheels spun with no cue at all for 26 to 93% of the spinning time, depending on circuit and driving style. R2 drives the picture and the engine from the physics' own `car.wheelspin`. It changes no physics, scoring, records or storage.

## What you see

| Situation | Effect |
|---|---|
| Light wheelspin (0.3 to about 0.5) | A thin, faint wisp of smoke from the rear tyres |
| Strong wheelspin on asphalt or curb | Denser smoke, thrown back off the tyres so it hangs where it was made, and a rubber mark |
| A slide with wheelspin | The larger of the slide's and the wheelspin's smoke and mark, never both added together |
| Wheelspin on grass | More dust. Grass takes no rubber and makes no tyre smoke |
| A donut at 4 to 5 m/s | One continuous ring of rubber, with smoke |
| A burnout on the spot (pinned to a wall, say) | Smoke at 35% of the full rate, and no mark |
| Classic | Exactly as before. It has no wheelspin state |

All the thresholds are in `TYRE_FX` in `src/tyre-effects.js`, which decides what the tyres leave behind each frame. `src/render.js` draws it.

- **Smoke** builds from wheelspin 0.3 to 0.85, up to 30 puffs a second at full speed. Each puff's opacity scales with the wheelspin, from half of a slide puff's.
- **Rubber** starts at wheelspin 0.4 and ends below 0.25. It also starts only above 2.5 m/s and ends below 2 m/s. The two gaps stop a flickering spin from drawing dashes. A wheelspin mark grows in pieces at least 0.5 m long, joined end to end from where the last mark stopped. So it can't grow while the car stands still, and it can't leave dots. Below 12 m/s it's drawn lighter.
- **Limits** are unchanged: 1800 skid segments (a ring buffer, oldest first) and 110 smoke puffs, each living 0.85 s.
- **Lifecycle** is unchanged. Nothing is added or aged while paused, after focus loss, on a finished run or on the title. Restart, a new session, the title and a change of circuit clear every mark, puff and piece of mark memory.

## What you hear

See [GAMEPLAY-AUDIO.md, Wheelspin](GAMEPLAY-AUDIO.md#wheelspin). In short, wheelspin revs the engine up to 1000 RPM above its in-gear note, smoothed so it can't wobble. Held slides, the gears, the tyres, the fallback engine and the mute and focus lifecycle are as they were.

## Measured, not judged

These numbers come from scripted drivers (`gripDriver`, `driftDriver`, `recklessDriver`, three starting offsets) on the three circuits in Power. They are the share of spinning time (wheelspin above 0.3) on asphalt and curb with no cue at all: no smoke of at least 3 puffs a second, no mark, an engine flare under 300 RPM and quiet tyres.

| Circuit, driver | R1 | R2 |
|---|---|---|
| Original, grip | 55% | 18% |
| Original, drift | 30% | 8% |
| Original, reckless | 58% | 11% |
| Switchback, grip | 80% | 30% |
| Switchback, drift | 29% | 7% |
| Switchback, reckless | 62% | 13% |
| Dockyard, grip | 93% | 47% |
| Dockyard, drift | 26% | 8% |
| Dockyard, reckless | 57% | 10% |

What's left is mostly light wheelspin, deliberately shown as a wisp or not at all. On grass, wheelspin now raises the dust 68 to 93% of the time. Ordinary tidy driving stays clean: Dockyard's grip driver smokes 1% of the time, against 0% in R1.

None of this says the effects look or sound right. That needs someone to drive it.

## Tests

| Command | Covers |
|---|---|
| `npm test` (`test/wheelspin-feedback.test.mjs`) | Classic's effects and sound frame for frame against R1; the thresholds, hysteresis, caps and finite values; Power's coverage; no extra shifts or RPM jumps |
| `npm run test:wheelspin:browser` | Chromium and Firefox: smoke, rubber and heard wheelspin on the pad; pause, focus loss, restart, Sound Off and the title; caps over a long session; Classic untouched; no new storage |
