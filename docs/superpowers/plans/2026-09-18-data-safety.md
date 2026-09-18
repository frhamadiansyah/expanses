# Never lose a free user's data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user whose database will not open, will not migrate, or does not check out must never see a dead end and must never have a reason to delete the app. Five layers, in this order: a recovery screen that offers Restore / Export / Start fresh; a snapshot in OPFS before anything risky, with automatic rollback when the result does not verify; a refusal to touch a database written by a newer build; progress while updating; and backup reminders that escalate at 30 days.

**Architecture:** `bootstrap()` becomes a staged open (`apps/web/src/db/open.ts`): open → read version → refuse the future → `quick_check` → snapshot → migrate with progress → verify → seed. Every stage that fails returns a typed `RecoveryReason` instead of throwing, and `main.tsx` renders either a stage screen, the recovery screen, or the app. Checks are pure `packages/db` functions over a `Database` (`repos/integrity.ts`, `checkLedgerHealth` beside today's `checkLedgerIntegrity`), so every one of them is tested in node against a real SQLite file. Snapshots are plain OPFS files in `expanses-safety/` written from the **main thread** (`apps/web/src/db/snapshots.ts`), never inside the VFS's `.expanses` directory and never dependent on the worker being alive; `open.ts` talks to them through a `SnapshotStore` interface so the orchestration is testable with an in-memory store. Bytes for a snapshot come from `pool.exportFile()` — a file copy taken between statements in the worker's own queue, because the SAH pool has no WAL and the `Database` mutex means no transaction can be open at that moment.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4, SQLite wasm in a worker over OPFS); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-18-data-safety-design.md` (approved 2026-09-18)

## Global Constraints

- **Never destroy user data on any path.** No code in this plan may delete, overwrite, wipe or reset anything except behind an explicit, repeated user press. Every destructive path takes a snapshot first. `pool.wipeFiles()` and `removeVfs()` appear in exactly one place (Start fresh) and only after a snapshot with `reason: 'before-start-fresh'` has been written and verified.
- **Every new path is tested against a real database** — a seeded `seedSampleData` file through `createNodeExecutor`, or a real OPFS database in Playwright. No path in this plan is proved by a mock alone.
- **Desktop is never weaker than the phone.** The recovery screen, recovery mode, Restore the last good copy, Export, Start fresh and the reminders all exist in the `chromium` project as well as `phone`, and every one of them is reachable by keyboard.
- Branch `feat/data-safety`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Gate before every commit: `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`).
- `checkLedgerIntegrity` keeps its current name, signature and return shape — `packages/db/test/sample-data.test.ts` asserts on it. New checks arrive as new functions.
- No migration is added by this plan. `MIGRATIONS` stays at 46 versions; `packages/db/test/database.test.ts`'s applied-versions list is not touched.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- Migration work stays in the worker. Nothing in this plan moves SQL onto the main thread, or the progress bar cannot animate.
- Country-neutral copy; no Indonesia-specific presets. Copy is plain, never a stack trace above the fold, and never says "corrupt" without "nothing was lost" in the same breath.
- Test snippets name real functions and real signatures as read on 2026-09-18; if the compiler disagrees, re-read the type and match it.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/repos/integrity.ts` | `checkStructure`, `checkLedgerHealth`, `checkDatabase`, `IntegrityProblem` |
| `packages/db/src/migrations.ts` | `LATEST_VERSION`, `databaseVersion`, `futureVersions`, `pendingMigrations`, `MigrateOptions.onProgress` |
| `packages/db/src/index.ts` | export the above |
| `packages/db/test/integrity.test.ts` | structure + ledger checks, on a corrupted real database |
| `packages/db/test/migration-safety.test.ts` | version reads, a failing migration, resume after interruption, progress |
| `apps/web/src/db/open.ts` | the staged open; `openSafely`, `RecoveryReason`, `OpenStage` |
| `apps/web/src/db/open.test.ts` | the whole orchestration against a real seeded database + an in-memory snapshot store |
| `apps/web/src/db/snapshot-policy.ts` (+ `.test.ts`) | names, parsing, which two to keep, whether a daily one is due, room to write |
| `apps/web/src/db/snapshots.ts` | the OPFS store: list, write, read, prune, manifest |
| `apps/web/src/db/salvage.ts` | raw OPFS export when the worker cannot start |
| `apps/web/src/db/worker.ts` | `snapshot` op with the autocommit guard; `import` verifies before adopting; fatal-corruption tagging |
| `apps/web/src/db/worker-executor.ts` | carry `fatal` through; `onFatal` callback |
| `apps/web/src/db/bootstrap.ts` | `openAppDb` unchanged in what it seeds; `bootstrap` delegates to `openSafely` |
| `apps/web/src/features/recovery/recovery-copy.ts` (+ `.test.ts`) | headline, body and which buttons for each `RecoveryKind` |
| `apps/web/src/features/recovery/RecoveryScreen.tsx` | the screen |
| `apps/web/src/features/recovery/StartFreshDialog.tsx` | the two-press deletion path |
| `apps/web/src/features/recovery/OpeningScreen.tsx` | "Opening / Making a safety copy / Updating / Checking", with the bar |
| `apps/web/src/main.tsx` | recovery mode, stage screens, the recovery screen, the mid-session fatal swap |
| `apps/web/src/features/backup/backupState.ts` (+ `.test.ts`) | `overdue` at 30 days; `migrationPrompt` helpers |
| `apps/web/src/features/backup/BackupBanner.tsx` | the `overdue` level with an in-place Download backup |
| `apps/web/src/features/backup/BackupPage.tsx` | snapshots listed; device-backup copy; restore verified before adoption |
| `apps/web/src/features/backup/AfterUpdateCard.tsx` | "Your data was updated — download a backup?" |
| `apps/web/e2e/recovery.spec.ts` | corrupt OPFS → recovery screen → export → restore → start fresh (chromium) |
| `apps/web/e2e/phone-recovery.spec.ts` | the same screen by thumb at 390px |
| `apps/web/e2e/newer-database.spec.ts` | a version-999 file refused, at open and at restore |
| `apps/web/e2e/backup-reminders.spec.ts` | the 30-day banner and the after-update card |
| `apps/web/e2e/phone-backup-reminders.spec.ts` | the same banner by thumb at 390px |
| `apps/web/package.json` | `better-sqlite3` + `@types/better-sqlite3` as devDependencies (the e2e process builds and reads real SQLite files) |

---

## Step 1 — The recovery screen

### Task 1: The checks, in `packages/db`

**Files:**
- Create: `packages/db/src/repos/integrity.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/integrity.test.ts`

**Interfaces:**
- Produces: `IntegrityProblem`, `checkStructure(database, pragma?)`, `checkLedgerHealth(database, ws)`, `checkDatabase(database, options?)`.
- Consumes: `listWorkspaces`, `contextOf` (`repos/workspaces.ts`), `entries`, `transactions`, `accounts` (`schema.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/integrity.test.ts
import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDatabase, checkLedgerHealth, checkStructure, createAccount, listAccounts, postTransaction } from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food.groceries')!.id;
  const spend = (amountMinor: number) =>
    postTransaction(database, ws, {
      occurredOn: '2026-09-03',
      description: 'Superindo',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor, currency: 'IDR' }),
    });
  return { database, ws, bank, groceries, spend };
}

describe('checkStructure', () => {
  it('finds nothing wrong with a database the app just made', async () => {
    const h = await household();
    await h.spend(120_000);
    expect(await checkStructure(h.database)).toEqual([]);
    expect(await checkStructure(h.database, 'integrity_check')).toEqual([]);
  });

  it('reports a corrupted file instead of throwing', async () => {
    const h = await household();
    await h.spend(120_000);
    const bytes = await h.database.exportBytes();
    // Fill sixty pages in the middle with 0xFF: page 1 (the schema) survives, the b-trees do not.
    bytes.fill(0xff, 4096 * 20, 4096 * 40);
    await h.database.importBytes(bytes);
    const problems = await checkStructure(h.database);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe('quick_check');
    expect(problems[0]!.detail).toMatch(/malformed|not a database|disk image|ok$/i);
  });
});

describe('checkLedgerHealth', () => {
  it('is clean for ordinary data', async () => {
    const h = await household();
    await h.spend(120_000);
    expect(await checkLedgerHealth(h.database, h.ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
  });

  it('finds an unbalanced transaction, an orphan entry and a transaction with no entries', async () => {
    const h = await household();
    const id = await h.spend(120_000);
    const second = await h.spend(50_000);
    const third = await h.spend(30_000);
    // Three separate wounds, each of a different kind.
    await h.database.db.values(sql`UPDATE entries SET amount_minor = amount_minor + 1 WHERE transaction_id = ${id} LIMIT 1`);
    await h.database.db.values(sql`UPDATE entries SET transaction_id = 'gone' WHERE transaction_id = ${second}`);
    await h.database.db.values(sql`DELETE FROM entries WHERE transaction_id = ${third}`);

    const health = await checkLedgerHealth(h.database, h.ws);
    expect(health.unbalanced.map((r) => r.transactionId)).toEqual([id]);
    expect(health.orphanEntries).toHaveLength(2);
    expect(health.orphanTransactions).toEqual([second, third].sort());
  });
});

describe('checkDatabase', () => {
  it('runs the structure and every workspace, and says what failed', async () => {
    const h = await household();
    const id = await h.spend(120_000);
    expect(await checkDatabase(h.database)).toEqual([]);
    await h.database.db.values(sql`DELETE FROM entries WHERE transaction_id = ${id}`);
    const problems = await checkDatabase(h.database);
    expect(problems.map((p) => p.kind)).toEqual(['orphan-transactions']);
    expect(problems[0]!.detail).toContain(id);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/db && npx vitest run test/integrity.test.ts`
Expected: FAIL — `checkStructure` is not exported.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/repos/integrity.ts
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { checkLedgerIntegrity } from './ledger';
import { contextOf, listWorkspaces } from './workspaces';

export interface IntegrityProblem {
  kind: 'quick_check' | 'integrity_check' | 'unbalanced' | 'orphan-entries' | 'orphan-transactions';
  /** One line, safe to show under "Details". Never a stack trace. */
  detail: string;
}

export interface LedgerHealth {
  /** Posted transactions whose entries do not sum to zero, per currency. */
  unbalanced: Awaited<ReturnType<typeof checkLedgerIntegrity>>;
  /** Entry ids pointing at a transaction or an account that is not there. */
  orphanEntries: string[];
  /** Posted transaction ids with no entries at all. */
  orphanTransactions: string[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * SQLite's own opinion of the file. A corrupt database answers in two ways — it throws
 * ("database disk image is malformed") or it returns rows that are not "ok" — and both count.
 * quick_check walks every page but skips the index-versus-table cross-check, so it is the one run at
 * every open; integrity_check is asked for after a migration that touched an index.
 */
export async function checkStructure(database: Database, pragma: 'quick_check' | 'integrity_check' = 'quick_check'): Promise<IntegrityProblem[]> {
  let rows: unknown[][];
  try {
    rows = await database.db.values<unknown[]>(sql.raw(`PRAGMA ${pragma}(1)`));
  } catch (error) {
    return [{ kind: pragma, detail: message(error) }];
  }
  const answers = rows.map((row) => String(row[0]));
  if (answers.length === 1 && answers[0] === 'ok') return [];
  return [{ kind: pragma, detail: answers.join('; ') || 'no answer' }];
}

/** What the ledger says about itself: every posted transaction balances, and nothing dangles. */
export async function checkLedgerHealth(database: Database, ws: WorkspaceContext): Promise<LedgerHealth> {
  const unbalanced = await checkLedgerIntegrity(database, ws);
  const orphanEntries = await database.db.values<[string]>(sql`
    SELECT e.id FROM entries e
    WHERE e.workspace_id = ${ws.workspaceId}
      AND (NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = e.transaction_id)
        OR NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = e.account_id))
    ORDER BY e.id`);
  const orphanTransactions = await database.db.values<[string]>(sql`
    SELECT t.id FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id)
    ORDER BY t.id`);
  return {
    unbalanced,
    orphanEntries: orphanEntries.map((r) => String(r[0])),
    orphanTransactions: orphanTransactions.map((r) => String(r[0])),
  };
}

/** Everything, in the order that costs least: the file first, then each workspace's ledger. */
export async function checkDatabase(database: Database, options: { deep?: boolean } = {}): Promise<IntegrityProblem[]> {
  const structure = await checkStructure(database, options.deep ? 'integrity_check' : 'quick_check');
  // A malformed file cannot be asked anything else; asking would only throw.
  if (structure.length) return structure;

  const problems: IntegrityProblem[] = [];
  for (const workspace of await listWorkspaces(database)) {
    const health = await checkLedgerHealth(database, contextOf(workspace));
    if (health.unbalanced.length) {
      problems.push({
        kind: 'unbalanced',
        detail: health.unbalanced.map((r) => `${r.transactionId} ${r.currency} ${r.total}`).join(', '),
      });
    }
    if (health.orphanEntries.length) problems.push({ kind: 'orphan-entries', detail: health.orphanEntries.join(', ') });
    if (health.orphanTransactions.length) problems.push({ kind: 'orphan-transactions', detail: health.orphanTransactions.join(', ') });
  }
  return problems;
}
```

Add to `packages/db/src/index.ts`, next to the other repo exports:

```ts
export * from './repos/integrity';
```

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass, `sample-data.test.ts` included (it still calls `checkLedgerIntegrity`, untouched). Root `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): ask SQLite and the ledger whether the file is sound"` (with the trailer; `git add` the new files first).

### Task 2: Versions, and a migration run that can be watched

**Files:**
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/migration-safety.test.ts`

**Interfaces:**
- Produces: `LATEST_VERSION`, `databaseVersion(database)`, `futureVersions(database)`, `pendingMigrations(database, migrations?)`, `MigrateOptions`.
- `migrate(database, migrations?, options?)` — the third argument is new; the first two keep their meaning, so no existing caller changes.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/migration-safety.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  databaseVersion,
  futureVersions,
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  pendingMigrations,
  type Migration,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const fresh = () => {
  executor = createNodeExecutor();
  return createDatabase(executor);
};

describe('versions', () => {
  it('answers 0 for a database that has never been migrated', async () => {
    expect(await databaseVersion(fresh())).toBe(0);
  });

  it('answers the highest applied version, and knows the build’s own', async () => {
    const database = fresh();
    await migrate(database);
    expect(LATEST_VERSION).toBe(Math.max(...MIGRATIONS.map((m) => m.version)));
    expect(await databaseVersion(database)).toBe(LATEST_VERSION);
    expect(await futureVersions(database)).toEqual([]);
    expect(await pendingMigrations(database)).toEqual([]);
  });

  it('names the versions a newer build wrote', async () => {
    const database = fresh();
    await migrate(database);
    await database.execScript(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (${LATEST_VERSION + 1}, 'from_the_future', '2027-01-01T00:00:00.000Z')`);
    expect(await futureVersions(database)).toEqual([LATEST_VERSION + 1]);
    expect(await databaseVersion(database)).toBe(LATEST_VERSION + 1);
  });

  it('lists what is still to do on a half-migrated database', async () => {
    const database = fresh();
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 44));
    expect((await pendingMigrations(database)).map((m) => m.version)).toEqual([45, 46]);
  });
});

describe('migrate', () => {
  it('reports each step as it starts it, and once when it is done', async () => {
    const database = fresh();
    const steps: [number, number, string][] = [];
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 3), { onProgress: (done, total, name) => steps.push([done, total, name]) });
    expect(steps).toEqual([
      [0, 3, 'ledger'],
      [1, 3, 'fx'],
      [2, 3, 'points'],
      [3, 3, 'points'],
    ]);
  });

  it('leaves the versions that committed, so the next open carries on where it stopped', async () => {
    const database = fresh();
    const boom: Migration = { version: 99, name: 'boom', sql: 'CREATE TABLE boom (x TEXT);\nINSERT INTO nope (x) VALUES (1);' };
    await expect(migrate(database, [...MIGRATIONS.filter((m) => m.version <= 3), boom])).rejects.toThrow();
    expect(await databaseVersion(database)).toBe(3);
    // The failed migration's own table rolled back with it.
    expect(await database.db.values(sql`SELECT name FROM sqlite_master WHERE name = 'boom'`)).toEqual([]);
    // And the run resumes from 4 with no repair.
    expect(await migrate(database)).toEqual(MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version));
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/db && npx vitest run test/migration-safety.test.ts`
Expected: FAIL — `LATEST_VERSION` is not exported.

- [ ] **Step 3: Implement**

In `packages/db/src/migrations.ts`, after the `MIGRATIONS` array:

```ts
/** The highest version this build of the app knows how to produce. */
export const LATEST_VERSION: number = Math.max(...MIGRATIONS.map((m) => m.version));

/** Versions already recorded in the file. Empty for a database that has never been migrated. */
async function recordedVersions(database: Database): Promise<number[]> {
  const tables = await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`);
  if (!tables.length) return [];
  const rows = await database.db.values<[number]>(sql`SELECT version FROM schema_migrations ORDER BY version`);
  return rows.map((r) => Number(r[0]));
}

/** The highest version recorded in the file, or 0. Read before anything runs, so a newer file is never touched. */
export async function databaseVersion(database: Database): Promise<number> {
  const versions = await recordedVersions(database);
  return versions.length ? versions[versions.length - 1]! : 0;
}

/** Versions the file records that this build does not know. Non-empty means: do not run, do not write. */
export async function futureVersions(database: Database, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  const latest = Math.max(...migrations.map((m) => m.version));
  return (await recordedVersions(database)).filter((version) => version > latest);
}

/** What this build would apply next, in order. Used to decide whether a snapshot is needed. */
export async function pendingMigrations(database: Database, migrations: Migration[] = MIGRATIONS): Promise<Migration[]> {
  const done = new Set(await recordedVersions(database));
  return [...migrations].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version));
}

export interface MigrateOptions {
  /** Called before each migration with (finished so far, total, the name about to run), and once at the end. */
  onProgress?: (done: number, total: number, name: string) => void;
}
```

Change `migrate`'s signature and its loop only:

```ts
export async function migrate(database: Database, migrations: Migration[] = MIGRATIONS, options: MigrateOptions = {}): Promise<number[]> {
  …unchanged through the renumber repair…
  const todo = [...migrations].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version));
  const applied: number[] = [];
  for (const m of todo) {
    options.onProgress?.(applied.length, todo.length, m.name);
    const script = `BEGIN IMMEDIATE;\n${m.sql}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', '${new Date().toISOString()}');\nCOMMIT;`;
    try {
      await database.execScript(script);
    } catch (error) {
      await database.execScript('ROLLBACK').catch(() => undefined);
      throw error;
    }
    applied.push(m.version);
  }
  if (todo.length) options.onProgress?.(todo.length, todo.length, todo[todo.length - 1]!.name);
  return applied;
}
```

Export from `packages/db/src/index.ts`:

```ts
export { databaseVersion, futureVersions, LATEST_VERSION, migrate, MIGRATIONS, type Migration, type MigrateOptions, pendingMigrations } from './migrations';
```

(replacing today's `export { migrate, MIGRATIONS, type Migration } from './migrations';`).

- [ ] **Step 4: Run** — `cd packages/db && npx vitest run` → all pass, including `database.test.ts`'s applied-versions list and every `*-migration.test.ts`. Root `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(db): read the schema version before running, and report each step"` (with the trailer).

### Task 3: The staged open

**Files:**
- Create: `apps/web/src/db/open.ts`
- Modify: `apps/web/src/db/bootstrap.ts`, `apps/web/package.json` (devDependencies `better-sqlite3`, `@types/better-sqlite3` — the tests and the e2e process build real SQLite files)
- Test: `apps/web/src/db/open.test.ts`

**Interfaces:**
- Produces:

```ts
export type RecoveryKind = 'cannot-open' | 'unreadable' | 'corrupt' | 'newer-database' | 'migration-failed' | 'verify-failed' | 'locked';
export interface RecoveryReason { kind: RecoveryKind; headline: string; detail: string; exportable: boolean; rolledBack?: boolean }
export type OpenStage = { stage: 'opening' | 'snapshotting' | 'checking' } | { stage: 'migrating'; done: number; total: number; name: string };
export interface SnapshotStore { list(): Promise<SnapshotInfo[]>; write(bytes: Uint8Array, reason: SnapshotReason, schemaVersion: number): Promise<SnapshotInfo>; read(file: string): Promise<Uint8Array>; blockedVersion(): Promise<number | null>; block(version: number): Promise<void>; unblock(): Promise<void> }
export type OpenResult = { ok: true; app: AppDb; applied: number[] } | { ok: false; reason: RecoveryReason };
export async function openSafely(deps: OpenDeps): Promise<OpenResult>;
```

- Consumes: `checkDatabase`, `checkStructure`, `databaseVersion`, `futureVersions`, `pendingMigrations`, `LATEST_VERSION`, `migrate`, `openAppDb`.

This task wires the orchestration with a **stubbed snapshot store that stores nothing** (`NO_SNAPSHOTS`), so the recovery screen can ship before snapshots exist; Task 6 swaps in the real one and Task 7 adds the rollback branch. What ships here already refuses a newer database, checks the file, and turns every failure into a `RecoveryReason`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/db/open.test.ts
import { createDatabase, LATEST_VERSION, migrate, MIGRATIONS, type Migration } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it } from 'vitest';
import { NO_SNAPSHOTS, openSafely, type OpenStage } from './open';

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

function opened(migrations: Migration[] = MIGRATIONS) {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  const stages: OpenStage[] = [];
  return {
    database,
    stages,
    run: () => openSafely({ database, migrations, snapshots: NO_SNAPSHOTS, onStage: (stage) => stages.push(stage) }),
  };
}

describe('openSafely', () => {
  it('opens a new database, migrates it, and reports the stages in order', async () => {
    const o = opened();
    const result = await o.run();
    expect(result.ok).toBe(true);
    expect(o.stages.map((s) => s.stage)).toEqual(['opening', 'migrating', 'migrating', 'checking']);
    if (result.ok) expect(result.applied).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('refuses a database a newer build wrote, and changes not one byte', async () => {
    const o = opened();
    await migrate(o.database);
    await o.database.execScript(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (${LATEST_VERSION + 2}, 'future', '2027-01-01T00:00:00.000Z')`);
    const before = await o.database.exportBytes();

    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('newer-database');
      expect(result.reason.exportable).toBe(true);
      expect(result.reason.detail).toContain(String(LATEST_VERSION + 2));
    }
    expect(Array.from(await o.database.exportBytes())).toEqual(Array.from(before));
  });

  it('stops at a corrupt file before it writes anything', async () => {
    const o = opened();
    await migrate(o.database);
    const bytes = await o.database.exportBytes();
    bytes.fill(0xff, 4096 * 10, 4096 * 30);
    await o.database.importBytes(bytes);

    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('corrupt');
    // "opening" only: nothing was migrated on a file we could not read.
    expect(o.stages.map((s) => s.stage)).toEqual(['opening']);
  });

  it('turns a migration that throws into a reason, not an exception', async () => {
    const boom: Migration = { version: 99, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
    const o = opened([...MIGRATIONS, boom]);
    const result = await o.run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('migration-failed');
      expect(result.reason.rolledBack).toBe(false); // no snapshot store yet; Task 7 makes this true
      expect(result.reason.exportable).toBe(true);
    }
  });

  it('turns a migration that passes but breaks the ledger into verify-failed', async () => {
    const o = opened();
    await o.run();
    const wrecker: Migration = { version: 98, name: 'wrecker', sql: "DELETE FROM entries WHERE 1 = 1;" };
    const second = await openSafely({ database: o.database, migrations: [...MIGRATIONS, wrecker], snapshots: NO_SNAPSHOTS, onStage: () => undefined });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.kind).toBe('verify-failed');
  });
});
```

(The last test needs at least one posted transaction: seed one with `postTransaction` before `wrecker`, using the same helper shape as `packages/db/test/integrity.test.ts`. Write it that way; do not rely on an empty ledger.)

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx vitest run src/db/open.test.ts`
Expected: FAIL — `./open` does not exist.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/db/open.ts
import {
  checkDatabase,
  checkStructure,
  type Database,
  databaseVersion,
  futureVersions,
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  type Migration,
  pendingMigrations,
} from '@expanses/db';
import { type AppDb, openAppDb } from './bootstrap';

export type RecoveryKind = 'cannot-open' | 'unreadable' | 'corrupt' | 'newer-database' | 'migration-failed' | 'verify-failed' | 'locked';

export interface RecoveryReason {
  kind: RecoveryKind;
  /** One sentence, in the user's words. */
  headline: string;
  /** What happened, for "Details" and a bug report. Never shown above the fold. */
  detail: string;
  /** Whether the bytes can still be handed to the user. */
  exportable: boolean;
  /** Whether the database was put back the way it was before an update. */
  rolledBack?: boolean;
}

export type OpenStage =
  | { stage: 'opening' | 'snapshotting' | 'checking' }
  | { stage: 'migrating'; done: number; total: number; name: string };

export interface OpenDeps {
  database: Database;
  migrations?: Migration[];
  snapshots: SnapshotStore;
  onStage: (stage: OpenStage) => void;
}

export type OpenResult = { ok: true; app: AppDb; applied: number[] } | { ok: false; reason: RecoveryReason };

const say = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Opening in named stages, so that every way this can go wrong ends in a screen with buttons rather
 * than a thrown error. Nothing before `migrate` writes a byte: the version is read, the future is
 * refused, and the file is checked, all read-only.
 */
export async function openSafely({ database, migrations = MIGRATIONS, snapshots, onStage }: OpenDeps): Promise<OpenResult> {
  onStage({ stage: 'opening' });

  let version: number;
  try {
    version = await databaseVersion(database);
  } catch (error) {
    return { ok: false, reason: { kind: 'unreadable', headline: 'We could not read your data this time.', detail: say(error), exportable: true } };
  }

  const future = await futureVersions(database, migrations);
  if (future.length) {
    return {
      ok: false,
      reason: {
        kind: 'newer-database',
        headline: 'This data was made by a newer version of Expanses.',
        detail: `Your data: update ${Math.max(...future)} · This app: update ${Math.max(...migrations.map((m) => m.version))}`,
        exportable: true,
      },
    };
  }

  // An existing file is checked before it is touched; a brand-new one has nothing to check.
  if (version > 0) {
    const problems = await checkStructure(database);
    if (problems.length) {
      return { ok: false, reason: { kind: 'corrupt', headline: 'Your data is still on this device, but we could not read it this time.', detail: problems.map((p) => p.detail).join('; '), exportable: true } };
    }
  }

  const pending = await pendingMigrations(database, migrations);
  let applied: number[] = [];
  if (pending.length) {
    const restore = await takeSnapshot({ database, snapshots, version, onStage });
    try {
      applied = await migrate(database, migrations, {
        onProgress: (done, total, name) => onStage({ stage: 'migrating', done, total, name }),
      });
    } catch (error) {
      return rollback({ snapshots, database, restore, kind: 'migration-failed', headline: 'The update could not be finished.', detail: say(error), version: pending[0]!.version });
    }
  }

  onStage({ stage: 'checking' });
  const problems = await checkDatabase(database, { deep: applied.length > 0 });
  if (problems.length) {
    return rollback({ snapshots, database, restore: null, kind: 'verify-failed', headline: 'We checked your data after the update and something did not add up.', detail: problems.map((p) => `${p.kind}: ${p.detail}`).join('; '), version: applied[0] ?? 0 });
  }

  try {
    return { ok: true, app: await openAppDb(database), applied };
  } catch (error) {
    return { ok: false, reason: { kind: 'cannot-open', headline: 'We could not finish opening your data.', detail: say(error), exportable: true } };
  }
}
```

For this task `takeSnapshot` returns `null` and `rollback` simply builds the reason with `rolledBack: false`; both get their real bodies in Tasks 6 and 7. Ship them as two small functions in the same file with that behaviour and a comment naming the task that fills them in, plus:

```ts
export interface SnapshotStore { /* filled in by Task 5 */ }
/** A store that keeps nothing — the behaviour before Task 6 lands, and what the unit tests use. */
export const NO_SNAPSHOTS: SnapshotStore = { … };
```

Then `apps/web/src/db/bootstrap.ts` keeps `openAppDb` exactly as it is (it is now called by `openSafely`) and `bootstrap()` becomes:

```ts
export function createWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

export async function bootstrap(onStage: (stage: OpenStage) => void): Promise<OpenResult> {
  let database: Database;
  try {
    database = createDatabase(createWorkerExecutor(createWorker()));
  } catch (error) {
    return { ok: false, reason: { kind: 'cannot-open', headline: 'We could not start the database engine on this device.', detail: say(error), exportable: false } };
  }
  return openSafely({ database, snapshots: NO_SNAPSHOTS, onStage });
}
```

Add to `apps/web/package.json` devDependencies: `"better-sqlite3": "^13.0.3"`, `"@types/better-sqlite3": "^9.6.0"`; run `npm install` at the root.

- [ ] **Step 4: Run** — `cd apps/web && npx vitest run` → all pass. Root `npm run typecheck` → clean. `main.tsx` does not compile against the new `bootstrap` signature yet — fix it in Task 4, or temporarily pass `() => undefined`; do not commit a broken typecheck.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): open the database in stages, and name every way it can fail"` (with the trailer).

### Task 4: The screen itself

**Files:**
- Create: `apps/web/src/features/recovery/recovery-copy.ts`, `RecoveryScreen.tsx`, `StartFreshDialog.tsx`, `OpeningScreen.tsx`, `apps/web/src/db/salvage.ts`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/db/worker.ts` (a `salvage`/`wipe` op)
- Test: `apps/web/src/features/recovery/recovery-copy.test.ts`

**Interfaces:**
- Produces: `recoveryCopy(reason, options): { headline, body, actions }` where `actions` is a subset of `('restore' | 'export' | 'retry' | 'start-fresh')`; `RecoveryScreen`; `OpeningScreen`; `salvageBytes(): Promise<Uint8Array | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/features/recovery/recovery-copy.test.ts
import { describe, expect, it } from 'vitest';
import type { RecoveryReason } from '../../db/open';
import { recoveryCopy } from './recovery-copy';

const reason = (kind: RecoveryReason['kind'], extra: Partial<RecoveryReason> = {}): RecoveryReason => ({
  kind,
  headline: 'Something happened.',
  detail: 'technical',
  exportable: true,
  ...extra,
});

describe('recoveryCopy', () => {
  it('always says the data is still there, and never shows the technical text as the headline', () => {
    for (const kind of ['cannot-open', 'unreadable', 'corrupt', 'newer-database', 'migration-failed', 'verify-failed', 'locked'] as const) {
      const copy = recoveryCopy(reason(kind), { hasSnapshot: true });
      expect(copy.headline).not.toBe('technical');
      expect(copy.body.length).toBeGreaterThan(20);
      expect(copy.actions).toContain('export');
    }
  });

  it('offers the last good copy only when there is one', () => {
    expect(recoveryCopy(reason('corrupt'), { hasSnapshot: true }).actions).toContain('restore');
    expect(recoveryCopy(reason('corrupt'), { hasSnapshot: false }).actions).not.toContain('restore');
  });

  it('never offers deletion to someone whose app is simply too old', () => {
    const copy = recoveryCopy(reason('newer-database'), { hasSnapshot: true });
    expect(copy.actions).toEqual(['export', 'retry']);
    expect(copy.headline).toBe('This data was made by a newer version of Expanses');
  });

  it('says the update was undone when it was', () => {
    const copy = recoveryCopy(reason('verify-failed', { rolledBack: true }), { hasSnapshot: true });
    expect(copy.headline).toBe('Your update was undone');
    expect(copy.body).toContain('Nothing was lost');
  });

  it('does not offer a restore or a wipe when storage is not working at all', () => {
    const copy = recoveryCopy(reason('cannot-open', { exportable: false }), { hasSnapshot: false });
    expect(copy.actions).toEqual(['retry']);
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/features/recovery/recovery-copy.test.ts` → FAIL, no module.

- [ ] **Step 3: Implement the copy and the screen**

`recovery-copy.ts` is a plain switch returning `{ headline, body, actions }`. Rules that the tests above pin down, and that the implementation must follow:

- every kind offers `export` except when `exportable` is false;
- `restore` appears only when `hasSnapshot` and the kind is not `newer-database`;
- `start-fresh` never appears for `newer-database` or `locked`;
- `retry` always appears.

`RecoveryScreen.tsx` renders it in the order of §3.2 of the spec: headline, body, Restore (primary, with the snapshot's date and size), Export, Try again, a `<details>` with the technical text, and the Start fresh link last, small, red, opening `StartFreshDialog`. All four are `<button>`s; the screen is a plain centred column with `max-w-md p-4` so it is the same on a 390px phone and on desktop, no horizontal scroll.

`StartFreshDialog.tsx`: two presses. First press explains what goes (byte size of the database, the dates of any snapshots), offers [Download a backup first] and a checkbox "I already have a backup", and keeps the red [Delete everything on this device] disabled until one of the two is satisfied. Only then does it ask the worker to `wipe` and reload.

`salvage.ts` — the main-thread escape hatch used when the worker never starts:

```ts
const MAGIC = 'SQLite format 3 ';
/** The SAH pool writes a 4096-byte header (HEADER_OFFSET_DATA = SECTOR_SIZE) before the database bytes. */
const DATA_OFFSET = 4096;

/**
 * Reads the database straight out of the VFS's slot files, without SQLite. Slots are identified by the
 * SQLite magic at DATA_OFFSET rather than by the name the VFS stores, so nothing here depends on how the
 * pool encodes paths. Returns null when there is nothing that looks like a database.
 */
export async function salvageBytes(directory = '.expanses'): Promise<Uint8Array | null> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(directory).catch(() => null);
  if (!dir) return null;
  let best: Uint8Array | null = null;
  // @ts-expect-error - values() is not in the lib.dom types yet
  for await (const handle of dir.values()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    if (file.size <= DATA_OFFSET) continue;
    const head = new Uint8Array(await file.slice(DATA_OFFSET, DATA_OFFSET + 32).arrayBuffer());
    if (new TextDecoder().decode(head.subarray(0, 16)) !== MAGIC) continue;
    const view = new DataView(head.buffer);
    const pageSize = view.getUint16(16 - 16) || 4096; // bytes 16..17 of the SQLite header
    const pages = view.getUint32(28 - 16);
    const length = pageSize * pages;
    const usable = length > 0 && DATA_OFFSET + length <= file.size ? length : file.size - DATA_OFFSET;
    const bytes = new Uint8Array(await file.slice(DATA_OFFSET, DATA_OFFSET + usable).arrayBuffer());
    if (!best || bytes.length > best.length) best = bytes;
  }
  return best;
}
```

(Read the header offsets carefully when implementing: page size is bytes 16–17 big-endian, page count bytes 28–31 big-endian, both relative to the start of the *database*, which is `DATA_OFFSET` in the slot file. The `- 16` above is because the slice starts at `DATA_OFFSET`; keep a comment saying so, or slice from `DATA_OFFSET` with a 32-byte view and index absolutely.)

`main.tsx` becomes:

```ts
const params = new URLSearchParams(window.location.search);
const recoveryMode = params.has('recover') || window.location.hash === '#recover';

async function start() {
  if (recoveryMode) {
    // Recovery mode never opens the database: the VFS keeps no handles, so a user (or a test) can
    // export, restore and start fresh even when opening is what breaks.
    root.render(<RecoveryScreen reason={{ kind: 'cannot-open', headline: 'Recovery', detail: 'Opened in recovery mode.', exportable: true }} requested />);
    return;
  }
  const result = await bootstrap((stage) => root.render(<OpeningScreen stage={stage} />));
  if (!result.ok) {
    root.render(<RecoveryScreen reason={result.reason} />);
    return;
  }
  … today's dev-sample block and <App app={result.app} /> …
}
```

The single-tab lock stays exactly as it is; its "Already open in another tab" message gains a link to `?recover`.

- [ ] **Step 4: Run** — `cd apps/web && npx vitest run` → pass. Root `npm run typecheck` → clean. `npm run build -w @expanses/web` → succeeds.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): a recovery screen with buttons, instead of a dead end"` (with the trailer; `git add` the new folder first).

### Task 5: Proving it on a real broken database

**Files:**
- Create: `apps/web/e2e/recovery.spec.ts`, `apps/web/e2e/phone-recovery.spec.ts`

No product code. This task exists because the feature is not real until a genuinely corrupt OPFS database produces the screen.

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/web/e2e/recovery.spec.ts
import { expect, type Page, test } from '@playwright/test';

async function addBank(page: Page, name: string, balance: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

/**
 * Writes rubbish over the middle of the database, from the page itself. Recovery mode never opens the
 * VFS, so the pool holds no sync access handles and the slot files can be written here.
 * Layout: each slot file is a 4096-byte SAH header, then the database's pages.
 */
async function corruptTheDatabase(page: Page) {
  await page.goto('/?recover');
  await expect(page.getByRole('heading', { name: /Your data is still on this device|Recovery/ })).toBeVisible();
  const wrecked = await page.evaluate(async () => {
    const DATA = 4096;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('.expanses');
    // @ts-expect-error values() is not in lib.dom yet
    for await (const handle of dir.values()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      if (file.size < DATA + 4096 * 40) continue;
      const magic = new Uint8Array(await file.slice(DATA, DATA + 16).arrayBuffer());
      if (new TextDecoder().decode(magic.subarray(0, 15)) !== 'SQLite format 3') continue;
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position: DATA + 4096 * 10, data: new Uint8Array(4096 * 20).fill(0xff) });
      await writable.close();
      return file.size;
    }
    return 0;
  });
  expect(wrecked).toBeGreaterThan(0);
}

test('a corrupt database opens the recovery screen, and the data can still be exported', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  await corruptTheDatabase(page);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your data is still on this device' })).toBeVisible();
  await expect(page.getByText(/could not read it this time/i)).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export what is there' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.sqlite3$/);
});

test('start fresh needs two presses and says what it deletes', async ({ page }) => {
  await addBank(page, 'About to go', '1000000');
  await corruptTheDatabase(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Start fresh' }).click();
  const confirm = page.getByRole('button', { name: /Delete everything on this device/ });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('I already have a backup').check();
  await expect(confirm).toBeEnabled();
  await Promise.all([page.waitForEvent('load'), confirm.click()]);

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'About to go' })).toHaveCount(0);
});
```

`phone-recovery.spec.ts` is the same first test at 390px, asserting the buttons are stacked, at least 44px tall, and that `document.documentElement.scrollWidth <= innerWidth`.

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx playwright test e2e/recovery.spec.ts --workers=2`. If the corruption helper finds no slot, print `getFileNames()` from a page evaluate and fix the offsets before touching product code.

- [ ] **Step 3: Make it pass** — whatever the run exposes: most likely the recovery screen needs `role="heading"` on its title, Export needs to fall back to `salvageBytes()`, and Start fresh needs its worker `wipe` op.

- [ ] **Step 4: Run the gate** — `npm run typecheck`, `npm test` (root), `npx playwright test --workers=2` in `apps/web`.

- [ ] **Step 5: Commit** — `git commit -am "test(web): a genuinely corrupt database reaches the recovery screen"` (with the trailer).

---

## Step 2 — Snapshots and rollback

### Task 6: What to keep, and when (pure)

**Files:**
- Create: `apps/web/src/db/snapshot-policy.ts`
- Test: `apps/web/src/db/snapshot-policy.test.ts`

**Interfaces:**
- Produces: `SnapshotReason`, `SnapshotInfo`, `snapshotName(takenAt, schemaVersion)`, `parseSnapshotName(file)`, `keepTwo(list, incoming)`, `dailyDue(list, now)`, `roomFor(estimate, dbBytes)`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/db/snapshot-policy.test.ts
import { describe, expect, it } from 'vitest';
import { dailyDue, keepTwo, parseSnapshotName, roomFor, type SnapshotInfo, snapshotName } from './snapshot-policy';

const snap = (takenAt: string, reason: SnapshotInfo['reason'] = 'daily'): SnapshotInfo => ({
  file: snapshotName(takenAt, 46),
  takenAt,
  schemaVersion: 46,
  bytes: 1_372_160,
  reason,
});

describe('names', () => {
  it('writes a name that can be read back', () => {
    expect(snapshotName('2026-09-18T09:12:00.412Z', 46)).toBe('snapshot-20260918T091200Z-v46.sqlite3');
    expect(parseSnapshotName('snapshot-20260918T091200Z-v46.sqlite3')).toEqual({ takenAt: '2026-09-18T09:12:00.000Z', schemaVersion: 46 });
    expect(parseSnapshotName('sample.sqlite3')).toBeNull();
  });
});

describe('keepTwo', () => {
  it('keeps the two newest and names the rest for deletion', () => {
    const list = [snap('2026-09-16T10:00:00.000Z'), snap('2026-09-17T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'before-migration');
    expect(keepTwo(list, incoming).map((s) => s.takenAt)).toEqual(['2026-09-16T10:00:00.000Z']);
  });

  it('never deletes the one just written, whatever the clock says', () => {
    const list = [snap('2027-01-01T10:00:00.000Z'), snap('2027-01-02T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'before-migration');
    expect(keepTwo(list, incoming).map((s) => s.file)).not.toContain(incoming.file);
  });

  it('spares a copy taken before Start fresh for seven days', () => {
    const list = [snap('2026-09-10T10:00:00.000Z', 'before-start-fresh'), snap('2026-09-17T10:00:00.000Z')];
    const incoming = snap('2026-09-18T10:00:00.000Z', 'daily');
    expect(keepTwo(list, incoming, new Date('2026-09-15T10:00:00Z'))).toEqual([]);
    expect(keepTwo(list, incoming, new Date('2026-09-30T10:00:00Z')).map((s) => s.reason)).toEqual(['before-start-fresh']);
  });
});

describe('dailyDue', () => {
  const now = new Date('2026-09-18T09:00:00Z');
  it('is due once a calendar day, and not at all without a copy today', () => {
    expect(dailyDue([], now)).toBe(true);
    expect(dailyDue([snap('2026-09-17T23:59:00.000Z')], now)).toBe(true);
    expect(dailyDue([snap('2026-09-18T00:01:00.000Z')], now)).toBe(false);
  });
});

describe('roomFor', () => {
  it('needs three times the database free, and says so honestly when the browser will not estimate', () => {
    expect(roomFor({ quota: 100_000_000, usage: 10_000_000 }, 1_372_160)).toBe('yes');
    expect(roomFor({ quota: 12_000_000, usage: 10_000_000 }, 1_372_160)).toBe('prune-first');
    expect(roomFor({ quota: 10_500_000, usage: 10_000_000 }, 1_372_160)).toBe('no');
    expect(roomFor({}, 1_372_160)).toBe('yes');
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/db/snapshot-policy.test.ts`.

- [ ] **Step 3: Implement** — a pure module, no OPFS, no dates from `Date.now()` except through the `now` argument (default `new Date()`). `keepTwo(list, incoming, now?)` returns the snapshots to delete; `roomFor` returns `'yes' | 'prune-first' | 'no'` and answers `'yes'` when `quota` or `usage` is missing, because a browser that will not estimate must not stop a rescue copy being taken.

- [ ] **Step 4: Run** — `cd apps/web && npx vitest run` → pass; root `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): the rules for which safety copies to keep"` (with the trailer).

### Task 7: The OPFS store, and a copy before every update

**Files:**
- Create: `apps/web/src/db/snapshots.ts`
- Modify: `apps/web/src/db/worker.ts` (`snapshot` op with the autocommit guard), `apps/web/src/db/open.ts` (`takeSnapshot` for real), `apps/web/src/db/bootstrap.ts` (pass the real store), `apps/web/src/features/recovery/RecoveryScreen.tsx` (list them, restore them)
- Test: `apps/web/src/db/open.test.ts` (extended with an in-memory store), `apps/web/e2e/recovery.spec.ts` (extended)

**Interfaces:**
- Produces: `opfsSnapshots(): SnapshotStore`; `memorySnapshots(): SnapshotStore` (exported from `snapshots.ts` for tests); worker op `{ op: 'snapshot' }` → `Uint8Array`.

- [ ] **Step 1: Write the failing tests** — add to `apps/web/src/db/open.test.ts`:

```ts
it('copies the database before it migrates, and only when there is something to migrate', async () => {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  const store = memorySnapshots();
  await openSafely({ database, snapshots: store, onStage: () => undefined });
  const [first] = await store.list();
  expect(first).toBeUndefined(); // a brand-new database has nothing worth copying

  // Now a real upgrade: stop at 44, then open with the full list.
  executor.close();
  executor = createNodeExecutor();
  const older = createDatabase(executor);
  await migrate(older, MIGRATIONS.filter((m) => m.version <= 44));
  const store2 = memorySnapshots();
  const result = await openSafely({ database: older, snapshots: store2, onStage: () => undefined });
  expect(result.ok).toBe(true);
  const [snapshot] = await store2.list();
  expect(snapshot).toMatchObject({ reason: 'before-migration', schemaVersion: 44 });
  // The copy really is the database as it was: version 44, not 46.
  const copy = createDatabase(createNodeExecutor());
  await copy.importBytes(await store2.read(snapshot!.file));
  expect(await databaseVersion(copy)).toBe(44);
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/db/open.test.ts`.

- [ ] **Step 3: The worker op**

In `apps/web/src/db/worker.ts`, add `{ id: number; op: 'snapshot' }` to `Request` and, in the handler:

```ts
} else if (req.op === 'snapshot') {
  /*
   * A file copy, taken between statements. The SAH pool has no WAL (importDb even rewrites the header
   * to force it off), so the file is complete and self-consistent whenever no transaction is open —
   * and the worker handles one request at a time, behind the Database mutex. The autocommit check is
   * the belt: 0 means a transaction is in flight and the bytes would be a torn read.
   */
  if (!sqlite3.capi.sqlite3_get_autocommit(state.db.pointer)) throw new Error('busy');
  const bytes = await state.pool.exportFile(FILE);
  reply({ id: req.id, result: bytes }, [bytes.buffer]);
}
```

`sqlite3` must be kept on the `ready` state object so the handler can reach `capi`. The executor grows `snapshotBytes()` alongside `exportBytes()`; on `busy` it waits one macrotask and retries once, then gives up and the open proceeds without a snapshot, telling the user (spec §4.3).

- [ ] **Step 4: The store**

`snapshots.ts` implements `SnapshotStore` over `navigator.storage.getDirectory()`:

- `directory()` → `root.getDirectoryHandle('expanses-safety', { create: true })` — a sibling of `.expanses`, never inside it (the VFS owns every file in its own directory and will delete strangers).
- `write(bytes, reason, schemaVersion)`: check `roomFor(await navigator.storage.estimate(), bytes.length)`; `'prune-first'` deletes all but the newest first, `'no'` throws `SnapshotSpaceError`. Then write the file with `createWritable()`, close, **re-read it** and verify length, the `SQLite format 3\0` magic, and `pageSize × pageCount === length`; a copy that fails is deleted and the manifest untouched. Then rewrite `manifest.json` and delete what `keepTwo` names.
- `list()` reads `manifest.json`, falling back to reading the directory and `parseSnapshotName` when the manifest is missing or unparseable — a snapshot must be restorable even if the manifest is the thing that broke.
- `read(file)`, `blockedVersion()`, `block(version)`, `unblock()` (the last three are manifest fields, used by Task 8).
- `memorySnapshots()` is the same interface over a `Map`, exported for the unit tests.

`takeSnapshot` in `open.ts` becomes real: `onStage({ stage: 'snapshotting' })`, ask the executor for the bytes, `snapshots.write(bytes, 'before-migration', version)`, and return the resulting `SnapshotInfo` (or `null` when the store refused, with the reason carried into the failure copy). The daily snapshot is not taken here — it goes in `App.tsx`'s first idle callback (`requestIdleCallback`, fallback `setTimeout(…, 2000)`) so it never delays the first paint: `if (dailyDue(await store.list(), new Date())) await store.write(await snapshotBytes(), 'daily', LATEST_VERSION)`.

`RecoveryScreen` lists `await store.list()` and renders **Restore the last good copy** with the newest snapshot's date and size; pressing it imports the bytes through the worker (`database.importBytes`), runs `checkStructure`, and reloads on success.

- [ ] **Step 5: Extend the e2e** — add to `recovery.spec.ts`:

```ts
test('restore the last good copy brings the data back after corruption', async ({ page }) => {
  await addBank(page, 'Rescue me', '1000000');
  // The daily copy is taken after the first paint; give it a beat, then prove it exists.
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('expanses-safety').catch(() => null);
    if (!dir) return 0;
    let n = 0;
    // @ts-expect-error values() is not in lib.dom yet
    for await (const entry of dir.values()) if (entry.name.endsWith('.sqlite3')) n += 1;
    return n;
  })).toBeGreaterThan(0);

  await corruptTheDatabase(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your data is still on this device' })).toBeVisible();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Restore the last good copy/ }).click()]);

  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Rescue me' })).toBeVisible();
});
```

- [ ] **Step 6: Run the gate** — `npm run typecheck`, `npm test` (root), `npx playwright test --workers=2` in `apps/web`. The last test is the proof of the whole layer: a real OPFS database, really corrupted, really restored.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): a safety copy in OPFS before every update, and one a day"` (with the trailer).

### Task 8: Verify, roll back, and do not loop

**Files:**
- Modify: `apps/web/src/db/open.ts` (`rollback` for real, the blocked version), `apps/web/src/features/recovery/recovery-copy.ts`, `apps/web/src/features/backup/AfterUpdateCard.tsx` (create), `apps/web/src/app/Layout.tsx`
- Test: `apps/web/src/db/open.test.ts` (extended)

- [ ] **Step 1: Write the failing tests** — add to `open.test.ts`:

```ts
async function seeded() {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 45));
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'food.groceries')!.id;
  await postTransaction(database, ws, {
    occurredOn: '2026-09-03',
    description: 'Superindo',
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor: 120_000, currency: 'IDR' }),
  });
  return { database, ws };
}

it('puts the database back when a migration throws part-way', async () => {
  const { database } = await seeded();
  const before = await database.exportBytes();
  const boom: Migration = { version: 47, name: 'boom', sql: 'CREATE TABLE boom (x TEXT);\nINSERT INTO nope (x) VALUES (1);' };
  const store = memorySnapshots();

  const result = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatchObject({ kind: 'migration-failed', rolledBack: true });
  expect(await databaseVersion(database)).toBe(45);
  expect(Array.from(await database.exportBytes()).length).toBe(Array.from(before).length);
  expect(await store.blockedVersion()).toBe(47);
});

it('puts the database back when the update finishes but the ledger does not add up', async () => {
  const { database, ws } = await seeded();
  const wrecker: Migration = { version: 47, name: 'wrecker', sql: "DELETE FROM entries WHERE amount_minor < 0;" };
  const store = memorySnapshots();

  const result = await openSafely({ database, migrations: [...MIGRATIONS, wrecker], snapshots: store, onStage: () => undefined });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatchObject({ kind: 'verify-failed', rolledBack: true });
  expect(await checkLedgerHealth(database, ws)).toEqual({ unbalanced: [], orphanEntries: [], orphanTransactions: [] });
  expect(await databaseVersion(database)).toBe(45);
});

it('does not try the same failed update again on the next open', async () => {
  const { database } = await seeded();
  const boom: Migration = { version: 47, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
  const store = memorySnapshots();
  await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });

  const stages: OpenStage[] = [];
  const second = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: (s) => stages.push(s) });
  expect(second.ok).toBe(true); // it opens, at the old version, rather than failing again
  expect(await databaseVersion(database)).toBe(45);
  expect(stages.some((s) => s.stage === 'migrating')).toBe(false);
});

it('says so plainly when the rollback itself cannot be done', async () => {
  const { database } = await seeded();
  const boom: Migration = { version: 47, name: 'boom', sql: 'INSERT INTO nope (x) VALUES (1);' };
  const store = memorySnapshots();
  store.read = async () => { throw new Error('the copy is gone'); };

  const result = await openSafely({ database, migrations: [...MIGRATIONS, boom], snapshots: store, onStage: () => undefined });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatchObject({ kind: 'migration-failed', rolledBack: false, exportable: true });
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/db/open.test.ts`.

- [ ] **Step 3: Implement**

`rollback()` in `open.ts`:

1. Without a snapshot from this open, build the reason with `rolledBack: false` and return — no writes.
2. With one: `await database.importBytes(await snapshots.read(restore.file))` (the worker's `import` op already keeps the current bytes and puts them back if the import fails, so a failed rollback leaves the half-updated file rather than nothing), then `checkStructure(database)`.
3. On success: `await snapshots.block(failedVersion)`, return `rolledBack: true`.
4. On failure of either step: `rolledBack: false`, both files still exportable, straight to the screen.

And at the top of `openSafely`, after the future check:

```ts
  // A rolled-back update must not be attempted again at every launch: it would fail the same way, and
  // each attempt costs another snapshot. The block lifts when the user asks, or when a new build ships.
  const blocked = await snapshots.blockedVersion();
  const allowed = blocked === null ? migrations : migrations.filter((m) => m.version < blocked);
```

with `allowed` used for `pendingMigrations` and `migrate` from there on, and `snapshots.unblock()` called when `Math.max(...migrations.map(m => m.version))` differs from the build that set the block, or when the user presses "Try the update again".

`AfterUpdateCard.tsx`, rendered by `Layout.tsx` above the page when `openSafely` returned `applied.length > 0` or a `rolledBack` reason:

- applied: *"Your data was updated to version 46. Download a backup now?"* [Download backup] [Not now].
- rolled back: *"Your update was undone. We updated your data, checked it, and something did not add up — so we put it back exactly as it was. Nothing was lost."* [Download a backup] [Details ▸] [Try the update again].

- [ ] **Step 4: Run the gate** — `npm run typecheck`, `npm test` (root), `npx playwright test --workers=2` in `apps/web`.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): check the data after an update, and put it back when it does not add up"` (with the trailer).

---

## Step 3 — Refusing a newer database

### Task 9: The refusal, at open and at restore

**Files:**
- Modify: `apps/web/src/db/worker.ts` (`import` verifies before adopting), `apps/web/src/features/recovery/RecoveryScreen.tsx` / `recovery-copy.ts` (the newer-database face), `apps/web/src/features/backup/BackupPage.tsx` (the message on a rejected restore)
- Test: `apps/web/e2e/newer-database.spec.ts`; `packages/db/test/migration-safety.test.ts` and `apps/web/src/db/open.test.ts` already cover the read side (Tasks 2 and 3)

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/web/e2e/newer-database.spec.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { expect, type Page, test } from '@playwright/test';

/** A backup that claims a version this build has never heard of — a TestFlight file, or a downgrade. */
function fromTheFuture(source: string, target: string) {
  writeFileSync(target, readFileSync(source));
  const db = new BetterSqlite3(target);
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'from_the_future', '2027-01-01T00:00:00.000Z')").run();
  db.close();
  return target;
}

test('a database from a newer app is refused, exportable, and never wiped', async ({ page }, testInfo) => {
  await addBank(page, 'Still here', '1000000');

  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await downloaded;
  const future = fromTheFuture((await backup.path())!, join(testInfo.outputDir, 'future.sqlite3'));

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(future);
  await safety;
  await page.getByRole('button', { name: /Replace my data with/ }).click();

  // Refused at the restore, before it is adopted: the device's data is untouched.
  await expect(page.getByText('This data was made by a newer version of Expanses')).toBeVisible();
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Still here' })).toBeVisible();
});

test('a database already at a newer version refuses to open, and offers only export', async ({ page }, testInfo) => {
  await addBank(page, 'Untouched', '1000000');

  // Put the future file on disk the only way a user can: page the bytes in through OPFS from recovery
  // mode, where nothing opens the VFS and the pool holds no handles. Same trick as the corruption test.
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const future = fromTheFuture((await (await downloaded).path())!, join(testInfo.outputDir, 'future.sqlite3'));
  const bytes = Array.from(readFileSync(future));

  await page.goto('/?recover');
  await page.evaluate(async (data) => {
    const DATA = 4096;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('.expanses');
    // @ts-expect-error values() is not in lib.dom yet
    for await (const handle of dir.values()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      const magic = new Uint8Array(await file.slice(DATA, DATA + 16).arrayBuffer());
      if (new TextDecoder().decode(magic.subarray(0, 15)) !== 'SQLite format 3') continue;
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position: DATA, data: new Uint8Array(data) });
      await writable.close();
      return;
    }
    throw new Error('no database slot found');
  }, bytes);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'This data was made by a newer version of Expanses' })).toBeVisible();
  await expect(page.getByText(/Your data: update 999 · This app: update \d+/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start fresh' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restore the last good copy/ })).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export what is there' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.sqlite3$/);
});
```

Writing the file's bytes over the slot keeps the SAH header (the first 4096 bytes) and replaces the
database with the future one — the same bytes the VFS would hold had a newer build written them. The
future file is the same size or smaller than the current one (it differs by one `schema_migrations`
row), so any tail left behind lies past `pageSize × pageCount` and SQLite never reads it; if the run
shows otherwise, pad the write to the slot's full length with zeroes. No `window.__expanses`, no
test-only backdoor in the product.

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx playwright test e2e/newer-database.spec.ts --workers=2`.

- [ ] **Step 3: Implement**

In `apps/web/src/db/worker.ts`'s `import` op, between reopening and replying, replace today's lone `schema_migrations` existence check with a verification that refuses before adopting:

```ts
const hasSchema = state.db.selectValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
if (!hasSchema) throw new Error('That file is not an Expanses backup.');
const check = state.db.selectValue('PRAGMA quick_check(1)');
if (check !== 'ok') throw new Error('That backup is damaged — your data on this device is untouched.');
const highest = Number(state.db.selectValue('SELECT max(version) FROM schema_migrations') ?? 0);
if (highest > latestVersion) throw new Error(`NEWER_DATABASE:${highest}`);
```

`latestVersion` arrives on the `import` request from the caller (`LATEST_VERSION` lives in `packages/db`, which the worker does not import today; pass it in the message rather than adding the dependency). The existing `catch` already restores `previous` and reopens, so every one of these throws leaves the device's data exactly as it was. `BackupPage` maps a `NEWER_DATABASE:` message to the spec's §6.2 wording, and `recovery-copy.ts` renders the same words with only Export and Try again.

- [ ] **Step 4: Run the gate** — `npm run typecheck`, `npm test`, `npx playwright test --workers=2`.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): refuse data a newer Expanses wrote, and let it be exported"` (with the trailer).

---

## Step 4 — Progress while updating

### Task 10: Say what is happening

**Files:**
- Modify: `apps/web/src/features/recovery/OpeningScreen.tsx`, `apps/web/src/main.tsx`
- Test: `apps/web/src/features/recovery/opening-copy.test.ts` (create), `apps/web/e2e/recovery.spec.ts` (extended)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/features/recovery/opening-copy.test.ts
import { describe, expect, it } from 'vitest';
import { openingCopy } from './OpeningScreen';

describe('openingCopy', () => {
  it('names the stage and counts the steps', () => {
    expect(openingCopy({ stage: 'opening' })).toEqual({ title: 'Opening your data…', body: 'Starting the local database on this device.', percent: null });
    expect(openingCopy({ stage: 'snapshotting' })).toMatchObject({ title: 'Making a safety copy…' });
    expect(openingCopy({ stage: 'migrating', done: 2, total: 7, name: 'book_indexes' })).toEqual({
      title: 'Updating your data…',
      body: 'Step 3 of 7 · book_indexes · Do not close the app. Your data was copied before we started.',
      percent: 29,
    });
    expect(openingCopy({ stage: 'migrating', done: 7, total: 7, name: 'book_indexes' }).percent).toBe(100);
    expect(openingCopy({ stage: 'checking' })).toMatchObject({ title: 'Checking your data…' });
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/features/recovery/opening-copy.test.ts`.

- [ ] **Step 3: Implement** — `openingCopy` is a pure exported function; `OpeningScreen` renders it with a `<progress>` (or a div with `role="progressbar"`, `aria-valuenow`) and `role="status"` so the change is announced. `main.tsx` holds the stage in a module-level variable and re-renders on each `onStage`; a stage that lasts under 300 ms is never given its own paint (keep the previous screen until a 300 ms timer fires, then render) so three headings do not flash past. The migration work is in the worker already, so the bar animates; nothing in this task may move SQL to the main thread.

- [ ] **Step 4: Prove it end to end** — extend `recovery.spec.ts`: restore a file stopped at an older version (build one in the test process with better-sqlite3 by deleting rows 45 and 46 from a real export's `schema_migrations` — the renumber repair in `migrate()` is not involved because the names still match), reload, and assert `Updating your data…` and `Step 1 of 2` appear before the app does. Then assert the after-update backup card is shown.

Also assert the interrupted case: with the same older file restored, `page.reload()` twice in quick succession (the second while the first is still migrating is prevented by the tab lock — so instead kill and reopen the context between migrations by using a migration list stopped mid-way in a unit test) — the unit coverage in Task 2 (`leaves the versions that committed`) is the proof; the e2e only asserts that a second open after an interrupted one shows no progress screen and opens straight to the app.

- [ ] **Step 5: Run the gate and commit** — `git commit -am "feat(web): say what is happening while the data is updated"` (with the trailer).

---

## Step 5 — Backup reminders

### Task 11: Thirty days, and after every update

**Files:**
- Modify: `apps/web/src/features/backup/backupState.ts`, `backupState.test.ts`, `BackupBanner.tsx`, `BackupPage.tsx`
- Test: `apps/web/e2e/backup-reminders.spec.ts` (create)

- [ ] **Step 1: Write the failing tests** — extend `apps/web/src/features/backup/backupState.test.ts`:

```ts
describe('backupUrgency', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  it('keeps today’s ladder and adds an overdue step at thirty days', () => {
    expect(backupUrgency('2026-09-15T12:00:00Z', true, now)).toBe('ok');
    expect(backupUrgency('2026-09-13T12:00:00Z', true, now)).toBe('remind');
    expect(backupUrgency('2026-09-06T12:00:00Z', true, now)).toBe('warn');
    expect(backupUrgency('2026-08-20T12:00:00Z', true, now)).toBe('overdue');
    expect(backupUrgency(null, true, now)).toBe('overdue');
    expect(backupUrgency(null, false, now)).toBe('ok');
  });
});

describe('bannerWords', () => {
  it('says how long it has been, and what that means', () => {
    expect(bannerWords('overdue', 31)).toBe('No backup in 31 days. Your only copy is on this device.');
    expect(bannerWords('overdue', null)).toBe('You have not backed up yet. Your only copy is on this device.');
    expect(bannerWords('warn', 15)).toBe('No backup in 15 days. Your data exists only on this device.');
  });
});
```

- [ ] **Step 2: Run and see it fail** — `cd apps/web && npx vitest run src/features/backup/backupState.test.ts`.

- [ ] **Step 3: Implement**

- `BackupUrgency` gains `'overdue'`; `backupUrgency` returns it at ≥ 30 days and for data that was never backed up (today's never-backed-up case is promoted from `warn` to `overdue` — it is the worst case there is). The 7 and 14 day steps are unchanged.
- `bannerWords` is a new pure function so the copy is tested, not asserted through the DOM.
- `BackupBanner` renders `overdue` in amber with a **Download backup** button that exports in place (`database.exportBytes()` → `saveBytes` → `setLastBackupAt` → invalidate), so a reminder is one press from done, on phone and desktop. The Back up now link stays for the other levels.
- `BackupPage` gains two sections: **Safety copies on this device** (the snapshot list from `opfsSnapshots().list()` — date, size, why it was taken, and a Restore button per copy with the same two-step confirm as a file restore), and **Backups and your iPhone**, carrying the spec §8.2 words. Until the phase-4 device check has been run, the iPhone paragraph reads "When Expanses is installed as an app, your data sits in the app's own container, which iCloud and Finder back up with the rest of the phone. Deleting the app deletes that copy too." and does **not** promise more.

- [ ] **Step 4: Prove it end to end**

`last_backup_at` lives in the database, so age it the honest way — export once, age the row in the
exported file with better-sqlite3 in the test process, and restore that file:

```ts
// apps/web/e2e/backup-reminders.spec.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { expect, test } from '@playwright/test';

function agedBackup(source: string, target: string, days: number) {
  writeFileSync(target, readFileSync(source));
  const db = new BetterSqlite3(target);
  const when = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare("INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(when);
  db.close();
  return target;
}

test('a month without a backup is one press from fixed', async ({ page }, testInfo) => {
  await addBank(page, 'Needs backing up', '1000000');

  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const aged = agedBackup((await (await downloaded).path())!, join(testInfo.outputDir, 'aged.sqlite3'), 31);

  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[type=file]').setInputFiles(aged);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);

  await page.goto('/transactions');
  const banner = page.getByRole('status').filter({ hasText: 'No backup in 31 days.' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Your only copy is on this device.');

  const download = page.waitForEvent('download');
  await banner.getByRole('button', { name: 'Download backup' }).click();
  await download;
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions/); // fixed in place, no trip to /backup
});
```

`phone-backup-reminders.spec.ts` runs the same flow at 390px and asserts
`document.documentElement.scrollWidth <= window.innerWidth` while the banner is up, and that the
button is at least 44px tall.

- [ ] **Step 5: Run the gate** — `npm run typecheck`, `npm test` (root), `npx playwright test --workers=2` in `apps/web` (both projects).

- [ ] **Step 6: Commit** — `git commit -am "feat(web): a louder reminder at thirty days, and a backup offered after every update"` (with the trailer).

---

## Done when

- A database corrupted in OPFS opens the recovery screen, exports, and restores — proved by `apps/web/e2e/recovery.spec.ts` in both Playwright projects.
- A migration that throws, and a migration that quietly breaks the ledger, both leave the database exactly as it was — proved in `apps/web/src/db/open.test.ts` against a real seeded database.
- A version-999 file is refused at open and at restore, and exports cleanly — proved in `apps/web/e2e/newer-database.spec.ts`.
- An update shows its steps, and an interrupted one resumes — proved in `packages/db/test/migration-safety.test.ts` and the opening-copy test.
- Thirty days without an export is one press from fixed.
- `npm run typecheck`, `npm test` and `npx playwright test --workers=2` are green, and nothing in `packages/db/test` had to be weakened to get there.

## Not in this plan

Cloud sync, encrypted backup files, scheduled automatic exports, and any server-side component. The
iOS device-backup verification in spec §8.2 belongs to phase 4 of the phone-shell plan; this plan only
fixes the words the app says until that check has been run.
