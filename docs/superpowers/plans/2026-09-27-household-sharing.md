# Household sharing — implementation plan

Spec (binding): `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (v3). Section numbers below (§n) refer
to it. Review of v2: `docs/superpowers/specs/2026-09-27-household-sharing-review.md`.

Branch `feat/household-sharing`, worktree `.worktrees/household-sharing`, off `main` at `d3af231`
(`feat/ios-testflight` is merged, so the Capacitor shell precondition of spec step 2 holds).

## Global constraints

- The spec is the authority. Where the code disagrees with the spec, the code's reality wins and the spec is corrected
  in the same commit, with a line saying what changed and why.
- The existing test suite stays green and unchanged (`npm test`, `npm run typecheck` at the repo root). Baseline:
  db 1750, web 1179, core 919, catalog 152 tests.
- Money, ledger and merge logic are always test-first (TDD). Property tests use `fast-check` (already a devDependency).
- No new runtime library in the app for crypto: WebCrypto only (§5). Node ≥ 20 `globalThis.crypto.subtle` in tests.
- `workspace_id` is never sent; apply stamps the local workspace id (§4.1).
- Sharing state lives in `shared_books`, never `books.kind` (§4.2).
- Country-neutral: nothing in sharing is Indonesia-specific. UI is the native kit only (§11); desktop capabilities are
  never weakened for the phone.
- The relay runs locally only (wrangler dev / Miniflare). No Cloudflare account, no deploy, no domain. The relay base URL
  is configuration (`VITE_RELAY_URL`, default `http://localhost:8787`).
- Commit messages follow the repo's style (a plain sentence subject saying what the user or code now does), ending with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Implementers never dispatch subagents.

## Task 1: Confirm the spec against the code (spec step 0 + a quick review of v3)

Read §4, §6.3, §7 and the code they name. For each row of §4.1, confirm the table, the scope rule, the `Op.id` and every
column against the schema files in `packages/db/src/schema*.ts` and the migrations. Settle `budget_frequencies`' key and
columns (§15). Read the three ledger doors in `packages/db/src/repos/ledger.ts` (`postTransactionTx`,
`replaceTransaction`, `voidTransactionTx`) and every other writer of `transactions` / `entries` (at least `events.ts`,
`set-aside-tx.ts`; grep for all) and list each with the door it goes through or must be routed through. Confirm that
`replaceTransaction` carries set-aside answers, goals, bill payments as §7.4 claims, that `audit_log` is written where
§7.3 says, and that `postTransactionTx` can accept a caller-supplied id (§7.2 needs `id = op.id`). Check which readers
§4.4's anti-join must touch exist under those names.

Deliver:
- `packages/db/src/sync/shared-entities.ts` exporting `SHARED_ENTITIES` (one record per entity: `entity`, `table`,
  scope description or SQL predicate builder, how `Op.id` is built/parsed, `fields` mapping synced field name → column)
  and `NEVER_SYNCED_COLUMNS`.
- `packages/db/test/sync/shared-entities.test.ts`: every named table and column exists in a freshly migrated database.
- A findings file `docs/superpowers/specs/2026-09-27-household-sharing-v3-check.md`: each discrepancy found, and the
  correction applied to the spec. Apply the corrections to the spec in the same commit.

Done when: the constant and its test exist and pass; the spec agrees with the code; the findings file lists every
writer of `transactions`/`entries` with its door.

## Task 2: Sync foundations — migration, clock, change-set shape, transport, key stub

- Migration `packages/db/migrations/0056_household_sharing.sql` exactly as §4.2 (plus whatever Task 1 corrected), wired
  the same way existing migrations are.
- `packages/db/src/sync/hlc.ts` — §6.1 encoding, local tick, receive, the 24 h drift check; state in `settings`
  under `sync.hlc`.
- `packages/db/src/sync/types.ts` — `ChangeSet`, `Op`, `LogEntry`, `SequencedEntry`, `DevicePublic`, `Sealed`,
  `SyncTransport` (§3, §6.2, §6.6).
- `packages/db/src/sync/split.ts` — cut ops into change-sets of ≤ 200 ops and ≤ 64 KB JSON with consecutive HLCs (§6.2).
- `packages/db/src/sync/memory-transport.ts` — `MemoryTransport` implementing `SyncTransport` in memory, with the
  relay's semantics from §9.2/§9.3 (duplicate `(deviceId,hlc)` → treated as accepted; rotation only at `epoch+1` else
  conflict; claimed/expired invites; removed devices refused; deleted book → gone). It is the reference the relay must
  match later.
- `packages/db/src/sync/seal.ts` — a `Sealer` interface (encrypt+sign a change-set into a `LogEntry`, verify+decrypt
  back) with an identity implementation for this step (§14 step 1: "keys are a stub").
- Tests: `hlc.test.ts` (monotonic under clock jumps, total order, 24 h rule blocks then releases), `split.test.ts`,
  `memory-transport.test.ts` (each status the relay table lists).

Done when: those tests pass; the existing suite is green.

## Task 3: Capture (§6.3, §6.4)

- `packages/db/src/sync/capture.ts`: `withCapture(tx, {bookId, entity, id}, fn)` for in-place entities; purchase capture
  at the three ledger doors (`postTransactionTx`, `replaceTransaction`, `voidTransactionTx` when not inside a replace);
  `sync_lineage` maintained; field clocks written; ops cut and put in `sync_outbox` at commit, sealed via the `Sealer`.
  Capture must be switchable off (apply runs with it off). A write outside a shared book costs one lookup and emits
  nothing.
- Route every writer Task 1 listed through capture: every repository function that writes a table in `SHARED_ENTITIES`
  for a row in a book (categories, budgets and their overrides/frequencies, book income and overrides, expense
  templates, bill windows, bill skips, books, and every transaction writer including `events.ts`, `set-aside-tx.ts`).
- `packages/db/test/sync/capture-harness.ts`: `installCaptureTriggers(db)` (§6.4) and a global `afterEach` that fails a
  test when `__writes` holds a write to a shared-book row that no outbox op accounts for. Wire it so the whole existing
  db suite runs with one shared book seeded (via a vitest setup file or an env-gated project — choose the mechanism that
  keeps the default `npm test` meaningful and document it in the report).
- Tests for capture itself: each entity emits exactly the changed fields; purchase post/replace/void emit per §6.3;
  lineage id survives two corrections.

Done when: the capture harness run of the whole db suite is green, and the existing suite is green.

## Task 4: Apply, merge and seeding (§6.5, §7, §4.4 placeholder accounts)

- `packages/db/src/sync/apply.ts`: the pull loop of §7.1 over a `SyncTransport` + `Sealer`; `applyChangeSet` (§7.2);
  `applyPurchase`; `moneySide` (§7.4); placeholder accounts per member per book (`book_member_accounts`); the
  Uncategorised category (`uuidv5(bookId, 'uncategorised')`); tombstones; held ops for split purchases; audit author.
- `packages/db/src/sync/seed.ts`: §6.5 steps 1–3 (step 4's draining is the caller's).
- `packages/db/src/sync/engine.ts`: a small facade — `shareBook`, `syncOnce(bookId)` (drain outbox, pull, apply) —
  the thing the app and later tasks call.
- Tests in `packages/db/test/sync/`: `convergence.property.test.ts` (≥ 200 programs, N devices, offline stretches,
  random interleavings, includes a seeded book joined later), `money-atom.property.test.ts`, `same-purchase.test.ts`,
  `void-wins.test.ts`, `idempotent.test.ts`, `payer-ledger.test.ts` — each as §13 describes. Joining in these tests may
  use a minimal test helper that inserts the book and `shared_books` directly; the real join is Task 5.

Done when: those tests pass; the existing suite and the capture harness stay green.

## Task 5: Keys (§5, §6.6, §8.1–8.2, §8.4, §8.7)

- `KeyStore` interface; `WebKeyStore` (non-extractable keys in IndexedDB `cicis-keys`) in `apps/web`;
  `NativeKeyStore` for Capacitor. Keychain plugin: pick one compatible with Capacitor 8 that stores with
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`; if none installs cleanly, implement `NativeKeyStore` behind the
  interface over the best available secure-storage plugin and record the choice as a spec correction. Chosen by
  `isNative()`. A node test implementation for db tests.
- Real `Sealer`: epoch keys, §5.3 sealing, §5.5 at rest, §6.6 encrypt/sign/verify, deflate via `CompressionStream`
  (or a documented fallback in node), pinning (§5.4).
- Invites and join (§8.1, §8.2) including the Crockford base32 code; link-a-device (§8.3); removal and `maybeRotate`
  (§8.4); restore detection and rejoin (§8.7).
- Tests: `crypto.kat.test.ts`, `rotation.test.ts`, `pinning.test.ts`, `join.test.ts`, `restore.test.ts` per §13; all
  Task 4 tests re-run with the real sealer.

Done when: those pass, Task 4's tests pass with real sealing, suite green.

## Task 6: The relay (§9, §10)

- `apps/relay/`: Cloudflare Worker + one Durable Object per book, DO storage only, state exactly §9.3, auth §9.1,
  endpoints §9.2 with every status code, `verifyEntitlement` returning `true` (§10). `wrangler.toml` for local dev only.
- `relay.test.ts` under Miniflare / `@cloudflare/vitest-pool-workers` (install what is needed as devDependencies of
  `apps/relay` only): every status code of §9.2.
- `RelayTransport` implementing `SyncTransport` over HTTP with the §9.1 headers; outbox drain in HLC order; pull from
  `applied_seq`; foreground + every 30 s polling with exponential backoff to 5 min (§9.4) — wired in `apps/web`.
- An integration test: two databases converge through a local Worker using `RelayTransport`.
- A root script `npm run relay` that starts the Worker locally.

Done when: relay tests green; the two-database integration test converges.

## Task 7: Screens (§11)

Settings → Workspaces → a workspace: Share this workspace (explainer incl. "a replaced phone needs a new invite", seeding
progress "Preparing N of M", code + link + Share), Members with devices and Remove, Link a device, status line. Workspace
switcher: "Shared with …" subtitle; **+** menu → Join a workspace (paste code or `cicis://join/…`), preview with the
currency check, Join. A purchase in a shared book: subtitle `paidLabel` · "paid by X"; receipt shows both. Native kit
components only; phone and desktop both work.

`apps/web/e2e/sharing.spec.ts` (Playwright, phone and desktop projects, `WebKeyStore`, two browser contexts, local
Worker started by the Playwright config): share a book with history, join, record on both, correct each other's,
remove, rotate, same Cashflow total.

Done when: `sharing.spec.ts` green on both projects; the existing e2e suite still green.

## Task 8: Hiding (§4.4)

Anti-join on `book_member_accounts` in: Accounts page, Net worth, every Paid-with and Transfer picker, tax report, health
ratios. In a shared book the add form's currency flag is disabled and there is no With row. No link in a shared book
leads to an account, card, statement or balance of a placeholder. Tests: a db-level test per reader; one e2e per
excluded page.

Done when: those tests pass; suite green.

## Task 9: Edges (§8.5, §8.6, §8.7 UI)

Make owner (role op + `setOwners`), Leave, Stop sharing (`deleteBook`; others go `unshared` on `410`, read-only,
"No longer shared by …"), frozen book (no owner devices), `needs_invite` state and its message, status lines of §11.
Covered in `sharing.spec.ts` and `restore.test.ts`.

Done when: those tests pass; the full suite, typecheck and e2e are green.
