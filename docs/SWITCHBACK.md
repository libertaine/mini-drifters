# Switchback

The first Prototype 0.2 experiment, to find out whether a second circuit makes Mini Drifters more interesting. It's one handcrafted track, not a generator, and it uses the same car, physics, scoring, road width and look as Original.

It's an experiment. The questions are in the [playtesting checklist](#playtesting-checklist), and the track only stays if the answers are good.

## Try it

1. On Windows, double-click **`Start Game.cmd`** in this checkout. Elsewhere, run `node server.mjs` and open <http://127.0.0.1:4190>.
2. On the title screen, press **Right** (or click **Switchback**) under the tagline.
3. Press Enter.

Left and Right change the track from anywhere on the title. Restart and Drive Again stay on the same track, and Return to Title lets you choose again. The choice lasts until the page reloads, and a new visit starts on Original. The Try It lesson always uses Original.

## What it's meant to be

Original is a few big corners: a long straight, a sweeper, a hairpin and two long 166° to 173° bends. Switchback is meant to have a different rhythm, with more corners that are smaller and linked, rather than being harder or faster.

1. **West straight** (192 m), the one place to reach top speed. The lap starts here, heading north.
2. **Top-left right-hander**, braking from top speed into a medium corner.
3. **The switchbacks**, five linked medium corners stepping down to the south-east: right, left, right, left, right. Each turns about 100° at a radius of 32 to 35 m, with almost no straight between them, so a slide can be flicked from one into the next.
4. **The tight right** at the bottom of the short east straight, the only corner tighter than 25 m. It turns 127° at a 20 m radius, so it rewards a deliberate handbrake entry.
5. **A left flick and a right-left sweep** onto the bottom straight.
6. **Bottom-left right-hander** back onto the west straight.

## Compared with Original

Measured from the circuits and with the scripted test drivers, 12 runs each, median values:

| | Original | Switchback |
|---|---|---|
| Lap length | 1287 m | 1319 m |
| Area, with the runoff | 493 × 364 m | 461 × 491 m |
| Corners turning more than 25° | 6 | 11 |
| Opposite corners linked back to back | 3 | 7 |
| Biggest single corner | 173° | 127° |
| Tightest corner | 16 m radius, 166° | 20 m radius, 127° |
| Longest straight | 212 m | 192 m |
| Share of the lap on straights of 20 m or more | 25% | 28% |
| Closest approach of separate sections (centre to centre) | 51 m | 58 m |
| Grip driver's best lap | 45.9 s | 49.6 s |
| Drift driver's score, best combo and spins | 9,447, 2,619, 2 | 8,580, 2,484, 4 |
| Reckless driver's score | 4,591 | 5,991 |

What that suggests, before anyone has driven it:

- Switchback is a little longer and slightly slower, not faster.
- It has almost twice as many corners, and they're medium ones linked in sequence. Original's character is long bends and one hairpin.
- The scripted drifter spins about twice as often on Switchback, probably in the switchbacks, where one slide leads straight into the next. Whether that's a fun challenge or a frustration is for a person to judge.
- A driver who only hauls on the handbrake scores more on Switchback than on Original, but still well below controlled drifting.

Nothing about the car or the scoring was changed for this track.

## How it's checked

`test/tracks.test.mjs` checks the circuit with the real simulation: it's closed and evenly sampled, never crosses itself, keeps separate sections at least 20 m of grass apart, has one long straight and exactly one tight corner, and has its gates in order. It also checks that full laps count, that cutting across the grass voids them, that the scripted drivers get round with every lap counting and no wall contact, and that the ghost and a change of track behave. It also confirms that Original is exactly the v0.1.0 circuit.

`npm run test:tracks:browser` checks the title's track choice with real keys and clicks in Chromium and Firefox. It also drives a lap of Switchback with real key presses, then checks the ghost, the radio, Restart, Return to Title, the lesson, Drive Again and a return to Original. It saves screenshots to `artifacts/`.

None of that shows the track is fun. That's what the checklist below is for.

## Playtesting checklist

Drive a few runs of each track, in either order.

- Does Switchback feel meaningfully different from Original, rather than just another layout?
- Are the switchbacks enjoyable to drift through? Can you link them, or do they keep catching you out?
- Is the west straight long enough to recover and set up the top-left corner? Is the short east straight enough for the tight right?
- Does the tight right reward the handbrake, or is it simpler to grip round?
- Are there frustrating or awkward places, such as a corner that comes too soon, a curb that hides the line, or an exit that runs out of road?
- Does one track give you better drift combos?
- Would you choose to drive both?

Please note anything that felt wrong and where it happened. The track hasn't been changed to answer any of these in advance.

## Known gaps

- The curbs stop for a moment at every change of direction, leaving a small step in the road edge. Original has this at its one left-right transition, and Switchback has it at every switchback. It's how the renderer has always painted curbs, so it's left alone for now.
- Each track keeps its own ghost only for the current run, as before. Nothing is saved, including the choice of track.
- The scenery is the same scatter of trees around the outside on both tracks.
