# Sharing Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** A shared workspace survives a lost or restored database on either phone without anyone's help, a join never stalls on ids already on the phone, a joined copy can be deleted for good, the partner's screen says something true when the other side goes quiet, backups keep the copies that matter, and every share is nudged to two owners.

**Architecture:** Four drops, each shippable to TestFlight alone. **A**: apply learns to remap a purchase's local transaction id, adopt dead leftovers and skip-and-report rows another live copy holds (`HELD_ELSEWHERE`), with "Place them now"; Delete erases a once-shared book instead of voiding it; a share record (relay book, member, sealed epoch keys, cursor) is written outside the database next to the device keys and checked at start-up; the Share page reports a partner's silence. **B**: `engine.reconnect` rebuilds the share from the record and replays the whole log, this device's own entries included, matching own purchases to own accounts by label; restored-behind copies replay automatically. **C**: the update pauses when no copy could be taken, kill-mid-save repro, pinned copies before sharing changes and updates, Backup status on the Account page with a per-workspace coverage check. **D**: co-owner card and rename self. No relay change. No schema migration (local tables only change by rows; the web key store bumps its IndexedDB version).

**Tech Stack:** TypeScript, SQLite (sqlite-wasm in the app, better-sqlite3 in tests) via drizzle-orm `sql`, vitest, React 19 + TanStack Router/Query, Capacitor 8 (`@aparajita/capacitor-secure-storage`), Playwright with the local relay Worker.

**Spec:** `docs/superpowers/specs/2026-11-11-sharing-resilience-design.md` (binding; decisions D-A1…D-D2, calls §13). Background: `docs/superpowers/specs/2026-09-26-household-sharing-design.md` §7, §8.2–8.7; feasibility study `sharing-rejoin-study.md` (session scratchpad).

## Global Constraints

- **Build on build 110.** `fix/sync-diagnostics` (sync log, `sharingDiagnostics`, Details page, status line never empty, pruning paused, restore warning) must be merged to `main` before Wave A2 starts; rebase this branch on it then. Wave A1 tasks touch only `packages/db` and may start now.
- **No relay change.** `apps/relay/**` and `packages/db/src/sync/memory-transport.ts` are not edited.
- **No migration.** If a task finds it needs one, stop and raise it; the next free number is `0110` (latest today: `0109_shared_goals.sql`).
- **Apply determinism.** Every decision that changes shared state is the same on every device. The only local-row-dependent outcome is the `HELD_ELSEWHERE` skip, which is never sent and is cleared by `placeHeldRows`.
- **The normal sync loop is unchanged.** `replayOwn` is passed only by `reconnect`, `replayBehind` and `placeHeldRows`.
- UI copy is impersonal: never "you"/"your"/"my" in any string a screen shows or an engine/repository throws; people are named. `grep -nE "\b([Yy]ou|[Yy]our|[Mm]y)\b"` over the diff's string literals must come back empty.
- No sample numbers in placeholders or hints (counts in notices come from results, not placeholders).
- Test fixtures are invented: no real bank or account names, no real figures. Currency codes are allowed.
- Country-neutral: nothing here is Indonesia-specific.
- Privacy: nothing leaves the device unencrypted. The share record stores `book_epoch_keys.key_sealed` byte for byte, never an opened key.
- Money logic has tests with exact minor units (balances after erase, purchases after replay).
- Every new event goes into the build 110 sync log (`SyncService.note`) with a new `SyncLogOp` where needed: `'reconnect' | 'replay' | 'place' | 'erase' | 'records'`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The couple's path** — member Leave-and-delete (erase), owner re-shares the same workspace, member joins: every row arrives, `sync_skipped` empty, cursor at the log head. Test: Task A9 `rejoin-after-delete.test.ts` "leave, delete, re-share, join".
2. **A live holder never stalls and never gets edited** — the member keeps the old copy and joins the new share: join completes, old copy's rows and balances unchanged to the unit, `HELD_ELSEWHERE` skips counted; after Delete of the old copy, `placeHeldRows` brings everything. Test: Task A3 `held-elsewhere.test.ts`.
3. **Erase touches nothing outside the copy** — Personal's purchases from the same bank account, a same-named category in Personal, a joint account, a split refused. Test: Task A5 `book-erase.test.ts` "never touched".
4. **Own entries replay without doubling** — owner loses everything, reconnects: her own past purchases are back once each, on her own account when the label matches, partner's projection equal to hers. Test: Task B2 `reconnect.test.ts` "fresh database".
5. **A restored copy taken after the share** — cursor behind the record: own entries past the copy's cursor are applied, nothing applied twice. Test: Task B3 `replay-behind.test.ts`.
6. **Records follow the share's life** — written on share/join/rotation, removed on stop/leave/410/removed/delete, never another device's. Test: Task A2 `share-records.test.ts`.

## Waves

Tasks in one wave touch disjoint files and can run in parallel; a wave starts when the previous one is merged. Each drop ends with a TestFlight task.

| Wave | Tasks | Parallel? | Needs |
|---|---|---|---|
| A1 | A1 (record store, db), A3 (apply collisions), A5 (erase) | yes, all three | — |
| A2 | A2 (engine writes records + detection), A4 (rejoin lineages), A6 (place held rows), A7 (silence reads) | A2 ∥ A7; A4 then A6 (both edit `engine.ts` join/rejoin region — run A4 first) | A1, A3; build 110 merged |
| A3w | A8 (web: start-up wiring, Delete/Leave and delete, statuses, join warning) | one task | A2, A4–A7 |
| A4w | A9 (two-phone scenario + e2e), A10 (TestFlight A) | A9 then A10 | A8 |
| B1 | B1 (`replayOwn` + label match in apply) | one | Drop A on main |
| B2 | B2 (`reconnect`), B3 (`replayBehind`) | B2 then B3 (both in `engine.ts`) | B1 |
| B3w | B4 (web: auto reconnect, notices, Bring back, Needs an account), B5 (e2e), B6 (TestFlight B) | B4 then B5 then B6 | B2, B3 |
| C1 | C1 (retention pins), C2 (update gate), C3 (kill-mid-save) | all three | Drop B on main (C1 needs the `reconnect` call site for `before-share-change`) |
| C2w | C4 (Backup status + coverage), C5 (TestFlight C) | C4 then C5 | C1, C2 |
| D1 | D1 (co-owner card), D2 (rename self) | yes | Drop C on main (or A, if D is pulled forward) |
| D2w | D3 (TestFlight D) | — | D1, D2 |

## File map

| File | Tasks |
|---|---|
| `packages/db/src/sync/share-records.ts` (new) | A1, A2 |
| `packages/db/src/sync/seal.ts` | A2 |
| `packages/db/src/sync/engine.ts` | A2, A4, A6, A7 (`forgetSharing` rule), B2, B3, D2 |
| `packages/db/src/sync/apply.ts` | A3, B1 |
| `packages/db/src/sync/held.ts` (new) | A3, A6 |
| `packages/db/src/repos/book-delete.ts` | A5 |
| `packages/db/src/repos/book-erase.ts` (new) | A5 |
| `packages/db/src/repos/sharing.ts` | A7 |
| `packages/db/src/index.ts` | A1, A3, A5, A7, B2 |
| `packages/db/test/sync/household.ts` | A1 (records), B2 (`lose`) |
| `apps/web/src/sync/key-store.ts`, `share-record-store.ts` (new) | A1 |
| `apps/web/src/sync/sync-service.ts` | A8, B4, D2 |
| `apps/web/src/sync/sync-log.ts` | A8 (ops) |
| `apps/web/src/features/sharing/SharePage.tsx`, `sharing-copy.ts`, `MemberPage.tsx`, `JoinWorkspace.tsx` | A8, B4, D1, D2 |
| `apps/web/src/features/workspaces/DeleteWorkspaceSheet.tsx`, `WorkspacePage.tsx` | A8 |
| `apps/web/src/features/sharing/ReconnectNotice.tsx` (new) | B4 |
| `apps/web/src/db/snapshot-policy.ts`, `snapshots.ts` | C1 |
| `apps/web/src/features/backup/icloud/names.ts`, `runner.ts`, `service.ts` | C1 |
| `apps/web/src/db/open.ts`, `background-copy.ts` | C2 |
| `apps/web/e2e/kill-mid-save.spec.ts` (new) | C3 |
| `apps/web/src/features/backup/BackupStatusPage.tsx` (new), `backup-coverage.ts` (new), `features/account/AccountMenuPage.tsx` | C4 |

---

## Drop A — joining never stalls, Delete erases, loss is detected, silence is told

### Task A1: The share record store

Spec §6.1 (D-B1).

**Files:**
- Create: `packages/db/src/sync/share-records.ts`
- Modify: `packages/db/src/index.ts` (export the module's types and `MemoryShareRecordStore`)
- Create: `apps/web/src/sync/share-record-store.ts`
- Modify: `apps/web/src/sync/key-store.ts` (IndexedDB version 2 creates store `shares`; export `KEYS_DB_VERSION = 2`)
- Modify: `packages/db/test/sync/household.ts` (each `Device` gets `records: MemoryShareRecordStore`, passed to the engine in Task A2)
- Test: `packages/db/test/sync/share-record-store.test.ts`, `apps/web/src/sync/share-record-store.test.ts`

**Interfaces:**
- Produces (db):
```ts
export interface ShareRecord {
  v: 1;
  bookId: string;
  relayBookId: string;
  memberId: string;
  deviceId: string;
  role: 'owner' | 'member';
  bookName: string;
  bookKind: string;
  workspaceId: string;
  baseCurrency: string;
  epochKeys: { epoch: number; sealed: string }[];
  appliedSeq: number;
  updatedAt: string;
}
export interface ShareRecordStore {
  list(): Promise<ShareRecord[]>;
  get(bookId: string): Promise<ShareRecord | null>;
  put(record: ShareRecord): Promise<void>;
  remove(bookId: string): Promise<void>;
}
export class MemoryShareRecordStore implements ShareRecordStore { /* Map<string, ShareRecord>, structuredClone on put/get */ }
export function parseShareRecord(raw: unknown): ShareRecord | null; // null for anything not v1 with every field typed
```
- Produces (web): `class WebShareRecordStore implements ShareRecordStore` (IndexedDB `cicis-keys`, store `shares`, key `bookId`); `class NativeShareRecordStore implements ShareRecordStore` (keychain item `shares` under prefix `cicis-keys.`, JSON array, `afterFirstUnlockThisDeviceOnly`, sync off, using the `SecureStore` slice from `key-store.ts`); `createShareRecordStore(): ShareRecordStore` (by `isNative()`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/sync/share-record-store.test.ts
import { describe, expect, it } from 'vitest';
import { MemoryShareRecordStore, parseShareRecord, type ShareRecord } from '../../src/index';

const record = (bookId: string, over: Partial<ShareRecord> = {}): ShareRecord => ({
  v: 1, bookId, relayBookId: `relay-${bookId}`, memberId: 'member-a', deviceId: 'device-a', role: 'owner',
  bookName: 'Home', bookKind: 'family', workspaceId: 'ws-1', baseCurrency: 'IDR',
  epochKeys: [{ epoch: 1, sealed: '{"x":1}' }], appliedSeq: 0, updatedAt: '2026-11-11T00:00:00.000Z', ...over,
});

describe('MemoryShareRecordStore', () => {
  it('puts, replaces, lists and removes by book id', async () => {
    const store = new MemoryShareRecordStore();
    await store.put(record('b1'));
    await store.put(record('b2'));
    await store.put(record('b1', { appliedSeq: 7 }));
    expect((await store.list()).map((r) => [r.bookId, r.appliedSeq]).sort()).toEqual([['b1', 7], ['b2', 0]]);
    await store.remove('b1');
    expect(await store.get('b1')).toBeNull();
    expect((await store.list()).map((r) => r.bookId)).toEqual(['b2']);
  });
  it('hands out copies, never its own objects', async () => {
    const store = new MemoryShareRecordStore();
    await store.put(record('b1'));
    const got = (await store.get('b1'))!;
    got.epochKeys.push({ epoch: 2, sealed: 'tampered' });
    expect((await store.get('b1'))!.epochKeys).toHaveLength(1);
  });
});

describe('parseShareRecord', () => {
  it('reads a v1 record and refuses anything else', () => {
    expect(parseShareRecord(record('b1'))).toEqual(record('b1'));
    expect(parseShareRecord({ ...record('b1'), v: 2 })).toBeNull();
    expect(parseShareRecord({ ...record('b1'), epochKeys: [{ epoch: '1', sealed: 'x' }] })).toBeNull();
    expect(parseShareRecord('nonsense')).toBeNull();
  });
});
```

```ts
// apps/web/src/sync/share-record-store.test.ts — fake-indexeddb as key-store.test.ts does; a fake SecureStore for native
it('WebShareRecordStore keeps records in cicis-keys/shares beside the device keys', async () => {
  const idb = new IDBFactory();
  const keys = new WebKeyStore(idb);
  const device = await keys.getOrCreateDevice();
  const store = new WebShareRecordStore(idb);
  await store.put(record('b1', { deviceId: device.deviceId }));
  expect((await new WebShareRecordStore(idb).list()).map((r) => r.bookId)).toEqual(['b1']);
  expect((await new WebKeyStore(idb).getOrCreateDevice()).deviceId).toBe(device.deviceId); // the version bump keeps the keys
});
it('NativeShareRecordStore writes one keychain item, this device only, never synchronised', async () => {
  const fake = fakeSecureStore();
  const store = new NativeShareRecordStore(fake);
  await store.put(record('b1'));
  await store.put(record('b2'));
  await store.remove('b1');
  expect(fake.calls.at(-1)).toMatchObject({ key: 'shares', sync: false, access: KeychainAccess.afterFirstUnlockThisDeviceOnly });
  expect(JSON.parse(fake.items.get('shares')!).map((r: ShareRecord) => r.bookId)).toEqual(['b2']);
});
it('an unreadable keychain item reads as no records, never throws', async () => {
  const fake = fakeSecureStore({ shares: '{not json' });
  expect(await new NativeShareRecordStore(fake).list()).toEqual([]);
});
```

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/share-record-store.test.ts` and `cd apps/web && npx vitest run src/sync/share-record-store.test.ts` — expected FAIL (modules not found).
- [ ] **Step 3: Implement.** The web store opens `cicis-keys` at version 2; `onupgradeneeded` creates `device` if missing and `shares` if missing (an upgrade from 1 keeps `device`). The native store serialises writes through one promise chain (read-modify-write of the array) so two puts never lose one. Unreadable items are logged once with `console.warn` and read as `[]`.
- [ ] **Step 4: Run** both tests — expected PASS. Run `cd apps/web && npx vitest run src/sync/key-store.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/share-records.ts packages/db/src/index.ts packages/db/test/sync/share-record-store.test.ts packages/db/test/sync/household.ts apps/web/src/sync/share-record-store.ts apps/web/src/sync/share-record-store.test.ts apps/web/src/sync/key-store.ts && git commit -m "A share record per shared book, kept beside the device keys and outside the database"`

### Task A2: The engine writes records and checks them at open

Spec §6.1, §6.2 (Drop A part: detection only), §7.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (option `shareRecords`; writes in `shareBook`, `joinBook`, `maybeRotate`, `makeOwner`, `syncActive` (cursor, coalesced); removes in `dropSyncStateTx` callers, `endShared`; new `backfillShareRecords`, `checkShareRecords`)
- Modify: `packages/db/src/sync/seal.ts` (`Sealer` constructor option `onStored(bookId, epoch, sealedJson)`)
- Modify: `packages/db/src/sync/seed.ts` (`SharingErrorCode` += `'KEYS_UNREADABLE' | 'SHARE_ENDED' | 'DEVICE_REMOVED' | 'NO_RECORD' | 'HELD_ELSEWHERE'`)
- Test: `packages/db/test/sync/share-records.test.ts`

**Interfaces:**
- Consumes: `ShareRecordStore`, `ShareRecord` (Task A1).
- Produces:
```ts
export interface SyncEngineOptions { appVersion?: string; shareRecords?: ShareRecordStore; recordEveryMs?: number /* default 30_000 */ }
export type ShareRecordFinding =
  | { kind: 'ok'; bookId: string }
  | { kind: 'behind'; bookId: string; bookName: string; fromSeq: number; toSeq: number }
  | { kind: 'lost'; bookId: string; bookName: string; relayBookId: string }
  | { kind: 'missing_book'; bookId: string; bookName: string; relayBookId: string };
class SyncEngine {
  backfillShareRecords(): Promise<number>;            // active books whose keys open and that have no record; returns how many written
  checkShareRecords(): Promise<ShareRecordFinding[]>; // local only; records of another deviceId are skipped
  flushShareRecord(bookId: string): Promise<void>;    // writes the cursor now (app hide)
}
```
`ended` / `removed` findings come from the relay and are Drop B's (Task B2 probe).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/sync/share-records.test.ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { Household } from './household';

describe('share records (spec §6.1)', () => {
  it('are written on share and join, with the keys sealed exactly as the database keeps them', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    for (const d of [dewi, fandri]) {
      const rec = (await d.records.get(bookId))!;
      const [[sealed]] = await d.database.db.values<[string]>(sql`SELECT key_sealed FROM book_epoch_keys WHERE book_id = ${bookId} AND epoch = 1`);
      expect(rec).toMatchObject({ bookId, relayBookId: home.relayBookId, deviceId: d.deviceId, memberId: d.memberId });
      expect(rec.epochKeys).toEqual([{ epoch: 1, sealed }]);
    }
    expect((await dewi.records.get(bookId))!.role).toBe('owner');
    expect((await fandri.records.get(bookId))!.role).toBe('member');
  });
  it('gain the new epoch key on a rotation, on every device that stays', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const rina = await home.device('Rina');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.join(rina, dewi);
    await home.settle();
    await dewi.engine.removeDevice(bookId, rina.deviceId);
    await home.settle([dewi, fandri]);
    expect((await dewi.records.get(bookId))!.epochKeys.map((k) => k.epoch)).toEqual([1, 2]);
    expect((await fandri.records.get(bookId))!.epochKeys.map((k) => k.epoch)).toEqual([1, 2]);
  });
  it('carry the cursor once it moves, at most every 30 s, and at once on flush', async () => {
    // engine with recordEveryMs = 30_000 and a controlled clock: sync twice within 30 s → appliedSeq unchanged after the second;
    // flushShareRecord → equals the cursor.
  });
  it('are removed on stop, leave, a 410, a removal and forget', async () => {
    // one case each: stopSharing (owner) → owner's gone; partner's next sync gets 410 → partner's gone;
    // leave → gone; removeDevice(target) → target's gone after its next sync; forgetSharing on unshared → gone.
  });
  it('backfill writes one for an active book with no record, and none for a book whose keys do not open', async () => {
    // records.remove(bookId) then backfillShareRecords() === 1; a restored device (home.restore) → backfill === 0.
  });
  it('checkShareRecords finds a lost share: the book here, its shared_books row gone', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    await dewi.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: home.relayBookId }]);
  });
  it('checkShareRecords finds a missing book and a copy behind, and ignores another device's record', async () => {
    // books row deleted → missing_book; cursor set back below appliedSeq → behind {fromSeq, toSeq}; record with deviceId 'other' → absent.
  });
});
```
Fill every sketched case with real assertions in the same style before Step 2 (each `it` ends in at least one `expect` on the record store or the finding).

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/share-records.test.ts` — expected FAIL (`records` undefined on engine, `checkShareRecords` not a function).
- [ ] **Step 3: Implement.**
  - `recordOf(bookId)` builds the record from `shared_books`, `books`, `book_epoch_keys`, `sync_cursor`, `viewRoleOfDevice`. Every write goes through `writeRecord(bookId)`, which swallows and `console.warn`s a store failure: a keychain hiccup never fails a share, join or sync.
  - `Sealer` calls `onStored` after its insert (inside the caller's transaction is fine: the record is written after commit by the engine, which reads the row back; `onStored` only marks the book dirty).
  - Removal points: after `dropSyncStateTx` in `stopSharing`/`forgetSharing`, in `endShared`, and in `leaveNow`.
  - `checkShareRecords` reads only local rows: `ok` when `shared_books` is active on the record's relay book and the cursor ≥ `appliedSeq`; `behind` when the cursor is lower; `lost` when the book exists and the row is missing, `needs_invite` on the record's relay book, or on another relay book and not active; `missing_book` when no `books` row.
- [ ] **Step 4: Run** the test — expected PASS. Run `npx vitest run test/sync` — expected PASS (no existing test changes; the household now passes records).
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/src/sync/seal.ts packages/db/src/sync/seed.ts packages/db/test/sync/share-records.test.ts && git commit -m "The engine keeps each share's record up to date and checks the records at open"`

### Task A3: Apply never stalls on ids already here

Spec §4.1, §4.2 (D-A2, D-A3, D-A4, D-A5).

**Files:**
- Create: `packages/db/src/sync/held.ts`
- Modify: `packages/db/src/sync/apply.ts` (`lineageOf` scoped by book, ~443; the new-lineage insert, ~935; `applyRowOp` existing-row path, ~405; `deterministicRefusal`/`guarded` learn `HeldElsewhere`, ~960–1026)
- Modify: `packages/db/src/index.ts` (export `heldElsewhereOf`)
- Test: `packages/db/test/sync/held-elsewhere.test.ts`, `packages/db/test/sync/remap.test.ts`

**Interfaces:**
- Produces:
```ts
// held.ts
export const HELD_PREFIX = 'HELD_ELSEWHERE';
export class HeldElsewhere extends Error { constructor(readonly holderBookId: string) }  // name 'HeldElsewhere'
export function remapId(bookId: string, lineageId: string, attempt?: number): string;   // uuidv5 of `remap:${bookId}:${lineageId}` (+ `:${attempt}` when > 1)
export async function freeTransactionIdTx(tx: Db, bookId: string, lineageId: string): Promise<string>; // lineageId if free, else the first free remapId
/** The existing row's place: 'here' (in this book's scope), 'elsewhere' (in the scope of another book that exists here), 'dead' (no book here reaches it). */
export async function rowPlaceTx(tx: Db, entity: RowEntity, id: string, bookId: string): Promise<{ place: 'here' } | { place: 'elsewhere'; bookId: string } | { place: 'dead' }>;
export async function adoptRowTx(tx: Db, ctx: BookContext, entity: RowEntity, id: string): Promise<void>; // category: tag + workspace_id; others: nothing (their scope follows the parent)
export async function heldElsewhereOf(database: Database, bookId: string): Promise<{ entity: string; id: string; holderBookId: string; holderName: string | null; holderExists: boolean }[]>;
```
- `guarded` records a `HeldElsewhere` as a skip with error `HELD_ELSEWHERE: <holderBookId>` and carries on (it is not in `deterministicRefusal`; it has its own branch so the distinction stays visible).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/sync/remap.test.ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, postTransaction, voidTransaction } from '../../src/index';
import { remapId } from '../../src/sync/held';
import { categoryOf, headOf, Household, projectBook, skipsOf } from './household';

describe('a purchase whose transaction id is already here (D-A2)', () => {
  it('posts under a local id, leaves the holder alone, and both phones project the same', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const groceries = await categoryOf(dewi.database, bookId, 'Groceries');
    const id = await postTransaction(dewi.database, dewi.ws, { occurredOn: '2026-09-10', description: 'market', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: dewi.bank, amountMinor: 41_300, currency: 'IDR' }) });
    // A voided leftover under the same id on Fandri's phone, as an old-build delete left it.
    // Posted through the ledger under the given id (PostTransactionInput.id, as apply posts), then voided.
    const fandriFood = await createAccount(fandri.database, fandri.ws, { name: 'Food', kind: 'expense', currency: 'IDR' });
    await postTransaction(fandri.database, fandri.ws, { id, occurredOn: '2026-01-01', description: 'leftover', lines: expenseLines({ categoryAccountId: fandriFood.id, paymentAccountId: fandri.bank, amountMinor: 1_000, currency: 'IDR' }) });
    await voidTransaction(fandri.database, fandri.ws, id);
    await home.join(fandri, dewi);
    await home.settle();
    expect(await skipsOf(fandri.database)).toEqual([]);
    expect(await headOf(fandri.database, id)).toBe(remapId(bookId, id));
    expect((await fandri.database.db.values(sql`SELECT description, status FROM transactions WHERE id = ${id}`))).toEqual([['leftover', 'void']]);
    expect(await projectBook(fandri.database, bookId)).toEqual(await projectBook(dewi.database, bookId));
  });
  it('a remapped purchase edited on either phone and then voided converges', async () => {
    // continue the setup: Fandri replaces it (amount 52_000), settle, Dewi replaces it (description), settle,
    // Fandri voids it, settle: both projections equal, purchase 'void' on both, no skips.
  });
});
```

```ts
// packages/db/test/sync/held-elsewhere.test.ts
describe('rows another copy on the phone holds (D-A3, D-A4)', () => {
  it('a live old copy: the join completes, the old copy is untouched, the held rows are counted', async () => {
    // Setup (the couple's shape, spec §1 note): Dewi shares book A; Fandri joins A; both record; settle.
    // On Dewi's phone, B = await copyBookUnderNewIdForTest(dewi, A) — same transaction and category ids, new book id.
    // Dewi shares B (dewi.engine.shareBook(B, …)), invites Fandri to B (createInvite(B, …)); Fandri joins B.
    // Fandri's A is still active on its own relay book: a live holder of every id B sends.
    // Assertions:
    expect(result.stopped).toBeUndefined();
    expect(heldCount).toBeGreaterThan(0);
    expect(await projectBook(fandri.database, oldBook)).toEqual(oldBefore);              // old copy unchanged
    expect(await balanceOf(fandri, fandri.bank)).toBe(bankBefore);                         // to the unit
    expect((await heldElsewhereOf(fandri.database, newBook)).every((h) => h.holderBookId === oldBook && h.holderExists)).toBe(true);
  });
  it('a kept old copy (its share stopped, read-only here) holds rows the same way', async () => {
    // As above, but Dewi stops sharing A first and Fandri syncs (A unshared on his phone) before Dewi shares B:
    // the join completes, A is unchanged, every held row names A.
  });
  it('after the old copy is deleted, Place them now brings every row and leaves no skip', async () => {
    // deleteBook(fandri, oldBook) (erase, Task A5), then fandri.engine.placeHeldRows(newBook) (Task A6 — this case lives in A6's test file if A6 lands later)
  });
  it('a dead leftover category (archived, out of every workspace) is adopted into the joined book', async () => {
    // write the leftover the old deleteBook way (archived_at set, book_categories row gone), join, settle:
    expect(await categoryOf(fandri.database, bookId, 'Groceries')).toBe(leftoverId);
    expect(await skipsOf(fandri.database)).toEqual([]);
  });
  it('a lineage of another book is never edited in this book's name (D-A5)', async () => {
    // lineage row for L under oldBook; the new share sends L: skip HELD_ELSEWHERE, oldBook's head unchanged.
  });
});
```
Add the helper `copyBookUnderNewIdForTest(d: Device, from: string): Promise<string>` to `household.ts` (copies `books`, `book_categories`, `book_transactions` rows to a new book id; same transaction and category ids), used only by these tests. Fill every sketched case with concrete setup and the listed assertions before Step 2.

- [ ] **Step 2: Run** `cd packages/db && npx vitest run test/sync/remap.test.ts test/sync/held-elsewhere.test.ts` — expected FAIL (UNIQUE constraint error from `postTransactionTx`; `held` module not found).
- [ ] **Step 3: Implement.**
  - `lineageOf(tx, lineageId, bookId)`; a row under another book → `throw new HeldElsewhere(thatBook)`.
  - New lineage: `const id = await postTransactionTx(tx, ctx.ws, { ...input, id: await freeTransactionIdTx(tx, ctx.bookId, op.id) })`; the `sync_lineage` insert keeps `lineage_id = op.id`.
  - `applyRowOp`, existing row: `rowPlaceTx`; `'elsewhere'` → `throw new HeldElsewhere(...)`; `'dead'` → `adoptRowTx` then the normal update; `'here'` → as today. New row: unchanged.
  - `guarded`: `if (error instanceof HeldElsewhere)` → rollback to savepoint, insert the skip with `HELD_ELSEWHERE: <id>`, push to `run.skipped`, return.
  - `rowPlaceTx` uses each entity's `scope(bookId)` over `SELECT 1 FROM <table> t WHERE id = ? AND <scope>` for this book, then for every other `books.id` (a handful per phone; no index needed).
- [ ] **Step 4: Run** both tests — expected PASS. Run `npx vitest run test/sync` and `npm run test:capture -w @expanses/db` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/held.ts packages/db/src/sync/apply.ts packages/db/src/index.ts packages/db/test/sync/remap.test.ts packages/db/test/sync/held-elsewhere.test.ts packages/db/test/sync/household.ts && git commit -m "Apply never stalls on ids already here: purchases get a local id, dead leftovers are adopted, rows another copy holds are set aside and counted"`

### Task A4: A same-book rejoin pre-creates lineages

Spec §4.2 D-A6.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (`joinBook` rejoin branch, ~663-683: before `catchUpTx`)
- Modify: `packages/db/src/sync/seed.ts` (export `recordLineagesTx(tx: Tx, book: SharedBook): Promise<number>` — the `record: true` part of `rowsInScopeTx` for purchases only)
- Test: `packages/db/test/sync/rejoin-lineages.test.ts`

**Interfaces:**
- Produces: `recordLineagesTx(tx, book): Promise<number>` — every posted purchase filed in the book with no `sync_lineage` row gets one (paid by `book.memberId`), returns how many.

- [ ] **Step 1: Write the failing test** — Dewi shares, Fandri joins, both record, settle; Fandri leaves (unshared, remembered member); on Fandri's phone delete his `sync_lineage` rows for the book (what a pre-share copy looks like); Dewi invites Fandri back as the same member (`createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId })`); Fandri joins. Assert: `joinBook` resolves, `result.stopped` undefined, `skipsOf(fandri.database)` empty, the count of posted transactions in the book on Fandri's phone equals the count before the leave (no duplicates), `projectBook` equal on both.
- [ ] **Step 2: Run** `npx vitest run test/sync/rejoin-lineages.test.ts` — expected FAIL (UNIQUE constraint).
- [ ] **Step 3: Implement** `recordLineagesTx` (factor out of `rowsInScopeTx`, which then calls it) and call it in the rejoin branch before `catchUpTx`.
- [ ] **Step 4: Run** it and `npx vitest run test/sync/restore.test.ts test/sync/join.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/src/sync/seed.ts packages/db/test/sync/rejoin-lineages.test.ts && git commit -m "A rejoin gives every local purchase its lineage first, so the log edits it in place"`

### Task A5: Delete erases a once-shared workspace

Spec §5 (D-A8 db part, D-A9, §5.2, §5.3).

**Files:**
- Create: `packages/db/src/repos/book-erase.ts`
- Modify: `packages/db/src/repos/book-delete.ts` (`shareRefusal`: a joined copy or once-shared book is refused only while `active` and not frozen; `planTx` adds `erases: boolean`; `deleteBook` calls `eraseBookTx` when `erases`)
- Modify: `packages/db/src/index.ts` (export `wasEverShared`)
- Test: `packages/db/test/sync/book-erase.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BookDeletePlan { /* existing fields */ erases: boolean }
export async function wasEverSharedTx(tx: Db, bookId: string, kind: BookKind): Promise<boolean>; // kind 'shared', a shared_books row, a remembered member, or a sync_lineage row of the book
export async function eraseBookTx(tx: Db, ws: WorkspaceContext, bookId: string): Promise<{ transactions: number; categories: number; budgets: number }>;
```
- Refusal codes unchanged; new message for an active joined copy: `'This workspace is shared and active here. Leave and delete it, or leave it first.'` (exported `ACTIVE_JOINED_MESSAGE`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/sync/book-erase.test.ts
describe('deleting a once-shared workspace erases it (spec §5)', () => {
  it('erases every row of a joined copy after leaving', async () => {
    // Dewi shares; Fandri joins; both record (Fandri from fandri.bank 30_000 and 12_500); settle; Fandri leaves.
    const plan = await planBookDelete(fandri.database, fandri.ws, bookId);
    expect(plan).toMatchObject({ refusal: null, erases: true });
    await deleteBook(fandri.database, fandri.ws, bookId);
    for (const table of ['shared_books', 'book_members', 'book_devices', 'book_epoch_keys', 'sync_lineage', 'sync_outbox', 'sync_cursor', 'sync_field_clocks', 'sync_tombstones', 'sync_skipped', 'book_member_accounts', 'book_transactions', 'book_categories']) {
      expect(await count(fandri, table, bookId)).toBe(0);
    }
    expect(await fandri.database.db.values(sql`SELECT id FROM transactions WHERE id IN ${idsBefore}`)).toEqual([]); // erased, not void
    expect(await fandri.database.db.values(sql`SELECT value FROM settings WHERE key IN (${`sharing.member.${bookId}`}, ${`sharing.seen.${bookId}`})`)).toEqual([]);
  });
  it('never touches what other workspaces use', async () => {
    // Before the share: Fandri has a Personal book with a purchase of 20_000 from fandri.bank on a Personal category named 'Groceries',
    // and a joint account. After leave + delete of the joined copy:
    expect(await balanceOf(fandri, fandri.bank)).toBe(-20_000);                 // only Personal's purchase left on it
    expect(await categoryOf(fandri.database, personal.id, 'Groceries')).toBe(personalGroceries);
    expect(await accountExists(fandri, jointAccount)).toBe(true);
    expect(await accountExists(fandri, fandri.bank)).toBe(true);
  });
  it('refuses a purchase split between the joined copy and Personal, with nothing changed', async () => {
    await expect(deleteBook(fandri.database, fandri.ws, bookId)).rejects.toMatchObject({ code: 'SPLIT' });
    expect(await count(fandri, 'book_transactions', bookId)).toBe(before);
  });
  it('refuses an active joined copy with the Leave and delete message', async () => {
    expect((await planBookDelete(fandri.database, fandri.ws, bookId)).refusal).toBe(ACTIVE_JOINED_MESSAGE);
  });
  it('an owner's workspace that was shared before erases too; a never-shared one still voids', async () => {
    // Dewi stops sharing, deletes: transactions gone. A plain workspace deleted: transactions status 'void' (as today).
  });
  it('a category another book also tags loses only the tag', async () => {});
  it('goals that came through the share go; this member's own goal stays as a private copy', async () => {});
});
```
Fill each sketched case with concrete setup and at least the assertions named in its title.

- [ ] **Step 2: Run** `npx vitest run test/sync/book-erase.test.ts` — expected FAIL (`erases` undefined; `JOINED_MESSAGE` refusal).
- [ ] **Step 3: Implement** `eraseBookTx` in the order of spec §5.2 (children before parents; `PRAGMA foreign_keys` is on in tests, so a wrong order fails loudly). Reuse `book-delete.ts`'s budget/category-set code for the plan rows. Transactions to erase = filed set ∪ lineage set, expanded over `replaces_transaction_id` chains both ways. Placeholders: `book_member_accounts.account_id` for the book, erased after the entries.
- [ ] **Step 4: Run** it and `npx vitest run test/book-delete*.test.ts test/sync` — expected PASS. Update any existing book-delete test that asserted the `JOINED_MESSAGE` refusal for an unshared joined copy (it is now allowed); keep the one for an active copy with the new message.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/book-erase.ts packages/db/src/repos/book-delete.ts packages/db/src/index.ts packages/db/test/sync/book-erase.test.ts && git commit -m "Deleting a workspace that is or was shared erases what only it holds, so no leftover id stops a later share"`

### Task A6: Place them now

Spec §4.3.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (new `placeHeldRows`)
- Test: `packages/db/test/sync/place-held.test.ts`

**Interfaces:**
- Consumes: `heldElsewhereOf` (A3), `recordLineagesTx` (A4), `eraseBookTx` via `deleteBook` (A5).
- Produces: `placeHeldRows(bookId: string): Promise<{ placed: number; stillHeld: number; result: SyncOnceResult }>` — refuses `NOT_FOUND` for a book not active; `HELD_ELSEWHERE` (SharingError) while any holder still exists.

- [ ] **Step 1: Write the failing test** — the A3 live-holder setup; `placeHeldRows` while the old copy exists rejects `{ code: 'HELD_ELSEWHERE' }`; after `deleteBook(oldBook)`: resolves `{ stillHeld: 0 }`, `placed` equals the held count before, `skipsOf` empty, `projectBook` equal on both phones, `sync_cursor.applied_seq` equals the relay head.
- [ ] **Step 2: Run** — expected FAIL (`placeHeldRows` not a function).
- [ ] **Step 3: Implement** as spec §4.3; reuse the rejoin reset steps through a private `resetAndPull(bookId, { replayOwn })` that `joinBook`'s rejoin branch also calls (no behaviour change there; `replayOwn` is `undefined` until Task B1).
- [ ] **Step 4: Run** it and `npx vitest run test/sync` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/test/sync/place-held.test.ts && git commit -m "Place them now: rows another copy held come in once that copy is gone"`

### Task A7: Silence from the other side

Spec §8.1 (D-A10, D-A11).

**Files:**
- Modify: `packages/db/src/repos/sharing.ts` (new `memberSilence`)
- Modify: `packages/db/src/sync/engine.ts` (`forgetSharing` also allows an active book whose owners have been silent ≥ 14 days while this phone synced in the last hour; `bookSyncStatus` unchanged)
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/sync/silence.test.ts`

**Interfaces:**
- Produces:
```ts
export const SILENT_NOTE_DAYS = 7;
export const OWNERS_GONE_DAYS = 14;
export interface MemberSilence { memberId: string; name: string; role: 'owner' | 'member'; lastChangeAt: string | null; silentDays: number | null }
export async function memberSilence(database: Database, bookId: string, deviceId: string, now: number): Promise<MemberSilence[]>; // other members with a device in the view
export async function ownersGone(database: Database, bookId: string, deviceId: string, now: number): Promise<{ gone: boolean; since: string | null }>;
// gone = every owner device in the view silent >= OWNERS_GONE_DAYS and shared_books.synced_at within the last hour, and this device is not an owner
```

- [ ] **Step 1: Write the failing test** — Dewi and Fandri; Dewi records at day 0; Fandri syncs at day 6, 7, 13, 14 (clock via `SyncEngine` `now`, and `recordDevicesSeen` fed as the service does). Assertions: at day 6 `silentDays` 6; at day 7 `silentDays` 7; `ownersGone` false at day 13 and true at day 14; at day 14 with `synced_at` two hours old → false; `forgetSharing` at day 13 rejects `STILL_SHARED`, at day 14 resolves and the book has no `shared_books` row; Dewi (an owner) never gets `gone: true`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** `lastChangeAt` = max over the member's devices in `devicesSeen(database, bookId)` (`sharing.ts`), as ISO. `forgetSharing` asks `ownersGone` with `this.now()`.
- [ ] **Step 4: Run** it and `npx vitest run test/sync/sharing-reads.test.ts test/sync/recovery.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/repos/sharing.ts packages/db/src/sync/engine.ts packages/db/src/index.ts packages/db/test/sync/silence.test.ts && git commit -m "How long since each member's last change, and keeping a copy as own once its owners have gone quiet"`

### Task A8: Web: start-up check, Delete, statuses, join warning

Spec §4.2 D-A7, §4.4, §5.1, §7, §8.1.

**Files:**
- Modify: `apps/web/src/sync/sync-service.ts` (`prepare`: `backfillShareRecords` + `checkShareRecords` before the "no shared books" return; findings kept in `this.findings`; `findings(): ShareRecordFinding[]`; `leaveAndDelete(ws, bookId)`, `deleteHereOnly(ws, bookId)`, `placeHeldRows(bookId)`; engine made with `shareRecords: createShareRecordStore()`; `flushShareRecord` on visibility hidden)
- Modify: `apps/web/src/sync/sync-log.ts` (`SyncLogOp` += `'records' | 'place' | 'erase'`)
- Modify: `apps/web/src/features/sharing/SharePage.tsx`, `sharing-copy.ts` (silence line, held line, lost line, "Keep as own copy", members' "Last change")
- Modify: `apps/web/src/features/sharing/JoinWorkspace.tsx` (other-copies warning; `PreviewedInvite.otherCopies` from the engine — add to `previewInvite` in `engine.ts` in this task, it is a read)
- Modify: `apps/web/src/features/workspaces/DeleteWorkspaceSheet.tsx`, `WorkspacePage.tsx` (Delete on an unshared joined copy; Leave and delete; Delete here only)
- Modify: `apps/web/src/features/workspaces/DeveloperSettingsPage.tsx` ("Forget sharing rows" test switch, inspectable build only, for the device checklist)
- Test: `apps/web/src/features/sharing/sharing-copy.test.ts`, `apps/web/src/sync/sync-service.test.ts`, `apps/web/src/features/workspaces/delete-name.test.ts` (or a new `delete-shared.test.ts`)

**Interfaces:**
- Consumes: A2, A3 (`heldElsewhereOf`), A5, A6, A7.
- Produces (copy, `sharing-copy.ts`):
```ts
export function silenceLine(s: MemberSilence, nowMs: number): string | null; // "No changes from Dewi since 12 Oct." when silentDays >= 7, else null
export function heldLine(held: { holderName: string | null; holderExists: boolean }[]): string | null;
// holder exists: "Part of this share is held by W (old) on this phone. Delete that copy to bring it in."
// none exists:   "Part of this share is waiting. Place it now."
export const LOST_LINE = (book: string) => `${book} lost its share on this phone. Keep recording; the next update reconnects it.`;
export const KEEP_OWN_LABEL = 'Keep as own copy';
```

- [ ] **Step 1: Write the failing tests** — copy: `silenceLine` at 6 days → null, at 7 → `'No changes from Dewi since 12 Oct.'` (fixed `nowMs`, en locale as the other copy tests); `heldLine` both forms; a test that every exported string in `sharing-copy.ts` matches `/\b(you|your|my)\b/i` → false. Service: with an in-memory record store holding a record for a book whose `shared_books` row is gone, `prepare()` leaves `findings()` = `[{ kind: 'lost', … }]` and writes a `records` line to the sync log; `prepare()` with no shared books still runs the check.
- [ ] **Step 2: Run** `cd apps/web && npx vitest run src/features/sharing/sharing-copy.test.ts src/sync/sync-service.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Share page order of lines: status (build 110) → held line → silence line. Lost finding: the Share row and the workspace's header badge show `LOST_LINE`. Delete sheet: confirm text from spec §5.1 verbatim; "Leave and delete" calls `leave` then `deleteBook` (a safety copy first, as the sheet already does); a `SyncTransportError` from `leave` shows the "Delete here only?" step. Rename the existing "Keep as my own copy" to `KEEP_OWN_LABEL`.
- [ ] **Step 4: Run** the tests — expected PASS. `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `git add apps/web/src packages/db/src/sync/engine.ts && git commit -m "Share page says when a share is lost here, held by another copy or quiet on the other side; joined copies can be deleted"`

### Task A9: The couple's path, two phones and end to end

Spec §11, §12.

**Files:**
- Test: `packages/db/test/sync/rejoin-after-delete.test.ts`
- Modify: `apps/web/e2e/sharing.spec.ts` (new test "leave and delete, share again, join")

- [ ] **Step 1: Write the test (db)** — the full cleanup of spec §11 on the household: Dewi shares (share 1), Fandri joins, both record (6 purchases each, invented amounts), settle; Dewi's phone goes back to a copy taken before the share (`database.importBytes(preShareCopy)` on the same device, its share records cleared, as on a pre-A build — this is the incident). Two variants of share 2:
  - (i) Dewi shares the same book id again: Fandri's `previewInvite` refuses `STILL_SHARED` before any claim (assert; nothing on the relay changes).
  - (ii) the couple's case, a new book id with the same rows (`copyBookUnderNewIdForTest`, then her old book row removed): Fandri joins share 2 and it completes with `HELD_ELSEWHERE` skips, not a stall (`result.stopped` undefined).

  Continue from (ii): Dewi stops share 2; Fandri syncs (unshared) and deletes the share-2 copy; Fandri leave-and-deletes the share-1 copy; Dewi shares again (share 3) and invites Fandri as the same member (`sameMember: true, memberId` = his share-2 member id); Fandri joins. Assertions: `skipsOf(fandri.database)` empty; posted transactions in the book on Fandri's phone = Dewi's count; `projectBook` equal; Fandri's bank balance equals the sum of his purchases that are in Dewi's copy (to the unit, the others are gone with the old copies — that is the accepted loss).
- [ ] **Step 2: Run** `npx vitest run test/sync/rejoin-after-delete.test.ts` — expected PASS on top of A1–A8 (it is the acceptance test; if it fails, the failing step names the task to fix).
- [ ] **Step 3: Write the e2e** — two contexts, owner shares, member joins, both record, member Leave and delete (through the sheet), owner Stop sharing then shares again, member joins: both Cashflow totals equal (`expect(await total(owner)).toBe(await total(member))`).
- [ ] **Step 4: Run** `cd apps/web && npx playwright test e2e/sharing.spec.ts -g "leave and delete"` — expected PASS on both projects.
- [ ] **Step 5: Commit** `git add packages/db/test/sync/rejoin-after-delete.test.ts apps/web/e2e/sharing.spec.ts && git commit -m "The couple's clean-up, end to end: leave and delete, share again, join, everything arrives"`

### Task A10: Ship Drop A

- [ ] `npm run typecheck && npm test && npm run test:capture` — all PASS.
- [ ] `cd apps/web && npx playwright test e2e/sharing.spec.ts e2e/phone-share.spec.ts e2e/recovery.spec.ts` — PASS, or only the failures already listed as pre-existing on main (sharing 129, both projects); compare against a run on main first.
- [ ] Copy grep over the drop's diff: `git diff main -- apps/web/src | grep -E "^\+.*['\"\`].*\b([Yy]ou|[Yy]our|[Mm]y)\b"` — empty.
- [ ] TestFlight per `reference-testflight-upload` (next build number); device checklist: Leave and delete on the husband's phone; Delete of an unshared joined copy; status lines; the start-up lost line, produced with the Developer page's "Forget sharing rows" switch (A8; deletes the book's `shared_books` row and nothing else, shown only on the inspectable build).
- [ ] Hand the couple spec §11 steps 1–8.

---

## Drop B — Reconnect, with the whole log

### Task B1: Replaying own entries, and own purchases onto own accounts

Spec §6.4 (D-B5), §6.5 (D-B6).

**Files:**
- Modify: `packages/db/src/sync/apply.ts` (`pullAndApply` options; the own branch ~1429; `postingLines` own-account lookup ~705-737)
- Create: `packages/db/src/sync/own-account.ts`
- Test: `packages/db/test/sync/replay-own.test.ts`, `packages/db/test/sync/own-account.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PullOptions { seen?: SeenLog; replayOwn?: { fromSeq: number } }
export async function pullAndApply(database: Database, transport: SyncTransport, sealer: Sealer, bookId: string, now?: () => number, options?: PullOptions): Promise<PullResult & { replayedOwn: number; needsAccount: number }>;
// own-account.ts
export async function ownAccountForLabelTx(tx: Db, ctx: BookContext, label: string, currency: string): Promise<string | null>; // exactly one match or null
```
Existing callers pass `seen` positionally today; change them to `{ seen }` (engine only).

- [ ] **Step 1: Write the failing tests** — `own-account.test.ts`: labels `'Bank One'` (one match) → its id; `'Card ···· 4821'` with two cards named Card ending 4821 and 1177 → the 4821 one; `'Bank One + Wallet'` → null; archived account → null; a placeholder of the book with the same name → null; another currency → null. `replay-own.test.ts`: Dewi shares, records 3 purchases from `dewi.bank` (17_000, 23_500, 8_250), settles; her purchases' rows are deleted locally with capture paused (the loss); `pullAndApply(..., { replayOwn: { fromSeq: 0 } })` → `replayedOwn` = number of her change entries, the 3 purchases are back once each, their money side on `dewi.bank` (balance −48_750), `needsAccount` 0; the same without `replayOwn` → nothing back (today's behaviour, guarding the normal loop).
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement.** In the pull loop: `const replay = options.replayOwn && own && entry.seq > options.replayOwn.fromSeq`; when `replay`, call `applyChangeSetTx` as for a peer and then the own-only branches. In `postingLines`, when `money.paidBy === ctx.memberId`, no head, and `!money.paidFrom`: try `ownAccountForLabelTx` per currency before the placeholder; count placeholder landings of own purchases into `needsAccount`.
- [ ] **Step 4: Run** them and `npx vitest run test/sync` and `npm run test:capture -w @expanses/db` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/apply.ts packages/db/src/sync/own-account.ts packages/db/src/sync/engine.ts packages/db/test/sync/replay-own.test.ts packages/db/test/sync/own-account.test.ts && git commit -m "A pull can replay this device's own entries, and an own purchase lands on the account its label names"`

### Task B2: Reconnect

Spec §6.3, §6.2 (`ended`, `removed`), D-B3/D-B4 engine side.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (new `reconnect`)
- Modify: `packages/db/test/sync/household.ts` (`Household.lose(d: Device, backup?: Uint8Array): Promise<Device>` — same keys and records, a new database from `backup` or fresh)
- Test: `packages/db/test/sync/reconnect.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ReconnectResult { bookId: string; created: boolean; applied: number; replayedOwn: number; emitted: number; pushed: number; needsAccount: number }
reconnect(bookId: string, options?: { ws?: WorkspaceContext }): Promise<ReconnectResult>;
// throws SharingError: NO_RECORD, KEYS_UNREADABLE, CURRENCY (ws currency differs), SHARE_ENDED (410; record removed), DEVICE_REMOVED (403; record removed)
```

- [ ] **Step 1: Write the failing test**

```ts
describe('reconnect (spec §6.3)', () => {
  it('fresh database: the owner brings the whole workspace back from the log, own entries included', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await spend(dewi, bookId, 'dewi one', 17_000);
    await spend(fandri, bookId, 'fandri one', 9_400);
    await home.settle();
    const before = await projectBook(fandri.database, bookId);
    const lost = await home.lose(dewi);
    expect(await lost.engine.checkShareRecords()).toEqual([expect.objectContaining({ kind: 'missing_book', bookId })]);
    const result = await lost.engine.reconnect(bookId, { ws: lost.ws });
    expect(result).toMatchObject({ created: true, needsAccount: 0 });
    expect(await projectBook(lost.database, bookId)).toEqual(before);
    expect(await skipsOf(lost.database)).toEqual([]);
    await spend(fandri, bookId, 'after', 5_000);
    await home.settle([lost, fandri]);
    expect(await projectBook(lost.database, bookId)).toEqual(await projectBook(fandri.database, bookId));
  });
  it('a pre-share copy with rows made after it: auto-reconnect keeps them and sends them', async () => {
    // copy before share; share, join, record; lose(dewi, copy); dewi records 'while disconnected' (not shared → not captured);
    // checkShareRecords → lost; reconnect → result.emitted >= 1; settle; Fandri has 'while disconnected'; projections equal.
  });
  it('the member loses the phone and reconnects the same way', async () => {});
  it('a share the owner stopped answers SHARE_ENDED and forgets its record', async () => {
    // dewi.engine.stopSharing; lose(fandri); reconnect rejects { code: 'SHARE_ENDED' }; fandri.records.get(bookId) null.
  });
  it('a removed device answers DEVICE_REMOVED', async () => {});
  it('own purchases whose label matches no account are counted, on the placeholder', async () => {
    // lose(dewi) then rename dewi.bank on the fresh database before reconnect → needsAccount === her purchase count.
  });
});
```
Fill the sketched cases with real setup and the named assertions.

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** spec §6.3 steps 1–6, using `resetAndPull` (A6) with `replayOwn: { fromSeq: 0 }`. The probe is `transport.pull(relayBookId, record.appliedSeq)`; map `410` and `removedFromBook` as `endIfGone` does.
- [ ] **Step 4: Run** it and `npx vitest run test/sync` — expected PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/test/sync/household.ts packages/db/test/sync/reconnect.test.ts && git commit -m "Reconnect: a phone that lost its share rebuilds it from its own record and replays the whole log"`

### Task B3: A restored copy behind the log replays by itself

Spec §6.2 `behind`, §6.7.

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (new `replayBehind`)
- Test: `packages/db/test/sync/replay-behind.test.ts`

**Interfaces:** `replayBehind(bookId: string): Promise<{ replayedOwn: number; applied: number }>` — pull with `replayOwn: { fromSeq: <cursor> }`, then write the record.

- [ ] **Step 1: Write the failing test** — share, join, settle; `copy = dewi.database.exportBytes()`; Dewi records two purchases and syncs (they reach the log); `lose(dewi, copy)`; `checkShareRecords` → `[{ kind: 'behind', fromSeq: c, toSeq: s }]` with `c < s`; `replayBehind` → the two purchases present once each (count by description), `replayedOwn` ≥ 1, projections equal after settle; a second `replayBehind` applies nothing new (`replayedOwn` counts but rows unchanged; posted count unchanged).
- [ ] **Step 2: Run** — expected FAIL. **Step 3: Implement.** **Step 4: Run** it and `npx vitest run test/sync/restore.test.ts` — PASS.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/test/sync/replay-behind.test.ts && git commit -m "A copy restored behind the log takes back this device's own later entries"`

### Task B4: Web: reconnect at start-up, notices, Bring it back

Spec §6.2 table, D-B3, D-B4, §6.6, §6.7.

**Files:**
- Modify: `apps/web/src/sync/sync-service.ts` (`prepare` acts on findings: `lost` → `reconnect`, `behind` → `replayBehind`, both after `start` has the network, retried by the scheduler on failure; `missing_book` kept for the card; `reconnect(bookId, ws)` public for the button; log ops `'reconnect' | 'replay'`)
- Create: `apps/web/src/features/sharing/ReconnectNotice.tsx`
- Modify: `apps/web/src/features/sharing/SharePage.tsx`, `sharing-copy.ts` (notice, "What could not come back", Reconnect now, Bring it back card, ended/removed lines)
- Modify: the build 110 restore warning text (one sentence, spec §6.7)
- Modify: transactions filter for **Needs an account** (`TransactionsPage.tsx`, a filter on own purchases whose money side is this member's placeholder)
- Test: `apps/web/src/sync/sync-service.test.ts`, `apps/web/src/features/sharing/sharing-copy.test.ts`

**Interfaces (copy):**
```ts
export function reconnectedLine(book: string, applied: number): string;   // "Home was reconnected to its share. 214 changes came back from the log."
export function notBackLines(input: { lastSyncAt: string | null; needsAccount: number }, nowMs: number): string[];
export const ENDED_LINE = (book: string) => `The share of ${book} has ended. The copy here stays as it is.`;
export const REMOVED_LINE = (book: string) => `This phone was removed from the share of ${book}.`;
export const BRING_BACK = (book: string) => `${book} was shared from this phone. Bring it back?`;
```

- [ ] **Step 1: Write the failing tests** — service: a `lost` finding with a reachable fake transport → `reconnect` called once, finding cleared, a `reconnect` log line; unreachable → finding kept, status `'Reconnecting when online'`, retried on the next `triggerAll`. Copy: `reconnectedLine('Home', 3)`; `notBackLines` with `needsAccount: 2` contains `'2 purchases need their account.'`; the you/your/my check.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); `npm run typecheck`.
- [ ] **Step 5: Commit** `git add apps/web/src && git commit -m "At start-up a lost share reconnects by itself and says what came back and what could not"`

### Task B5: Reconnect end to end

**Files:** `apps/web/e2e/sharing.spec.ts` (test "a phone that loses its data reconnects")

- [ ] **Step 1:** two contexts share and record; on the owner page delete the OPFS database files (the recovery fixture's wipe helper, `e2e/recovery-fixture.ts`) but not IndexedDB `cicis-keys`; reload. Expect the "Bring it back?" card (fresh database) → tap → the reconnected notice; Cashflow totals equal on both pages; the member records once more and it arrives.
- [ ] **Step 2:** `npx playwright test e2e/sharing.spec.ts -g "reconnects"` — PASS on both projects.
- [ ] **Step 3: Commit** `git add apps/web/e2e/sharing.spec.ts && git commit -m "End to end: a phone that loses its data brings its shared workspace back"`

### Task B6: Ship Drop B

- [ ] Same verification as A10, plus `e2e/recovery*.spec.ts`. TestFlight; device checklist: share on the new build, Developer page "Forget sharing rows" switch (A8) → reopen → reconnected notice; restore a post-share local copy → `behind` replay.

---

## Drop C — backups and data safety

### Task C1: Pinned copies and pruning back on

Spec §9.3 (D-C3).

**Files:**
- Modify: `apps/web/src/db/snapshot-policy.ts` (reason `'before-share-change'` in `REASONS`; `pinned(list, now)`; `keepTwo`/`keepNewestRegular` spare pins; `keepOne` unchanged)
- Modify: `apps/web/src/db/snapshots.ts` (un-pause pruning from build 110)
- Modify: `apps/web/src/sync/sync-service.ts` (take a `before-share-change` copy before `share`, `join`, `leave`, `stopSharing`, `forgetSharing`, `reconnect`; failure → the action stops with "No safety copy could be taken; try again." unless the platform keeps no copies)
- Modify: `apps/web/src/features/backup/icloud/names.ts` (optional 7th part `share` | `update`; `copiesToRemove` spares the newest of each for 30 days outside `KEEP_MAX`), `runner.ts`/`service.ts` (`bigChange` after a sharing change and on the first open of a new app version)
- Test: `apps/web/src/db/snapshot-policy.test.ts`, `apps/web/src/features/backup/icloud/names.test.ts`

**Interfaces:**
```ts
export const PIN_DAYS = 30;
export const PINNED_REASONS: readonly SnapshotReason[] = ['before-share-change', 'before-delete', 'before-migration'];
export function pinned(list: SnapshotInfo[], now: Date): SnapshotInfo[]; // newest of each pinned reason within PIN_DAYS, at most 3
export type CloudReason = 'share' | 'update';
export interface CloudCopy { /* existing */ reason: CloudReason | null }
```

- [ ] **Step 1: Write the failing tests** — local: a `before-share-change` copy 29 days old survives three daily copies through `keepTwo`; at 31 days it is pruned; two `before-share-change` copies → only the newer is pinned; `keepOne` (no room) prunes a pin. iCloud: `parseName` of a 6-part name → `reason: null`; of `..._2516582_share.cicisbackup` → `'share'`; an old-pattern parser (copy the 6-part check into the test as `oldParse`) returns null for the 7-part name; `copiesToRemove` with 20 copies over 9 days plus one `share` copy 20 days old keeps it and keeps 14 others.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); run `src/db/snapshots.test.ts`, `src/features/backup/icloud/*.test.ts`.
- [ ] **Step 5: Commit** `git add apps/web/src/db apps/web/src/features/backup/icloud apps/web/src/sync/sync-service.ts && git commit -m "Copies before a sharing change, a delete or an update are pinned for 30 days; pruning is back on"`

### Task C2: Pause the update when no copy could be taken

Spec §9.1 (D-C1).

**Files:**
- Modify: `apps/web/src/db/open.ts` (`takeSnapshot` returns `{ snapshot, skipped }` as today; `openSafely` returns a new outcome `{ kind: 'update-needs-copy'; reason: string; proceed: () => Promise<OpenResult>; retry: () => Promise<OpenResult> }` when migrations are pending, the copy failed and no whole copy is newer than `lastChangeAt`)
- Modify: `apps/web/src/db/background-copy.ts` (write `cicis.lastChangeAt` when the change count moved)
- Modify: the open screen that renders `OpenResult` (`apps/web/src/db/bootstrap.ts` and its screen) for the pause screen, copy from spec §9.1
- Test: `apps/web/src/db/open.test.ts`, `apps/web/src/db/background-copy.test.ts`

- [ ] **Step 1: Write the failing tests** — `openSafely` with a snapshot store whose `write` throws `StorageFullError`, a pending migration, `lastChangeAt` newer than every copy → `kind: 'update-needs-copy'`, no migration run (`user_version` unchanged); `proceed()` → migrates; `retry()` with a store that now works → migrates with a `before-migration` copy; a whole copy newer than `lastChangeAt` → migrates without pausing; `lastChangeAt` missing → pauses. Background copier: count moved → `localStorage['cicis.lastChangeAt']` set to the clock; unchanged → not written.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); `npx vitest run src/db`.
- [ ] **Step 5: Commit** `git add apps/web/src/db && git commit -m "An update waits when no safety copy could be taken first, with a way to go ahead"`

### Task C3: Kill-mid-save repro

Spec §9.2 (D-C2).

**Files:** Create `apps/web/e2e/kill-mid-save.spec.ts`.

- [ ] **Step 1:** 20 rounds: open the app, start a burst of 30 quick-entry saves without awaiting, close the context after a random 0–1500 ms (seeded RNG, seed printed), reopen in a new context with the same storage state (persistent context directory). Assert per round: no recovery screen; the Developer page's `quick_check` reads `ok`; every save whose toast appeared before the kill is in the list; the safety-copy list has no entry under `MIN_COPY_BYTES`.
- [ ] **Step 2:** `npx playwright test e2e/kill-mid-save.spec.ts --project=phone` — expected PASS. A failure: stop, open a fix task with the seed as its repro, do not weaken the test.
- [ ] **Step 3: Commit** `git add apps/web/e2e/kill-mid-save.spec.ts && git commit -m "Kill-mid-save: twenty interrupted bursts of saves, every finished save still there"`

### Task C4: Backup status on the Account page

Spec §9.4 (D-C4), §9.5 (D-C5).

**Files:**
- Create: `apps/web/src/features/backup/backup-coverage.ts`, `BackupStatusPage.tsx`
- Modify: `apps/web/src/features/account/AccountMenuPage.tsx` (row "Backups" with the one-line summary), router entry
- Modify: `apps/web/src/db/snapshots.ts` and `features/backup/icloud/runner.ts` (per-book posted counts read from the bytes just written, kept with the copy: manifest entry / localStorage map by file name)
- Test: `apps/web/src/features/backup/backup-coverage.test.ts`

**Interfaces:**
```ts
export interface CopySummary { where: 'phone' | 'icloud'; takenAt: string; bytes: number; whole: boolean; pinnedFor?: string }
export interface Coverage { newest: CopySummary | null; notCovered: { bookId: string; name: string; shared: boolean; lastChangeAt: string }[]; warn: boolean }
export function coverageOf(input: { copies: CopySummary[]; books: { bookId: string; name: string; shared: boolean; lastChangeAt: string | null; posted: number }[]; countsInNewest: Record<string, number> | null; createdAfterNewest: Record<string, number>; iCloudOn: boolean; now: Date }): Coverage;
export function summaryLine(c: Coverage, now: Date): string; // "Last copy 10 Nov, 21:40, in iCloud"; "No copy yet" when none
```

- [ ] **Step 1: Write the failing tests** — a book changed after the newest copy is in `notCovered`; one changed before is not; a copy whose per-book count is below live minus created-after → `whole: false` and is not `newest`; `warn` true when the newest is 4 days old with changes since, false at 2 days; the you/your/my check on `summaryLine` outputs.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); `npm run typecheck`.
- [ ] **Step 5: Commit** `git add apps/web/src && git commit -m "Backup status on the Account page: the last good copy, where it is, and any workspace changed since"`

### Task C5: Ship Drop C

- [ ] Full verification as A10 plus `e2e/kill-mid-save.spec.ts`. TestFlight; device checklist: Account → Backups reads right with iCloud on and off; fill the phone to trigger the update pause (or the Developer page's "Fail the next copy" switch); swipe away during a save, reopen.

---

## Drop D — co-owner and rename

### Task D1: Make the partner an owner too

Spec §10.1 (D-D1).

**Files:**
- Modify: `apps/web/src/features/sharing/SharePage.tsx`, `sharing-copy.ts`, `MemberPage.tsx`
- Modify: `packages/db/src/repos/sharing.ts` (`coOwnerSuggestion(database, bookId, deviceId): Promise<{ memberId: string; name: string } | null>` — this device an owner, the only owner member, another member with a device in the view, not dismissed within 30 days (settings `sharing.coowner.dismissed.<bookId>.<memberId>`))
- Test: `packages/db/test/sync/co-owner.test.ts`, `apps/web/src/features/sharing/sharing-copy.test.ts`

- [ ] **Step 1: Write the failing tests** — after Fandri joins, Dewi's `coOwnerSuggestion` → `{ memberId: fandri.memberId, name: 'Fandri' }`; Fandri's → null (not an owner); after `makeOwner` → null on both; dismissed at day 0 → null at day 29, back at day 30. Copy: `CO_OWNER_TITLE('Fandri') === 'Make Fandri an owner too?'`, body from spec §10.1, you/your/my check.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `git add packages/db/src/repos/sharing.ts packages/db/test/sync/co-owner.test.ts apps/web/src/features/sharing && git commit -m "After someone joins, the sole owner is asked to make them an owner too"`

### Task D2: Rename self

Spec §10.2 (D-D2).

**Files:**
- Modify: `packages/db/src/sync/engine.ts` (`renameSelf`)
- Modify: `packages/db/src/sync/seed.ts` (`SharingErrorCode` += `'NAME_REQUIRED'`)
- Modify: `apps/web/src/sync/sync-service.ts` (`renameSelf(bookId, name)` → engine, then `rememberName(name)`), `apps/web/src/features/sharing/SharePage.tsx` (own row opens the Name sheet; no placeholder sample)
- Test: `packages/db/test/sync/rename-self.test.ts`

**Interfaces:** `renameSelf(bookId: string, name: string): Promise<void>` — trims; empty → `SharingError('NAME_REQUIRED', 'A name is needed')`; longer than 40 → cut at 40; writes `UPDATE book_members SET name` inside `withCapture({ entity: 'member', id: selfMember, bookId })`; `syncSoon`.

- [ ] **Step 1: Write the failing test**

```ts
describe('renameSelf (spec §10.2)', () => {
  it('reaches every phone as a name-only member edit', async () => {
    // share, join, settle; fandri.engine.renameSelf(bookId, '  Fandi  '); settle
    expect(await nameOn(dewi, fandri.memberId)).toBe('Fandi');
    const op = (await outboxOpsAfterRename).find((o) => o.entity === 'member')!;
    expect(op.op === 'upsert' && (op.changed ?? Object.keys(op.fields))).toEqual(['name']);
    expect(makesMember(op)).toBe(false);
  });
  it('refuses an empty name', async () => {
    await expect(fandri.engine.renameSelf(bookId, '   ')).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
  });
  it('a rename crossing an owner's removal of the member stays dead on both phones', async () => {
    // fandri renames offline (no sync); dewi removes fandri's device and deletes his member row; dewi syncs; fandri syncs:
    expect(await memberRow(dewi, fandri.memberId)).toBeUndefined();
    expect(await skipsOf(dewi.database)).toEqual([]);
  });
});
```

- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); `npx vitest run test/sync/authority.test.ts`.
- [ ] **Step 5: Commit** `git add packages/db/src/sync/engine.ts packages/db/src/sync/seed.ts packages/db/test/sync/rename-self.test.ts apps/web/src && git commit -m "A member can change their own name in a shared workspace"`

### Task D3: Ship Drop D

- [ ] Full verification as A10. TestFlight; device checklist: co-owner card after a join, Not now hides it, rename arrives on the partner.

## Self-review

- Spec coverage: §4 → A3, A4, A6, A8; §5 → A5, A8; §6 → A1, A2 (record), B1–B4; §6.7 → B4; §7 → A2, A8; §8 → A7, A8; §9 → C1–C4; §10 → D1, D2; §11 → A9, A10; §12 → every task's tests; §13 calls → reflected in Interfaces.
- No relay file, no migration in any task's Files.
- `replayOwn` appears only in B1 (definition), A6/B2/B3 (callers).
