# Desktop controllers

Controller support merged in PR #16 after the owner reported satisfactory physical
driving and drifting on Original and Switchback, with no controller issues reported.
Analog throttle made little gameplay difference, which the owner accepted. That review
did not explicitly verify every disconnect/reconnect scenario. Automated mocked tests
remain separate evidence from physical hardware coverage. The version remains 0.1.0;
local records are a separate draft candidate, and no new release is declared.

## Mapping

Only devices reported as `mapping: "standard"` by the browser are accepted. Xbox-style
controllers are the initial target. PlayStation controllers should work when their
browser supplies that standard layout; labels below name the equivalent Xbox positions.
Unmapped devices, wheels and unusual adapters are not supported.

| Control | Driving | Menus |
|---|---|---|
| Left stick X | Proportional steering | — |
| RT | Proportional accelerator | — |
| LT | Proportional brake, then reverse | — |
| A (bottom face button) | Handbrake | Confirm |
| B (right face button) | — | Back; resume from Pause; title from Results |
| X (left face button) | Toggle ghost (outside lesson) | — |
| Y (top face button) | Next radio station | — |
| Menu / Start | Pause | Resume from Pause |
| D-pad Up / Down | — | Move focus (one step per press) |
| D-pad Left / Right | — | Choose track on title; change station or volume in Options; move between other actions |

Restart, Return to Title, lesson Skip, Resume and Sound are reachable through menu
focus. The five tutorial concepts still require real movement, slides, countersteering
and banked points. Controller-specific tutorial wording follows the driving device.

## Input and safety policy

The existing animation loop polls `navigator.getGamepads()` once per visible frame.
The first complete standard-mapped controller is selected and retained until it is
lost. Additional controllers are ignored; this is a single-player feature.

Steering has a 0.15 center dead zone and rescales the remaining range continuously to
−1…+1. Trigger values at or below 0.05 are zero; higher values retain their travel,
so 0.5 requests exactly half pedal. Commands use the original steering/pedal smoothing,
automatic brake/reverse transition and fixed 120 Hz simulation. Simultaneous triggers
follow the original both-pedals policy: brake while moving forward, no reverse request
until RT is released. No handling or scoring constants change. Ghost format stays 1.

Driving keys win while any driving key is held. A controller used alongside those
keys must return to neutral before it can take over after they are released. Neutral
controller snapshots never mask keyboard input. The driving source stays controller
while coasting, so losing that controller still safely pauses the session.

Connection, reconnection, screen transitions, restart, pause and focus loss require
all mapped buttons, pedals and steering to be released before controller actions
are accepted again. A held A cannot start a run and immediately apply the handbrake;
a held RT cannot accelerate after a restart or resume. Buttons act on press edges,
without menu auto-repeat. Release and press again for each menu action.

Losing the controller currently driving pauses, clears input and leaves the game
paused on reconnect. Losing an unused controller leaves keyboard driving intact.
Blur and hidden-tab pauses remain in place. Returning focus never resumes by itself.

## Browser limits

Use a desktop browser on HTTPS or localhost. Browsers may hide controllers until a
button is pressed while the page has focus; connect, release every control, then
press again. OS drivers, Bluetooth/USB adapters and browser mappings vary. This is
not a promise of universal controller compatibility. Missing or denied Gamepad API
access leaves keyboard and mouse available. Embedded pages may deny the API through
their permissions policy.

Gamepad actions and programmatic menu activation may not unlock browser audio. A
browser may require one mouse click or keyboard press for sound; driving and menus
remain usable with the controller while sound is unavailable. No browser security
or autoplay settings are bypassed.

## Automated checks

`npm test` includes mocked snapshots, bounds/noise, edges, transitions, arbitration,
proportional physics, brake/reverse, a real five-step lesson and six baseline runs.
`test/support/keyboard-baseline.json` was captured from unchanged main `0239cc1`:
each hash covers every tick's car, scoring, laps and clock, plus final ghost data.
Both keyboard commands and equivalent full-travel controller commands must reproduce
those hashes on Original and Switchback. These are regression fixtures, not lap records.

`npm run test:controller:browser` uses mocked Gamepad snapshots in Chromium and Firefox.
It runs the actual frame loop and DOM, including a scored three-lap session, its ghost,
and a complete lesson. The existing browser suites continue testing keyboard/mouse
navigation and layout. CI needs no physical controller. Mocked checks do not qualify
device detection, latency, real mappings or subjective analog feel.

## Physical-controller regression checklist

1. Run `npm start` in the controller worktree and open `http://127.0.0.1:4190` in a
   desktop Chromium browser, then Firefox. Record OS, browser version, controller,
   USB/Bluetooth and whether the browser reports the standard mapping.
2. With no controller, drive briefly with arrows/Space; check P, R, menus and focus.
3. Connect a controller, focus the page, press a button, then release all controls.
   Confirm the title reports Controller ready. Use only D-pad and A/B from here.
4. Select Switchback with Left/Right. Open How to Play and return with B. Open
   Options, choose a radio station and adjust both volumes; close with B. If audio
   needs a click/key to unlock, record that separately from controller navigation.
5. Start a run. Confirm held A does not carry into the handbrake. Compare quarter,
   half and full RT travel; vary the stick gradually in both directions. Coast,
   brake with LT, then keep LT held to reverse; use RT to brake back to forward.
6. Initiate and catch drifts with stick, RT and short A pulls. Check X toggles the
   ghost, Y changes radio, and holding either causes only one action per press.
7. Pause with Menu while RT is held. Confirm no motion; release every control,
   then resume. Test Resume, Restart, Options and Return to Title with D-pad/A.
8. Drive on controller and disconnect it, including while coasting. Expect Pause.
   Reconnect with RT/A held: expect no resume or motion. Release, then resume.
   Drive with keyboard and disconnect an unused controller: expect no pause or
   interruption. If available, unplug a second unused controller too.
9. While driving, hold a keyboard direction with a controller pedal held. Keyboard
   wins; after key release the pedal must be released and pressed again to drive.
   Switch tabs/blur while driving: expect Pause and no automatic resume on return.
10. Finish three laps. Verify scoring, timing, a previous-lap ghost, Drive Again,
    and Results → B → Title without keyboard input.
11. How to Play → Try It: complete accelerate, both steering directions, slide,
    countersteer and bank. Confirm controller instructions, no skipped steps and
    the qualified ending. Repeat to test Pause → Skip / Restart / Return to Title.
12. Note detection problems, accidental motion, stuck controls, focus/layout issues,
    latency and whether partial steering/pedals feel useful. Review any new findings
    before further controller changes. Release planning remains a separate decision.
