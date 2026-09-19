# Never lose a free user's data — design

Status: approved · 2026-09-18
Decisions: `scratchpad/decisions-data-safety.md` (user, 2026-09-18)
Build order: after the Coretax pickers.

## 1. Why

Expanses is local-first. A free user's only copy of their money lives in OPFS inside this app on this
device. Today, if that file will not open, the user is shown a dead end and their instinct — delete the
app and reinstall — destroys everything.

This is exactly what happens today, read from the code on 2026-09-18:

- `apps/web/src/main.tsx` renders `Message title="Opening your data…"`, then `await bootstrap()`. Any
  throw lands in one `catch` that renders `Message title="Could not open the database"` with the raw
  error string. No button, no export, no restore, no explanation. A dead end.
- `apps/web/src/db/bootstrap.ts` → `openAppDb()` calls `migrate(database)` and then writes
  (`createWorkspace`, `ensureCategoryKeys`, `ensureDefaultCategorySets`, `syncLinkedPrograms`,
  `activeBookId`) before a single check that the file is sound.
- `packages/db/src/migrations.ts` → `migrate()` runs each pending migration inside
  `BEGIN IMMEDIATE; … COMMIT;` through `execScript`, and on error attempts `ROLLBACK` and rethrows. One
  migration is atomic; **a run of several is not** — migrations 42 and 43 can commit and 44 fail, leaving
  a half-updated database that the previous app build cannot read either. Nothing is copied first.
- Nothing anywhere runs `PRAGMA integrity_check` or `quick_check`. `checkLedgerIntegrity`
  (`packages/db/src/repos/ledger.ts:409`) exists and is called only by `packages/db/test/sample-data.test.ts`.
- Nothing compares the stored schema version with the app's. A database written by a newer build (a
  restored backup, TestFlight, a downgrade) reaches `migrate()`, which skips the versions it does not
  know and then hands the app tables with columns it does not know either — failing later as an opaque
  query error.
- The only real backup is `apps/web/src/features/backup/BackupPage.tsx` — a manual download the user has
  to remember, nudged by `BackupBanner` at 7 and 14 days (`backupState.ts` → `backupUrgency`).

Five layers, in the user's build order. Together they make the outcome of *any* failure "your data is
still here, and here is how to get it out", never "reinstall".

## 2. What exists today (the ground this is built on)

| Piece | File | What it does now |
|---|---|---|
| Worker | `apps/web/src/db/worker.ts` | `sqlite3InitModule()` → `installOpfsSAHPoolVfs({ name: 'expanses' })` → one `OpfsSAHPoolDb('/expanses.sqlite3')`, `PRAGMA foreign_keys = ON`. Ops: `query`, `script`, `export` (`pool.exportFile`), `import` (keeps the previous bytes, `pool.importDb`, reopen, assert a `schema_migrations` table, roll back to the previous bytes on any failure). Errors are posted back as `{ id, error: message }`. |
| Transport | `apps/web/src/db/worker-executor.ts` | id → promise map; `worker.onerror` rejects everything pending with `SQLite worker failed`. |
| Handle | `packages/db/src/database.ts` | `Database` = `{ db, transaction, execScript, exportBytes, importBytes }`, all serialised through one mutex. |
| Migrations | `packages/db/src/migrations.ts` | `schema_migrations(version, name, applied_at)`; renumber repair; 46 migrations; one transaction each. |
| Open | `apps/web/src/db/bootstrap.ts` | `bootstrap()` → new Worker → `createDatabase` → `openAppDb()` → `migrate` + first-run seeding. |
| Shell | `apps/web/src/main.tsx` | single-tab `navigator.locks.request('expanses-db')` guard; "Opening your data…"; the dead-end catch. |
| Ledger check | `packages/db/src/repos/ledger.ts:409` | `checkLedgerIntegrity(database, ws)` → posted transactions whose entries do not sum to zero per currency. No orphan check. |
| Backup | `apps/web/src/features/backup/*` | manual export via `saveBytes` (`<a download>`), restore from file behind a safety-copy download and a confirm; `last_backup_at` in `settings`; banner at 7 / 14 days. |
| Storage facts | `@sqlite.org/sqlite-wasm` 3.53.4 | The SAH pool owns OPFS directory `.expanses` (default `"." + name`); default capacity 6 slots; each slot file is a 4096-byte header (`HEADER_OFFSET_DATA = SECTOR_SIZE = 4096`) followed by the database bytes. The pool cannot use WAL — `importDb` even rewrites the header to force WAL off. |
| Sample | `packages/db/test/sample/seed.ts`, `apps/web/dev-data/sample.sqlite3` | A realistic household: 1,372,160 bytes, 4096-byte pages, 335 pages, 200+ transactions. The size figures below are measured against it. |

**Capacitor is not in the repository yet.** There is no `capacitor.config.*` and no `ios/` directory;
the iOS wrapper is phases 4–5 of the phone-shell plan (`docs/superpowers/specs/2026-09-16-phone-shell-design.md`).
That spec already records the spike result that matters here: under `capacitor://localhost` on the iOS 26
Simulator, `installOpfsSAHPoolVfs()` works and rows survive relaunches. Everything below is written so it
holds for both the PWA today and the WKWebView wrapper later; §8 says exactly what phase 4 must verify.

## 3. Layer 1 — a recovery screen instead of a dead end

### 3.1 The staged open

`bootstrap()` becomes a sequence of named stages. Each stage that fails produces a `RecoveryReason`
instead of a thrown error, and no stage writes anything before the stage that proves the file sound.

| # | Stage | Fails as |
|---|---|---|
| 1 | Start the worker, install the VFS, open `/expanses.sqlite3` | `cannot-open` |
| 2 | Read `MAX(version)` from `schema_migrations` (missing table = a new database) | `unreadable` |
| 3 | Refuse a version higher than this build knows (§6) | `newer-database` |
| 4 | `PRAGMA quick_check(1)` before anything is written | `corrupt` |
| 5 | Snapshot, if migrations are pending (§4) | `snapshot-failed` (does not block; see §4.4) |
| 6 | `migrate()` with progress (§7) | `migration-failed` |
| 7 | Verify: `quick_check` + ledger health (§5) | `verify-failed` → automatic rollback, then `rolled-back` |
| 8 | First-run seeding and `syncLinkedPrograms`, as today | `cannot-open` |

Stages 2–4 are read-only. Stage 5 is the first write to OPFS, stage 6 the first write to the database.

```ts
// apps/web/src/db/open.ts
export type RecoveryKind =
  | 'cannot-open'      // the worker, the VFS, or the file itself
  | 'unreadable'       // opened, but schema_migrations cannot be read
  | 'corrupt'          // quick_check failed before we changed anything
  | 'newer-database'   // written by a newer build of Expanses
  | 'migration-failed' // an update stopped part-way; the snapshot is back in place
  | 'verify-failed'    // the update finished but the result does not check out
  | 'locked';          // another tab holds the database

export interface RecoveryReason {
  kind: RecoveryKind;
  /** One sentence, in the user's words. Never a stack trace. */
  headline: string;
  /** What actually happened, shown under "Details" for a bug report. */
  detail: string;
  /** Can this database still be read well enough to export it? */
  exportable: boolean;
  /** Was the database put back the way it was before the update? */
  rolledBack?: boolean;
}
```

### 3.2 What the screen offers

One screen, `apps/web/src/features/recovery/RecoveryScreen.tsx`, rendered by `main.tsx` in place of the
app. It is the phone shell's width, works with a thumb and with a mouse, and never scrolls sideways.

```
  Your data is still on this device

  We could not open it this time. Nothing has been deleted.
  [headline, one sentence]

  ┌──────────────────────────────────────────────┐
  │ Restore the last good copy                   │  ← primary, only when a snapshot exists
  │ From 18 September, 09:12 · 1.3 MB            │
  └──────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────┐
  │ Export what is there                         │  ← always offered; tried even when not "exportable"
  └──────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────┐
  │ Try again                                    │
  └──────────────────────────────────────────────┘

  Details ▸                                        ← the technical text, selectable, for a bug report

  Start fresh — deletes everything on this device   ← plain text link, red, bottom, behind two steps
```

Rules:

- **Never automatic.** Nothing on this screen runs on its own. The app does not delete, overwrite or
  reset anything without the user pressing something twice.
- **"Start fresh" is last, smallest, and gated.** Pressing it opens a confirm that (a) states how much
  data is about to go (the byte size of the file, and the snapshot dates), (b) requires an export first
  or an explicit "I have a backup" tick, and (c) requires typing nothing — but a second, separate press
  on a red button. Only then does it `pool.wipeFiles()` and reload.
- **Recovery mode is reachable on purpose.** `/?recover` (and `#recover`) opens this screen *without*
  opening the database at all, so a user whose app half-works, or a support conversation, can get to
  Export and Restore. It is a product feature, not a test hook, and it is what makes the automatic path
  testable end-to-end in a production build (§9).

### 3.3 "Export what is there" when the database will not open

Two paths, tried in order:

1. **Through the worker.** `pool.exportFile('/expanses.sqlite3')` does not need the database to be
   *openable* — it reads the slot's bytes. So even `cannot-open` from `new pool.OpfsSAHPoolDb(...)` and
   every `corrupt` / `unreadable` case still exports. This is the normal path.
2. **Raw OPFS salvage**, when the worker cannot start at all (`sqlite3InitModule()` throws, the `.wasm`
   fails to load, the VFS will not install). `apps/web/src/db/salvage.ts` runs on the main thread with
   nothing but `navigator.storage.getDirectory()`:
   - open the directory `.expanses`;
   - for each file in it, read bytes 4096..4112 and keep those beginning `SQLite format 3\0`
     (`HEADER_OFFSET_DATA` is 4096; journal slots do not carry the magic);
   - take the largest match, read the page size (bytes 16–17, big-endian) and page count (bytes 28–31) from
     its SQLite header, and slice exactly `pageSize × pageCount` bytes from offset 4096;
   - hand those bytes to `saveBytes()` as `expanses-salvage-<date>.sqlite3`.

   Identifying the slot by its magic rather than by the VFS's stored path avoids depending on how the
   pool encodes names. If page size or page count is nonsense, the whole slot minus its header is
   exported instead, and the screen says the file may need repair.

On iOS/WKWebView `<a download>` does nothing (phone-shell spec, §Risks). Export on the recovery screen
therefore goes through the same seam phase 4 introduces for the Backup page — one `saveBytes()`
implementation, a share sheet under Capacitor. Until that seam exists, the recovery screen also renders
the bytes as a copyable `data:` URL fallback and says "open this in Safari to save it". This is stated so
phase 4 cannot forget the recovery screen when it fixes the Backup page.

### 3.4 Corruption found while the app is running

`SQLITE_CORRUPT` / `SQLITE_NOTADB` can also surface hours after opening, from an ordinary query. The
worker tags any error whose message matches `/malformed|not a database|disk image/i` as fatal and posts
`{ fatal: 'corrupt' }`; the executor rejects everything pending and `main.tsx` swaps the app for the
recovery screen with `kind: 'corrupt'`. The user loses the screen they were on, not their data. *(Not in
the decisions file — see §11.)*

## 4. Layer 2 — a snapshot before anything risky

### 4.1 Where it lives

OPFS root, directory **`expanses-safety/`** — a sibling of the VFS's `.expanses`, never inside it (the
sqlite-wasm docs are explicit: every file in the VFS directory is assumed to belong to the VFS and may be
deleted by it).

```
expanses-safety/
  manifest.json
  snapshot-20260918T091200Z-v46-before-migration.sqlite3
  snapshot-20260917T203311Z-v46-daily.sqlite3
```

`manifest.json` holds the bookkeeping, but the directory is the authority on what exists — a copy has to
stay listable and restorable on the day `manifest.json` is itself what broke. So the name carries
everything a decision is made on: when, at which schema version, and **why** (amended 2026-09-19). The
reason was originally left out as "only for humans", and a copy whose manifest entry was lost then had to
be guessed at as the common one, `before-migration` — which put a `before-restore` copy, the undo net
holding whatever a restore replaced, back among the candidates for "Restore the last good copy".

```json
{ "snapshots": [
  { "file": "snapshot-20260918T091200Z-v46-before-migration.sqlite3", "takenAt": "2026-09-18T09:12:00.412Z",
    "schemaVersion": 46, "bytes": 1372160, "reason": "before-migration" }
] }
```

`reason` is `before-migration` | `daily` | `before-restore` | `before-start-fresh`. Metadata lives in
OPFS, not in `settings`, because the recovery screen must read it when the database will not open.

Snapshot files are written and read from the **main thread** (`apps/web/src/db/snapshots.ts`,
`FileSystemFileHandle.createWritable()` / `.getFile()`), not from the SQLite worker, for the same reason:
the snapshot must be listable and restorable when the worker is dead. Bytes come from the worker
(`exportBytes()`) when it is alive, from salvage when it is not.

### 4.2 When one is taken

| Trigger | Rule |
|---|---|
| Before a migration | Whenever `pendingMigrations()` is non-empty — every migration, not only table-rebuilding ones. At 1.4 MB a copy costs single-digit milliseconds; the asymmetry between that and a lost ledger is not close. |
| Daily | After a successful open, at most once per calendar day, in an idle callback after the first screen has painted. Without this, "Restore the last good copy" after a corruption that no migration caused would hand back a copy from whenever the last update was. *(Not in the decisions file — see §11.)* |
| Before restoring a file | The existing safety-copy download stays; a snapshot is taken as well, because a download the user cannot find is not a safety net. |
| Before "Start fresh" | **Not taken, and the reason is not written by any code path** (amended 2026-09-19). "Start fresh" deletes both `.expanses/` and `expanses-safety/` — it has to, or a clean slate would quietly keep two copies of the data the user just asked to be rid of — so a copy taken here would be destroyed by the very action that took it. What stands between a mistake and a catastrophe is the dialog in front of it: two presses, and the red button stays disabled until the user has downloaded a backup there or ticked that they already hold one. The `before-start-fresh` reason and its seven-day grace stay in the code, unwritten, for a later phase that keeps such a copy somewhere the wipe does not reach. |

### 4.3 How many, and what it costs

Two are kept (the decision), pruned oldest-first immediately after a new one is written — written first,
pruned second, so there is never a moment with zero snapshots. `before-start-fresh` is exempt from the
prune for 7 days — implemented on both prune paths, and unreachable while nothing writes that reason
(§4.2).

Cost, measured against `apps/web/dev-data/sample.sqlite3` (1,372,160 bytes, 335 pages):

| | Sample (1.4 MB) | A heavy 10-year ledger (~50 MB, extrapolated) |
|---|---|---|
| Bytes on disk for 2 snapshots | 2.7 MB | 100 MB |
| `exportFile` + OPFS write | ~10 ms | ~0.4 s |
| `quick_check` | 15 ms (better-sqlite3, cold) | ~0.5 s |
| `integrity_check` | 6 ms (warm) | ~0.3 s |

So the honest statement to the user is: snapshots use about twice the space your data already uses.
Before writing, `snapshots.ts` asks `navigator.storage.estimate()`; if `quota - usage` is less than
`3 × dbBytes`, it prunes to one snapshot, and if it still does not fit it skips the snapshot and the
pre-migration screen says so with a "Download a backup first" button — the update does not proceed
silently without a copy.

### 4.4 How the copy is taken while SQLite has the file open

**A file copy — `pool.exportFile('/expanses.sqlite3')` — taken from inside the worker's own request
queue.** Not `VACUUM INTO`, not a checkpoint. Why:

- **There is no WAL to checkpoint.** The OPFS SAH pool VFS has no shared memory, so WAL is unavailable;
  `importDb` even rewrites the header to force WAL off. The database is in rollback-journal mode, where
  the main file is complete and self-consistent at every moment no transaction is open.
- **No transaction can be open at that moment.** The worker is single-threaded and handles one request at
  a time, and `packages/db/src/database.ts` serialises `transaction()`, `execScript()` and every query
  through one mutex. A `snapshot` request is dispatched between statements, never inside one. As a belt:
  the worker refuses the snapshot (`{ error: 'busy' }`, retried once after a tick) when
  `sqlite3.capi.sqlite3_get_autocommit(db.pointer)` is 0.
- **`VACUUM INTO` would be worse here.** It writes a second database through the same VFS, which means
  claiming another pool slot (default capacity 6), doubling the write, and rebuilding every b-tree — all
  for a file we are about to byte-copy anyway. Its one advantage, a defragmented copy, is worth nothing
  to a rescue copy.

The snapshot is verified before it counts: after writing, `snapshots.ts` re-reads the file, checks the
length matches, checks the `SQLite format 3\0` magic, and checks `pageSize × pageCount` equals the length.
A snapshot that fails this is deleted and the manifest is not updated.

## 5. Layer 3 — verify after migrating, roll back automatically

### 5.1 The checks

Run in this order, immediately after `migrate()` reports applied versions, before any other write:

1. **`PRAGMA quick_check(1)`** — the page/b-tree structure. Failure is either a thrown SQLite error
   (`database disk image is malformed`) **or** a first row that is not the string `ok`. Both count.
   `quick_check` rather than `integrity_check` here because it walks every page but skips the
   index-versus-table cross-check; on the sample both are under 20 ms, so the difference only matters at
   the top end of database size. When `quick_check` passes and a migration touched an index, the slower
   `PRAGMA integrity_check` runs too — it is the one that catches "index row missing from table".
2. **Ledger health**, per workspace, new `checkLedgerHealth(database, ws)` in
   `packages/db/src/repos/ledger.ts` beside the existing `checkLedgerIntegrity` (which stays exactly as it
   is — `packages/db/test/sample-data.test.ts` asserts on its shape):
   - `unbalanced` — today's `checkLedgerIntegrity` result: posted transactions whose entries do not sum to
     zero per currency;
   - `orphanEntries` — `entries` whose `transaction_id` has no `transactions` row, or whose `account_id`
     has no `accounts` row (the decisions file names orphans explicitly; nothing checks for them today);
   - `orphanTransactions` — posted `transactions` with no `entries` at all.
3. **The version landed** — nothing this open was *allowed* to apply is still outstanding
   (`pendingMigrations(database, allowed)` is empty). Written first as "`MAX(version)` equals this build's
   highest migration", which is not true on a device holding a blocked update: the do-not-loop guard
   deliberately opens one version below the update it is skipping, and an update this open never attempted
   has not gone missing. The narrower question is the one that is always true after a successful run, and
   it still catches the case the check exists for — a file that no longer agrees with itself about what has
   run, which would otherwise be migrated again on the next launch, over a schema that already holds the
   change, long after the copy that could have put it back was pruned.

### 5.2 What counts as failure

Any of: a thrown error from a check; a `quick_check` / `integrity_check` first row other than `ok`; any
non-empty list from `checkLedgerHealth`; a version below the build's.

Explicitly **not** failure: `syncLinkedPrograms` throwing (it is already caught and warned today), a
missing category set, or anything else that a later open can fix. Those must not roll a migration back.

### 5.3 The rollback

Only when a snapshot from *this* open exists (reason `before-migration`, taken minutes ago):

1. The screen changes to "Putting your data back…" and stays there.
2. `database.importBytes(snapshotBytes)` — the worker's existing `import` op, which already keeps the
   current bytes and restores them if the import itself fails, so a failed rollback leaves the
   half-migrated file rather than nothing.
3. `quick_check` the result. If it passes, mark the snapshot as used, record `rolled_back_at` and the
   failed version in `expanses-safety/manifest.json` (not in the database — the database is the thing
   under suspicion), and reload the page. The old build's code then opens the old version normally.
4. If the rollback itself fails, no further writes: straight to the recovery screen with
   `kind: 'verify-failed'`, `rolledBack: false`, and both the snapshot and the current file offered for
   export.

**The app that just rolled back must not immediately migrate again.** After a rollback, the manifest
carries `blockedVersion: 47`; the next open sees it, skips migrating past 46, and opens read-write on the
old version with a banner: *"Your data is back as it was. Update 47 could not be applied — export a
backup and send it to support."* The block clears when the user presses "Try the update again" or when
the app's highest version changes (a fixed build shipped).

### 5.4 What the user is told

> **Your update was undone**
> We updated your data, checked it, and something did not add up — so we put it back exactly as it was
> before. Nothing was lost. Please download a backup now, and send it to us if you can.
> [Download a backup] [Details ▸]

Never a stack trace above the fold; never the word "corrupt" without "nothing was lost" in the same
breath.

## 6. Layer 4 — refuse a database newer than the app

### 6.1 Where the version is read

Stage 2 of §3.1 — after the file opens and **before `migrate()`, before any write, before `openAppDb`'s
seeding**. New in `packages/db/src/migrations.ts`:

```ts
/** The highest version this build knows. */
export const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

/** The highest version recorded in the file, or 0 for a database that has never been migrated. */
export async function databaseVersion(database: Database): Promise<number> { … }

/** Versions in the file that this build does not know. Non-empty means: do not run. */
export async function futureVersions(database: Database): Promise<number[]> { … }
```

`databaseVersion` reads `sqlite_master` first, so a brand-new file (no `schema_migrations`) answers 0
rather than throwing. `futureVersions` returns the recorded versions greater than `LATEST_VERSION`, which
is the honest test: a build that shipped migrations 1–46 must refuse a file that recorded 47, whatever
its name.

### 6.2 The message

> **This data was made by a newer version of Expanses**
> Update the app and open it again. Your data is safe and unchanged — this version simply does not know
> how to read it yet.
> Your data: update 48 · This app: update 46
> [Export what is there] [Details ▸]

No "Restore the last good copy" here (an older snapshot is older data, and the user's problem is the app,
not the file) — but it is listed under Details for the case where the newer file arrived by a restore the
user regrets. No "Start fresh" on this screen at all: the single most likely reader is someone who just
restored their own current backup onto an old build, and offering them deletion is indefensible.

### 6.3 The escape hatch

"Export what is there" works exactly as §3.3 — `pool.exportFile` gives back the newer file byte for byte,
so it can be carried to a device with an up-to-date app. The refusal never writes to the file, so the
export is identical to what a newer app would open.

## 7. Layer 5 — say what is happening during a long update

### 7.1 Progress

`migrate()` gains an options object; nothing else about it changes:

```ts
export interface MigrateOptions {
  onProgress?: (done: number, total: number, name: string) => void;
}
export async function migrate(database: Database, migrations = MIGRATIONS, options: MigrateOptions = {}): Promise<number[]>
```

`onProgress` fires *before* each migration with `(index, total, name)` and once more after the last with
`(total, total, name)`. `bootstrap()` forwards it to `main.tsx`, which renders:

> **Updating your data…**
> Step 3 of 7 · book_indexes
> [████████░░░░░░░░] Do not close the app. Your data is copied before we start.

Screens shown while opening, in order, each replacing the last: "Opening your data…" → "Making a safety
copy…" (only when a snapshot is being taken) → "Updating your data…" with the bar → "Checking your
data…" → the app. Any stage that takes less than 300 ms is not given its own screen — a flash of three
headings reads as a fault.

### 7.2 Responsive, and safe to interrupt

The migrations run in the worker, so the main thread stays free and the progress bar actually animates —
that is already true and must stay true: no migration work moves to the main thread.

"Resumes safely if interrupted" is already the design of `migrate()` — each migration is its own
`BEGIN IMMEDIATE … COMMIT` and records its row in `schema_migrations` inside that same transaction, so a
kill at any instant leaves a file at some completed version with the rest still pending. The next open
snapshots again and carries on from there. What is added is that this is now *tested* (§9) rather than
merely believed, and that the snapshot taken before the run means a kill in the middle of migration 47
has a version-46 copy sitting next to it either way.

## 8. Backups the user keeps

### 8.1 Reminders

Today's ladder (`backupUrgency`: `remind` at 7 days, `warn` at 14, `warn` immediately when data exists
and was never exported) stays and gains a third step:

| Age of last export | Level | What the user sees |
|---|---|---|
| < 7 days | `ok` | nothing |
| 7–13 days | `remind` | today's grey banner |
| 14–29 days | `warn` | today's amber banner |
| ≥ 30 days, or never with data | `overdue` | amber banner with a **Download backup** button that exports in place — no trip to `/backup` — plus one line: "Your only copy is on this device." |

*(The decisions file says "warn when the last export is older than 30 days"; the existing 7/14 ladder is
stricter and removing it would weaken what ships today. See §11.)*

**After a migration**, on the first screen after an update applies, a dismissible card: *"Your data was
updated to version 47. Download a backup now?"* with [Download backup] and [Not now]. Shown once per
version, recorded as `last_migration_prompt` in `settings`.

### 8.2 What an iPhone device backup does and does not cover

To be said in the app, on the Backup page, in these words (adjusted to what phase 4 measures):

- **Packaged as a real app, your data is included in your iPhone backup.** OPFS lives inside the app's
  own container, and iCloud and Finder backups take the whole container.
- **Not everything in the container is backed up.** `Library/Caches` and anything marked "do not back up"
  are excluded. Phase 4 must verify where WKWebView puts the OPFS store for this app and, if it lands
  under an excluded path, set `NSURLIsExcludedFromBackupKey` to false on it at launch. **Until that check
  has been run on a device, the app must not claim device backups cover the data.** The check: install,
  add a transaction, back up to Finder, delete the app, restore, open — the transaction is there.
- **A device backup is not a file you can hand to anyone.** It restores a whole phone, only to the same
  or a newer iOS, and you cannot pull one database out of it.
- **Deleting the app deletes the container.** The next device backup no longer contains your data. This
  is precisely the instinct the recovery screen exists to prevent.
- **Today, as a PWA, there is no device backup at all** — Safari can evict the origin's storage after
  seven unused days. The exported file is the only backup.

So: the export file is the backup; the device backup is a bonus; the snapshots are a seatbelt, not a
backup — they are on the same device and go with it.

### 8.3 Restore across devices

A backup file must open on any device, which the current restore path nearly manages already:

- It is a plain SQLite file, not device-bound, not encrypted (the Backup page says so, loudly, today).
- `isSqliteFile()` checks the magic; the worker then checks a `schema_migrations` table exists and rolls
  back to the previous bytes when it does not.
- **Added:** after importing, run `quick_check` and `futureVersions()` before adopting the file. A damaged
  file is rejected with "That backup is damaged — your data on this device is untouched" and the previous
  bytes stay. A *newer* file is rejected with the §6.2 message instead of being adopted and then refused
  at the next open. A file at an *older* version is accepted and migrated forward on the next open, with a
  snapshot first, exactly like any other upgrade.
- The safety copy before a restore is now both the existing download *and* a `before-restore` snapshot.

### 8.4 Out of scope

**Cloud sync.** It is a paid feature for using Expanses on two devices, and it is not a safety feature: a
sync that faithfully replicates a corruption or a deletion protects nobody. Nothing in this design assumes
it, and nothing here blocks it. Also out: encrypting backup files, scheduled automatic exports to a
user-chosen folder, and any server-side component.

## 9. Failure modes

| Failure | What the user sees | What is preserved |
|---|---|---|
| Worker/wasm will not start | Recovery screen, `cannot-open`: "We could not start the database engine." | Everything. Export via the raw OPFS salvage path (§3.3); snapshots still listed and restorable. |
| OPFS unavailable / VFS will not install (private window, blocked storage) | Recovery screen, `cannot-open`, with the "this browser is not storing data" explanation and no Start fresh. | Nothing was ever written; nothing to lose. |
| Another tab holds the database | Today's "Already open in another tab" screen, unchanged, plus a link to recovery mode. | Everything. |
| File corrupt, found at open | Recovery screen, `corrupt`: "Your data is still on this device. We could not read it this time." | The file (exportable byte for byte) and both snapshots. |
| File corrupt, found mid-session | The app is replaced by the recovery screen, `corrupt`. | Same. The screen the user was on is lost; nothing written since the last commit is lost. |
| Migration throws part-way | "Putting your data back…", then the app opens at the old version with the "update was undone" card. | Everything, from the pre-migration snapshot. |
| Migration succeeds, verification fails | Same as above; the card names the check that failed. | Everything, from the snapshot. |
| Rollback itself fails | Recovery screen, `verify-failed`, `rolledBack: false`. Both the half-updated file and the snapshot offered for export. | Both copies; nothing deleted. |
| Database newer than the app | Refusal screen (§6.2). No Restore, no Start fresh. | Everything, untouched, exportable. |
| Restoring a damaged backup file | "That backup is damaged — your data on this device is untouched." | The device's data, via the worker's existing rollback to the previous bytes. |
| Restoring a newer backup file | The §6.2 message, before adoption. | Both the device's data and the file. |
| No room for a snapshot | **Amended 2026-09-19:** the screen is not built. The update runs with no copy, and says so — the opener carries "no safety copy was taken first: …" into the failure text, where a user who does hit a broken update goes looking for one. The principle that a failed safety copy must never stand between a user and their own data was judged to outweigh a gate that could keep a device with no quota out of its own app; the [Download a backup] / [Update anyway] screen belongs to a later phase. | Everything, unless the update itself then fails — in which case there is nothing to go back to, and the screen says so. |
| User presses Start fresh | Two presses, and an export or an explicit tick. **Amended 2026-09-19:** no `before-start-fresh` snapshot is taken — the wipe removes `expanses-safety/` too, so the copy would not survive the press that took it (§4.2). | The backup the user downloaded or confirmed they already hold. Nothing on the device: that is what was asked for. |
| Browser evicts the origin (PWA, Safari 7-day rule) | A first-run app: "It looks like this is a new start." with a prominent Restore from file. | Nothing on-device — which is what the export reminders and the iOS wrapper exist to prevent. |

## 10. Testing

Everything below is a real test in the repository, not a manual pass.

**Node (vitest), against a real database**

- `checkLedgerHealth` on a seeded sample: clean; then with a hand-cut orphan entry, a hand-cut unbalanced
  transaction, and an entry-less posted transaction — each reported, each independently.
- **A corrupted database.** Build the sample with `seedSampleData`, `exportBytes()`, fill bytes
  `4096 × 100 .. 4096 × 160` with `0xFF`, `importBytes()` back, then assert the integrity check reports
  `corrupt` rather than throwing out of the caller. (Verified on 2026-09-18: better-sqlite3 opens such a
  buffer happily and throws `database disk image is malformed` on `quick_check` and on the first select —
  so the check must treat both the throw and a non-`ok` row as failure.)
- **A failed migration.** Migrate a seeded database to 46, then call the open orchestration with
  `[...MIGRATIONS, { version: 47, name: 'boom', sql: 'CREATE TABLE boom (x); INSERT INTO nope VALUES (1);' }]`
  and a fake snapshot store; assert `migrate` threw, the snapshot was restored, the version is 46, the row
  counts equal the pre-migration counts, and the reason is `migration-failed` with `rolledBack: true`.
- **A migration that succeeds and corrupts.** Same, with migration 47 = `DELETE FROM entries WHERE …` (an
  unbalancing delete); assert verification catches it via `checkLedgerHealth` and rolls back.
- **Interrupted and resumed.** Migrate with a migration list cut short at 44, then again with the full
  list; assert the second run applies 45 and 46 only and the figures match a straight run — the existing
  `books-sample-migration.test.ts` pattern.
- **The newer database.** Record `(999, 'from-the-future')` in `schema_migrations`; assert
  `futureVersions()` is `[999]`, that the orchestration returns `newer-database`, and that not one row
  changed in the file afterwards (compare `exportBytes()` before and after, byte for byte).
- Pure units: snapshot naming/parsing, which two to keep, whether a daily one is due, the reminder ladder
  including `overdue`, and the recovery copy for every `RecoveryKind`.

**Playwright (`chromium` and `phone`)**

- **Recovery mode**: `/?recover` shows the screen without opening the database, lists the snapshot, and
  exports a file whose first bytes are `SQLite format 3`.
- **A genuinely corrupt database, end to end**: add an account; navigate to `/?recover` (which releases
  the pool's sync access handles because recovery mode never opens the VFS); from the page, walk OPFS
  `.expanses`, find the slot whose byte 4096 begins `SQLite format 3\0`, and `createWritable({ keepExistingData: true })`
  0xFF over offsets `4096 × 101 .. 4096 × 161`; reload `/`; assert the recovery screen appears by itself;
  press **Restore the last good copy**; assert the account is back. This is the whole feature in one test.
- **Export from a broken database**: same corruption, press **Export what is there**, assert a download
  whose bytes open in better-sqlite3 (imported into the Playwright process) and contain the account.
- **Start fresh** needs two presses — the red button stays disabled until a backup has been downloaded
  there or ticked for — and leaves an empty app with nothing of the old data on the device, neither the
  database nor the kept copies (amended 2026-09-19; see §4.2).
- **The newer database**: build a file in the test process with better-sqlite3 (hoisted at the repo root;
  added to `apps/web` devDependencies) — take a real export, insert `(999, 'from-the-future')` into
  `schema_migrations`, restore it through the Backup page, and assert the refusal message, that Export
  works, and that no Start fresh button exists.
- **Progress**: with a slow migration forced by a large seeded database, assert "Updating your data…" and
  a step count are visible before the app appears. (Deterministically: the phone project's test asserts
  the progress component renders for a `migrate` that reports 7 steps, driven through the same code path.)
- **Reminders**: with `last_backup_at` set 31 days back, the banner offers **Download backup** and the
  press produces a download without leaving the page.

**Manual, once, on a device (phase 4 gate)**: the iOS device-backup check in §8.2.

## 11. Decisions taken here that the decisions file did not cover

1. **Recovery mode is a real route** (`/?recover`, `#recover`), not only an automatic screen — it is how a
   user with a half-working app reaches Export, and how the corruption test gets at OPFS.
2. **Corruption found mid-session** also opens the recovery screen; the decisions file only covers
   corruption at open.
3. **A daily snapshot**, at most one per calendar day, on top of the pre-migration ones — without it,
   "Restore the last good copy" hands back the state of the last app update.
4. **`quick_check` runs at every open**, not only after a migration (measured: 15 ms on the 1.4 MB sample;
   a size guard prunes to a post-migration-only check if a real measurement ever exceeds 400 ms).
5. **The 30-day reminder is a new fourth level**, not a replacement for today's 7/14 ladder, because
   replacing it would weaken what ships today.
6. **A rollback blocks the same update from re-running** until the user asks or a new build ships,
   instead of looping the user through the same failure at every launch.
7. **Restore-from-file now verifies before adopting** (`quick_check` + version), where today it checks only
   for a `schema_migrations` table.
8. **`checkLedgerIntegrity` is left alone and `checkLedgerHealth` added beside it**, so the orphan checks
   the decisions file asks for arrive without changing a function other tests assert on.
