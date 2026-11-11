# Sharing resilience: design

Date: 2026-11-11. Branch: `feat/sharing-resilience` (from `main` d880768e). Builds on `fix/sync-diagnostics` (build 110).

Background, read first:
- Feasibility study with file:line evidence: scratchpad `sharing-rejoin-study.md` (session 17ecd7cc).
- Household sharing design: `docs/superpowers/specs/2026-09-26-household-sharing-design.md` (§5 keys, §7 apply, §8.2 join, §8.4 leave, §8.5 frozen, §8.6 stop, §8.7 restore).
- Data-safety fix (build 108) and the background copy (main f8a26cc9).

## 1. The incident, and what it proved

The owner (sole Owner of workspace W) shared W with her husband (Member). Weeks later her phone's OPFS database was lost and came back from a copy that predates the share. What followed:

| What happened | Why (code) |
|---|---|
| Her phone showed sharing **Off**, no message. | Off = no `shared_books` row. Restores (`restoreSnapshot`, RecoveryScreen, BackupPage, iCloud runner) never look at sharing; `checkRestore` only looks at books that still have a row (`engine.ts:1247-1266`). |
| His phone stayed "active" and received nothing. | Her device is still an un-removed owner device in the log's view. Nobody writes. Partner status reads only his own last sync. |
| His Share row: "Sync now", no status text. | Fixed in build 110 (status line never empty). |
| He could do nothing about it. | He is a `member`: cannot invite, link, make owner, remove her device, stop, or keep as own (book not frozen). |
| She shared W again; the new share reached his phone **empty**. | The new share's seed sends purchases under lineage ids equal to transaction ids that already exist on his phone. `postTransactionTx(..., { id: op.id })` is a plain INSERT (`ledger.ts:422`), UNIQUE is not a skippable refusal (`apply.ts:976`), `guarded` rethrows (`apply.ts:1023`), the entry rolls back, the cursor never moves. |
| The epoch key and the relay book mapping were gone for good. | They live only in the database (`book_epoch_keys`, `shared_books`). The device keys live in the keychain (`key-store.ts:97-131`) and survived, but nothing outside the database said which relay book they belonged to. |

Note on the empty second copy: `copyHere` (`engine.ts:581-618`) refuses an invite whose `bookId` is already on the phone (`ALREADY_SHARED` / `STILL_SHARED`). His phone accepted the second share as a *new* book, so its book id is not the id of his first copy, yet its rows collide with his first copy's. The build 110 "Copy details" text from both phones settles which ids collided; the design below handles every case (same book id, other book id, live holder, deleted holder), so nothing in the cleanup depends on knowing it in advance.

## 2. Owner's requirements (binding)

R1. A shared workspace works as a **live backup**. If either phone loses or restores its database, Reconnect brings back **everything** in that workspace from the relay log, that device's **own** past entries included, onto the right accounts where possible. What cannot come back is defined (§6.6) and said plainly in the app.

R2. Self-reconnect needs **no help from the partner**. The app detects the loss **at start-up** and acts. It never sits silently Off.

R3. Data-loss prevention beyond sharing (§9): stop an update when no copy could be taken (with a way through), a kill-mid-save repro, a backup retention rule that always keeps the last copy before each sharing change and before each app update or migration, a clear Backup status on the Account page, and a check that unshared workspaces are covered by the backups. Nothing leaves the device unencrypted.

R4. A member can **delete** a joined copy completely, not only archive it. Delete erases what belongs only to that copy (§5).

R5. A member can change their own display name in a shared workspace (§10.2).

R6. Order: (A) join-collision fix + delete-that-erases + partner visibility + loss detection at start-up; (B) self-reconnect with full replay; (C) backup and data-safety hardening; (D) co-owner and rename. Each drop ships to TestFlight on its own.

The owner does not need this incident's lost data back.

## 3. What build 110 already does (not redone here)

From `fix/sync-diagnostics` (commits 283d27ee, 0bff0e39, plus work in progress in `.worktrees/sync-diag`):
- `sharingDiagnostics(database, bookId)` reads a book's sharing bookkeeping with or without its `shared_books` row (`packages/db/src/repos/sharing.ts`).
- A local sync log (`apps/web/src/sync/sync-log.ts`): every run, share, join, invite and action, with the relay id and the engine's status after.
- Share page **Details** and **Copy details** (`SyncDetailsPage.tsx`, `sync-details.ts`), status line never empty, inspectable web view on TestFlight.
- iCloud and local copy pruning **paused**; a confirm before restoring a copy that predates a share.

This design reuses the sync log for every new event (reconnect, held-elsewhere skips, erase, silence) and adds to Details; it does not change how the log is stored.

## 4. Drop A, part 1: joining never stalls on ids already here

### 4.1 Where colliding ids come from

Ids are uuidv7 made on the phone that created the row. A joining phone holds a row with the same id only when it holds an earlier copy of the same data:

| Holder on the joining phone | Example | Today |
|---|---|---|
| H1. Same book id, not live (left, stopped, removed, kept as own, needs_invite) | Rejoin after Leave | `copyHere` → rejoin. Purchases with no `sync_lineage` row here (a pre-share copy) hit the UNIQUE INSERT. |
| H2. Same book id, live | His first copy, when the new share keeps W's id | Refused `STILL_SHARED` before the claim. Fine. |
| H3. Deleted earlier (book row gone, rows voided, categories archived and taken out) | Member deleted a stale copy, owner shares again | Book is "new" here; purchases hit UNIQUE on the voided transactions; categories match by id and are updated **in place without being tagged into the new book** (`applyRowOp` `exists` path, `keyWhere` is id-only for `accounts`). |
| H4. Another book id, live or kept | The couple's case: his first copy beside the new share | Purchases: `lineageOf` (`apply.ts:443`) reads `sync_lineage` by `lineage_id` with **no book filter**, so a lineage of the old book would be edited in the new book's name; or UNIQUE on the INSERT. Categories: same as H3, but the holder is live. |
| H5. Own pre-share rows (the sharer's phone after a loss, rows never captured) | Her phone after Reconnect | Handled by Reconnect (§6.3: lineages pre-created). |

`sync_lineage.lineage_id` is a global primary key (`0056_household_sharing.sql`), so one lineage id can only ever belong to one book on a phone.

### 4.2 Decisions

D-A1. **Delete erases** (§5). A deleted copy leaves no rows behind, so H3 does not arise for anything deleted on the new build.

D-A2. **Purchase whose transaction id is taken, lineage not held: remap the local transaction id.** When apply posts a new lineage (no `sync_lineage` row) and `op.id` already exists in `transactions` (live in a non-shared book, voided, anything), it posts under a local id `remapId(bookId, lineageId)` = uuidv5 of `"remap:" + bookId + ":" + lineageId` (with `":2"`, `":3"` appended while that id is also taken) and writes `sync_lineage(lineage_id = op.id, head_transaction_id = <local id>)`. The holder row is not touched.
- Deterministic in the only sense that matters: **the shared state is the same on every device**. Transaction ids are already local (every replace gives the head a new id that is never sent; `lineageOfTransaction` looks up the head first, `capture.ts:1082-1093`). Peers never see the local id.
- No migration: every later capture of the purchase starts from a posted head, which `lineageOfTransaction` finds through `sync_lineage.head_transaction_id`. A voided remapped purchase has head NULL and is never captured again (void wins). A test edits and voids a remapped purchase on both phones (plan Task A3).

D-A3. **Lineage held by another book here: local skip, reported, never a stop.** When `sync_lineage` already has `op.id` under another `book_id` (H4), apply records a skip with error `HELD_ELSEWHERE: <other book id>` in `sync_skipped` and carries on. Same for a row entity keyed by its own id (category, budget, bill, goal, event rows) whose row exists here but is **in the scope of another book that still exists here** (live or kept).
- This is the one skip that depends on local rows, so it is kept apart from the deterministic ones: its error prefix is `HELD_ELSEWHERE`, it is never sent, and `sharingDiagnostics` counts it on its own.
- The status line says it, naming the other copy (§4.4). After that copy is deleted, **Place them now** pulls the log again from 0 (§4.3) and the rows land.
- Rejected alternatives: *adopt* the live holder into the new book (steals rows from a workspace still in use); *remap* row entities (every reference — a purchase's category lines, a bill's category, a stage's goal — would need translating both ways in capture and apply; too wide for a safety fix); *stall* (the incident).

D-A4. **Row held by a dead leftover: adopt.** A row keyed by its own id that exists here but is in the scope of **no** book that exists here (an old-build delete left an archived category with `workspace_id` cleared, a bill on it, …) is adopted: the log's fields win as for any existing row, and the row is filed into the joining book (`book_categories` tag, `workspace_id` set to the book's workspace, `archived_at` from the log). Children follow their parent's scope, so adopting a category adopts its budgets and bills. Shared state is again the same everywhere.

D-A5. **Lineage lookups are scoped by book.** `lineageOf` in apply reads `WHERE lineage_id = ? AND book_id = ?`; a lineage row of another book is D-A3, never an edit of it.

D-A6. **Same-book rejoin pre-creates lineages (H1).** In `joinBook`'s rejoin branch, before `catchUpTx`, every posted purchase filed in the book with no `sync_lineage` row gets one (the seed's `rowsInScopeTx(..., { record: true })` writes exactly these, `seed.ts:262-283`). The pull then finds the lineage and edits the local row in place. Rows the log never names go out after, as today (`emitNewerTx`).

D-A7. **A warning before joining beside another copy.** `previewInvite` adds `otherCopies: { bookId, name, state }[]`: books here whose `book_members` include the inviter's member id, or a member with the inviter's name and role owner, and that are not the invite's own book. The join screen then says "This phone also holds W (old) from Dewi. Rows that copy still holds are left out until it is deleted." with **Delete W (old) first** and **Join anyway**. A warning only; D-A3 keeps a join beside it safe.

### 4.3 Place them now

`engine.placeHeldRows(bookId)`: the same reset the rejoin does (`engine.ts:663-683`) on an active book, without a claim: clear `sync_skipped` rows whose error starts `HELD_ELSEWHERE`, cursor to 0, `clearAuthorityTx`, `catchUpTx`, pull with a `SeenLog`, `reconcileAllMembersTx`, `emitNewerTx`, drain. Offered only while the book has `HELD_ELSEWHERE` skips and none of their holders still exists. Idempotent: applying the log again over rows already applied changes nothing (equal clocks never win).

### 4.4 What the screens say

- Share row status line, while held skips exist and the holder exists: "Part of this share is held by W (old) on this phone. Delete that copy to bring it in."
- Once the holder is gone: "Part of this share is waiting. Place it now." → **Place them now**.
- Details (build 110) lists them: entity, id, holder book.

## 5. Drop A, part 2: Delete that erases

### 5.1 Rules

D-A8. **Delete is offered on a joined copy** (`books.kind = 'shared'`) once it is not active: `unshared` (left, stopped by its owner, removed), `needs_invite`, or `active` and frozen. From an `active` copy the action is **Leave and delete**, one confirm:
> Leave and delete Home?
> This phone leaves the share and Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone leave those accounts' balances. Dewi's copy is not changed. A safety copy is taken first.
> [Leave and delete] [Cancel]

- When the relay cannot be reached, Leave cannot happen: "Leaving needs a connection. Delete here only? The share will still list this phone until an owner removes it." → **Delete here only** (local `forgetSharing` semantics, then erase).
- The last owner cannot leave (existing `LastOwnerError`); the sheet says "Make someone else an owner first" and offers nothing else.

D-A9. **Delete erases instead of voiding** for every book that is or was shared: `kind = 'shared'`, a `shared_books` row in any state, a `sharing.member.<bookId>` remembered member, or any `sync_lineage` row with its `book_id`. A never-shared workspace keeps today's void behaviour (its ids live nowhere else, and the audit trail of a void has value there).
- Why erase for a once-shared workspace too: its ids live on in partners' copies and on the relay log. If the same workspace (or a partner's copy of it) is ever shared to this phone again, voided rows and archived categories are exactly the holders of §4.1 H3. Erasing removes the cause; D-A2/D-A4 stay as the safety net for copies deleted on older builds.
- The owner's path ("Stop sharing" or "Stop sharing on this device", then Delete) erases too, by the same rule.
- The `before-delete` safety copy is taken first (existing, screen side) and kept by the retention rule (§9.3), so a delete can be undone for 30 days by restoring that copy.

### 5.2 What "belongs only to that copy"

Erased, in one transaction:
1. **Transactions**: every transaction filed in the book (`book_transactions`, a split's part in `book_transaction_splits`, an entry on one of its categories) **and** every transaction whose lineage is the book's (`sync_lineage.book_id`, head or `sync_lineage_last`), whatever its status. With each: `entries`, `transaction_flags`, `bill_payments`, `transaction_line_excluded`, `book_transactions`, `book_transaction_splits`, attachment rows and receipt photos that only these transactions use, `transactions.replaces_transaction_id` chains (every row of the chain).
2. **Sync state**: `sync_lineage`, `sync_lineage_last`, `sync_outbox`, `sync_cursor`, `sync_field_clocks`, `sync_kept_clocks`, `sync_tombstones`, `sync_skipped`, `sync_authority`, `sync_authority_devices`, `sync_invites_used`, `book_epoch_keys`, `book_devices`, `book_members`, `shared_books`, settings `sharing.member.<id>` and `sharing.seen.<id>`, and the share record outside the database (§7).
3. **Placeholder accounts** in `book_member_accounts` for the book, and the mapping rows.
4. **Categories** tagged into the book (`book_categories`) that no other book tags; with their needs, colours, category settings, budgets, budget overrides, frequencies, shares, bills on them and bill windows, skips, pauses; category sets filed only in this book.
5. **Goals that came only through the share** (rows in the goal family scoped by this book's `goal_shares` whose `shared_by` is another member). This member's own goals stay: they became a private copy when the share ended (shared goals C15).
6. The book row, `book_budget_settings`, `book_income_overrides`, the active-book setting.

Never touched:
- Accounts that are not placeholders (bank, card, wallet, joint): kept. Their balances change only by the erased transactions, exactly as voiding changes them today.
- Any transaction with a line or a part in another book (refused as today: `SPLIT`).
- A category also tagged into another book (only the tag goes).
- Shared events (they have their own books); net-worth group logs are exited as today when the share ends.

How "only" is decided: by book scoping, never by guesswork on names. A row is erased if the only book that reaches it is this one: transactions by filing or lineage, categories by `book_categories`, placeholders by `book_member_accounts.book_id`, goals by `goal_shares`. The test fixture (plan Task A5) holds a Personal book with its own purchases from the same bank account, a category with the same name in Personal, a joint account, and a purchase split between Personal and the shared book, and asserts each survives.

### 5.3 Refusals that stay

`PERSONAL_BOOK`, `LAST_BOOK`, `SPLIT`. `IN_USE` (bills, event plans, drafts that use its categories) stays for a never-shared workspace; for a joined copy its own bills are erased with it, and a draft or event plan of this phone that names one of its categories refuses as today.

## 6. Drop B: Reconnect (self-reconnect with full replay)

### 6.1 The share record outside the database

D-B1. A **share record** per shared book lives next to the device keys, outside the database:
- Native: keychain item `cicis-keys.shares` (same prefix, same `afterFirstUnlockThisDeviceOnly`, iCloud sync off), a JSON array.
- Web: IndexedDB `cicis-keys`, new object store `shares` (database version 1 → 2), keyed by book id.

```ts
interface ShareRecord {
  v: 1;
  bookId: string;
  relayBookId: string;
  memberId: string;
  deviceId: string;          // this device's id when written; a record for another id is ignored
  role: 'owner' | 'member';  // as the view had it when written; informational
  bookName: string;
  bookKind: string;          // books.kind here ('workspace' | 'shared' | …)
  workspaceId: string;
  baseCurrency: string;
  epochKeys: { epoch: number; sealed: string }[];  // book_epoch_keys.key_sealed, byte for byte
  appliedSeq: number;        // this device's cursor when last written
  updatedAt: string;
}
```

- The epoch keys are stored **exactly as the database stores them**: sealed for this device's own agreement key (`AT_REST_INFO`). The record reveals nothing the database does not, and opens only with the keychain's own private key. Nothing leaves the device.
- Written by the engine on `shareBook`, `joinBook`, every new epoch key (`Sealer.storeEpochKeyTx` gains an `onStored` hook), `makeOwner`/role changes seen in a pull, and the cursor (coalesced: at most every 30 s, and on app hide).
- **Backfill**: at the first open of the build, every `active` book whose keys open gets its record. Shares made on older builds are covered from then on.
- Removed when this device's share ends knowingly: `stopSharing`, `forgetSharing`, `leave`, a `410`, a `403 removed`, and Delete (§5).
- Size: a few hundred bytes per book per epoch. Keychain writes are small and local.

D-B2. Limits stated plainly in the spec and the help text: the record is **this phone only** (`ThisDeviceOnly`). A new phone, or a reinstall that loses the keychain, is a new device: it comes back through an owner's invite (§8.7 of the household design, which already replays everything because the old entries are not "own" there). If the lost phone was the **only owner's**, nobody can invite it back. That is why Drop D asks every share to have two owners.

### 6.2 Detection at start-up

`engine.checkShareRecords()` runs in `SyncService.prepare`, next to `checkRestore`, **before** its early return on "no shared books" (`sync-service.ts:167`). For each record of this device:

| Finding | Condition | Action |
|---|---|---|
| `ok` | `shared_books` active on the record's relay book, cursor ≥ record's `appliedSeq` | refresh the record |
| `behind` | active on the same relay book, cursor < `appliedSeq` | a restored copy taken after the share: **replay** from the copy's cursor with own entries (§6.4), automatically |
| `lost` | book here, and no `shared_books` row, or `needs_invite` on the same relay book with this device's keys, or another relay book that is not active | **Reconnect automatically** (§6.3) |
| `missing_book` | no book with that id here (fresh start, copy older than the workspace) | **offer** "Home was shared from this phone. Bring it back?" [Bring it back] [Not now] |
| `ended` | relay answers `410` | say "The share of Home has ended. The copy here stays as it is." Drop the record. |
| `removed` | relay answers `403 removed` | say "This phone was removed from the share of Home." Drop the record. |

D-B3. `lost` and `behind` act without asking (R2), because they put back what the user already had and never delete a local row; a notice says what happened: "Home was reconnected to its share. 214 changes came back from the log." (count from the result, not a sample in a placeholder). `missing_book` asks, because it creates a workspace the user may have meant to be rid of (a deliberate fresh start).

D-B4. When the relay cannot be reached at open, the finding is kept and the Share row says "Home lost its share on this phone. Reconnecting when online." with **Reconnect now**. The scheduler retries it like a sync.

### 6.3 Reconnect

`engine.reconnect(bookId, options)`, one path for `lost` and `missing_book`:
1. Read the record; check `deviceId` is this device and the sealed keys open with this device's agreement key (else `KEYS_UNREADABLE`).
2. Probe the relay with a signed pull of the book from the head (no apply). `410` → `ended`; `403 removed` → `removed`; this device not on the relay → `removed`.
3. In one transaction:
   - `missing_book`: insert the book row (record's id, name, kind, currency; into `options.ws` or the record's workspace if it still exists, else Personal's workspace).
   - Insert or replace `shared_books` (`active`, relay book, highest held epoch, member id).
   - Store every epoch key from the record (`ON CONFLICT DO NOTHING`).
   - Delete `sync_outbox`, `sync_skipped` for the book; cursor to 0; `clearAuthorityTx`.
   - Insert this device's own `book_devices` row if missing (public keys from the keychain; it is already in the log's view, so no introduction is written).
   - Pre-create lineages for local posted purchases with none (D-A6).
   - `catchUpTx`.
4. `pullAndApply` with a `SeenLog` and `replayOwn: { fromSeq: 0 }` (§6.4).
5. `reconcileAllMembersTx`, `emitNewerTx` (rows made here while disconnected go out whole), drain.
6. Write the record (fresh `appliedSeq`), log the run.

No relay change. No invite. No partner action.

### 6.4 Replaying this device's own entries

Today the pull skips applying own entries (`apply.ts:1429`, `if (!own) applyChangeSetTx`). After a loss, those entries are the only place the lost changes live.

D-B5. `pullAndApply(..., { replayOwn: { fromSeq } })`: an own **change** entry with `seq > fromSeq` is applied exactly as a peer's (`applyChangeSetTx`), after the same authority decisions; the own-only branches (goal link note, event put-backs, member reconcile) still run after it. Removals and rotations by this device are applied as today.
- Safe on rows already present: applying a change whose field clocks equal the local ones changes nothing (equal hlc never wins); purchases with a local head go through the in-place path.
- Used only by Reconnect, `behind` replay and `placeHeldRows`; the normal sync loop is unchanged.

### 6.5 Own purchases onto the right accounts

A purchase carries category lines, `paidBy`, `paidLabel` (the account name as the payer saw it, `"Name ···· 1234"` for a card, `"A + B"` for two) and `paidFrom` for a shared item, never a local account id. A replayed own purchase with no local head would land on this member's placeholder (`apply.ts:720-737`).

D-B6. When this member paid and no local head exists, apply looks for **exactly one** own account here (not a placeholder, not archived) whose display label equals `paidLabel` and whose currency is the line currency; for a card label it matches name and last four digits. One match: the money side goes on it. None or several: the placeholder, as today, and the purchase is listed under **Needs an account** (a filter on the workspace's transactions, reached from the reconnect notice). The choice is local only; the money side of an own purchase never travels, so peers are unaffected.

### 6.6 What cannot come back, said plainly

After Reconnect the notice has a "What could not come back" line, shown only when it applies:
- **Changes that never reached the share.** Anything recorded on this phone after its last sync before the loss. "Changes made on this phone after its last sync on 3 Nov could not come back."
- **Edits to old rows made after the copy and before the loss, in a copy taken before the share.** A pre-share copy has no field clocks, so the log's values win. Same sentence as above.
- **Rows deleted here after the copy** come back if the log still has them. "Deleted rows may be back: check the last days."
- **Own purchases on placeholder** (D-B6 no match): "12 purchases need their account." with a link.
- **Other workspaces** that were never shared: the copy is all there is. Pointed at the Backup status (§9.4).

### 6.7 Restore paths (requirement item 5)

Build 110 warns before restoring a copy that predates a share. If the user restores anyway (RecoveryScreen, BackupPage, iCloud runner), nothing new is needed in those callers: the next open runs `checkShareRecords`, the record is still in the keychain, and the book is `lost` (pre-share copy) or `behind` (post-share copy) and is reconnected or replayed. The 110 warning text gains one sentence: "Sharing reconnects by itself after the restore."

## 7. Drop A, part 3: the record is written from Drop A

Detection (R2) has to see a record that exists before the next loss. So Drop A ships the record store, the engine writes, the backfill and `checkShareRecords`; findings `lost`/`behind`/`missing_book` in Drop A show a plain line, "Home lost its share on this phone. Keep recording; the next update reconnects it." Drop B adds the action. A phone on Drop A that loses its database before Drop B is reconnected the day Drop B lands.

## 8. Drop A, part 4: the partner side tells the truth

### 8.1 Silence

What a phone knows about another member: the newest entry time heard from each of its devices (`recordDevicesSeen`, settings `sharing.seen.<bookId>`, from each pulled entry's hlc). That is the time of their last **change**, not of their last sync: the relay keeps no "last seen" and this design adds no relay change.

D-A10. `memberSilence(database, bookId, now)` returns, per other member with a device in the view, `lastChangeAt` (newest over their devices) and `silentDays`. The Share page:
- Members list rows: "Last change 12 Oct" for every other member.
- Status line, as a second line, when every device of an owner (or of the only other member) has been silent ≥ 7 days **and** this phone synced in the last hour (so the silence is theirs, not this phone's): "No changes from Dewi since 12 Oct."
- The words claim only what is known: a change, not a sync.

D-A11. **Keep as own copy when the owners have gone quiet.** `forgetSharing` (local only: the relay is not told) is also allowed on an active, unfrozen book when every owner device in the view has been silent ≥ 14 days and this phone synced within the last hour. Confirm:
> Keep Home as own copy?
> No changes from Dewi since 12 Oct. Home stops syncing on this phone and stays here with every row, editable. Dewi's phone is not told. Home can be shared again later.

Rejected: a "proved gone" signal. With Drop B an owner's phone that lost its database reconnects by itself, so "gone" is the rare case of a lost phone that cannot be invited back; a member keeping a copy is local and undoable (an owner can invite the member back as the same person).

Copy fix while here: "Keep as my own copy" (SharePage.tsx:298) becomes "Keep as own copy".

### 8.2 A share that disappears on the other side

With Drop B, the only way an owner's share vanishes without a `410` is a lost phone whose keychain is gone too. The partner then sees D-A10's line after 7 days and D-A11's way out after 14; with two owners (Drop D) the partner can instead remove the dead device and invite the new one.

## 9. Drop C: data-loss prevention beyond sharing

### 9.1 Stop an update when no copy could be taken

Today `takeSnapshot` (`open.ts:211-233`) is "never a gate": a failed `before-migration` copy is logged and the update runs.

D-C1. When there are migrations to run and the `before-migration` copy fails, the open **pauses** unless a whole copy (local or iCloud) taken after the database's last change exists. Screen:
> An update is ready, but no safety copy could be taken first.
> [reason from the error, e.g. not enough free space]
> [Try again] [Update without a copy]

"Update without a copy" asks once more ("If this update fails there is nothing to go back to.") and then runs. Nobody is kept from their data (the reason the gate was refused before); the update just no longer runs blind.

"After the last change" needs a persisted time: `total_changes()` (`worker.ts:119`, `background-copy.ts`) is per connection and starts at 0 on every open. So the background copier, which already compares the change count on every leave, also writes `cicis.lastChangeAt` (localStorage, a per-device convenience) whenever it sees the count moved. Missing or unreadable means "unknown", and unknown means the gate applies.

### 9.2 Kill-mid-save repro

D-C2. A Playwright test (`apps/web/e2e/kill-mid-save.spec.ts`) writes a burst of transactions and closes the page's context at random points inside the burst, 20 times, reopening each time. Assertions: the open never shows the recovery screen; `quick_check` is `ok`; every transaction whose save resolved before the kill is present; no 0-byte or partial safety copy is listed. If it fails, the failure gets its own fix task with the repro as its test. On device, the same is checked by hand (swipe the app away during a save), listed in the TestFlight checklist.

### 9.3 Retention after the pause

D-C3. Pruning is turned back on with these rules.

Local safety copies (`snapshot-policy.ts`), on top of today's `keepTwo` / `keepOne`:
- New reason `before-share-change`, taken before `shareBook`, `joinBook`, `leave`, `stopSharing`, `forgetSharing`, `reconnect`, and Delete of a shared copy (the existing `before-delete` covers Delete).
- **Pinned** copies, never the "newest survivor" and never pruned by `keepTwo` while pinned: the newest `before-share-change` copy, the newest `before-delete` copy, and the newest `before-migration` copy, each for 30 days after it was taken. At most 3 pinned; a newer copy of the same reason replaces the older pin.
- On the no-room path (`keepOne`) pins go too, newest kept, as today: a device that full is told so by `roomFor`.

iCloud copies (`names.ts`), on top of 7 backup-days / 14 copies:
- A copy is taken (`bigChange`) after every sharing change listed above and on the first open of a new app version.
- The file name gains an optional reason segment after the byte count (`_share`, `_update`); `parseName` (`names.ts:44`) accepts 6 parts (old) or 7 (new). An older build requires exactly 6 parts, so it returns null for a new name and skips it entirely (never lists, never prunes it), which is the safe direction; verified by a test on the old pattern.
- Pinned, per device: the newest `_share` copy and the newest `_update` copy, each for 30 days, outside the 14-copy count.

### 9.4 Backup status on the Account page

D-C4. Account page row **Backups**, one line: "Last copy 10 Nov, 21:40, in iCloud" (newest of local and iCloud, with where), opening a page:
- **On this phone**: newest whole local copy, time and size; pinned copies listed with why ("before sharing Home").
- **iCloud**: on or off; newest copy of this phone, time, size; "Encrypted before it leaves the phone."
- **Shared workspaces**: "Home is also kept in its share and reconnects by itself." for each active share with a record.
- **Not covered since the last copy**: workspaces with changes newer than the newest whole copy (§9.5). Hidden when empty.
- A warning tone (not red) when the newest copy is older than 3 days while there were changes, or iCloud is off and no local copy is newer than 3 days.

### 9.5 Unshared workspaces are covered

D-C5. Every copy (local and iCloud) is of the whole database, so every workspace is in it; there is no per-workspace backup to forget. Two checks make that visible rather than assumed:
- **Recency per workspace.** The status page compares, per book, the newest `transactions.created_at` of rows filed in it (transactions have no `updated_at`; a replace makes a new row, so `created_at` covers edits too) and the newest `audit_log.created_at` of its workspace, with the newest whole copy's `takenAt`. Books with a later change are listed under "Not covered since the last copy", shared books included (their log covers them, said beside the name).
- **Wholeness of the copy.** After each local or iCloud copy is written, the copier reads per-book counts of posted transactions from the bytes it just wrote (the read-only open the background copy already does for `quick_check`) and keeps them on this phone beside the copy's name (the local manifest entry for a local copy; for an iCloud copy, whose metadata lives only in its file name, a small localStorage map keyed by file name, pruned with the copies). The status page shows a copy as "whole" only when every book's count in it is at least the live count minus the transactions created after it. A copy that fails this is never shown as the last good copy and the next copy is taken at once.

### 9.6 Privacy

Unchanged and restated: iCloud copies are AES-256-GCM before they leave the phone, keys in the iCloud keychain per key id; local copies stay in OPFS; the share record holds only sealed keys; the relay sees only sealed entries. No new network path.

## 10. Drop D: co-owner and rename

### 10.1 Co-owner

`makeOwner` exists (owner only, `engine.ts:813-826`, UI under `MemberPage.tsx:107-111`).

D-D1. When an owner's phone applies the first introduction of a new member (or opens the Share page with a sole owner and another member with a device in), the Share page shows a card once per member:
> Make Fandri an owner too?
> With two owners, either phone can invite people and bring the other back if it is lost.
> [Make owner] [Not now]

"Not now" hides it for 30 days. The Members list keeps "Make owner" as today. A member's phone shows, on a sole-owner share: "Dewi is the only owner. If Dewi's phone is lost, only Dewi can bring it back." (no action; informative).

### 10.2 Rename self

D-D2. On the Share page Members list, this member's own row opens **Name** (single field, prefilled, no placeholder sample). Save writes a `member` upsert of `name` only through `withCapture` (so `makesMember` stays false, `authority.ts:29-33`), syncs soon, and updates the remembered name (`rememberName`, `SharingSection.tsx:23`) for future shares and joins.
- Only self. An owner renaming someone else is rejected: names are how people know who wrote what, and the authority rules already let only the member (or an owner, for role) write their row; keeping rename to self avoids an owner silently relabelling a partner.
- Engine: `renameSelf(bookId, name)`; refuses an empty or whitespace name (`NAME_REQUIRED`), trims, max 40 characters.
- A rename racing an owner's removal of the member stays dead (`NO_REVIVE`), on every device.
- Shared events: their people are `event_people` rows of each event's own book with their own writer rules; rename there is out of scope for this build and listed as a follow-up.

## 11. Cleanup for the couple, step by step (after Drop A is on both phones)

Before anything: on both phones, Share page → Details → Copy details, and keep the text (it records which ids collided and which book ids each copy has).

**Order (A6 and A8 reviews): join the new share first, then delete the old copy, then Place them now.** Deleting the old copy before joining, with Keep them in Personal on, moves his own purchases to Personal while the new share also brings them back, and counts them twice.

1. **Her phone (owner of the new, empty share):** Home → Share → **Stop sharing**. The relay deletes the second relay book. His empty copy goes "No longer shared by Dewi" on its next sync.
2. **His phone, the empty copy:** Workspace → **Delete**. It erases (§5). A safety copy is taken first.
3. **Her phone:** Home → Share → share again. Her phone remembers her member id from step 1, so she is the same person.
4. **Her phone:** the Members list still has Fandri from the second share (member rows stay after a stop). Open his row → **Link a device for Fandri**, so he joins as the same person rather than a second "Fandri". Send him the link.
5. **His phone: join first.** Open the link → Join. His first copy of Home is still here, so the warning (D-A7) names it ("Home · joined …") and says to join first. Rows that copy still holds are set aside (`HELD_ELSEWHERE`); the new copy's Share row says so.
6. **His phone, the first copy (still active on the old relay book): then delete.** Workspace → **Leave and delete** on the copy the sheet names as holding rows of the newer share. He leaves the old share and the copy is erased; his own purchases the new share carries are not kept in Personal (they come back through it). If he wants to keep anything else from it, export first; the before-delete safety copy is kept 30 days either way. The app then opens the new copy's Workspace page.
7. **His phone, the new copy: then Place them now.** Workspace → the Share row's **Place them now** (or Share → Place them now). A safety copy is taken first; the rows the old copy held come in.
8. **Her phone:** the co-owner card (Drop D) or Fandri's row → **Make owner**. Until Drop D ships, use Make owner on his row (it exists today).
9. Both phones: the status line reads "Up to date"; Details shows no `HELD_ELSEWHERE` skips.

If either phone is on Drop A but the other is not, wait: a pre-A phone still stalls on step 5.

**One-time cleanup of a stale copy whose owner device is gone** (any user, not just the couple): on the stale copy, after 14 days with no change from any owner, the Share page offers **Keep as own copy** (D-A11) or **Leave and delete** (D-A8). Leave works for a member whatever the owner's state, because the relay knows the member's device.

## 12. Tests

Two-phone db tests reuse `packages/db/test/sync/household.ts` (`Household`, `Device`, `MemoryTransport`). New helpers there:
- `Household.lose(d, backup?)`: the same device keys and share records, a database replaced by `backup` bytes or a fresh migrated one (the loss); returns the new `Device`.
- `Device.records: MemoryShareRecordStore` passed to the engine.

Per path (plan tasks name the files):
- Join collision: member deletes (erase) then rejoins a re-share: everything arrives, no skips, no stall. Member keeps the old copy (live holder): join completes, `HELD_ELSEWHERE` skips counted, status says so; Delete old copy; `placeHeldRows`: everything arrives. Voided leftovers from an old-build delete (written directly as the old code did): remap + adopt, everything arrives, the voided rows untouched. A remapped purchase edited and voided on both phones converges. Same-book rejoin of a pre-share copy: no UNIQUE.
- Erase: every table in §5.2 empty for the book; every "never touched" row intact (fixture listed in §5.2); a split refuses; balances of the bank account equal the Personal-only sum.
- Silence: thresholds at 6/7 days and 13/14 days; no line when this phone itself has not synced.
- Records: written on share, join, rotation; removed on stop, leave, 410, removed, delete; backfill; another device's record ignored.
- Reconnect: owner loses everything (fresh DB) → `missing_book` → Bring back → every row, own and partner's, equal to the partner's projection; owner restores a pre-share copy with post-copy local rows → auto reconnect, local rows go out, log's rows arrive, partner receives the local ones; member loses → same; `behind` replay after a post-share copy; relay `410` → `ended`; `403` → `removed`; own purchases matched to accounts by label, unmatched counted.
- Retention: pure-function tests for pins (local and iCloud names), old-pattern compatibility.
- Update gate: `openSafely` pauses when the copy fails and no newer copy exists; proceeds with "without a copy".
- Rename: arrives on the partner; crossing a removal stays dead.
- e2e (local relay Worker, `apps/web/e2e/sharing.spec.ts` style): member Leave and delete, owner re-shares, member joins, totals equal; wipe OPFS on one page while keeping IndexedDB `cicis-keys`, reload, Reconnect notice, totals equal; kill-mid-save.

## 13. Calls I made

1. Join collision: **remap** the local transaction id for purchases (safe, no migration), **adopt** dead leftovers, **skip-and-report** (`HELD_ELSEWHERE`) when another live or kept copy holds the row, plus **Place them now** after it is deleted. Never stall.
2. Lineage lookups in apply are scoped by book; a lineage of another book is never edited in this book's name.
3. Delete **erases** for any book that is or was shared (joined copy and owner's once-shared workspace alike); a never-shared workspace keeps void. Joined copy: Delete when not active, **Leave and delete** when active, **Delete here only** when offline.
4. The share record lives in the keychain / IndexedDB beside the device keys, epoch keys stored **sealed exactly as in the database**; this phone only; backfilled on first open.
5. Detection at start-up: `lost` and `behind` reconnect/replay **automatically** with a notice; `missing_book` **asks**.
6. Reconnect replays own entries (`replayOwn`) from 0; own purchases go onto an own account when exactly one matches the label, else placeholder + "Needs an account".
7. Partner silence is measured by **last change heard** (no relay change): line after 7 days; Keep as own copy allowed after 14 days of owner silence while this phone is syncing.
8. Detection ships in Drop A with an honest line; the Reconnect action in Drop B.
9. Update gate pauses only when no copy could be taken **and** no newer copy exists, with "Update without a copy" as a way through.
10. Retention: pins for the newest before-share-change, before-delete and before-migration copies (30 days, max 3 local); iCloud pins for the newest share and update copies (30 days) beyond the 14.
11. Co-owner: a one-time card on the owner's phone per new member; rename is **self only**; event people renaming is out of scope.

## 14. Questions only the owner can answer

1. Thresholds: "No changes from Dewi since …" after **7** days, Keep as own copy after **14**. Right for a household that may go a week without recording?
2. Reconnect without asking when the share is found missing at start-up (call 5). Acceptable, or always ask first?
3. Deleting a joined copy removes his own purchases in it from his own accounts' balances (the same as void does today). Acceptable, or should own purchases be kept, moved into Personal under new ids, before the erase?
4. Cleanup direction: his first copy holds more of the old history than her restored copy. The plan re-shares **her** copy (as decided); the alternative is he keeps his copy as own, shares it, and she joins. Confirm hers.
