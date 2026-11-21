# Link my devices: design

Date 2026-11-19. Branch `feat/link-my-devices` (from `main` 383fbf8e). Status: **design only, for review. No feature code.**
Approved mockup: `docs/mockups/2026-11-19-link-my-devices.html`. Builds on the household sharing design
(`2026-09-26-household-sharing-design.md`, "HS"), sharing resilience (`2026-11-11-sharing-resilience-design.md`, "SR")
and the rulings (`plans/2026-09-27-household-sharing-rulings.md`).

## 0. Decision

1. **Option A (auto-share every workspace as owner-only relay books) is rejected.** Household sharing moves only book
   scope: 111 of the 159 tables, every money account, every own-account transfer and the money side of own purchases
   never travel (§1.3). A linked Mac would miss most of the owner's data.
2. **Recommended: C, "one copy, one seat".** A new *self channel* (one encrypted relay book for the owner's devices)
   replicates the **whole database** row by row. A new device starts as a byte copy of the linking device, so every id
   is the same on every device and no mapping is needed.
3. **Household sharing runs on one device only, the seat** (the device that already shares). Other linked devices get
   shared workspaces through the self channel, so they look exactly like the seat's copy, private rows included. The
   husband's side does not change at all.
4. The other linked devices stay **standby** members of each household relay book, so if the seat is lost one of them
   takes over with the existing whole-log replay (SR §6). They never pull or write household entries while standby.
5. Build in 7 drops. The first one the owner can test is Drop 3 (link + replace + figures). Until Drop 6, a shared
   workspace can only be viewed on a non-seat device (owner question 1).

## 1. Today, end to end (verified)

### 1.1 Words

| Thing | What it is | Evidence |
|---|---|---|
| book | one `books` row = one workspace in the UI; one DB has one `workspaces` row (owner scope) and many books | HS §2; `apps/web/src/db/bootstrap.ts:126-129` |
| relay book | an append-only log + device allow-list on a Durable Object, one per shared book, event, goal share or net-worth group log | `apps/relay/src/book.ts:5-17`, `wrangler.toml` |
| member | a person in a shared book (`book_members`, role owner/member) | HS §4.2 |
| device | one install, `deviceId` = hash of its signing key; keys in the keychain, **this device only**, never in the DB or a backup | `apps/web/src/sync/key-store.ts:120-157`; HS §5.1 |
| epoch | the book's AES key; rotated after a removal, sealed for each remaining device | `engine.ts:1033` (`maybeRotate`); HS §5.3 |
| outbox | plaintext change-sets written in the same SQLite transaction as the rows, sealed at drain | `packages/db/src/database.ts:55-67`; `engine.ts:378-427` |
| capture | explicit per write site (`withCapture`, `capturePostedTx`), not triggers | `packages/db/src/sync/capture.ts:21-41` |
| scope | `SHARED_ENTITIES` says which rows of which tables travel and which fields; `NEVER_SYNCED_COLUMNS` the rest | `shared-entities.ts:82-713`, `:720-786` |
| "what is shared" | net-worth items, goals, events are shared one by one through their own relay books | `apps/web/src/features/sharing/share-list.ts:7-15` |
| gates | a new value is kept out of a log until every other device says app version ≥ N (else older phones skip or stop) | `packages/db/src/sync/events/version.ts:8-41`; memory "sync refusal-skip bug" |

### 1.2 Flows

- **Share**: refuse another currency (`seed.ts:96-107`), create relay book, seed every in-scope row, drain, then invite
  (`engine.ts:339-370`).
- **Invite / join**: 52-character code (`invite.ts:6,18,119`), valid 7 days (`invite.ts:12`), claim is one-shot; joiner
  introduces itself in a signed entry, then pulls from 0 (`engine.ts:610,679,774`).
- **Link a device** today = an owner's same-member invite **for one book** (`engine.ts:674`, HS §8.3). The linked
  device is a full household device of that book only.
- **Remove / rotate / leave / stop / forget**: `engine.ts:1010,1033,1135,1192,1221`.
- **Restore detection**: at open, a shared book whose device row is not this device or whose key does not open goes
  `needs_invite` and its outbox is **cleared** (`engine.ts:1883-1904`, called from `sync-service.ts:267-290`).

### 1.3 What household sharing never moves (why A fails)

- 111 of 159 tables are not in `SHARED_ENTITIES` (Appendix A, from a schema built by running every migration): cards, card terms/statements/instalments, assets, debts, loans, securities, trades, prices, fx tables,
  every points table, goals' contributions/draws/dues, sinking funds, drafts/captures, statement checks, tax reports,
  `events` and its items, `settings`, `transaction_photos`, and every sync bookkeeping table.
- A money account never travels as an `accounts` row (`shared-entities.ts:723-725`); transfers between own accounts
  belong to no book (HS §4.1 line 167).
- The money side of an own purchase never travels; on a second device of the same member it lands on that member's
  **placeholder** account (`apply.ts:826-856`). So today, a Rumah purchase paid from BCA on the iPhone does not lower BCA
  on a per-book-linked iPad.
- A purchase split across workspaces keeps its other parts off the log (`apply.ts:785-786`).
- Photos never leave the device (`migrations/0048_transaction_extras.sql:26`).

## 2. Candidates

| | A. Auto-share each workspace | B. Self channel, every own device also a household device | **C. Self channel + one household seat** |
|---|---|---|---|
| How | linking shares every book as an owner-only relay book and claims every device invite with one code; new books auto-shared | one relay book for the owner's devices carrying all rows; each own device also pulls/applies each household book | as B, but only the seat pulls/applies/writes household books; others are standby and get household results through the self channel |
| Owner-scope data (accounts, cards, assets, points, settings…) | **never** (§1.3) | yes | yes |
| Out-of-scope rows of a shared workspace reach the owner's other devices? | **no**: same scope filter as the husband | yes, via self channel | **yes**, via self channel (identical DB) |
| Anything private reaches the husband? | no | no | **no**: self relay book allow-lists only the owner's devices; household books are written only by the seat's existing capture, same scope |
| Same numbers on every own device? | no: placeholders, missing tables | **no**: two devices apply the same household entry with different local ids (new head ids on replace, placeholders, remaps — `apply.ts:212-302`, SR D-A2), then the self channel copies both: double counts | yes: one applier, rows copied |
| Work | extend `SHARED_ENTITIES` to ~110 tables by hand, each with scope/capture/apply; every new feature too | as C plus a deterministic-apply rewrite (rejected) | generic row capture (triggers), one adapter on the seat (Drop 6) |

Also rejected: **deterministic household apply on every device** (would need the ledger's replace to make the same head
id on the payer and on others — edit = void + post with a fresh id, `ledger.ts:937`); **iCloud Drive / CloudKit** (a synced
SQLite file corrupts or conflicts; Apple-only while Android is planned; the owner already chose the relay — memory
"Mac app": "own-device sync is Link a device via relay, not iCloud").

**Cost of C:** while the seat is offline, the Mac's view of Rumah does not move and (from Drop 6) Mac edits to Rumah wait
to reach Sari. The Devices screen says which device keeps sharing up to date. Private workspaces sync device to device
with no seat.

### 2.1 What would differ between the owner's devices, and what to do

Rule: **every table replicates unless listed below.** A test fails when a table, a column or a settings key is not
sorted (same pattern as `NEVER_SYNCED_COLUMNS`' test).

| Group | Tables / keys | Decision |
|---|---|---|
| Device-only | `book_epoch_keys` (sealed for one device, HS §5.5), `sync_outbox` (seat's, signed by its hlc), new `self_outbox`, `self_pending`, `self_cursor`, `self_held`; settings `sync.hlc`, `sync.device`, `last_backup_at`, `icloud_backup*`, `fx.recalc_failures` | never sent, removed from the snapshot on join |
| Seat-owned (household bookkeeping) | `shared_books`, `book_members`, `book_devices`, `book_member_accounts`, `sync_lineage`, `sync_lineage_last`, `sync_cursor`, `sync_field_clocks`, `sync_kept_clocks`, `sync_tombstones`, `sync_skipped`, `sync_authority`, `sync_authority_devices`, `sync_invites_used`, `goal_share_log`, `nw_sent`, `nw_group_books`, `event_books`, `group_logs`; settings `sharing.*`, `share.*`, `*.pending_summaries`, the version-gate "crossed" marks (`repairs.ts`) | written **only by the seat** of that relay book; replicated to the others as read-only facts so a takeover can continue (§3.4). Apply refuses ops on them from a non-seat. |
| Derived, made again on each device | `fx_lot_uses`, `fx_shortfalls`, `fx_day_values`, `fx_recalc_pending` (caches, `fx-costs.ts:255-274`); `point_entries` rows with `source` in (`transaction`,`projected`,`system`) (re-derived with fresh `uuidv7()`, `point-ledger.ts:140,277`) | **Drop 0 audit**: either device-only and recomputed after apply, or given deterministic ids. Must be pure functions of replicated rows. |
| Automatic writes into replicated tables | fx gain/loss pair entries (`fx-gain-loss.ts:148-151` deletes and re-inserts `entries`), upkeep at open (`bootstrap.ts:135-161`: category keys, default sets, held-at, calculator goals, linked programmes), lazily made system accounts (`accounts_system_key` unique) | **Drop 0**: deterministic ids (uuidv5 of what the row is for) so two devices make the same row; test "upkeep twice on two copies → equal dumps". 46 repo files call `uuidv7()`; only automatic writers matter. |
| Fetched inputs | `fx_rates`, `prices`, `security_prices`, Yahoo dividend memo (`yahoo.ts:168`, localStorage) | tables replicate (natural keys, last writer wins), so both devices value net worth alike; the localStorage memo stays a per-device cache |
| User data not synced by households today | `events`, `event_items*`, all points tables, `draft_transactions`, `capture_sources`, `capture_settings`, cards, assets… | replicate (that is the point) |
| Photos | files in OPFS `expanses-photos/`, named by `transaction_photos`; draft `image_file` | Drop 4: sealed blobs through the relay, after the figures |
| localStorage that changes numbers or behaviour | `health.ratio-settings` (`health-settings.ts:20-34`, emergency-fund ratios), `expanses.sinking-account` (`BillFormPage.tsx:21,189`), `cicis.events.converted` (`share-event.ts:98-107`), `wallet.joint-order` (`wallet-joint.ts:163-173`), `expanses.currency.favorites` / `.recent` (`currency-list.ts`, `tx-form.ts:1745`), `cicis.sharing.name` (`SharingSection.tsx:20`) | Drop 0: move into the `settings` table (one-time copy), so they replicate |
| localStorage view choices | `wallet.view`, `wallet.balance-hidden`, `expanses.transactions.view/.group`, `transactions-show-opening`, `expanses.networth.chart`, `debt-plan.sort`, `recurring-page`, `expanses.cashflow.not-monthly`, `expanses.sideways-tip`, install hint, backup snooze, iCloud welcome | stay per device (a Mac may show Table, the phone List) |
| Must be cleared on join | `expanses.dev-sample-loaded` (`sync-service.ts:111-114` turns **all** sync off while set; the Mac's local container has it) | cleared by the join step |
| Entitlements | `expanses.entitlements` (`lib/entitlements.ts`) | per device (store receipts); the Mac tier is not weakened |

## 3. The self channel

### 3.1 Data (one migration)

**As built (Drop 1, migration `0126_self_sync.sql`):** device-only `self_state` (`capture` = this device has linked
devices; `quiet` = an apply is running), `self_pending` (table, key, changed columns or `*`/`-`, and the ms it was
written), `self_outbox`, `self_notes` (what an apply settled by itself); class `meta` — never captured, kept alike by
every device's apply, carried in the copy a new device starts from — `self_clocks(tbl, pk, col, hlc)` (`col = ''` is
when the row was made), `self_tombstones(tbl, pk, hlc)`, `self_aliases(tbl, from_pk, to_pk)` (a row merged into
another by rule 5). `SELF_TABLES` (`packages/db/src/self/tables.ts`) now has four classes: `replicate`, `seat`,
`device`, `meta`.

Still to come with the relay (Drop 2): `self_group(relay_book_id, epoch, joined_at)`; `self_devices(device_id PK, name,
kind, sign_jwk, agree_jwk, added_at, removed_at, last_synced_at, app_version, schema)` (replicated: the Devices list on
every device); `household_seats(relay_book_id PK, device_id, hlc)` (replicated; no row = this device, today's
behaviour); device-only `self_cursor`, `self_held`.

### 3.2 Capture

- Every `replicate` and `seat` table gets `AFTER INSERT/UPDATE/DELETE` triggers that write `(tbl, pk, changed columns
  | '*' | '-')` into `self_pending`, made from `PRAGMA table_info`. Triggers are the only way 160 tables (and every future
  one) cannot escape capture, and they catch writes outside a `Database.transaction` too. **As built:** persistent
  triggers (`self_cap_<table>_{i,u,d,k}`, `self/triggers.ts`), present only while `self_state.capture` is set (a device
  with no linked devices pays nothing). `migrate` drops them before it runs anything (a column a trigger names cannot be
  dropped, and no migration write may be captured: every device migrates itself) and makes them again from the new
  schema afterwards, also when a migration failed. A settings row of class `device` is filtered in the trigger itself.
- All tables have a primary key except `sync_skipped` (device-only) — checked against the schema built from all
  migrations (test).
- The trigger is off while `self_state.quiet` is set: the self channel's own apply sets it inside its transaction.
  Migrations run on each device and are deterministic: one migration ever used `randomblob`
  (`0027_category_revamp.sql`), long applied everywhere; a test forbids it in new ones.
- **Collect** (`collectSelfChanges`): every marked row at its values now — a row made goes whole (`i`), a row changed
  with the columns that changed, a row gone as a removal — in one change-set `{ v, hlc, schema, ops }`. The clock is the
  latest write time among the marked rows (not when they were collected), never behind the device's clock. An apply
  collects this device's own waiting writes first, so its edits carry their clocks when the rules compare them. Size
  splitting and app version come with the relay (Drop 2).
- Sealing, signing, drain, pull: the household machinery as is (`seal.ts`, `relay-signing.ts`, `relay-transport.ts`).

### 3.3 Apply: six plain rules

1. **Each column: the later clock wins** (hlc per column in `self_clocks`).
2. **A removed row stays removed.** Edits to it are dropped; only a fresh insert with a later clock brings it back.
3. **Void stays void** (`transactions.status`), as in households.
4. **Two edits of one transaction made apart** (two posted rows replacing the same row): the later one stays, the
   other and anything that replaced it are voided, on every device, with an Activity line "Edited on two devices at once:
   the later edit was kept".
   As built: "later" is when each replacement was made (its row clock); the void goes through the ledger's own
   `voidTransactionTx` on every device, not sent; its audit line is named and dated by the edit that won, so the devices
   agree. A void the ledger refuses (an event's own posting, a sale) leaves both rows posted, noted
   (`edited-twice-kept-both`) — never silent. Known gap: a void whose side effects make new rows with random ids (a goal
   arrival taken back) can leave those rows different per device.
5. **Two rows clash on a unique key** (two devices made "the same" row under different ids). **A clash never deletes a
   transaction, an entry, a split, a payment or any row that holds money, and never removes children.** Each unique
   index has one fixed answer, the same on every device (the "later" row is the one whose key columns have the later
   clock, ties by id):
   - **Merge** (settings-like rows, no money): one row stays under the earlier id; each column takes the later value of
     the two; the other row's children are moved onto it (their own clashes merge the same way); only the other row
     itself goes, and its id is kept as an alias so later changes to it land on the row that stayed. Activity line.
   - **Keep both** (a real record each, the key is only a "seen before" mark): both rows stay; the later row's key is
     cleared. Activity line "Recorded on two devices: may be a duplicate".
   - **Hold** (money, or rows that money hangs on): the change waits, exactly like rule 6, and the Devices screen names
     the two rows and what to do; it applies by itself once either row changes so the clash is gone.

   | Unique index | Answer | What happens |
   |---|---|---|
   | `budgets_category` | merge | one budget per category; later amount; overrides, frequency, share move over |
   | `budget_overrides_month` | merge | one override per budget and month; later amount |
   | `merchant_mccs_active_pattern` | merge | one live pattern; later code |
   | `income_sources_account` | merge | one income source per account; later settings |
   | `draft_transactions_ref` | keep both | both drafts stay in To review; the later loses its message ref |
   | `transactions_external_ref` | keep both | both purchases stay posted; the later loses its ref; Activity says "may be a duplicate" |
   | `accounts_system_key` | hold | a system account holds entries; Drop 0 gives these fixed ids so it should never happen |
   | `asset_sales_account` | hold | a sale posts a transaction |
   | `deposit_events_once` | hold | an event posts interest and principal |
   | `securities_ticker` | hold | trades and prices hang on it |
   | `tax_year_reports_year` | hold | a frozen or filed report and its rows |
   | `statement_checks_period` | hold | deleting would cascade its links |
   | `book_member_accounts`, `event_books`, `event_category_accounts`, `group_logs`, `nw_item_map` (UNIQUE columns) | hold | seat-owned, one writer, so a clash means a bug |

   An edit that moves an existing row onto another row's key (rather than two rows made apart) is held for every key.
   A merge's children keyed by the parent itself (a budget's frequency and share) land on the row that stayed, and a
   removal of a merged-away row is dropped (it went into the other). As built: `self/clashes.ts`, `self/channel.ts`.
6. **A change from a newer data version waits** (`self_held`, cursor stops, nothing skipped): "Update cicis on this Mac
   to keep in step with iPhone." Changes from an older version apply; absent columns are left as they are. A migration
   that drops or renames a replicated column ships an upgrader (test-enforced).

A change-set group applies in one transaction with `PRAGMA defer_foreign_keys` (FKs are on: `worker.ts:57`). A
deterministic refusal is recorded and shown, like `sync_skipped`; anything else rethrows and the cursor stays (rulings,
"guarded").

**Drop 0 as built:** the gate test (`test/self/upkeep-twice.test.ts`) runs the open's upkeep, the catalogue's terms,
points derive / catch-up / write-offs and the foreign-currency recalculation on two copies at one moment. It failed on
default category sets, catalogue earn rules / bonuses / partners / cash value, points batches, redraw pieces and
write-offs, and the revalue audit line: all now take name-based ids (`stableId`, uuidv5 under their workspace,
programme or transaction). The points-expiry fix (7538c254) had made batch ids stable on one device only: two devices
deriving the same new batch still minted two ids. Exchange gain/loss pairs and the ledger's post/void audit lines are
named too.

### 3.4 The household seat

- A device runs household sync only for relay books whose seat is itself: `SyncService.refresh` (`sync-service.ts:337`)
  and `prepare`/`checkRestore` (`:267-290`, `engine.ts:1883`) skip the others. **Without this, a linked device would see
  the copied `shared_books` rows, find no key that opens, flip them to `needs_invite` and clear the outbox, and the
  self channel would carry that back to the seat: the "sharing went Off" incident again.**
- At link, the linking device becomes or stays the seat of every relay book it holds (no row in `household_seats` = it).
- **Standby**: after a join, the seat sends the new device, inside the self channel, a same-member invite for each
  relay book where its member may invite (owner); the new device claims it with a new `claimStandby` (claim, keep its
  epoch keys device-only, append its signed introduction; it writes no household table). Rotations then seal for it.
  Where the seat's member is not an owner (the husband's own devices), no standby: a takeover needs an owner's invite
  (today's "Ask an owner to link a new device").
- **Until Drop 6**, a write to a shared workspace on a non-seat is refused like a read-only book (`capture.ts:68`):
  "Rumah is changed on iPhone, which keeps it shared with Sari."
- **Drop 6**: on the seat, self apply of a row in a shared book's scope is fed to household capture (same entity
  snapshot as `withCapture`; ledger rows mark their lineage like `capturePostedTx`). The non-seat checks the same
  authority rules before saving (read-only, frozen, member limits), reading the replicated `sync_authority`. A refusal
  that still happens on the seat (a race) keeps the row on both own devices, is not sent, and is listed on the Share
  page.

### 3.5 Linking: code, QR, Allow

- New relay endpoints, mirrored in `MemoryTransport` (the relay ports it check for check, `book.ts:5-9`):
  `POST /links` (signed by the source; 6-digit code, **10 minutes**, at most 5 wrong tries then the code is burned),
  `POST /links/claim` (new device: code + its public keys), `GET /links/:id` (source polls). Invites today last 7 days
  and are 52 characters (`invite.ts:12,18`); neither fits.
- Six digits are a meeting point, not a secret the relay cannot guess. So: the source asks **"Link MacBook Air?"** and
  both screens show the same **4-digit check** derived from both devices' keys (commit-then-reveal, so the relay cannot
  pick keys that match); Allow only if they match (owner question 2). The QR carries a 32-byte secret instead and needs
  no check.
- After Allow: the source adds the device to the self relay book (creating it on the first link, owners = every own
  device), seals the self epoch keys for the new device's agreement key (HS §5.3), and starts the snapshot (§4).
- Who may join: a device **with no linked devices** and **no live household or event share the source lacks**. "This
  iPhone shares Rumah with Sari, so it shows a code instead of typing one." This is what keeps a seat from ever being
  replaced by mistake.

**As built (Drop 2).**
- *Meeting place* (`packages/db/src/self/link-hub.ts`): one implementation, used by `MemoryTransport` (a map) and by
  the Worker (one `LinkObject` Durable Object, migration `v2`). Endpoints: `POST /links` (source, own key), `POST
  /links/claim` (new device, own key: code, keys, commitment), `GET /links/:id`, `POST /links/:id/reveal | allow |
  decline` (parties only, checked against the key the session holds; anyone else gets 404). A code is 6 digits, unique
  among open sessions, 10 minutes, claimed once (then it is free again).
- *Five tries*: six digits cannot say which session a wrong code was aimed at, so **every wrong code counts against
  every session open at that moment, and a session that has seen five is burned** (the source shows "try again" and a
  new code); one device may try five wrong codes in ten minutes (429 after). An attacker gets 5 in 1,000,000 at a code,
  and even a hit only reaches the Allow screen, whose digits will not match.
- *Check digits* (`link-crypto.ts`): the new device sends sha-256 of its nonce with its claim; the source reveals its
  nonce only after that; the new device reveals its own (with its name, sealed for the source's key — the relay never
  reads a device name) only after the source's. Digits = sha-256 over both devices' keys and both nonces, mod 10,000.
  The source checks the revealed nonce against the commitment and ends the link if they differ.
- **Design change: the square code carries the same 6 digits** (`cicis://link#482719`), a convenience for a camera, not
  a 32-byte secret. Both ways rest on the check digits and Allow (owner answer 2), so there is one path to get right.
- *Allow*: the source puts an ordinary signed invite on the group's book (its keys sealed with a fresh secret) and leaves
  `{ relayBookId, inviteId, secret }` in the session sealed for the new device's key. The new device claims the invite:
  on a self book the relay makes every claiming device an owner (so any device can unlink any other) and answers the
  log's seq at the claim, where its reading starts.
- *Engine* (`self/engine.ts`, `SelfEngine`): `startLinking / checkLinking / allowLinking / declineLinking` (source),
  `joinWithCode / checkJoining` (new device; refused on a device that already holds a group — linked, or showing a code
  itself), `sync` (collect, pull → apply → send → pull, ack; a hold stops at that entry; `403 removed` → unlinked),
  `unlink(device)` (signed removal, relay drop, new epoch sealed for every device still in `self_devices`), `devices()`,
  and `uploadCopy / downloadCopy / deleteCopy` (the copy sealed under a one-off key, blobs of 700 KB, 24 hours, each
  checked against its hash and the whole against its sha-256).
- *Tables* (migration `0126`, unreleased, amended): device-only `self_group` (relay book, epoch, cursor, `active` |
  `unlinked`); replicated `self_devices` (each device writes its own row: name, kind, keys, app version, last synced —
  at most every 5 minutes; `removed_at` set by the device that unlinked it).
- *Change-sets* are cut into parts of at most 48 KB of JSON, each under its own clock, so any part fits a 128 KB log
  entry even if nothing compresses.

## 4. Replace on join

### 4.1 Source (linking device): read only

1. Export the database under the DB mutex (`database.ts:82`, `exportBytes`): a consistent copy. Record `S` = its self
   cursor at that moment; its self outbox at that moment goes out later with seq > S, which the joiner applies over the
   copy without effect (same clocks).
2. Seal the bytes with a one-off transfer key (sealed for the joiner) and upload as ≤1 MB blobs. Tell the joiner
   `{ S, blob hashes, schema, per-workspace counts }` in a self entry.
3. The relay sets the joiner's pruning mark to `S` at claim, so nothing after `S` is pruned before the joiner reads it.

The source never applies anything from the joiner's old data: no message in the protocol carries it, and the joiner's
self outbox starts empty after the replace. **Proof test**: dump of the source (every table but self bookkeeping) is
byte-identical before and after a join, including joins killed at each step below.

### 4.2 Joiner (new device)

| Step | What | If it stops here |
|---|---|---|
| 0 | Checks: same or newer app (else "Update cicis on this Mac first"), the §3.5 join rules, enough free space for copy + backup | nothing changed |
| 1 | Download and open the blobs into memory; check it is a whole database (`snapshots.ts` header check) | nothing changed; try again (blobs kept 24 h) |
| 2 | **Backup file** of this device's data to Downloads (`exportBytes` + `saveBytes`, as `BackupPage.tsx:58-64`) **and** a `before-restore` safety copy (`snapshots.ts:552-620`); photos held from the sweep (`photos/hold-before-restore.ts`), else refuse | nothing replaced; the backup file exists |
| 3 | Stop all sync (`whileReplacing`, `sync-service.ts:641`); import marker down; `restoreBytes` (`salvage.ts:106`) | the existing import marker puts the safety copy back at next launch |
| 4 | Before anything else opens: delete device-only rows (§2.1), write `self_group`, `self_cursor = S`, clear `expanses.dev-sample-loaded` | re-run at next launch (marker stays until done) |
| 5 | Reload; pull the self log from `S`; then photos (Drop 4) | ordinary sync; resumes |

The device's own household devices for books the source also holds stay valid as standby (same keys, already pinned in
the copied `book_devices`). Books only the joiner had are refused at step 0, never dropped silently.

## 5. Edge cases

- **Unlink** (Devices › a device › Unlink…): signed removal + relay drop + rotation (`engine.ts:1010-1088` as is, owners
  = all own devices). The data on the other devices stays. If it was the seat, the unlinking device takes over each
  book it is standby in: whole-log pull with the replicated bookkeeping, `emitNewerTx` (`seed.ts:558`, sends what the
  lost seat never sent), then removes the lost device from each household book and rotates. Books with no standby show
  today's "needs a new invite".
- **Lost device that comes back**: its next call gets `403 removed` (HS §8.4); it stops syncing, keeps its data and
  shows "Unlinked from this data" (owner answer 3: nothing erased by itself; erasing is a manual action). Its offline edits after the removal are refused by the others (ruling I2).
- **Two links at once**: each code is one-shot and one device; two new devices can join one group in parallel. Two
  devices typing each other's codes cannot happen: a device showing a code cannot join, and a device with a linked
  device cannot join.
- **Offline device**: queues in `self_outbox`; the relay keeps entries until every active device has read them. Devices
  shows "synced 3 days ago". Column-level clocks merge its edits; rules 2–5 settle the rest.
- **Restoring a backup on a linked device**: it would roll its clocks back. Detected at open (self bookkeeping does not
  match this device or the cursor went back, like `checkBook`); the device stops syncing and says "This Mac was put
  back from a backup. Link it again to bring it up to date." Its restored data is kept until the owner links again.
- **Older app versions**: rule 6 for the self channel; household gates unchanged (only the seat writes; standby
  devices report their version at claim and hold gates back like any device until updated). iPhone and Mac builds share
  `MARKETING_VERSION`, so they should go to TestFlight together.
- **Currency**: no rule for the self channel (the whole DB moves). `assertShareableTx` (`seed.ts:96-107`) is unchanged
  for households.
- **Relay limits and cost** (as built in Drop 2: blobs of at most 700 KB each so a request stays under 1 MB, 256 MB per
  book, kept a week at most — the copy 24 hours; a self book is pruned below the lowest ack of its active devices and a
  pull from before that is `410 pruned`; a household book is never pruned): 5 active devices per relay book (`book.ts:20,192`) counts standby devices, so owner 3 +
  husband 2 fills Rumah; 128 KB per entry (`book.ts:19,138`); 1 MB per request (`index.ts:19`); 500 entries per pull
  (`book.ts:21,158`); the log is never pruned today (`book.ts:13-17`). New: blob store (snapshot deleted after the
  join, photos after every device has them) and pruning of the self log below the lowest device mark. Cost on Durable
  Objects is pennies per user per month; the snapshot is the only large write. `verifyEntitlement` (`entitlement.ts`)
  is the hook if linking becomes a paid feature.
- **Keys on Mac Catalyst**: `NativeKeyStore` (keychain, this device only, `key-store.ts:123-157`). The local "Sign to
  Run Locally" Mac app has no provisioning profile (`feat/mac-catalyst:apps/web/ios/mac/App.mac-local.entitlements`)
  and no keychain or iCloud (memory "Mac app"): **linking only works in the TestFlight/App Store Mac build**. Devices
  shows "Linking needs the App Store or TestFlight version of cicis" when keys cannot be made. The local app's container
  (sample household + test rows) is the same one the TestFlight app uses, which is exactly the replace-on-join case.

## 6. Build plan

Tests use two or three in-memory devices (`MemoryTransport`, `MemoryKeyStore`) and invented data only.

| Drop | What | Tests | Needs |
|---|---|---|---|
| 0 | Sorting and determinism, no visible change: `SELF_TABLES` / settings-key classification; deterministic ids for automatic writers | every table/key sorted; "upkeep and automatic jobs on two copies of one DB → equal dumps" (the gate) | both (one web bundle) |
| 1 | Self capture + apply in `packages/db`, no relay: triggers, flush, six rules, version hold | property test: random writes on two devices, exchanged in random order → equal dumps; one test per rule; every repo write emits a self change | both |
| 2 | Self relay book + link: `/links` endpoints, check digits, blobs, pruning; Devices list rows | relay ↔ MemoryTransport parity; wrong code ×5 burns it; relay cannot pass a key swap; unlink rotates | both |
| 3 | **Replace on join + Devices screens + seat rule** + the meaning-carrying localStorage keys moved into `settings` (moved here from Drop 0: they need the screens that read them made async, and nothing replicates before linking is live) (phone Account › Devices; Mac Settings › Devices; progress per workspace; shared workspaces view-only off-seat). First owner test. | source dump unchanged; kill at each §4.2 step; refused joins; non-seat never runs household code; Playwright: two browser contexts on the local relay | iPhone TestFlight (shows the code) + Mac TestFlight (types it) |
| 4 | Photos and draft pictures as blobs, after the figures; sweep-safe | photo on phone appears on Mac; sweep keeps held photos; big library resumes | both |
| 5 | Standby + takeover on Unlink | phone (seat) + Mac (standby) + husband: phone lost with unsent household changes → Mac takes over → husband's copy equals Mac's; husband's DB never holds a row outside scope | iPhone mainly (it is the seat) |
| 6 | Editing shared workspaces on a non-seat (capture adapter) | capture parity: every capture-harness write made on the Mac gives the same household ops as on the seat; race refusal listed | Mac mainly |

The owner should link for real (her phone with Rumah) only from Drop 5: before it, losing the phone means sharing Rumah
again with today's resilience flows.

### 6.1 Drops 3–6 as built (2026-11-21)

- **Drop 3** — Allow syncs, exports and uploads the copy; the invite carries `startSeq` and the relay holds the log after
  it until the new device claims. The new device saves a backup file (Downloads / share sheet), keeps a safety copy,
  holds its photos, keeps the plan in localStorage and replaces its data (`restoreSnapshot`); the next open's
  `SelfService.prepare` runs `completeLinkedCopy` before household sharing starts. A copy that never arrived is
  refused and the data left as it is ("Linking did not finish"). Seat = `settings 'self.seat'` (the device that made
  the group); elsewhere, `SyncService` never runs and capture sends nothing to the household. Devices screens per the
  two mockups (2026-11-19, 2026-11-21 — rendered and checked before building). Seven localStorage choices are mirrored
  into `settings` (`pref.*`). No QR yet: the app has no camera scanner (the code is typed); device names are the
  device's kind (iPhone, iPad, Mac) — no plugin reads a device's own name.
- **Drop 4** — receipt photos (`self_photos`, `self_photo_have`): sent as sealed blobs after the figures, fetched by
  devices that lack them, let go when every linked device holds them, sent again for a device linked later or away
  more than a week. Draft pictures (the iPhone's capture folder) stay on the device that read them.
- **Drop 5** — standby: the seat invites the other linked devices into each workspace it shares as an owner
  (`self_standby`); each claims (`SyncEngine.claimStandby`: keys, introduction, nothing of the seat's bookkeeping
  written). Unlink of the seat from another device makes it the seat and runs `takeOverAsSeat` (whole log again, the
  lost seat's unsent changes out, the lost device removed and the key rotated). Not covered: net-worth group logs and
  shared events' books (they follow their own rules; after a takeover they need an invite as today), and the
  husband's own linked devices (his seat is not an owner, so no standby: an owner invites, as today).
- **Drop 6** — on the seat, what another linked device changed in a shared workspace is applied inside household
  capture (entity rows by `withCapture`, purchases by the ledger's capture doors) and goes to the household; a change
  the household refuses (read-only, frozen, owner-only) is kept on every owner device and said in Activity ("A change
  made on another device was not shared"); while the seat's sharing is not ready the change waits (held). The
  view-only notice became "Shared through the iPhone — changes made here reach them once the iPhone has synced".

### 6.2 Code review fixes (2026-11-21)

- **Welcome signed, versioned.** The source signs `{v, sessionId, joinerId, welcome}` with the key the check digits
  covered; the new device verifies it against `view.source.signJwk` before it claims anything. The welcome carries the
  source's data version (`schema`) and app version: a newer copy is refused before any claim or replace ("Update cicis
  on this device first", `NEWER_SOURCE`).
- **Backup always.** The new device saves its backup file before linking unless it holds nothing of the owner's
  (`heldHere().empty`: no transaction of any status, no asset/liability account, one workspace at most); nothing starts
  until that is known, and a failed save stops the link.
- **No ghost device.** `SelfService.takeCopy` holds the photos, then keeps the plan, then replaces. A step that fails
  before the replace took forgets the plan and takes the device off the relay book (`abandonJoin`); so does an open
  that finds the plan but not the copy. The source records `joining:<id>` on Allow and, three days on without that
  device's row (`UNFINISHED_JOIN_MS`), takes it off the relay itself. An unlinked device's old data is never the copy.
- **Unlinked.** Capture triggers removed, `self_pending`/`self_outbox` cleared, `seatIsElsewhere` false (the data is
  its own again); the seat takes it out of every shared workspace it stood by in (`standbyGone`); Devices offers
  "Link to another device" again.
- **A copy not yet made its own** (`joinOutcome: 'incomplete'`): the link channel refuses to run and household sharing
  is held off (`SyncService.holdOff`; a write into a shared workspace refuses) until an open finishes it.
- **Relay.** Blobs: a small index `blobs` of `[size, expiresAt]` (≤ 1000 blobs a book), never a listing of the data;
  household books hold none (400). Link meeting place: wrong codes count by device (5) and by network address
  (CF-Connecting-IP, IPv6 by /64: 20) per 10 minutes and never end anyone's session; one waiting code a device, ten new
  codes an address per 10 minutes, 500 sessions in all; tries kept in one pruned value.
- **Before Allow** the source says what goes: N workspaces, N transactions.
- **Second review.** Both sides pin the other's keys exactly as they fed the check digits on the first confirm: a
  later view with other keys ends the link (`mismatch`); the joiner verifies the welcome against the pinned key, and
  the source seals the welcome for the pinned joiner. Re-linking clears `self_devices.removed_at` (on Allow, and in the
  device's own row). Standby removals go one at a time (a 404 is done). `planWaitsHere` throws on a failed read, so a
  plan is dropped only on a clean "not the copy"; a failed read at open is 'incomplete'. `UNFINISHED_JOIN_MS` is 14
  days: the joiner's row is the only sign of life the source sees, and a finished device taken off is told "Unlinked
  from this data" and offered Link to another device.

## 7. Risks

1. **Automatic writers** that make rows with fresh random ids, or caches that are not pure, would double or unbalance
   figures across devices (points re-derive, fx pairs). Drop 0 exists for this and its two-copies test runs in CI.
2. **The seat boundary**: any household code running on a non-seat over copied bookkeeping breaks sharing for both
   phones. Seat-owned tables are written only by the seat, apply refuses them from others, a test asserts it.
3. **Generic merge of a double-entry ledger**: replace forks, unique clashes and FK order across split change-sets must
   never stall or unbalance. Rules 3–5 plus the property test; a clash never deletes money rows (rule 5); any hold is shown, never silent.

Also: 6-digit code strength (check digits), self log growth (pruning), 5-device cap with standby, Mac keychain only in
TestFlight builds.

## 8. Owner questions (answered 2026-11-20)

1. Shared workspaces view-only on non-seat devices until Drop 6? **Yes.**
2. An Allow step on the linking device, with the same 4 check digits on both screens? **Yes.**
3. A lost device that was unlinked and comes back: **(a)** it stops syncing and shows "Unlinked from this data";
   nothing is erased by itself. Erasing it is a manual action on that device.

Also: the macOS platform is now added in App Store Connect, so Mac TestFlight builds are possible for Drop 3.

## Appendix A. Tables household sharing never moves (111 of 159)

asset_acquired, asset_profiles, asset_sales, audit_log, bond_coupons, book_category_sets, book_epoch_keys,
book_member_accounts, broker_fees, budget_income_overrides, budget_settings, calculator_inputs, capture_settings,
capture_skipped, capture_sources, card_fee_refunds, card_fee_waived_years, card_fee_waivers, card_identity,
card_installments, card_postings, card_settlements, card_statement_settings, card_terms, cards,
catalog_category_choices, category_mccs, category_set_members, category_sets, cycle_actuals, cycle_bonuses,
debt_profiles, deposit_automation, deposit_events, deposit_terms, draft_transactions, earn_rules, earns_into,
event_books, event_category_accounts, event_currency, event_item_currency, event_item_purchases, event_items,
event_log_currency, event_postings, events, fx_day_values, fx_gain_loss, fx_lot_uses, fx_rates, fx_recalc_pending,
fx_shortfalls, goal_contributions, goal_draws, goal_due_months, goal_dues, goal_earmarks, goal_share_log,
gold_price_choices, holding_links, income_sources, investment_trades, loan_items, loan_rate_periods, loan_terms,
member_transfer_accounts, member_transfer_postings, member_transfer_unposted, merchant_mccs, nw_group_books,
nw_item_map, nw_joint_accounts, nw_sent, nw_share_settings, point_entries, point_programmes, point_snapshots, prices,
redemption_options, reward_programs, securities, security_price_choices, security_prices, settings, shared_books,
sinking_fund_entries, sinking_funds, statement_checks, statement_links, sync_authority, sync_authority_devices,
sync_cursor, sync_field_clocks, sync_invites_used, sync_kept_clocks, sync_lineage, sync_lineage_last, sync_outbox,
sync_skipped, sync_tombstones, tax_year_reports, tax_year_rows, trade_goal_parts, trade_templates, transaction_photos,
transaction_point_actuals, transfer_partners, valuations, workspace_members, workspaces.

Of the 48 that do move, `accounts`, `transactions` and `entries` move only in part (categories; purchases in a shared
book, without the money side of own purchases).
