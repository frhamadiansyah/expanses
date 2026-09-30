# Joint Net Worth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members of a shared workspace can opt in to a net-worth group, agree a filing mode (joint / separate), and see each other's shared items as summaries sent from the owner's phone; they can pay with and transfer to each other's shared items.

**Architecture:** The group gets its own encrypted **group log**: a second relay book driven by the existing `SyncEngine`, admitted without an invite code because every member's devices are already pinned in the workspace. Five new row entities travel in it (proposals, answers, item summaries, pending counts, transfers), each with a single allowed writer checked on apply. Pure logic (group state derivation, summary maths) lives in `@expanses/core`; the ledger side (`paidFrom`, transfer postings) extends the existing apply path.

**Tech Stack:** TypeScript, SQLite via drizzle (`packages/db`), vitest + fast-check, React (`apps/web`, native UI kit), Playwright, Cloudflare Worker relay (`apps/relay`, unchanged).

**Spec:** `docs/superpowers/specs/2026-09-29-joint-net-worth-design.md` (binding; §n below). It builds on `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (**S**§n). Code map with exact paths and line numbers: see "Code map" at the end of this plan.

## Global Constraints

- The spec is the authority. Where the code disagrees, the code's reality wins and the spec is corrected in the same commit, with a line saying what changed and why.
- The existing suite stays green: `npm test` and `npm run typecheck` at the repo root (db runs twice: plain and `vitest.capture.config.ts`).
- Money, ledger, merge and group-state logic are test-first (TDD). Property tests use `fast-check` (already a devDependency).
- Private lines never leave the owner's phone: no op in any outbox may carry a non-Household transaction's amount, description or id, or any local `accountId` (§4, §10).
- Group-log entities are readable only by group members' devices: nothing of §5.1 is ever written to the workspace log (§4).
- WebCrypto only, no new runtime crypto library. No relay change (the relay is unchanged; the group log is an ordinary relay book).
- Country-neutral: only the tax report is Indonesia-specific. UI is the native kit only; desktop capabilities never weakened for the phone.
- New migration is `packages/db/migrations/0057_joint_net_worth.sql`, registered in `packages/db/src/migrations.ts` as `{ version: 57, name: 'joint_net_worth', sql: jointNetWorth }`.
- Minimum app version for group setup: the constant `NET_WORTH_MIN_APP_VERSION = '0.3.0'` in `packages/db/src/sync/net-worth/version.ts`; the web app reports its version from `apps/web/package.json`, which this work bumps to `0.3.0`.
- Commit messages follow the repo style (a plain sentence subject saying what the user or code now does), ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Implementers never dispatch subagents.

## Review Focus

1. **Both partners propose at the same moment, offline.** Expect one deterministic active proposal on both phones (latest creation HLC wins once fully confirmed), never two groups and never a flip-flop. Test: Task 2 `concurrent proposals` property.
2. **A card whose owner paid it off this cycle** (a payment from her BCA, not Household). Expect `otherUseMinor` negative, the invariant still exact, and the partner's page reading "Rina's other use" as a credit (−), with the limit bar never below zero width. Tests: Task 3 `payment in cycle`, Task 9 `negative other use renders`.
3. **The owner archives or deletes a shared account.** Expect `nw_item.removed = true` sent and the item gone on the partner's phone, including from the joint total. Test: Task 6 `archived item is removed`.
4. **A USD item in a joint IDR household with no USD rate.** Expect the joint total blank (as Net worth is today) and the item still listed with its own-currency balance. Test: Task 9 `missing rate`.
5. **He pays with her card; she switches the card to Don't share before her phone syncs.** Expect the purchase still lands on her real card (already recorded stays) and the card leaves his Paid-with list. Test: Task 7 `unshared after paying`.

---

## Parallel lanes

- **Wave 1 (parallel):** Task 1 (db foundations), Task 2 (core: group state), Task 3 (core: summary maths). Tasks 2 and 3 are pure `packages/core` code and touch no db file.
- **Wave 2:** Task 4 (group log lifecycle). Needs Task 1.
- **Wave 3 (parallel):** Task 5 (proposals API + setup screens; needs 2, 4) and Task 6 (summaries compute/send/receive; needs 1, 3, 4).
- **Wave 4 (parallel lanes):** Lane X: Task 7 then Task 8 (both touch `FormPage.tsx` / `tx-form.ts`, so serial). Lane Y: Task 9. Lane Z: Task 10. All need Task 6; Task 10 also needs Task 5.
- **Wave 5:** Task 11 (e2e and final pass).

Each parallel task runs in its own worktree off the integration branch `feat/joint-net-worth`; the controller merges each back before the next wave.

---

### Task 1: Foundations — migration, entities, single-writer check, device app version

**Files:**
- Create: `packages/db/migrations/0057_joint_net_worth.sql`
- Modify: `packages/db/src/migrations.ts` (import + `{ version: 57, name: 'joint_net_worth', sql: jointNetWorth }`)
- Modify: `packages/db/src/sync/shared-entities.ts` (five new `RowEntity` entries; optional `writer` on `RowEntity`; `appVersion` on `device`)
- Modify: `packages/db/src/sync/apply.ts` (`applyRowOp`, around line 296: the writer check)
- Create: `packages/db/src/sync/net-worth/version.ts`
- Modify: `packages/db/src/sync/engine.ts` (`SyncEngine` constructor takes `appVersion?: string`; the own `device` row carries it)
- Modify: `apps/web/src/sync/sync-service.ts` (pass `appVersion` from `apps/web/package.json`), `apps/web/package.json` (version `0.3.0`)
- Test: `packages/db/test/sync/net-worth-entities.test.ts`, extend `packages/db/test/sync/shared-entities.test.ts`

**Interfaces:**
- Produces tables (all side tables, no column added to an existing table except `book_devices.app_version`):
  ```sql
  CREATE TABLE group_logs (book_id TEXT PRIMARY KEY, group_book_id TEXT NOT NULL UNIQUE);
  CREATE TABLE nw_proposals (book_id TEXT NOT NULL, proposal_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('joint','separate')),
    members_json TEXT NOT NULL, proposed_by TEXT NOT NULL, created_hlc TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, proposal_id));
  CREATE TABLE nw_answers (book_id TEXT NOT NULL, proposal_id TEXT NOT NULL, member_id TEXT NOT NULL,
    answer TEXT NOT NULL CHECK (answer IN ('confirm','decline','left')), PRIMARY KEY (book_id, proposal_id, member_id));
  CREATE TABLE nw_items (book_id TEXT NOT NULL, item_id TEXT NOT NULL, owner TEXT NOT NULL, summary_json TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (book_id, item_id));
  CREATE TABLE nw_pending (book_id TEXT NOT NULL, member_id TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (book_id, member_id));
  CREATE TABLE member_transfers (book_id TEXT NOT NULL, transfer_id TEXT NOT NULL, occurred_on TEXT NOT NULL,
    amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, from_json TEXT NOT NULL, to_json TEXT NOT NULL,
    description TEXT, void INTEGER NOT NULL DEFAULT 0, recorded_by TEXT NOT NULL, PRIMARY KEY (book_id, transfer_id));
  CREATE TABLE member_transfer_postings (book_id TEXT NOT NULL, transfer_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
    PRIMARY KEY (book_id, transfer_id));
  CREATE TABLE nw_share_settings (account_id TEXT PRIMARY KEY, setting TEXT NOT NULL CHECK (setting IN ('total','hidden')));
  CREATE TABLE nw_item_map (account_id TEXT PRIMARY KEY, group_book_id TEXT NOT NULL, item_id TEXT NOT NULL UNIQUE);
  CREATE TABLE nw_sent (item_id TEXT PRIMARY KEY, summary_hash TEXT NOT NULL);
  ALTER TABLE book_devices ADD COLUMN app_version TEXT;
  ```
  `book_id` in the five synced tables is the **group log's** local book id. `nw_share_settings`, `nw_item_map`, `nw_sent`, `member_transfer_postings` never sync (add them to nothing; `nw_item_map`/`nw_sent`/`member_transfer_postings` are local bookkeeping).
- Produces on `RowEntity`: `writer?: (fields: Record<string, unknown>, key: Record<string, string>) => string | 'either-party' | null` — the member allowed to write this row, read from the op's *merged* fields/key. Entities:
  | entity | table | keyColumns | fields | writer |
  |---|---|---|---|---|
  | `nw_proposal` | `nw_proposals` | `['proposal_id']` | `mode, members (members_json), proposedBy (proposed_by), createdHlc (created_hlc), cancelled` | `fields.proposedBy` |
  | `nw_answer` | `nw_answers` | `['proposal_id','member_id']` | `answer` | `key.member_id` |
  | `nw_item` | `nw_items` | `['item_id']` | `owner, summary (summary_json), removed` | `fields.owner` |
  | `nw_pending` | `nw_pending` | `['member_id']` | `count` | `key.member_id` |
  | `member_transfer` | `member_transfers` | `['transfer_id']` | `occurredOn, amountMinor, currency, from (from_json), to (to_json), description, void, recordedBy (recorded_by)` | `'either-party'` = `from.owner` or `to.owner` |
  All five: `scope: (bookId) => sql\`t.book_id = ${bookId}\``, `localOnInsert: ['book_id']`.
- Produces: `export const NET_WORTH_MIN_APP_VERSION = '0.3.0'` and `export function meetsMinVersion(v: string | null): boolean` (semver compare, `null` → false) in `packages/db/src/sync/net-worth/version.ts`.
- Writer check: in `applyRowOp`, when `entity.writer` is set, compute the allowed writer from the op merged over the stored row; if the change-set's author member (`changeSet.member`, already verified by signature and the authority view) is not it (for `'either-party'`: not `from.owner` and not `to.owner`), throw `AuthorityError('writer')` so the existing machinery records `sync_skipped` with `AUTHORITY:` and the op wins no field. For `nw_proposal`, `cancelled` may only be set by `proposedBy` (same rule).

- [ ] **Step 1:** Write `net-worth-entities.test.ts` (failing): for each of the five entities, (a) a change-set from the rightful writer applies (row present with fields), (b) the same op from another member is refused: row absent/unchanged and one `sync_skipped` row whose `error` starts with `AUTHORITY:`; (c) `member_transfer` accepted from `to.owner` as well as `from.owner`, refused from a third member. Use `shareBookForTest` from `test/sync/sync-helpers.ts` to make a book and `applyChangeSet(database, bookId, changeSet)`. Also: `meetsMinVersion('0.3.0') === true`, `('0.2.9') === false`, `(null) === false`, `('0.10.0') === true`.
- [ ] **Step 2:** Run `cd packages/db && npx vitest run test/sync/net-worth-entities.test.ts` — expect FAIL (no tables / entities).
- [ ] **Step 3:** Write the migration and register it; add the entities, the `writer` field and check, `appVersion: 'app_version'` in the `device` entity's fields; add `version.ts`.
- [ ] **Step 4:** Extend `shared-entities.test.ts`'s every-column-exists check to cover the new entities (it iterates `SHARED_ENTITIES`, so it may already); run both tests — PASS.
- [ ] **Step 5:** `SyncEngine` constructor gains an optional options param `{ appVersion?: string }`; wherever the engine writes its own `book_devices` row (`shareBook`, `joinBook`, link) it sets `app_version`. A test in `net-worth-entities.test.ts`: a `Household` (from `test/sync/household.ts`) of two devices built with `appVersion: '0.3.0'` → each device sees the other's `app_version = '0.3.0'` after `settle()`. Extend `Household.device()` with an optional `appVersion` argument (default `'0.3.0'`).
- [ ] **Step 6:** Web: `sync-service.ts` passes `appVersion: pkg.version` (import `apps/web/package.json` via Vite's JSON import); bump `apps/web/package.json` version to `0.3.0`.
- [ ] **Step 7:** Run `npm test` and `npm run typecheck` at the root — PASS. Commit: "Shared workspaces can carry net-worth entities, each written only by the member it belongs to, and every device says which app version it runs".

---

### Task 2: Group state — derived, never stored (pure, `@expanses/core`)

**Files:**
- Create: `packages/core/src/net-worth/group.ts`, export from `packages/core/src/index.ts`
- Test: `packages/core/src/net-worth/group.test.ts`, `packages/core/src/net-worth/group.property.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FilingMode = 'joint' | 'separate';
  export interface Proposal { proposalId: string; mode: FilingMode; members: string[]; proposedBy: string; createdHlc: string; cancelled: boolean }
  export interface Answer { proposalId: string; memberId: string; answer: 'confirm' | 'decline' | 'left' }
  export interface GroupState {
    active: { proposalId: string; mode: FilingMode; members: string[] } | null;   // members = listed minus left
    pending: Proposal | null;   // the newest non-cancelled proposal newer than active and not declined by anyone
    waitingFor: string[];       // members of `pending` who have not answered
  }
  export function deriveGroup(proposals: readonly Proposal[], answers: readonly Answer[]): GroupState;
  export function canPropose(mode: FilingMode, members: readonly string[]): boolean; // joint ⇒ exactly 2; always ≥ 2 distinct
  ```
  HLC strings compare lexicographically (S6.1 encoding), so "latest" = max `createdHlc` string.

Rules (spec §6): a proposal is **activated** when not cancelled, `canPropose(mode, members)`, and every listed member has an answer of `confirm` or `left` recorded (the proposer's own `confirm` included). The **active** proposal is the activated one with the greatest `createdHlc`. Once activated it stays active until a newer one activates; a later `decline` does not undo it. Group members = its `members` minus those whose answer is `left`; fewer than 2 ⇒ `active = null`. `pending` = the newest proposal with `createdHlc` greater than the active one's (or any, if none active), not cancelled, not activated, and with no `decline`.

- [ ] **Step 1: Write the failing tests** (`group.test.ts`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { deriveGroup, canPropose, type Proposal, type Answer } from './group';

  const p = (id: string, hlc: string, mode: 'joint' | 'separate', members: string[], by = members[0], cancelled = false): Proposal =>
    ({ proposalId: id, mode, members, proposedBy: by, createdHlc: hlc, cancelled });
  const a = (proposalId: string, memberId: string, answer: Answer['answer']): Answer => ({ proposalId, memberId, answer });

  describe('deriveGroup', () => {
    it('is empty with nothing', () => expect(deriveGroup([], [])).toEqual({ active: null, pending: null, waitingFor: [] }));
    it('waits for the other member', () => {
      const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm')]);
      expect(s.active).toBeNull();
      expect(s.pending?.proposalId).toBe('p1');
      expect(s.waitingFor).toEqual(['andi']);
    });
    it('activates when everyone confirms', () => {
      const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm')]);
      expect(s.active).toEqual({ proposalId: 'p1', mode: 'joint', members: ['rina', 'andi'] });
      expect(s.pending).toBeNull();
    });
    it('a decline stops a pending proposal', () => {
      const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'decline')]);
      expect(s).toEqual({ active: null, pending: null, waitingFor: [] });
    });
    it('a cancelled proposal never activates', () => {
      const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'], 'rina', true)], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm')]);
      expect(s.active).toBeNull();
    });
    it('the old mode holds while a change waits', () => {
      const s = deriveGroup(
        [p('p1', '001', 'separate', ['rina', 'andi']), p('p2', '002', 'joint', ['rina', 'andi'], 'andi')],
        [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p2', 'andi', 'confirm')],
      );
      expect(s.active?.mode).toBe('separate');
      expect(s.pending?.proposalId).toBe('p2');
      expect(s.waitingFor).toEqual(['rina']);
    });
    it('a member who leaves after activation keeps the group for the rest', () => {
      const s = deriveGroup([p('p1', '001', 'separate', ['rina', 'andi', 'sari'])],
        [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'confirm')]);
      expect(s.active?.members).toEqual(['rina', 'andi', 'sari']);
    });
    it('leaving removes the member; fewer than two ends the group', () => {
      const three = deriveGroup([p('p1', '001', 'separate', ['rina', 'andi', 'sari'])],
        [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'left')]);
      expect(three.active?.members).toEqual(['rina', 'andi']);
      const two = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi'])], [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'left')]);
      expect(two.active).toBeNull();
    });
    it('joint with three members never activates', () => {
      const s = deriveGroup([p('p1', '001', 'joint', ['rina', 'andi', 'sari'])],
        [a('p1', 'rina', 'confirm'), a('p1', 'andi', 'confirm'), a('p1', 'sari', 'confirm')]);
      expect(s.active).toBeNull();
    });
  });

  describe('canPropose', () => {
    it('joint needs exactly two', () => {
      expect(canPropose('joint', ['a', 'b'])).toBe(true);
      expect(canPropose('joint', ['a', 'b', 'c'])).toBe(false);
      expect(canPropose('separate', ['a', 'b', 'c'])).toBe(true);
      expect(canPropose('separate', ['a'])).toBe(false);
      expect(canPropose('separate', ['a', 'a'])).toBe(false);
    });
  });
  ```
  Note: answers are one row per `(proposal, member)`, last writer wins, so `deriveGroup` sees only the final answer. "Once active, stays active" is kept by the API (Task 5): `answerNetWorth` refuses `decline` on an activated proposal, and `left` is the only answer allowed after activation (a `left` counts as having answered, so the proposal stays activated and the member drops out).
- [ ] **Step 2:** Run `cd packages/core && npx vitest run src/net-worth/group.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement `group.ts` per the rules above (sort by `createdHlc`; members order preserved from the proposal).
- [ ] **Step 4:** Property test `group.property.test.ts` (`fc.assert`, 300 runs, fixed seed): for random lists of proposals and answers, (a) `deriveGroup` is independent of input order (shuffle both arrays ⇒ equal result) — this is the convergence guarantee; (b) `active`, if any, has ≥ 2 members and `joint ⇒ exactly 2`; (c) `waitingFor ⊆ pending.members`. Also the **concurrent proposals** Review Focus case: two proposals by different members with different HLCs, both fully confirmed ⇒ the greater HLC is active, on every permutation.
- [ ] **Step 5:** Run the core tests — PASS. Commit: "The net-worth group and its filing mode are derived the same way on every phone from proposals and answers".

---

### Task 3: Summary maths (pure, `@expanses/core`)

**Files:**
- Create: `packages/core/src/net-worth/summary.ts`, export from `packages/core/src/index.ts`
- Test: `packages/core/src/net-worth/summary.test.ts`, `packages/core/src/net-worth/summary.property.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ItemSummary {            // spec §5.2, exactly
    owner: string; kind: 'asset' | 'liability'; subtype: string; name: string; currency: string;
    balanceMinor: number; asOf: string;
    card: { limitMinor: number; cycleStart: string; cycleEnd: string } | null;
    period: { start: string; end: string };
    openingMinor: number; householdMinor: number; otherUseMinor: number;
    monthEnds: { month: string; balanceMinor: number }[];
    tax: unknown | null;                     // the CoretaxInputs row for this item; typed by Task 10
  }
  export interface PeriodMovement { transactionId: string; amountMinor: number; household: boolean }
  /** Splits a period's movements on one item; amounts signed in the item's balance sense (owed for a liability). */
  export function splitPeriod(openingMinor: number, movements: readonly PeriodMovement[]): { householdMinor: number; otherUseMinor: number; closingMinor: number };
  export function cardBar(limitMinor: number, s: Pick<ItemSummary, 'openingMinor' | 'householdMinor' | 'otherUseMinor' | 'balanceMinor'>):
    { householdPct: number; otherPct: number; availableMinor: number };
  export function summaryHash(s: ItemSummary): string;   // stable JSON (sorted keys) → string, used to skip unchanged sends
  export function lastMonthEnds(today: string, count: number): string[]; // ['2026-08', ...] oldest first, excludes current month
  ```
- `cardBar`: `availableMinor = limitMinor − balanceMinor` (may be negative when over limit); percentages of `limitMinor`, each clamped to `[0, 100]`, household first; a negative `otherUseMinor` contributes 0 width (Review Focus 2); `limitMinor <= 0` ⇒ both 0.

- [ ] **Step 1: Write failing tests** (`summary.test.ts`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { splitPeriod, cardBar, summaryHash, lastMonthEnds } from './summary';

  describe('splitPeriod', () => {
    it('adds household and other use to the opening', () => {
      const r = splitPeriod(0, [
        { transactionId: 't1', amountMinor: 50_000_000, household: true },
        { transactionId: 't2', amountMinor: 100_000_000, household: false },
      ]);
      expect(r).toEqual({ householdMinor: 50_000_000, otherUseMinor: 100_000_000, closingMinor: 150_000_000 });
    });
    it('payment in cycle: a payment from her own bank is negative other use', () => {
      const r = splitPeriod(200_000_000, [
        { transactionId: 't1', amountMinor: 50_000_000, household: true },
        { transactionId: 'pay', amountMinor: -200_000_000, household: false },
      ]);
      expect(r).toEqual({ householdMinor: 50_000_000, otherUseMinor: -200_000_000, closingMinor: 50_000_000 });
    });
  });

  describe('cardBar', () => {
    it('limit 5 jt, household 500 rb, other 1 jt ⇒ 3,5 jt available', () => {
      const bar = cardBar(500_000_000, { openingMinor: 0, householdMinor: 50_000_000, otherUseMinor: 100_000_000, balanceMinor: 150_000_000 });
      expect(bar).toEqual({ householdPct: 10, otherPct: 20, availableMinor: 350_000_000 });
    });
    it('negative other use takes no width', () => {
      const bar = cardBar(500_000_000, { openingMinor: 200_000_000, householdMinor: 50_000_000, otherUseMinor: -200_000_000, balanceMinor: 50_000_000 });
      expect(bar.otherPct).toBe(0);
      expect(bar.availableMinor).toBe(450_000_000);
    });
    it('no limit ⇒ no bar', () => expect(cardBar(0, { openingMinor: 0, householdMinor: 1, otherUseMinor: 1, balanceMinor: 2 })).toEqual({ householdPct: 0, otherPct: 0, availableMinor: -2 }));
  });

  describe('summaryHash', () => {
    it('ignores key order', () => {
      const a = { owner: 'r', kind: 'asset', subtype: 'bank', name: 'BCA', currency: 'IDR', balanceMinor: 1, asOf: '2026-09-29', card: null,
        period: { start: '2026-09-01', end: '2026-09-30' }, openingMinor: 0, householdMinor: 0, otherUseMinor: 1, monthEnds: [], tax: null } as const;
      const b = Object.fromEntries(Object.entries(a).reverse());
      expect(summaryHash(a as never)).toBe(summaryHash(b as never));
    });
  });

  describe('lastMonthEnds', () => {
    it('24 months before September 2026', () => {
      const m = lastMonthEnds('2026-09-29', 24);
      expect(m).toHaveLength(24);
      expect(m[0]).toBe('2024-09');
      expect(m[23]).toBe('2026-08');
    });
  });
  ```
  (Amounts in IDR minor units, 2 decimals: 5 jt = `500_000_000`.)
- [ ] **Step 2:** Run `cd packages/core && npx vitest run src/net-worth/summary.test.ts` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Property test: for random opening and movement lists, `opening + household + other === closing`; `cardBar` percentages each in `[0,100]` and their sum ≤ 100 whenever `balanceMinor ≤ limitMinor` and both parts non-negative.
- [ ] **Step 5:** PASS; commit: "A shared item's period splits into Household lines and one other-use total that always add up".

---

### Task 4: Group log lifecycle

**Files:**
- Create: `packages/db/src/sync/net-worth/group-log.ts`
- Modify: `packages/db/src/sync/engine.ts` (new methods delegate to `group-log.ts`; `syncOnce(workspaceBookId)` also syncs the linked group log)
- Modify: `packages/db/src/sync/authority.ts` (admission rule for group logs), `packages/db/src/sync/shared-entities.ts` (workspace-log entity `net_worth_group`)
- Modify (only if needed): `packages/db/src/sync/capture.ts` `CaptureSession.sharedBooks()` — group logs are rows of `shared_books`, so capture should already see them; confirm
- Test: `packages/db/test/sync/group-log.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; `SyncEngine` internals (`transport.createBook`, `sealKeyFor` as in `maybeRotate` engine.ts ~586, `Sealer.storeEpochKeyTx`, `removeDevice`, `maybeRotate`, `stopSharing`).
- Produces on `SyncEngine`:
  ```ts
  openGroupLog(workspaceBookId: string): Promise<string>;            // creates if absent; returns groupBookId; idempotent
  groupLogOf(workspaceBookId: string): Promise<string | null>;
  admitToGroupLog(workspaceBookId: string, memberIds: readonly string[]): Promise<void>; // seal current epoch key to each member's active pinned devices
  leaveGroupLog(workspaceBookId: string): Promise<void>;             // own devices removed with rotation; local nw_* rows of this group deleted
  removeFromGroupLog(workspaceBookId: string, memberId: string): Promise<void>; // any group member may call for a member who left (answer 'left'), rotates
  groupMembersReady(workspaceBookId: string, memberIds: readonly string[]): Promise<{ ready: boolean; outdated: { memberId: string; deviceName: string }[] }>; // meetsMinVersion over book_devices.app_version of active devices
  ```
- Produces: workspace-log row entity `net_worth_group` (table `group_logs`, keyColumns `['book_id']`, field `groupBookId: 'group_book_id'`, scope `t.book_id = ${bookId}`, writer: any member). Receiving it records the link; the device starts pulling the group log once it holds an epoch key for it.

Design notes (rule on these, record in the ledger):
- The group log is a row in `shared_books` whose `book_id` is a fresh local id (no `books` row: `shared_books` has no FK to `books`, migration 0056). `group_logs` links it to the workspace. `bookContextTx` for a group log: `ws` and `currency` come from the linked workspace's `shared_books`/`books` row. Every workspace reader that iterates `shared_books` (e.g. `useSharedBooks`, `bookSyncStatus`, the workspace switcher) must skip group logs: filter `book_id NOT IN (SELECT group_book_id FROM group_logs)`. Grep for `sharedBooks`/`shared_books` readers and add the filter; test that `useSharedBooks`' query returns only the workspace.
- Admission without invite (authority.ts, next to `introductionRefusal`): in a group log, a device introduction is admitted iff the device is active and pinned (same `sign_jwk`) in the **linked workspace's** authority view. The epoch key reaches a device as a `rotation`-shaped entry sealed to it (reuse the `maybeRotate` sealing path at the current epoch, or `epoch + 1` if the relay requires monotonic epochs — check `MemoryTransport` semantics S9.3 and rule).
- No seeding (`seedBookTx` not called).
- The relay needs every device of the group registered on the group book: follow how `shareBook` registers the creator (`transport.createBook(device.public)`) and how devices are added today (claim); if the relay only admits a device via invite claim, create one invite per admitted device with `sameMember: false` terms signed by the proposer and claim it automatically on the receiving device when it sees `net_worth_group` — record the ruling. Do not change the relay.

- [ ] **Step 1:** Write `group-log.test.ts` (failing), using `Household` with three devices (`rina`, `andi`, `sari` = the adult son), all in the workspace:
  1. `rina.engine.openGroupLog(home.bookId)` then `admitToGroupLog(home.bookId, [andiMemberId])`; `home.settle()` plus syncing the group log ⇒ `andi.engine.groupLogOf(home.bookId)` returns the same `groupBookId` as rina's.
  2. An `nw_item` op written by rina into the group log (use a direct `withCapture` write of an `nw_items` row) reaches andi's `nw_items`, **not** sari's; sari's database has no `book_epoch_keys` row for the group log and no `sync_skipped` noise beyond the expected "no key" handling.
  3. `andi.engine.leaveGroupLog(home.bookId)` ⇒ after settle, rina's next group-log entry is sealed at a newer epoch andi does not hold; andi's `nw_items` for the group are deleted.
  4. `groupMembersReady` returns `outdated` for a device built with `appVersion: '0.2.0'` (Household arg from Task 1) and `ready: true` when all are `0.3.0`.
  5. The workspace's shared-book listing (the query behind `useSharedBooks` in `apps/web/src/features/sharing/queries.ts`, or its db helper) does not include the group log.
- [ ] **Step 2:** Run `cd packages/db && npx vitest run test/sync/group-log.test.ts` — FAIL.
- [ ] **Step 3:** Implement `group-log.ts` and the engine methods; wire `syncOnce(workspaceBookId)` to also `syncOnce(groupBookId)` when linked and this device holds a key.
- [ ] **Step 4:** Tests PASS; run the full db suite including capture config (`npm test -w @expanses/db`). Commit: "A net-worth group gets its own encrypted log that only its members' phones can read".

---

### Task 5: Proposals, answers, share settings — API and setup screens

**Files:**
- Create: `packages/db/src/sync/net-worth/proposals.ts`, `packages/db/src/repos/net-worth-sharing.ts`
- Modify: `packages/db/src/index.ts` (exports)
- Create: `apps/web/src/features/sharing/NetWorthSetup.tsx`, `apps/web/src/features/sharing/NetWorthReview.tsx`, `apps/web/src/features/sharing/net-worth-queries.ts`
- Modify: `apps/web/src/features/sharing/SharingSection.tsx` (a "Share net worth" row / status), `apps/web/src/features/networth/AssetDetailPage.tsx` and the account page reached from `apps/web/src/features/accounts/AccountsPage.tsx` (a "Share with Household" row), `apps/web/src/features/networth/AddAssetForm.tsx` and the add-account form (the D9 switch)
- Test: `packages/db/test/sync/net-worth-proposals.test.ts`, `packages/db/test/repos/net-worth-sharing.test.ts`, component tests alongside where the feature folder has them

**Interfaces:**
- Consumes: `deriveGroup`, `canPropose` (Task 2); `openGroupLog`, `admitToGroupLog`, `leaveGroupLog`, `removeFromGroupLog`, `groupMembersReady` (Task 4).
- Produces (`proposals.ts`, methods on `SyncEngine` delegating to it):
  ```ts
  proposeNetWorth(workspaceBookId: string, input: { mode: FilingMode; members: string[] }): Promise<string>; // proposalId; opens group log, admits members, writes nw_proposal + own confirm; throws 'not-ready' with outdated devices, 'invalid' if !canPropose
  answerNetWorth(workspaceBookId: string, proposalId: string, answer: 'confirm' | 'decline'): Promise<void>; // refuses 'decline' on an activated proposal
  cancelNetWorth(workspaceBookId: string, proposalId: string): Promise<void>;  // proposer only
  leaveNetWorth(workspaceBookId: string): Promise<void>;                       // answer 'left' on active, then leaveGroupLog
  netWorthGroup(workspaceBookId: string): Promise<GroupState & { groupBookId: string | null; me: string }>;
  ```
  (`repos/net-worth-sharing.ts`, owner scope, never synced):
  ```ts
  getShareSetting(database, accountId): Promise<'total' | 'hidden' | null>;
  setShareSetting(database, accountId, setting: 'total' | 'hidden'): Promise<void>;   // throws 'joint-forbids-hidden' when the active mode is joint
  reviewItems(database, ws): Promise<{ accountId: string; name: string; subtype: string; setting: 'total' | 'hidden' | null }[]>; // every listAccounts asset/liability, no placeholders
  confirmReview(database, ws, settings: Record<string, 'total' | 'hidden'>): Promise<void>; // writes every row; joint forces 'total'
  pendingHidden(database, ws): Promise<string[]>;   // accountIds still 'hidden' while mode is joint (D8)
  ```
  Joint mode is read via `netWorthGroup` of the one workspace this person is in a group with (one group per person, §4); expose `activeNetWorthGroup(database): Promise<{ workspaceBookId; groupBookId; mode; members } | null>` for owner-scope readers.
- `pendingHidden` changes ⇒ write `nw_pending { count }` for me into the group log (Task 6 sends summaries; this task only writes the count).

Screens (native kit only; copy per spec §8.1 and §6):
- SharingSection: when the workspace is shared and has ≥ 2 members, a row **Share net worth**. States: none → opens `NetWorthSetup`; pending and I proposed → "Waiting for Andi" + Cancel; pending and I am asked → card "Rina set up household net worth: one tax ID. [Confirm] [Choose differently]"; active → "Net worth shared · One tax ID" (or "Separate") with **Change filing** (a new proposal) and **Stop sharing my net worth** (leave).
- NetWorthSetup: question "How does your household file tax?" with **One tax ID for both of us** / **Each of us has our own tax ID**; member picker (joint ⇒ exactly one other; separate ⇒ one or more); on `not-ready`, the message "Update the app on Andi's iPad" (device name from `outdated`).
- NetWorthReview: shown once when the group becomes active and `reviewItems` has any `null`, and after separate → joint when `pendingHidden` is non-empty ("Household now files with one tax ID. Share Business Mandiri with Andi? [Share]"). Grouped by kind as the Net worth drawers (`sheet-drawers.ts`). Joint: no switches, the line "Your household files with one tax ID, so every item is in the joint report." Separate: a switch per item, on by default. Button **Share**.
- Item pages: row **Share with Household** → the two settings; `Don't share` disabled in joint with the same line.
- Add forms (new account, card, asset): joint ⇒ a note "Shared with Household (one tax ID)"; separate ⇒ a switch **Share with Household**, on; writes `setShareSetting` on save. No row at all when this person has no active group.

- [ ] **Step 1:** Failing db tests: propose → other confirms → `netWorthGroup` active on both devices (via `Household`); `answerNetWorth(..., 'decline')` on an active proposal throws; joint with three members throws `invalid`; `setShareSetting(..., 'hidden')` throws `joint-forbids-hidden` under joint; separate → joint with one hidden item ⇒ `pendingHidden` = that id and an `nw_pending { count: 1 }` arrives on the partner; sharing it ⇒ count 0.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement the db side. **Step 4:** PASS.
- [ ] **Step 5:** Screens with component tests for the state machine of SharingSection's row (none / waiting / asked / active) using the existing test setup in `apps/web` (find a sibling `*.test.tsx` under `features/sharing` or `features/workspaces` and follow it).
- [ ] **Step 6:** `npm test`, `npm run typecheck` — PASS. Commit: "A household can agree how it files tax and each person chooses what of theirs to share".

---

### Task 6: Summaries — compute, send, receive

**Files:**
- Create: `packages/db/src/sync/net-worth/summaries.ts`
- Modify: `packages/db/src/sync/capture.ts` (after a commit that touched an account's entries/profile/value, mark it dirty; at flush recompute dirty shared items)
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/sync/net-worth-summaries.test.ts`, extend the capture harness privacy check

**Interfaces:**
- Consumes: `splitPeriod`, `summaryHash`, `lastMonthEnds` (Task 3); `activeNetWorthGroup`, `getShareSetting` (Task 5); `nativeBalances` (`repos/ledger.ts`), `listAccounts` (`repos/accounts.ts`), `assetValuesAt` (`repos/asset-values.ts`), `cardTerms.creditLimitMinor`/`statementDay` (schema-points), `cycleFor` (`packages/core/src/points/cycles.ts:44`).
- Produces:
  ```ts
  computeItemSummary(tx: Db, ws: WorkspaceContext, accountId: string, owner: string, workspaceBookId: string, today: string): Promise<ItemSummary>;
  itemIdOf(groupBookId: string, accountId: string): string;           // uuidv5(groupBookId, 'item:' + accountId), stored in nw_item_map
  sendSummariesTx(tx: Db, accountIds: readonly string[] | 'all', today: string): Promise<number>; // writes nw_item ops into the group log's outbox for changed ones
  receivedItems(database: Database, groupBookId: string): Promise<(ItemSummary & { itemId: string })[]>;   // non-removed, others' only
  ```
- Household movement = an entry on the account whose transaction is in the workspace book (`transactions.book_id = workspaceBookId`, or the column the ledger uses for book membership — confirm in `schema.ts`). Other use = every other entry. Period = the card's current cycle from `cycleFor(today, …, statementDay)` for a credit card, else the calendar month of `today`. `monthEnds` = `nativeBalances` (or `assetValuesAt` for valued assets) at each month end from `lastMonthEnds(today, 24)`. `tax` = `null` here (Task 10 fills it in joint mode).
- Sending rules (§9): an account is sent when the person has an active group, its setting is `total` (or the mode is joint, which forces total unless it is still in `pendingHidden`), and `summaryHash` differs from `nw_sent`. A setting change to `hidden`, an archived account (`archivedAt` set), or a deleted account sends `removed = true` and deletes its `nw_sent` row. Placeholder accounts are never items. Leaving the group sends nothing and deletes local received rows (Task 4).
- Restore (S8.7): after `checkRestore` rejoin, `sendSummariesTx(tx, 'all', today)` with `nw_sent` cleared.

- [ ] **Step 1:** Failing tests (`Household` rina + andi, active joint group via Task 5 API):
  1. Rina posts Household groceries 500 rb and a Business purchase 1 jt on her card (card limit 5 jt, cycle containing today) ⇒ after settle, andi's `receivedItems` has her card with `householdMinor = 50_000_000`, `otherUseMinor = 100_000_000`, `balanceMinor = 150_000_000`, `card.limitMinor = 500_000_000`.
  2. **Privacy:** scan every outbox change-set rina produced (plaintext, before sealing — use `outboxChangeSets` from `sync-helpers.ts` on the group log and the workspace book): no string equal to the Business purchase's description, no number equal to its amount as a standalone field, no id of that transaction, and no rina `accountId` anywhere.
  3. A `hidden` item (separate mode) emits no `nw_item` op at all.
  4. **Archived item is removed** (Review Focus 3): archive rina's card ⇒ andi's `receivedItems` no longer has it.
  5. Unchanged recompute sends nothing (outbox count unchanged).
  6. `sari` (in the workspace, not the group) never has any `nw_items` row.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS, including `npm run test:capture` (the capture harness must see no uncaptured shared-book write).
- [ ] **Step 5:** Commit: "Each shared item's balance, chart and one other-use total are sent from the owner's phone, and nothing private goes with them".

---

### Task 7: Paid with the other's item (`paidFrom`)

**Files:**
- Modify: `packages/db/src/sync/capture.ts` (`PurchaseMoney` gains `paidFrom`; `projectPurchase` ~line 680 sets it when the money side is on an item received from another member)
- Modify: `packages/db/src/sync/apply.ts` (`postingLines` ~line 407: account owner = `money.paidFrom?.owner ?? money.paidBy`; on the owner's device the money side is posted on the local account `nw_item_map` maps `itemId` to)
- Modify: `apps/web/src/features/transactions/PaymentSheet.tsx`, `tx-form.ts`, `FormPage.tsx` (Paid with shows "Rina's, shared" group in the shared workspace only)
- Test: `packages/db/test/sync/paid-from.test.ts`, web tests for the picker grouping

**Interfaces:**
- Consumes: `receivedItems` (Task 6), `activeNetWorthGroup` (Task 5), `placeholderAccountTx` (apply.ts:143).
- Produces: `paidFrom: { owner: string; itemId: string } | null` in `PurchaseMoney` (default `null`; absent on the wire = `null`). A form value for the payer's side: when he picks her item, his device posts the money side on **rina's placeholder** (`placeholderAccountTx(tx, ctx, rinaMemberId, currency)`) and the capture records `paidFrom = { owner: rina, itemId }`, `paidBy = andi`, `paidLabel = summary.name`. Add `paidFrom` to `PostTransactionInput` as a sync-only hint (like `syncAuthor`) or pass it through the capture context — rule and ledger it.
- On rina's device, `postingLines` puts the money side on her real card account with `cardId` set, so her statement, cycle and points see it exactly as S7.4 describes for the payer's own device.
- **Ruling carried from Task 9:** a Household purchase the owner pays from their **own shared item** also carries `paidFrom = { owner: self, itemId }` (set in `projectPurchase` when the money-side account has an `nw_item_map` row and a `total` setting). That is how the partner's `SharedItemPage` finds "Lines you can see" for an item. Test: rina pays Household groceries from her shared card ⇒ the op's `money.paidFrom` is `{ owner: rina, itemId }`; from an unshared account ⇒ `null`.

- [ ] **Step 1:** Failing tests (`Household` rina + andi, active group, rina's card shared):
  1. Andi records Household groceries 300 rb paid from rina's card ⇒ on rina: the transaction's money side is her card account with `card_id` = the card, and it appears in her card's current `cardStatement`; on andi: the money side is rina's placeholder; on both the purchase reads "paid by Andi".
  2. Changing `paidFrom` back to andi's own account (edit on andi's device) moves rina's side off her card to andi's placeholder.
  3. **Unshared after paying** (Review Focus 5): andi pays; rina sets the card to `hidden` locally **before** syncing; after settle the purchase is on her real card; andi's Paid-with list (the query the picker uses) no longer offers the card.
  4. A device that receives a purchase without `paidFrom` behaves exactly as today (existing tests stay green).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Picker: in `PaymentSheet`, a section header "Rina's, shared" listing `receivedItems` of kind bank/cash/ewallet/credit_card, only when the form's book is the group's workspace; web test for the grouping and its absence in another workspace.
- [ ] **Step 6:** `npm test`, typecheck — PASS. Commit: "In the shared workspace you can pay with your partner's shared card, and it lands on their real card".

---

### Task 8: Transfers between partners (`member_transfer`)

**Files:**
- Create: `packages/db/src/sync/net-worth/transfers.ts`
- Modify: `packages/db/src/sync/apply.ts` (after a `member_transfer` row applies, post/replace/void this device's side), `packages/db/src/sync/engine.ts` (`recordMemberTransfer`, `editMemberTransfer`, `voidMemberTransfer`)
- Modify: `apps/web/src/features/transactions/FormPage.tsx`, `tx-form.ts` (Transfer mode: **To** lists the other's shared items under "Andi's, shared with Household"; **From** likewise for recording money received), `PaymentSheet.tsx` if it renders those lists
- Test: `packages/db/test/sync/member-transfer.test.ts`

**Interfaces:**
- Consumes: Task 1 `member_transfers`, `member_transfer_postings`; `postTransactionTx`, `replaceTransactionTx`, `voidTransactionTx` (ledger.ts); `placeholderAccountTx`; `nw_item_map`; `receivedItems`.
- Produces:
  ```ts
  recordMemberTransfer(workspaceBookId: string, t: { occurredOn: string; amountMinor: number; currency: string;
    from: { owner: string; itemId: string }; to: { owner: string; itemId: string }; description: string | null }): Promise<string>;
  editMemberTransfer(workspaceBookId: string, transferId: string, patch: Partial<{ occurredOn: string; amountMinor: number; description: string | null }>): Promise<void>;
  voidMemberTransfer(workspaceBookId: string, transferId: string): Promise<void>;
  ```
  The recorder's own item is referenced by its `itemId` from `nw_item_map` (their own shared item). Both items must be in `currency`.
- Posting (spec §7.2): on the `from` owner's device, `from` account −amount / `to` owner's placeholder +amount; on the `to` owner's device, `to` account +amount / `from` owner's placeholder −amount; any other device nothing. The local transaction id is kept in `member_transfer_postings`; an edit replaces it (`replaceTransactionTx`), `void` voids it. Postings are made with capture paused (they belong to no workspace book; they must not emit purchase ops).

- [ ] **Step 1:** Failing tests (rina, andi, sari in workspace; rina+andi group; both have a shared bank item): rina records 5 jt BCA → andi's Mandiri ⇒ rina's BCA balance −5 jt, andi's Mandiri +5 jt, sari has no posting; both Net worth (`netWorthAt`) move by exactly 5 jt in opposite directions (placeholders excluded); edit to 4 jt ⇒ both sides 4 jt; void ⇒ both back; andi (the `to` owner) may edit it; a transfer op from sari is refused (Task 1 writer check).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Transfer form lists; web test that the other's items appear only in the group's workspace and only those in the chosen currency.
- [ ] **Step 6:** `npm test`, typecheck — PASS. Commit: "A transfer to your partner's shared account is recorded once and lands on both real accounts".

---

### Task 9: Net worth by mode, the other's item page, Accounts "…, shared"

**Files:**
- Create: `apps/web/src/features/networth/joint-rows.ts` (+ `joint-rows.test.ts`), `apps/web/src/features/networth/SharedItemPage.tsx`
- Modify: `apps/web/src/features/networth/OverviewPage.tsx`, `overview-rows.ts`, `sheet-drawers.ts` (rows gain an optional `owner`), `queries.ts`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/app/router.tsx` (route for the shared item page), health ratios reader (`HealthRatios.tsx` / `health-cards.ts`) to use the joint total in joint mode
- Test: `joint-rows.test.ts`, component tests

**Interfaces:**
- Consumes: `receivedItems`, `activeNetWorthGroup`, `cardBar`, current Net worth rows.
- Produces: `jointRows(own: OverviewRow[], received: (ItemSummary & { itemId })[], me: string, ratesToBase): { rows: (OverviewRow & { owner: string })[]; totalMinor: number | null; byOwner: Record<string, number | null> }` — received items converted with the viewer's rates exactly as own rows are; any missing rate ⇒ `totalMinor = null` and that owner's subtotal `null` (Review Focus 4).
- Owner ring colors: two tokens `--owner-1`, `--owner-2` (and more for separate groups of 3+) defined on `:root` with dark-mode values, distinct from kind icon colors; assigned by the order of `active.members`, same on both phones.

UI (spec §8.2, §8.3, D12, D13):
- Joint: the page title total is the household's; legend under it "● Rina 58,8 jt · ● Andi 400 jt"; drawers by kind as today with subtotals; each row's icon circle gets the owner's ring; rows stay one line (no owner text, no "updated"); `aria-label` includes "Rina's". Tapping an own row goes where it goes today; tapping a received row opens `SharedItemPage`.
- Separate or no group: unchanged. AccountsPage gains a section "Andi's, shared" listing received items (not counted in totals).
- `SharedItemPage`: balance, chart from `monthEnds`, "Lines you can see" = Household purchases of the period whose money side is on the item (purchases whose `paidFrom.itemId` is this item — Task 7 sets it for purchases paid by either member), one line "Rina's other use · total only" = `otherUseMinor` (a negative value reads as a credit), for a card the bar from `cardBar`; details: Owner, Updated (`asOf`), "not yet on Rina's phone" when a Household purchase paid from it is newer than `asOf` (and the bar subtracts it).

- [ ] **Step 1:** Failing `joint-rows.test.ts`: two owners' rows merge into kind drawers with correct subtotals and `byOwner`; missing USD rate ⇒ `totalMinor === null`, the USD row still present with its native balance; **negative other use renders** as "−" credit text in the SharedItemPage view-model (put the view-model in `shared-item.ts` with its own test).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Components and route; health ratios use the joint total in joint mode (test in `health-cards.test.ts`).
- [ ] **Step 6:** `npm test`, typecheck — PASS. Commit: "With one tax ID, Net worth is the household's, and each item's ring says whose it is".

(Owner-paid Household purchases on a shared item carry `paidFrom` with the owner — built in Task 7; Task 9 only reads it.)

---

### Task 10: Joint tax report

**Files:**
- Modify: `packages/db/src/sync/net-worth/summaries.ts` (`tax` filled in joint mode), `packages/db/src/repos/tax-inputs.ts` (export a per-account row builder, or a filter of `coretaxInputsFor`'s output by account)
- Modify: `apps/web/src/features/coretax/CoretaxPage.tsx`, `report-rows.ts`
- Test: `packages/db/test/sync/joint-tax.test.ts`, `apps/web/src/features/coretax/report-rows.test.ts` (extend or create)

**Interfaces:**
- Consumes: `coretaxInputsFor(database, ws, taxYear)`; `receivedItems`; `nw_pending` rows; `activeNetWorthGroup`.
- Produces: `taxRowFor(database, ws, accountId, taxYear): Promise<CoretaxRowPart | null>` — the slice of `CoretaxInputs` (`cash` / `holdings` / `estimated` / `receivables` / `debts`) belonging to one account, same types as `@expanses/core`'s `CoretaxInputs` members; `ItemSummary.tax` typed as `{ taxYear: number; part: CoretaxRowPart } | null`. `jointCoretaxInputs(own: CoretaxInputs, received: ItemSummary[], taxYear): { inputs: CoretaxInputs; waiting: { owner: string; name: string }[] }` — merges received parts for `taxYear`; an item whose `tax.taxYear < taxYear` or whose `monthEnds` lacks `${taxYear}-12` goes in `waiting`.
- The latest finished tax year = `today`'s year − 1.

- [ ] **Step 1:** Failing tests: joint mode, rina's bank + andi's house ⇒ `jointCoretaxInputs` has both rows with the same codes/values as each owner's own `coretaxInputsFor`; separate mode ⇒ summaries carry `tax = null`; andi's phone offline since before 31 Dec ⇒ his items in `waiting`; `nw_pending.count > 0` ⇒ the page view-model says "Rina hasn't added 1 item yet" and is not complete.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** CoretaxPage: in joint mode a banner "Joint report · Rina and Andi" and the incomplete states; separate unchanged.
- [ ] **Step 6:** `npm test`, typecheck — PASS. Commit: "With one tax ID, the tax report lists both people's items and says what it is still waiting for".

---

### Task 11: End to end, and the final pass

**Files:**
- Modify: `apps/web/e2e/sharing.spec.ts` (new `test(...)` blocks; follow the file's existing two-context pattern and `test.describe.configure({ timeout: 300_000 })`)
- Modify: `docs/superpowers/specs/2026-09-29-joint-net-worth-design.md` (any remaining code-reality corrections)

- [ ] **Step 1:** E2E, phone and desktop projects: share a workspace (existing helpers), then: propose joint → the other confirms → both review → both Net worth show the same total and the ring legend; pay with the other's card from the second context → the first context's card statement shows it; transfer 5 jt → both accounts move; the first context sets an item to Don't share in separate mode (after a mode change both confirm) → it disappears on the second; leave → the second's Net worth is personal again.
- [ ] **Step 2:** Run `npm run e2e` — the new tests and the existing suite green (known flaky: `points-ledger:83`; re-run once before treating as a failure).
- [ ] **Step 3:** Root `npm test`, `npm run typecheck` — PASS. Commit: "Two phones agree on a joint net worth end to end".

---

## Code map (from the pre-plan survey)

- Engine facade `packages/db/src/sync/engine.ts`: `shareBook` 185, `syncOnce` 256, `drain` 220, `createInvite` 322, `linkDevice` 375, `joinBook` 459, `removeDevice` 563, `maybeRotate` 586 (seals a key to each active device via `sealKeyFor`), `leave` 659, `stopSharing` 714, `checkRestore` 882.
- `shared-entities.ts`: `RowEntity` 16, `SHARED_ENTITIES` 68, `device` entity ~126, `NEVER_SYNCED_COLUMNS` 278, `buildOpId` 317.
- `capture.ts`: `PurchaseMoney` 156, `CaptureSession` 187, `withCapture` 408, `projectPurchase` 680 (paidBy/paidLabel 705–718), `capturePostedTx` 741.
- `apply.ts`: `placeholderAccountTx` 143, `applyRowOp` 296, `postingLines` 407 (the spec's `moneySide`; `money.paidBy === ctx.memberId` at 430), `applyChangeSetTx` 606, `applyChangeSet` 637, `pullAndApply` 716.
- `authority.ts`: `AuthorityError` 42, `introductionRefusal` 148, `viewActiveDevices` 109.
- `seal.ts`: `Sealer.storeEpochKeyTx` 110; `sealKeyFor` in `crypto.ts`.
- Relay: `POST /books` needs no invite; no app-version recorded anywhere (hence Task 1's `appVersion`).
- Repos: `listAccounts` accounts.ts:109, `assetValuesAt` asset-values.ts:83, `netWorthAt` :194, `coretaxInputsFor` tax-inputs.ts:26, ledger `postTransactionTx` :124 / `replaceTransactionTx` :293 / `voidTransactionTx` :266, `cardStatement` statements.ts:168, card limit `cardTerms.creditLimitMinor` (schema-points.ts:6).
- Web: `SyncService` apps/web/src/sync/sync-service.ts; Net worth page `features/networth/OverviewPage.tsx` (route `/net-worth`, router.tsx:210); Accounts `features/accounts/AccountsPage.tsx`; form `features/transactions/FormPage.tsx` + `tx-form.ts` (`FormMode` incl. `'transfer'`) + `PaymentSheet.tsx`; sharing `features/sharing/SharingSection.tsx`, `queries.ts`; tax `features/coretax/CoretaxPage.tsx`, `report-rows.ts`; e2e `apps/web/e2e/sharing.spec.ts`.
- Test helpers: `packages/db/test/sync/household.ts` (`Household.device/share/join/settle/restore`), `sync-helpers.ts` (`shareBookForTest`, `outboxChangeSets`), `capture-harness.ts`, `convergence.property.test.ts`.
- Commands: root `npm test`, `npm run typecheck`, `npm run e2e`; one db test `cd packages/db && npx vitest run test/sync/<name>.test.ts`; capture config `npx vitest run --config vitest.capture.config.ts`.
