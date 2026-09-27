# Household sharing — review of design v2

Reviewed: `2026-09-26-household-sharing-design.md` (draft v2) on `docs/household-sharing`, 2026-09-27.
Checked against the code at `445a655` (the branch is level with `main`).

## Verdict

**Not ready to build.** The decisions in §1 are sound and the cryptography is mostly sound. The design disagrees with
the ledger code in ways that break the merge model, and four parts of the key and invite flow cannot work as
written. There are 7 blockers, 9 major findings and 9 minor ones.

Recommended order of work:

1. Resolve B1 first. It reshapes §4.3, §6 and §7.
2. Resolve B2 and B6 together. Both ask how a joiner gets the whole book, and the answer may bring snapshots back
   from the dropped list in §0.
3. Fix B3, B4, B5 and B7, which are local changes to §5 and §8.
4. Correct `SHARED_TABLES` and the field rules (major findings 1 to 6) before step 1 of the build order starts.

## Blockers

### B1. The ledger is void-and-replace; the design assumes edits in place

`packages/db/src/repos/ledger.ts:263` says: "Edit = void the original and post the replacement atomically". No
repository runs `DELETE` or `UPDATE` on `entries`, and none runs `DELETE` on `transactions`. What the app calls
delete is `status = 'void'`.

Consequences for the design:

- Last-writer-wins per field never applies to a transaction, because an edit produces a new transaction id.
- Two devices that edit the same purchase offline both void T and post T′ and T″. Rule 5 ("duplicates are not
  conflicts") keeps both, so the purchase is counted twice.
- `applyMoney` step 1 (delete the existing entries) and the row delete in §7 do something the ledger never does.
- Tombstones are almost never used, because rows are voided, not deleted.

**Recommendation:** choose one of the two and write it into §4.3 and §7.

| Option | What it means | Cost |
|---|---|---|
| A. Sync a lineage id (recommended) | The synced entity is the root of the `replaces_transaction_id` chain. `money` and the other fields have clocks on the lineage. Applying a change voids the current head and posts a replacement, as the ledger does today. | A lineage lookup; the ledger and its audit trail stay untouched. |
| B. Edit in place in shared books | Shared books get a second write path that updates rows and entries directly. | Two ledger behaviours to test and maintain; integrity checks and card postings must accept mutation. |

### B2. A late joiner cannot read history after any rotation

§8.1 wraps only the current epoch key for the invite. The joiner then runs `pull(bookId, 0)` and receives entries
from older epochs that it cannot decrypt. "Skip and retry later" never resolves, because that key never arrives.
The cursor is also undefined when an entry is skipped: §7 advances `applied_seq` for each entry.

**Recommendation:** the invite wraps every epoch key the book has had, not only the current one. State that the
cursor does not advance past an entry that could not be decrypted. If snapshots return (see B6), a joiner needs
only the keys from the snapshot's epoch onwards.

### B3. Two rotations that race collide

Two devices can both mint epoch n+1 with different keys. `book_epoch_keys` has the primary key `(book_id, epoch)`,
so one overwrites the other. `rotation.test.ts` expects "two rotations racing both apply", and the design gives no
rule that makes this true.

**Recommendation:** the relay accepts a `rotation` entry only when its `epoch` equals the current epoch plus one,
and answers `409` otherwise. The device that lost pulls, then rotates again to n+2 if its removal still needs it.

### B4. On Leave, the leaving device mints the new key

§8.4 step 2 runs on the device that removes. For **Leave** that is the departing device, which then knows the key
for epoch n+1.

**Recommendation:** removal and rotation are separate. The relay records the removal; the next remaining device
that pulls sees it and rotates. Until then, writes continue under epoch n, which the departed device can no longer
pull.

### B5. A synchronizable keychain item clones the device identity

§5.1 marks the keychain item as synchronizable. An iPhone and an iPad on one Apple ID then hold the same signing
key and the same `deviceId`. This breaks Link a device (§8.2), the HLC tiebreak and the removal of one device. It
also sends private keys to iCloud, which conflicts with the privacy stance of the app.

**Recommendation:** store the keys as device-only items (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). A
restored phone joins again by invite, which §5.1 already explains to the user.

### B6. There is no initial upload

`withCapture` sees only new writes. When a book with existing history is shared, the design never says that the
existing rows are sent. The joiner receives an empty book.

**Recommendation:** Share this workspace emits seed change-sets for every row in scope, in chunks (see major
finding 8), before the invite is shown. Add this to step 1 of the build order and to `convergence.property.test.ts`.

### B7. The join flow runs in an order that cannot work

- §11 shows the book's name and the inviter's name before **Join**. The relay holds no names, and nothing is
  fetched before the claim.
- The currency check in §8.3 runs after `claimInvite`, which has already used the invite and a device slot.
  "Nothing is stored" is true on the phone and false on the relay.

**Recommendation:** add `GET /invites/:id`, which returns a blob encrypted under `S` that holds the book name, the
inviter's name and the base currency. The joining device decrypts it, runs the currency check, shows the names,
and claims only when the person taps Join. The base currency then no longer needs to be in the clear on the relay.

## Major findings

| # | Finding | Evidence | Recommendation |
|---|---|---|---|
| 1 | The `bills` table does not exist. Bills are `expense_templates`, and `money_account_id` is `NOT NULL` and names the owner's account. | migration 0044; `expense_templates` schema | Name `expense_templates` in `SHARED_TABLES`. Apply the placeholder rule of §4.3 to `money_account_id`. |
| 2 | Budgets and bills have no `book_id`. Their book is found by joining their category to `book_categories`. | `budgets.ts:207`, `expense-templates.ts:169` | Write the scope rule per table as "rows whose category is in the book". |
| 3 | Composite keys. `bill_skips` has the key `(workspace_id, template_id, month)`, and `workspace_id` differs per device. `book_income_overrides` is missing from the list. | migrations 0041, 0042 | Define how `Op.id` encodes a composite key without `workspace_id`. Add `book_income_overrides`. |
| 4 | Every table has `workspace_id NOT NULL`. The design says it is never sent and does not say what apply writes. | all schemas | Apply stamps the local workspace id on every inserted row. |
| 5 | No list of which `transactions` columns sync. `card_id`, `goal_id`, `event_id`, `mcc`, `external_ref` and `replaces_transaction_id` are owner scope. `money` drops `entries.memo` and `spend_category_id`, and allows one asset entry. | `transactions` and `entries` schemas | Add an explicit list of synced columns per table. Say what happens to a split payment and to `memo`. |
| 6 | `books.kind = 'shared'` already exists as a label the user picks. §11 uses it as the sharing state. A joiner that receives a `'personal'` book makes the personal-book lookup ambiguous. | `books.ts:19`, `books.ts:83` | Sharing state comes from `shared_books` only. A joined book is never `'personal'` on the joiner. |
| 7 | The native shell is not on `main`. Capacitor is on `feat/ios-testflight`, which is not merged. Key storage on web and desktop is not defined, and `sharing.spec.ts` runs in browser contexts. | `git merge-base --is-ancestor feat/ios-testflight main` fails | Define a `KeyStore` interface with a web implementation (non-extractable `CryptoKey` in IndexedDB) and a native one. State the desktop plan. Make the merge of the native shell a precondition of step 2. |
| 8 | One change-set per database transaction means a CSV import is one very large entry. Durable Object values have a size limit. | §6.3, §9.3 | Cap the size of a change-set and split larger ones into several entries with consecutive HLCs. |
| 9 | The completeness test calls every exported function of 64 repositories. Each needs arguments written by hand. | §6.3 | In tests, put SQLite triggers on every `SHARED_TABLES` table that record each write, and fail when a write has no matching op. |

## Minor findings

- Cross-references are wrong: §4.2 and the table in §5 cite §5.3 for encryption at rest (it is §5.4); the title of
  §5.2 cites §8.5 for rotation (it is §8.4).
- The pseudocode in §7 writes columns before the line "if the row did not exist: insert it".
- The HLC has no limit on drift. One device with a clock in the future wins every field. Reject a change-set more
  than a fixed interval ahead of local time.
- Request authentication has no nonce, so a request can be replayed within 5 minutes. The relay should refuse a
  second entry with the same `(deviceId, hlc)`.
- Signatures are checked against public keys that the relay supplies. Pin each device's key from its `member`
  entry and from `book_devices`.
- The `member` log entry is plaintext, so the relay sees `deviceName`. §9.3 admits this; §12 should say it too.
- `SyncTransport.createBook` lacks `baseCurrency` and `deviceName`, which `POST /books` requires.
- A backup is an export of the whole database, so it contains `sync_*` and `shared_books`. After a restore on
  another device the shared books have keys that cannot be unwrapped. Define that state: mark them as needing a
  new invite.
- A member who edits the payer's purchase moves the payer's card statement and balance (§7). The design states
  this. It deserves an explicit yes from the user, because it changes owner-scope numbers from another phone.

## Confirmed correct

- Migration `0056` is the next free number. The latest is `0055`; `0052` does not exist.
- "5 of 64 repositories write `audit_log`" is exact: `workspaces`, `goal-funding`, `ledger`, `books`, `accounts`.
- Side tables only, with no new columns, matches the rule stated in `0042_books.sql`.
- The invite code length is right: 32 bytes in base32 is 52 characters.
- `database.transaction` takes an async callback (`packages/db/src/database.ts`), so WebCrypto can run before the
  commit.
- `fast-check` and Playwright are installed. Miniflare is not yet.

## Decisions needed from the owner

1. B1: lineage id (A) or edits in place (B).
2. B2 and B6: invite carries all epoch keys and the book is seeded by change-sets, or snapshots return.
3. B5: device-only keys, accepting that a restored phone joins again by invite.
4. Minor finding 9: whether a member may change a purchase that another member paid.
