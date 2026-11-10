# Local personal records

Records are independent for Original and Switchback. They live only in this
browser/device's localStorage, survive reloads/restarts, and disappear when browser
storage is cleared. There are no accounts, online leaderboard, telemetry or sync.

## Qualification

- Highest score: the existing final score after three valid laps finish a normal run.
- Fastest lap: existing valid lap time in seconds, saved at lap completion, even if
  the run is later restarted or abandoned. Voided and incomplete laps do not count.
- Best combo: the existing banked best-combo value after a normal three-lap finish.
  Lost/unbanked points and abandoned runs do not establish combo records.
- Try It sessions and their restarts never establish any records.
- Ties do not improve a record. Zero is a valid score/combo; null means no record.

The session emits start, lap, finish and abandon events containing primitive copies.
The records keeper observes these boundaries; it does not read/write each frame or
alter the car, scoring, validation, tracks, ghost, input or audio settings.
Tutorial starts/restarts explicitly use tutorial mode; it is not inferred from ghosts.
Results retain their score, timing, combo, spinout and humorous remark. NEW BEST
means this run saved an improvement; a lap saved earlier in the run remains marked.
New-run flags reset on restart/abandon, so an old lap record is never claimed again.

## Storage schema

Key: `mini-drifters-records`. A single JSON entry:

```json
{
  "version": 1,
  "tracks": {
    "original": { "score": 12450, "fastestLap": 48.321, "bestCombo": 4210 },
    "switchback": { "score": null, "fastestLap": null, "bestCombo": null }
  }
}
```

Points must be nonnegative safe integers; laps must be finite positive seconds no
larger than Number.MAX_SAFE_INTEGER. Stable IDs are original and switchback; unknown
tracks/fields are ignored, and invalid known values become null. Malformed JSON,
wrong-shaped data and unsupported versions recover empty, without an eager write or
historical migration. The next qualifying improvement writes schema 1.

The latest stored snapshot is re-read at record boundaries to retain other tabs'
saved tracks. Only strict improvements write. Score and combo settle together in one
write. If initial access/read fails, storage is unavailable for that page visit.
Later read/write failures leave saved data intact and can retry at another record
boundary. If a write fails,
the previous saved snapshot stays visible and the improvement is not marked NEW BEST;
a later qualifying improvement can retry. A note on the title/results explains the
failure. Gameplay continues; no temporary records are presented as saved.
Existing sound and radio preference keys are untouched.

## Human acceptance

Run `npm start` in the records worktree and open http://127.0.0.1:4190 in desktop
Chromium, then Firefox. Use a fresh browser profile for empty-store checks.

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
   mini-drifters-records to malformed JSON, then reload. Expect -- and normal driving;
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

The records PR stays draft for acceptance. Version remains 0.1.0; no v0.2.0 decision,
tag or GitHub Release is made here.
