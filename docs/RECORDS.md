# Local personal records

Records are independent for every track and handling mode: a record's identity is
track + handling mode + record type (Original with Power never shares a record with
Original with Classic, or with Switchback with Power). The public modes are Classic
(id `classic`) and Power (id `revised`); records use the id, never the display name. They live only in this
browser/device's localStorage, survive reloads/restarts, and disappear when browser
storage is cleared. There are no accounts, online leaderboard, telemetry or sync.

Score and best combo also depend on the **scoring version** they were earned under,
because a change to what drifts pay makes old scores incomparable. The fastest lap does
not: scoring changes leave the car, the circuits and lap validity alone.

| Record | Partition |
|---|---|
| Highest score | track + handling mode + scoring version |
| Best combo | track + handling mode + scoring version |
| Fastest lap | track + handling mode, shared by every scoring version |

| Scoring version | Rules | Shown as |
|---|---|---|
| `scoring-1` | v0.2.0's rules: every record saved before the low-speed fade | Legacy scoring |
| `scoring-2` | the low-speed fade (`src/scoring.js` `speedScore`) | the current bests |

The current id is `SCORING_VERSION` in `src/scoring.js`. Any change to the points a
drive earns needs a new id there, never new numbers under an old one. Runs only ever
compete with records from their own scoring version: legacy scores and combos are
read-only history. The title shows them in one small line under the current bests
("Legacy scoring: score 15,420 · combo 2,400") when there are any; they are never
labelled NEW BEST and no run can beat or change them. There is no option to play with
the old rules.

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
- Gymkhana challenges never establish any of these records. They keep their own, under
  their own storage key: see [the Gymkhana notes](GYMKHANA.md#records).
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

Since the low-speed fade the key is `mini-drifters-records-v3`, schema 3. A single JSON
entry:

```json
{
  "version": 3,
  "tracks": {
    "original": {
      "classic": {
        "fastestLap": 47.31,
        "scoring": {
          "scoring-1": { "score": 15420, "bestCombo": 2400 },
          "scoring-2": { "score": 11800, "bestCombo": 2150 }
        }
      },
      "revised": {
        "fastestLap": 47.9,
        "scoring": {
          "scoring-1": { "score": null, "bestCombo": null },
          "scoring-2": { "score": null, "bestCombo": null }
        }
      }
    }
  }
}
```

Points must be nonnegative safe integers; laps must be finite positive seconds no
larger than Number.MAX_SAFE_INTEGER. Stable track IDs are original and switchback;
stable handling IDs are classic and revised (`src/handling.js`); stable scoring ids are
`scoring-1` and `scoring-2` (`src/scoring.js`). Invalid known values become null.
Tracks, modes, scoring versions and fields this version does not know are never shown
and are carried through writes untouched, so a later version's data survives. A later
scoring version saved under schema 3 is kept and hidden, not shown as current or legacy.

### Older keys: read, never written

Two earlier keys are read with their own versions' rules and **never written**. Every
record in them was scored with `scoring-1`.

| Key | Schema | Written by | Shape |
|---|---|---|---|
| `mini-drifters-records-v2` | 2 | the handling-modes release (6ffe6bf) | `tracks.<track>.<mode> = { score, fastestLap, bestCombo }` |
| `mini-drifters-records` | 1 | v0.2.0 (all Classic) | `tracks.<track> = { score, fastestLap, bestCombo }` |

Neither is upgraded in place. Each older version reads only its own key, treats any
other schema there as empty and rewrites the whole key on its next new best, so an
in-place upgrade would be destroyed by an older tab left open or by a rollback, and a
current-scoring score written there would be shown by the older version as one of its
own. Instead, every read computes:

    fastest lap          = the best of (schema 3, schema 2, v0.2.0 if Classic)
    current score/combo  = schema 3 under scoring-2 only; nothing older is ever imported
    legacy score/combo   = the best of (schema 3 under scoring-1, schema 2, v0.2.0 if Classic)

This is a pure, idempotent function of the three saved strings. It invents nothing,
keeps a real zero as zero and a missing record as missing, and keeps picking up
anything an older tab saves later. Nothing is written on load: the folded values are
copied into the new key, each under its own scoring version, the first time a new best
is written there. Current-scoring score and combo records start empty; the first
qualifying run sets them, whatever the legacy values were.

**Rollback limitation.** An older version shows only its own key. After a rollback,
records first set under the current scoring (score and combo bests, and laps set only
since the upgrade) are not visible there. They are not lost: upgrading again shows
them, with anything the older version saved meanwhile merged in as legacy scores and
shared laps. Current scores are deliberately not dual-written to the older keys.

**Retired mode.** A third mode, Tuned Power (id `tuned`), was offered while v0.3.0 was
being built and was then removed before release. Its id is reserved
(`RETIRED_HANDLING_IDS`) so it can never name a different mode. Any `tuned` entries in a
save are kept through every write exactly as they were. They aren't shown, and they're
never folded into Classic or Power. Its physics and research results stay in the physics
lab only.

- Malformed JSON, wrong-shaped data, or a version that isn't a later schema (missing,
  not an integer, or below 3) in the current key is treated as corrupt: it shows as
  empty (the older keys still show), nothing is written on load, and the next
  qualifying improvement replaces it with schema 3. Unreadable older keys are ignored
  and left exactly as they are.
- A later schema (an integer version above 3) is **never written**. Records fall back
  to what can still be read (the older keys), no NEW BEST is claimed, and the
  title says the records were saved by a newer version.

**Physics changes.** Records are only comparable while a mode's physics hold. The
numbers of each mode are pinned by a test. A change that could materially alter lap
times should get a new handling id (a new, empty partition); old partitions are kept
untouched in storage. A change that alters only what drifts pay gets a new scoring
version instead (above), and leaves the handling ids and lap records alone.

All three keys are re-read at record boundaries to retain other tabs' saved tracks and modes,
including an older version's tab. Only strict improvements write. Score and combo settle together in one
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
   mini-drifters-records-v3 to malformed JSON, then reload. Expect -- and normal driving;
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
the corrected results after the shortcut and voided-lap fixes (#18 and #19). The handling
modes (#21) keep them per handling mode, in schema 2. The low-speed scoring fade keeps
score and combo per scoring version as well, in schema 3, with every earlier record kept
as legacy scoring.
