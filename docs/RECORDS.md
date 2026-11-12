# Local personal records

Records are independent for every track and handling mode: a record's identity is
track + handling mode + record type (Original with Power never shares a record with
Original with Classic, or with Switchback with Power). The public modes are Classic
(id `classic`) and Power (id `revised`); records use the id, never the display name. They live only in this
browser/device's localStorage, survive reloads/restarts, and disappear when browser
storage is cleared. There are no accounts, online leaderboard, telemetry or sync.

## Qualification

- Highest score: the run's qualifying score after three valid laps finish a normal
  run. Points banked on voided laps are left out of it, as on the results screen.
- Fastest lap: existing valid lap time in seconds, saved at lap completion, even if
  the run is later restarted or abandoned. Voided and incomplete laps do not count.
- Best combo: the best combo banked on a counted lap, as shown on the results, after a
  normal three-lap finish. Combos banked on voided laps, lost/unbanked points and
  abandoned runs do not establish combo records.
- Try It sessions and their restarts never establish any records.
- Practice pad sessions never establish any records: they are never scored or lapped,
  and their pad is not a circuit the keeper accepts.
- The run's handling mode is fixed when it starts. Every event names it, and an event
  naming another mode, run or track than the run's start is ignored.
- Ties do not improve a record. Zero is a valid score/combo; null means no record.

The session emits start, lap, finish and abandon events containing primitive copies.
The records keeper observes these boundaries; it does not read/write each frame or
alter the car, scoring, validation, tracks, ghost, input or audio settings.
Tutorial starts/restarts explicitly use tutorial mode; it is not inferred from ghosts.
Results retain their score, timing, combo, spinout and humorous remark. NEW BEST
means this run saved an improvement; a lap saved earlier in the run remains marked.
New-run flags reset on restart/abandon, so an old lap record is never claimed again.

## Storage schema

From v0.3.0 the key is `mini-drifters-records-v2`, schema 2. A single JSON entry:

```json
{
  "version": 2,
  "tracks": {
    "original": {
      "classic": { "score": 12450, "fastestLap": 48.321, "bestCombo": 4210 },
      "revised": { "score": null, "fastestLap": 47.9, "bestCombo": null }
    },
    "switchback": { "classic": { "score": null, "fastestLap": null, "bestCombo": null } }
  }
}
```

Points must be nonnegative safe integers; laps must be finite positive seconds no
larger than Number.MAX_SAFE_INTEGER. Stable track IDs are original and switchback;
stable handling IDs are classic and revised (`src/handling.js`). Invalid known
values become null. Tracks, modes and fields this version does not know are never shown
and are carried through writes untouched, so a later version's data survives.

**Retired mode.** A third mode, Tuned Power (id `tuned`), was offered while v0.3.0 was
being built and was then removed before release. Its id is reserved
(`RETIRED_HANDLING_IDS`) so it can never name a different mode. Any `tuned` entries in a
save are kept through every write exactly as they were. They aren't shown, and they're
never folded into Classic or Power. Its physics and research results stay in the physics
lab only.

- Malformed JSON, wrong-shaped data, or a version that isn't a later schema (missing,
  not an integer, or below 2) is treated as corrupt: it shows as empty, nothing is
  written on load, and the next qualifying improvement replaces it with schema 2.
- A later schema (an integer version above 2) is **never written**. Records fall back
  to what can still be read (the v0.2.0 key below), no NEW BEST is claimed, and the
  title says the records were saved by a newer version.

### v0.2.0 records

v0.2.0 saved `mini-drifters-records`, schema 1:
`{ "version": 1, "tracks": { "original": { "score", "fastestLap", "bestCombo" }, ... } }`.

v0.3.0 **never writes that key**. v0.2.0 reads anything that isn't schema 1 as empty,
and its next new best then overwrites the whole key, so an in-place upgrade would be
destroyed by a v0.2.0 tab left open or by a rollback. Instead, every read folds the
v0.2.0 key, read with v0.2.0's own rules, into Classic (all v0.2.0 records were driven
with Classic):

    shown Classic best = the better of (the schema 2 Classic best, the v0.2.0 best), per record type

This is a pure, idempotent function of the two saved strings. It invents nothing,
keeps a real zero as zero and a missing record as missing, and keeps picking up
anything a v0.2.0 tab saves later. Nothing is written on load: the folded Classic
values are copied into the new key the first time a new best is written there.

**Rollback limitation.** v0.2.0 shows only its own key. After a rollback, records set
first in v0.3.0 (every Power record, and Classic improvements) are
not visible there. They are not lost: upgrading again shows them, merged with anything
v0.2.0 saved meanwhile. Writing Classic bests to the old key as well (dual-writing)
would keep them visible after a rollback, but was not built without the owner's
decision.

**Physics changes.** Records are only comparable while a mode's physics hold. The
numbers of each mode are pinned by a test. A change that could materially alter lap
times or scores should get a new handling id (a new, empty partition); old partitions
are kept untouched in storage.

Both keys are re-read at record boundaries to retain other tabs' saved tracks and modes,
including a v0.2.0 tab's. Only strict improvements write. Score and combo settle together in one
write. If initial access/read fails, storage is unavailable for that page visit.
Later read/write failures leave saved data intact and can retry at another record
boundary. If a write fails,
the previous saved snapshot stays visible and the improvement is not marked NEW BEST;
a later qualifying improvement can retry. A note on the title/results explains the
failure. Gameplay continues; no temporary records are presented as saved.
Existing sound and radio preference keys are untouched.

## Human acceptance

Run `npm start` and open http://127.0.0.1:4190 in desktop
Chromium, then Firefox. Use a fresh browser profile for empty-store checks.

These steps are v0.2.0's; with v0.3.0 they apply to each handling mode. Also check that
switching handling on the title shows each mode's own records, that a run in one mode
never changes another mode's, that the practice pad changes none, and that a v0.2.0
save appears under Classic.

1. On Original, confirm all three bests show --. Press Right to Switchback, check
   its heading/placeholders, then Left back. Repeat with a standard-mapped controller's
   D-pad after connecting, focusing the page, pressing a button and releasing controls.
2. Start using Enter or controller A. Drive normally with arrows/Space or stick/RT/LT/A.
   Finish three valid laps with banked drift points. Check existing results and remark
   remain present; all three first records have NEW BEST. Note the exact result values.
3. Return to Title (controller B or the button). Check the three saved values. Reload,
   then close/reopen the browser on the same origin/profile and check they remain.
4. Select Switchback; it must still show --. Complete a run there, return to title,
   switch between tracks and reload. Each track must retain its own values.
5. Drive Again on either track. A lower/equal score or combo must not receive its
   NEW BEST label; a slower/equal lap must not receive one. Beat an individual record
   and check only the improved fields are marked and saved.
6. Complete one valid lap, note its time, then restart or Return to Title before
   three laps. A faster lap persists; score/combo records must remain unchanged.
   Cut a checkpoint to void a lap, or leave before finishing a lap: neither may set
   a lap record. Lost drift points must not establish a combo record.
7. How to Play → Try It: drive, bank points, restart, skip/finish or exit the lesson.
   Return to Title and reload; no record may change. A following normal run can qualify.
8. In a separate disposable browser profile, use DevTools Application/Storage to set
   mini-drifters-records-v2 to malformed JSON, then reload. Expect -- and normal driving;
   completing a run must recover a valid save. Deny site storage using browser privacy
   controls where available: expect a storage note and functional gameplay, with no
   NEW BEST claims for failed writes. Automated tests inject denied reads/quota errors.
9. With records visible, navigate Start, How to Play, Options and back using keyboard
   and controller. Check 1024×600, 1366×768 and 1920×1080 for readable records and
   visible controls, including with storage failure messages.
10. Recheck pause/resume, restart, ghost/radio actions, held-control isolation and
    keyboard/controller takeover. Explicitly test driving-controller disconnect,
    reconnect with pedals held, release then resume, and unused-controller disconnect
    during keyboard driving. The prior owner review did not explicitly cover every
    physical disconnect/reconnect scenario; mocked browser tests are separate evidence.

Local records were released in v0.2.0 (PR #17), taking their score and best combo from
the corrected results after the shortcut and voided-lap fixes (#18 and #19). v0.3.0 keeps
them per handling mode, in schema 2.
