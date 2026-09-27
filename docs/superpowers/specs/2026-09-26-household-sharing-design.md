# Household sharing — design

Status: draft v3 for review · 2026-09-27
Builds on: `2026-09-17-workspaces-design.md` §5.4, `2026-09-18-data-safety-design.md`.
Reviewed by: `2026-09-27-household-sharing-review.md` (v2). Every finding there is answered in §0.
Checked against the code at `725f284` (step 0): `2026-09-27-household-sharing-v3-check.md`. Each correction is listed
there by number, and each changed passage here says "(check #n)".

**Task 2, fix round 1** corrected four more things once real code exposed them: §6.1's receive rule was the wrong
half of standard HLC receive (kept only `ms`, not the counter too — a bug, not a design choice; see the task 2
fix report); §6.1 gained the counter-overflow rule (roll into `ms`) and the requirement that a split reserve its
hlcs before assigning any, so a later ordinary tick can't reuse one; §6.2 gained the same overflow rule and refuses
a single over-budget op outright rather than emitting it alone over 64 KB; §3/§9.1–9.3 correct the duplicate-append
contract to `200`, not `409` (`409` is only the rotation conflict) and the durable object's `seen` to a `Map` (of
seq), matching what actually answers a replay.

**Task 4 (apply, merge, seeding)** corrected these once apply ran against real ledgers: §4.3/§7.4 — a line in
another currency is posted with its carried `amountBaseMinor` as it is, never re-derived from a rounded rate, and
the rate the pair implies is units of base per *major* unit (the exponents differ: USD 2, IDR 0); §7.4 — the payer's
own accounts are kept only while `money.paidBy` is still this member, and the difference goes on the largest entry
*of each currency*; §4.4 — a bill's `payer` keeps a local account only while it is one of this device's own; §7.2/§7.3
— the tombstone ruling (a row keyed by anything but its own id comes back when made again later), existence-only
rows, rows whose uniqueness is wider than their id, and a parent that is gone; §6.4 — the harness watches only while
the book is shared, leaves apply's writes out, and counts drained and applied change-sets; §6.5 — joined books are
left out of the default-tree upkeep at app open. **Fix round 1:** §7.1 — apply skips only a refusal every
receiver makes alike and records it in `sync_skipped` (§4.2); anything else rolls the entry back and stops; §6.2/§7.2 —
a revivable row travels whole but names its changed fields (`Op.changed`), so rule 1 stays per field; §8.4 — a
removal stamps `device.removedAt`'s clock.

## 0. What v3 changed

v2 was written from the table definitions without reading the ledger's write path. The review read it. v3 is v2
corrected against the code at `445a655`.

| Finding | Answer in v3 |
|---|---|
| **B1** ledger is void-and-replace | The synced thing is a **purchase**, keyed by its **lineage id**; applying a change calls the ledger's own `post`, `replace` and `void` (§4.3, §7). Decided by the owner: option A. |
| **B2** late joiner cannot read old epochs | The invite wraps **every** epoch key the book has had (§8.1). The cursor never passes an entry it could not apply (§7.1). |
| **B3** racing rotations | The relay accepts a rotation only at `currentEpoch + 1`, else `409` (§8.4, §9.2). |
| **B4** leaver mints the key | Removal and rotation are separate acts; a **remaining** device rotates (§8.4). |
| **B5** synchronizable keychain | Keys are **device-only**. A restored or replaced phone rejoins by invite, always (§5.1). Decided by the owner. |
| **B6** no initial upload | **Share** seeds the log with every row in scope before the invite is shown (§6.5). Decided by the owner: seed, not snapshots. |
| **B7** join order | `GET /invites/:id` returns a preview encrypted under `S`; the currency check and the names come before the claim (§8.2). |
| **M1–M6** tables, scope, keys, columns, `kind` | §4.1 names real tables with a scope rule, a key encoding and a column list each. Sharing state is `shared_books` only. |
| **M7** shell not on `main` | `KeyStore` interface with a web and a native implementation (§5.2). Merging `feat/ios-testflight` is a precondition of step 2. |
| **M8** change-set size | Capped at 200 ops and 64 KB; larger writes split (§6.2). |
| **M9** completeness test | SQLite triggers in the test harness; the existing suite is the test (§6.4). |
| Minor: drift, replay, pinning, names on relay, restore, cross-refs, pseudocode order, `createBook` | §6.1, §9.1, §5.4, §9.3, §8.7, fixed throughout. |
| Minor 9: a member changes what the payer paid | **Yes, anything.** Decided by the owner. The history names who (§7.3). |

Still dropped from this build, each behind a named seam: photo sync, snapshots, log retention, R2, websocket push,
events, category sets, With shares, cross-currency books, entitlement verification, safety number, duplicate hint.

## 1. Purpose

Two people in one household record into one workspace, each paying from their own accounts, and both phones show
the same book with the same numbers, offline or not.

Decided with the owner: sharing is the **only** thing a server is for; the server **cannot read** anything; **no
accounts**; the middle is **a relay we run**; the **owner pays**, members join free; the merge is
**last-writer-wins per field, money as one atom, void wins, no conflict inbox**; any member may change anything in
the book.

Assumed: a small, trusting household (≤ 5 devices); offline recording untouched; Android is coming.

## 2. Glossary

| Word | Means |
|---|---|
| **workspace** (UI) / **book** (DB) | one `books` row; the unit of sharing |
| **owner scope** | everything keyed by `workspace_id` that is not in a book |
| **local workspace id** | this device's own `workspace_id`; it differs on every device and is never sent |
| **purchase** | one expense or income in a book, across all its corrections; identified by its **lineage id** |
| **lineage id** | the id of the first `transactions` row in a `replaces_transaction_id` chain |
| **head** | the one row of a lineage whose `status = 'posted'`, or none when the purchase is void |
| **device** | one install, identified by its signing public key |
| **member** | a person; one or more devices |
| **epoch** | one workspace key; rises by one at each rotation |

## 3. Truth and transport

Each device's local SQLite is the truth. The relay is an append-only log per book and a device allow-list.

```ts
interface SyncTransport {
  createBook(device: DevicePublic): Promise<{ bookId: string }>;
  append(bookId: string, entry: LogEntry): Promise<{ seq: number }>;          // duplicate (deviceId,hlc) -> 200, the original seq
  pull(bookId: string, since: number): Promise<{ entries: SequencedEntry[]; latest: number }>;
  putInvite(bookId: string, invite: InviteRecord): Promise<void>;
  previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }>;
  claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult>;
  removeDevice(bookId: string, deviceId: string): Promise<void>;
  setOwners(bookId: string, deviceIds: string[]): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
}
type DevicePublic = { signJwk: JsonWebKey; agreeJwk: JsonWebKey };
type Sealed = { iv: string; ct: string };                                     // base64url
```

Implementations: `MemoryTransport` (tests), `RelayTransport` (§9).

## 4. Data

### 4.1 What syncs — `SHARED_ENTITIES`

A constant in `packages/db/src/sync/shared-entities.ts`. One record per synced entity: its table, how a row is
found to be in a book, how its `Op.id` is built, and **exactly** which fields travel. Nothing outside this list is
ever sent. `workspace_id` is never sent; **apply stamps the local workspace id on every row it inserts**.

| Entity | Table | In the book when | `Op.id` | Fields that travel |
|---|---|---|---|---|
| `book` | `books` | `id = bookId` | `id` | `name`, `base_currency`, `count_events_in_budget`, `archived_at` |
| `category` | `accounts` | `id` is in `book_categories` for the book | `id` | `name`, `parent_id`, `kind`, `subtype`, `currency`, `icon`, `system_key`, `sort_order`, `archived_at` (check #1–3: there is no colour column) |
| `category_need` | `category_needs` | `category_account_id` is a category of the book | `category_account_id` | `need` (ruled O4) |
| `member` | `book_members` | `book_id = bookId` | `member_id` | `name`, `role`, `joined_at` |
| `device` | `book_devices` | `book_id = bookId` | `device_id` | `member_id`, `name`, `sign_jwk`, `agree_jwk`, `added_at`, `removed_at` |
| `budget` | `budgets` | `category_account_id` is a category of the book | `id` | `category_account_id`, `amount_minor` |
| `budget_override` | `budget_overrides` | its `budget_id` is in the book | `id` | `budget_id`, `month`, `amount_minor` |
| `budget_frequency` | `budget_frequencies` | its budget is in the book | `budget_id` | `frequency`, `amount_as_set_minor` (check #4) |
| `book_income` | `book_budget_settings` | `book_id = bookId` | `book_id` | `expected_income_minor` |
| `book_income_override` | `book_income_overrides` | `book_id = bookId` | `bookId + '\|' + month` | `amount_minor` |
| `bill` | `expense_templates` | `category_account_id` is a category of the book | `id` | `name`, `category_account_id`, `amount_minor`, `day_of_month`, `active`, `archived_at`, **`payer`** (§4.4) |
| `bill_window` | `bill_windows` | its `template_id` is in the book | `template_id` | `pay_by_day`, `starts_month` |
| `bill_skip` | `bill_skips` | its `template_id` is in the book | `templateId + '\|' + month` | (existence only) |
| `purchase` | `transactions` + `entries` + `book_transactions` + `transaction_flags` + `bill_payments` | the lineage's head is in `book_transactions` for the book (the ledger tags only a posting with an income or expense line; check #9) | **lineage id** | §4.3 |

`book_categories` and `book_transactions` are not entities. Apply writes a `book_categories` row whenever it inserts a
`category`. `postTransactionTx` writes `book_transactions` itself, from the categories' book (check #10).

**Local on insert.** Some columns are `NOT NULL` with no default and never travel: every `created_at`, the
`updated_at` of `budgets` and `book_budget_settings`, and `books.kind`. Apply writes a local value for them: now, and
`'shared'` for `books.kind`. Each record's `localOnInsert` names them (check #7).

**Composite keys** are joined with `|` in the column order shown, never including `workspace_id`.

**Never syncs:** transfers between asset accounts (they belong to no book); every owner-scope table; `settings`,
`fx_rates`; photos; `transactions.source`, `external_ref`, `event_id`, `card_id`, `goal_id`, `mcc`,
`replaces_transaction_id`, `created_at`; `entries.id`, `spend_category_id`, `fx_rate_to_base` (`amount_base_minor` travels inside `money`, ruled O2);
`books.kind`, `sort_order`, `created_at`; `accounts.valuation_mode`, `created_at`; every other `created_at` and
`updated_at` (check #8). `NEVER_SYNCED_COLUMNS` in the constant is the complete list.

Step 0 confirmed each row of this table against the code. `book_members` and `book_devices` come with migration
0056 (check #11). The constant is the truth, and its test fails when a synced table gains a column nobody has sorted.

### 4.2 New tables — migration `0056_household_sharing.sql`

Side tables only; no column is added to any existing table.

```sql
CREATE TABLE shared_books (
  book_id       TEXT PRIMARY KEY,
  relay_book_id TEXT NOT NULL,
  epoch         INTEGER NOT NULL,   -- the epoch this device writes under
  member_id     TEXT NOT NULL,      -- this device's member
  state         TEXT NOT NULL,      -- 'active' | 'needs_invite' | 'unshared'
  shared_at     TEXT NOT NULL
);
CREATE TABLE book_members (
  book_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL,               -- 'owner' | 'member'
  joined_at TEXT NOT NULL,
  PRIMARY KEY (book_id, member_id)
);
CREATE TABLE book_devices (
  book_id TEXT NOT NULL, device_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  sign_jwk TEXT NOT NULL, agree_jwk TEXT NOT NULL,     -- pinned public keys (§5.4)
  added_at TEXT NOT NULL, removed_at TEXT,
  PRIMARY KEY (book_id, device_id)
);
CREATE TABLE book_member_accounts (                     -- the hidden placeholder account per other member and currency
  account_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, member_id TEXT NOT NULL, currency TEXT NOT NULL,
  UNIQUE (book_id, member_id, currency)                 -- ruled O2
);
CREATE TABLE book_epoch_keys (
  book_id TEXT NOT NULL, epoch INTEGER NOT NULL, key_sealed TEXT NOT NULL,   -- §5.5
  PRIMARY KEY (book_id, epoch)
);
CREATE TABLE sync_lineage (                             -- purchase -> its current head
  lineage_id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
  head_transaction_id TEXT,                             -- NULL once void
  paid_by TEXT NOT NULL, paid_label TEXT NOT NULL
);
CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, hlc TEXT NOT NULL, entry_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sync_cursor (
  book_id TEXT PRIMARY KEY, applied_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_field_clocks (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (book_id, entity, id, field)
);
CREATE TABLE sync_tombstones (
  book_id TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (book_id, entity, id)
);
CREATE TABLE sync_skipped (                             -- task 4 fix round 1: an op apply refused, never silent (§7.1)
  book_id TEXT NOT NULL, seq INTEGER NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, error TEXT NOT NULL, at TEXT NOT NULL
);
```

**Sharing state is `shared_books`, never `books.kind`.** `kind` is a label the owner picked and stays whatever it
was on the owner's device. A joiner inserts the book with `kind = 'shared'`, so it is never the joiner's
`'personal'` book and `personalBook()` stays unambiguous.

### 4.3 A purchase

A purchase is a lineage. The ledger edits by voiding a row and posting its replacement
(`ledger.ts` — "Edit = void the original and post the replacement atomically"), so a purchase's row id changes at
every correction and its lineage id never does. `sync_lineage` maps one to the other.

Fields of a `purchase`, each with its own clock:

| Field | From | Type |
|---|---|---|
| `occurredOn` | `transactions.occurred_on` | `YYYY-MM-DD` |
| `description` | `transactions.description` | string |
| `channel` | `transaction_flags.channel` | `'online' \| 'offline' \| null` |
| `excluded` | `transaction_flags.excluded` | `0 \| 1` |
| `bill` | `transactions.template_id` + `bill_payments` (check #5) | `{ templateId, billMonth } \| null` |
| `money` | `entries` + two `transactions` columns | the atom below |
| `void` | `transactions.status` of the head | `true`, written once |

```ts
type Money = {
  lines: {                        // entries on income/expense accounts, signed as stored (check #6)
    categoryId: string;
    amountMinor: number;           // in `currency`
    currency: string;
    amountBaseMinor: number;       // the same line in the book's currency (ruled O2)
    memo: string | null;
  }[];
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  paidBy: string;      // member_id
  paidLabel: string;   // "BCA KrisFlyer ···· 1467"
};
```

The book's currency is every member's workspace base currency: §8.2 checks the joiner, and §6.5 refuses to share
a book whose currency is not the owner's (ruled O3). So on every device, `entries.amount_base_minor` is the line in
the book's currency, and a line in the book's currency has `fx_rate_to_base = 1` and needs no rate.

A line in **another currency** is possible, for example in history paid from a USD card before sharing. It carries
both figures: `amountMinor` in its `currency`, and `amountBaseMinor` (ruled O2). A receiver posts the line with its
carried `amountBaseMinor` **as it is** (task 4 correction): `PostingLine.amountBaseMinor` tells `planPosting` to keep
the figure and to put a currency's rounding difference only on a line that carries none. Re-deriving it from
`amountBaseMinor / amountMinor` (v3) used a rounded ratio, so a receiver's figure could be off by one minor unit from
the payer's, and the projections would never agree. `planPosting` balances each currency on its own, so the money side
takes one placeholder entry per currency (§4.4, §7.4); its base figure is derived with the rate the pair implies —
units of base per **major** unit, `|amountBaseMinor / amountMinor| × 10^(exp(currency) − exp(base))` (v3 left out the
exponents) — and takes the currency's difference, so the atom balances exactly. A zero amount never occurs (`planPosting`
refuses it), and a pair whose base is zero gives no rate (every line of that currency then carries its figure).

**Category side and money side.** An entry on an account whose `kind` is `income` or `expense` is a `line`. Every
other entry of the row is the **money side**. `paidLabel` is built on the payer's device from the money side: the
account's name, plus `' ···· ' + last4` when `transactions.card_id` names a card; with more than one money-side
account, the names joined by `' + '`.

### 4.4 Placeholder accounts, and the bill's payer

On a device that did not pay, the money side is posted against a **placeholder account** for the payer: one
`accounts` row per other member, per book and per currency — `kind = 'asset'`, `subtype = 'cash'`, `name` = the
member's name, `currency` = the currency of the lines it balances (the book's, nearly always) — with a
`book_member_accounts` row keyed `(book_id, member_id, currency)` (ruled O2). An asset account must have a currency
(`accounts` CHECK), so one placeholder cannot take them all. Created on first need.

Placeholder accounts are excluded from the Accounts page, Net worth, every Paid-with and Transfer picker, the tax
report, the health ratios, goal funding and idle cash. Their balance is never shown. Every other reader sees an
ordinary transaction.

The exclusion is one shared predicate, `notPlaceholder(column)` = `column NOT IN (SELECT account_id FROM
book_member_accounts)`, applied in each reader that lists asset accounts (check §3, fix round 1):

- `listAccounts` (`accounts.ts`), with an `includePlaceholders` opt-in for the receipt and the sync code. It feeds
  the Accounts page, the pickers, Net worth's money list and the tax report rows.
- `assetValuesAt` (`asset-values.ts`). It feeds `netWorthAt`, `sheetInputsAt` (the health ratios),
  `coretaxInputsFor`, goal funding and idle cash.
- `coretaxInputsFor`'s own account read (`tax-inputs.ts`).

`nativeBalances` keeps returning every account. Its consumers index it by accounts they listed through the readers
above, and none of them iterates its keys.

`expense_templates.money_account_id` is `NOT NULL` and names an owner's account. A `bill` therefore travels with
the field **`payer`** `= { memberId, label }` in place of the column. Apply writes `money_account_id` = the
existing local value when `memberId` is this device's member, the row already exists **and that value is one of this
device's own accounts, not a placeholder** (task 4 correction: otherwise a bill handed back to its first payer would
keep the other member's placeholder here and read as theirs); otherwise the placeholder account for `memberId`. That
includes this device's own member on a device that has no account of theirs for it — a second device of the same
person — which is why a placeholder can belong to this device's own member. The convergence test compares `payer` by
member only: the label is the paying device's account name and is kept nowhere on the others. A member who pays a bill someone else set up picks their own account in the form, which
changes `payer`.

In a shared book the add form draws the currency flag **disabled** and offers no **With** row.

## 5. Keys

All WebCrypto; no library added.

| Purpose | Algorithm |
|---|---|
| Device signing | ECDSA P-256 with SHA-256 |
| Device agreement | ECDH P-256 |
| Epoch key | AES-GCM, 256-bit, 32 random bytes |
| Derivation | HKDF-SHA-256 |

### 5.1 Device identity

Two key pairs generated at first launch. `deviceId = hex(SHA-256(raw public signing key))[0:32]`.

**Device-only.** Never synchronised, never in the database, never in a backup. A phone that is replaced, or
restored from a backup file, is a new device and rejoins every shared workspace by invite (§8.7). The Share screen
says so in one line.

### 5.2 `KeyStore`

```ts
interface KeyStore {
  getOrCreateDevice(): Promise<{ deviceId: string; sign: CryptoKeyPair; agree: CryptoKeyPair; public: DevicePublic }>;
  hasDevice(): Promise<boolean>;
}
```

| Implementation | Used by | Stores |
|---|---|---|
| `WebKeyStore` | browsers, Playwright, the desktop web build | **non-extractable** `CryptoKey` pairs in IndexedDB, database `cicis-keys` |
| `NativeKeyStore` | the Capacitor shell, iOS and later Android and Mac | JWK pairs in the platform keychain, iOS class `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` |

Chosen by `isNative()`. The native implementation needs the Capacitor shell, which is on `feat/ios-testflight` and
not on `main`: **merging that branch is a precondition of step 2.**

### 5.3 Sealing an epoch key for a device (rotation)

```
eph     = generate ECDH P-256 pair
shared  = ECDH(eph.private, device.agreePublic) → 256 bits
wrapKey = HKDF(shared, salt = utf8(bookId), info = utf8('cicis-epoch-v1')) → AES-GCM 256
ct      = AES-GCM(wrapKey, iv = random(12), data = epochKey, aad = utf8(bookId + ':' + epoch + ':' + deviceId))
record  = { deviceId, epoch, ephJwk, iv, ct }
```

### 5.4 Whose key is it — pinning

A device trusts a signing key only if it is in its own `book_devices`. The relay's copy is used for one thing:
checking the signature on the entry that introduces a device. That entry is an ordinary encrypted change-set whose
first op is the `device` upsert carrying the device's own `sign_jwk` and `agree_jwk`. Writing it requires the epoch
key, which requires `S`, which the relay never has — so the relay cannot introduce a device. Apply checks that the
entry's signature verifies under the key **inside** it and that the relay-supplied key matches; from then on, only
the pinned key. Rotations seal for the devices in `book_devices`, never for a list the relay supplies.

### 5.5 At rest

`book_epoch_keys.key_sealed` is the JSON of §5.3's record sealed for this device's own agreement key, with
`info = 'cicis-at-rest-v1'`. Without the device key the epoch keys do not open.

## 6. Change-sets

### 6.1 The clock

```
hlc = hex(ms, 12 digits) + hex(counter, 4 digits) + '-' + deviceId          // compared as strings
```

On a local write: `ms = max(nowMs, lastMs)`; if `ms == lastMs` then `counter += 1` else `counter = 0`. If `counter`
would overflow its 4 hex digits (> 0xffff), it rolls into `ms` instead: `ms += 1, counter = 0`. On applying a
change-set (standard HLC receive): if the remote `ms > lastMs`, adopt it wholesale — `lastMs = ms, counter =
its counter`; if `ms == lastMs`, take the higher counter. An older or equal-and-not-higher message changes nothing.
Keeping only `lastMs` here (an earlier draft of this rule) is wrong: it lets a local write made right after
receiving sort *before* the change-set that caused it, when the two happen to tie on `ms`. `last` — `{ ms, counter
}` — is kept in `settings` under `sync.hlc`.

A local write cut into several change-sets (§6.2) reserves all of their hlcs from the clock in one step, before
any is assigned, so a later ordinary local tick can never re-hand-out a counter a split already used.

**Drift.** A change-set whose `ms` is more than **24 hours** ahead of the receiving device's clock is not applied
and **blocks the cursor** (§7.1) until the device's own clock passes `ms − 24h`. A phone with a wrong clock cannot
win every field for ever.

### 6.2 Shape and size

```ts
type ChangeSet = { v: 1; hlc: string; member: string; ops: Op[] };
type Op =
  | { entity: string; id: string; op: 'upsert'; fields: Record<string, unknown>;    // only fields that changed …
      changed?: string[] }                                                          // … or, for a revivable row (§7.2), all, naming these
  | { entity: string; id: string; op: 'delete' };
```

A `purchase` is never `delete`d; it is voided by an upsert of `{ void: true }`.

At most **200 ops** and **64 KB** of JSON per change-set. A local database transaction that produces more is split
into several change-sets with consecutive HLCs (counter + 1 each, rolling into `ms` on overflow per §6.1), in op
order. An import of 3,000 rows is fifteen entries. A single op whose own JSON already exceeds 64 KB is refused
outright — never emitted alone over budget.

### 6.3 Capture

Two capture points, both in `packages/db/src/sync/capture.ts`, both running inside the caller's database
transaction so a change-set is durable exactly when its rows are.

**Rows edited in place** — every entity except `purchase`:

```ts
await withCapture(tx, { bookId, entity, id }, async () => { /* the existing write */ });
```

Reads the entity's fields before, runs the write, reads after; emits an upsert with the fields that differ, or a
delete if the row is gone.

**Purchases** — at the two places the ledger writes a transaction (check #14):

| Ledger function | Records |
|---|---|
| `postTransactionTx` (every insert of `transactions` and `entries`) | the new row's lineage: `replacesTransactionId`'s lineage when it has one, else a new lineage whose id is the root of its `replaces_transaction_id` chain (the new id, for a fresh post) |
| `markVoidTx` (the only writer of `status = 'void'`; reached from `voidTransactionTx` and `replaceTransaction`) | the voided row's lineage |

Before the db transaction commits, each touched lineage of a shared book is resolved by its **net effect**:

| Before → after | Emits |
|---|---|
| no lineage → a posted head in the book | upsert of every field; inserts `sync_lineage` with `head` = the new id and `paid_by` = this member |
| a head → another posted head in the book | project both (§4.3); upsert the fields that differ; `sync_lineage.head` = the new id |
| a head → no posted head in the book (voided, or re-filed with no category line; check #18) | upsert `{ void: true }`; `sync_lineage.head = NULL` |

That one rule covers `replaceTransaction` (a `markVoidTx` then a `postTransactionTx` with `replacesTransactionId`).
It also covers `trades.ts`, which replaces a recalculated sell with `voidTransactionTx` and then `postTransactionTx`,
so the pair is not read as a void. And it covers the deposit-event recursion in `voidTransactionTx`. Hooking the
three exported functions separately would read every replacement as a new lineage.

**Where the flush runs (ruled O1).** `createDatabase().transaction` opens a capture session for each db
transaction. The mutex already serialises transactions, so there is one current session per `Database`. The two
capture points add the lineages they touch, and `withCapture` adds its row ops. After `fn` resolves and **before
`COMMIT`**, the session is flushed. It resolves the lineages, writes `sync_field_clocks`, and cuts, seals and inserts
the change-sets into `sync_outbox`, all inside the same transaction. If `fn` throws, the session is dropped along
with the `ROLLBACK`. Writes through `database.db` outside a transaction are never ledger writes, so they open no
session.

Nothing else needs rerouting (check #15). `events.tagTransaction` (`event_id`), `set-aside-tx`
`parkForGoalTx`/`carryTaggedTx` (`goal_id`) and `ledger.setTransactionMcc` (`mcc`) update in place only columns
that never travel. Every other writer reaches the ledger through `postTransactionTx` or `voidTransactionTx`. The check
lists them.

After capture, for each emitted field: `sync_field_clocks[book, entity, id, field] = hlc`. At commit the ops are
cut into change-sets (§6.2), each sealed and signed (§6.6) and inserted into `sync_outbox`.

A write outside a shared book emits nothing and costs one lookup.

### 6.4 Nothing escapes capture

In the **test harness only** (`packages/db/test/sync/capture-harness.ts`), `installCaptureTriggers(db, bookId)` creates
TEMP triggers on every table named in `SHARED_ENTITIES`: `AFTER INSERT`, `AFTER UPDATE OF <the synced columns>` (only
when one of them really changed), and a delete trigger. They watch only the synced columns, so an in-place write to a
column that never travels (check #15) is not a miss. A row entity's delete trigger is **`BEFORE DELETE`**: its scope
test reads the row itself, which an `AFTER DELETE` trigger can no longer see (task 3 correction). Each trigger writes
to a temp table `__writes` the table, the key, the op, the outbox's **high-water mark** at the time of the write
(`max(rowid)` of `sync_outbox`), and what changed: a row entity's before-image, a purchase table's changed column names.

After every test, a global `afterEach` fails the test if `__writes` holds a write to a row of the shared book that no
op accounts for. **An op accounts for a write only if it was sealed after the write's high-water mark and carries the
field the changed column feeds** (task 3 fix round 1; an earlier "any op for that id, ever" rule could not catch a
second uncaptured write to a row already seen):

- A row entity is judged by its end state against what peers will end up with: for each synced field, the value in
  the latest op after the mark that carries it, else the first write's before-image. Any difference is a miss, so a
  captured A→B followed by an uncaptured B→A is caught (fix round 2). A row that is gone needs a delete; a new row
  needs an upsert. A row deleted and written back as it was needs nothing.
- A purchase row written in place (its transaction not inserted in the same batch) needs an op naming the purchase
  field (`PurchaseEntity.fields`) of each changed column. Every touched lineage must have a `sync_lineage` row whose
  head is the lineage's posted head in the book (that is how a void or a missed replacement is caught), unless it has
  neither (a purchase posted and voided in one transaction, which no other device ever saw).
  The head's projection must also read as the latest op's value for each field an op carried since the first write.
- Raw SQL a test runs through `database.execScript` (a fixture such as "archive this row") is not a repository write
  and is dropped from the watch. No repository writes data through `execScript`; only migrations use it.

**As built (task 4).** Three refinements, each proven by `capture-harness.test.ts`: every trigger fires only while the
watched book has an `active` `shared_books` row (a write to a book not yet shared needs no op — §6.3); a write made
inside `withCapturePaused` (apply writing what another device emitted, §7.2) is left out — the capture config's
`pausedWrites` observer marks those, and only those, in `temp.__apply_paused` — and the change-set being applied joins
the ops a later local write is judged against, the latest **hlc** carrying a field being its end value; and the ops
come from `temp.__sealed`, a copy of every change-set as it enters `sync_outbox`, so an entry the engine has drained to
the relay still accounts for its writes (the mark is that table's seq, not the outbox's reusable rowid).

The whole existing suite, run against a database whose first workspace's Personal book is shared, is the completeness
test; no repository function is called by hand. The command is **`npm run test:capture`** (in `packages/db`, or at the
repo root). `packages/db`'s `npm test` runs the plain suite and then the capture run (`vitest run && vitest run --config
vitest.capture.config.ts`), so a red plain pass short-circuits the capture pass: fix it, or run `npm run test:capture`
on its own.

### 6.5 Seeding — sharing a workspace that already has history

**Share this workspace**, before any invite exists:

0. **Currency check (ruled O3).** If the book's `base_currency` is not the owner's workspace base currency, refuse
   with §8.2's sentence the other way round: *"This workspace keeps its money in SGD; this app keeps yours in IDR.
   Sharing across currencies isn't supported yet."* Nothing is created.

1. Create the relay book; insert `shared_books`; mint epoch 1.
2. Emit, in this order, upserts of every row in scope with **all** its fields: `book`, `member` (self), `device`
   (self), `category` (parents before children) and its `category_need`, `budget` and its dependents, `bill` and its dependents, then every
   non-void `purchase` oldest first with `paidBy` = this member.
3. Cut into change-sets (§6.2), each with a fresh HLC; write `sync_field_clocks`; put in `sync_outbox`.
4. Drain the outbox. Only when it is empty is the invite created and shown. While it drains the screen says
   "Preparing 1,204 of 3,120".

Voided rows are not seeded: a purchase that was void before sharing never existed for the other member.

**As built (task 4).** `SyncEngine.shareBook` (`packages/db/src/sync/engine.ts`) runs step 0 before the relay book
exists, then `seedBookTx` (`seed.ts`) writes steps 1–3 in one transaction; `syncOnce` drains. Minting the epoch key is
task 5's. The app's default-tree upkeep at open (`ensureCategoryKeys`, `ensureDefaultCategorySets`) skips a book this
device **joined** — a `shared_books` row on a book it holds as `kind = 'shared'` — because its keyed and default
categories arrive by sync under the owner's ids and category-set membership never syncs. The owner's own shared book is
not skipped: what the owner's device adds to it is captured and reaches everyone once, and skipping it would stop the
capture run's shared Personal book from getting its defaults.

### 6.6 The log entry

```ts
type LogEntry =
  | { kind: 'change';   deviceId: string; epoch: number; hlc: string; iv: string; ct: string; sig: string }
  | { kind: 'removal';  deviceId: string; epoch: number; hlc: string; target: string; sig: string }
  | { kind: 'rotation'; deviceId: string; epoch: number; hlc: string; sealed: SealedFor[]; sig: string };
type SequencedEntry = LogEntry & { seq: number; signJwk: JsonWebKey };
```

`ct = AES-GCM(epochKey[epoch], iv = random(12), data = deflate(utf8(JSON(changeSet))), aad = utf8(bookId + ':' +
epoch + ':' + deviceId))`. `sig = ECDSA(sign.private, SHA-256(utf8(JSON(entry without sig, keys sorted))))`.
Everything binary is base64url. A `rotation`'s `epoch` is the **new** epoch.

No entry carries a name. Device and member names travel only inside `change` entries.

## 7. Apply and merge

### 7.1 The loop

```
entries = pull(bookId, applied_seq)
for e in entries, in seq order:
  verify e.sig                       # key pinned in book_devices; or, for a device's first entry, §5.4
    on failure: stop; state = error 'bad signature at seq N'; do not advance
  if e.kind == 'rotation':  open my record in e.sealed; store book_epoch_keys[e.epoch]; shared_books.epoch = e.epoch
  if e.kind == 'removal':   book_devices[e.target].removed_at = now; maybeRotate()        # §8.4
  if e.kind == 'change':
    key = book_epoch_keys[e.epoch]; if missing: state = 'needs_invite'; stop
    cs = JSON(inflate(decrypt(e)))
    if ms(cs.hlc) > nowMs + 24h: stop                                                     # §6.1
    apply(cs)                                                                             # §7.2, one db transaction
  applied_seq = e.seq                 # same transaction as the apply
```

**The cursor never passes an entry that was not applied.** Every `stop` leaves `applied_seq` where it was; the next
tick tries the same entry again.

**As built (task 4).** `pullAndApply` (`packages/db/src/sync/apply.ts`). An entry this device wrote is already true
here and only moves the cursor (a restored backup is a new device, §5.1, so this never skips anything it lacks). A
removal is applied by its author too.

**Skips (fix round 1).** Each op runs in a savepoint. Only a refusal every receiver makes alike from the carried data
is skipped: a SQLite constraint error; `PostingError` `TOO_FEW_LINES`, `ZERO_AMOUNT`, `UNBALANCED`, `NOT_INTEGER`;
`LedgerError` `INVALID_DATE`, `INVALID_ORIGINAL`, `INVALID_MCC`, `INVALID_BILL_MONTH`; and a row whose parent is gone.
The op is rolled back to its savepoint, recorded in `sync_skipped` (book, seq, entity, id, error, when) and returned in
`PullResult.skipped`, and the entry goes on. Anything else is a bug: it is rethrown, the entry's transaction rolls
back, and the cursor stays before it — a stop like any other, retried on the next tick. The property tests require no
skip at all.

### 7.2 Applying one change-set

Capture is switched off for the duration, so applying never re-emits.

```
for op in cs.ops, in order:
  if op.entity == 'purchase': applyPurchase(op, cs); continue
  T = tombstones[op.entity, op.id]; revivable = the entity's Op.id is not its own minted `id`
  if op.op == 'delete':
    if not revivable: tombstones[...] = max(T, cs.hlc); delete the row; continue            # rule 3
    if T >= cs.hlc or clock[..., '@row'] > cs.hlc: continue      # made again after this delete: it lost
    tombstones[...] = cs.hlc; delete the row; continue
  if T exists:
    if not revivable or cs.hlc <= T: continue
    remove the tombstone                                          # made again later: alive again
  if revivable: clock[..., '@row'] = max(clock[..., '@row'], cs.hlc)
  winners = { f: op.fields[f] for f in (op.changed ?? keys(op.fields)) if clock[op.entity, op.id, f] is null or cs.hlc > clock[...] }
  if the row exists: if winners is empty: continue; update it with winners
  else:                                                           # an existence-only row (bill_skip) inserts here too
    if its parent is gone: continue                               # an override of a budget that lost, …
    if a sibling holds its unique slot: the lower id wins; the loser is deleted and tombstoned here
    insert it with op.fields, the local workspace id, localOnInsert values, and its tag row
  for f in winners: clock[op.entity, op.id, f] = cs.hlc
```

```
applyPurchase(op, cs):
  L = sync_lineage[op.id]
  if L exists and L.head is null: return                          # void wins, for ever
  winners = fields of op that beat their clocks, as above
  if winners is empty: return
  if winners.void:
    voidTransactionTx(L.head); L.head = null; record clocks; return
  state = (L exists ? project(L.head) : {}) merged with winners   # the purchase as it should now read
  input = ledgerInput(state, moneySide(L, state.money))           # §7.4
  if L does not exist:
    id = postTransactionTx(tx, input with id = op.id)             # the lineage id is the first row's id
    insert sync_lineage(op.id, head = id, paid_by, paid_label)
  else:
    id = replaceTransactionTx(tx, L.head, input); L.head = id
  record clocks for winners
```

**Tombstones (controller ruling, task 4).** An entity keyed by its own minted `id` (`book`, `category`, `budget`,
`budget_override`, `bill`) is never made again under that id, so its tombstone wins for ever (rule 3). One keyed by
anything else — a natural key (`bill_skip`, `book_income_override`) or another row's id (`category_need`,
`budget_frequency`, `bill_window`, `book_income`, `member`, `device`) — is made again under the same `Op.id` (skip,
take back, skip again). For those, capture always emits the **whole** row and records the row's existence clock
`@row` in `sync_field_clocks`, and a delete and a re-make race by hlc like any field: whichever is later wins on every
device. A fragment never arrives for a revivable row, because a fragment could not be inserted where the row was gone.
The op names the fields that really changed in `changed` (fix round 1): only those compete for their clocks and are
written into an existing row, so rule 1 stays per field (a name edited here and a role there both survive); the
others are there only to insert the row where it is absent. Known limit: a row inserted by a revive takes the reviving
device's values for its unnamed fields, which can be older than a concurrent edit another device made before the
delete reached it.

**Uniqueness wider than the id.** `budgets` is unique per category and `budget_overrides` per budget and month, so two
devices can each make "the" budget of one category offline under different ids. The lower id wins on every device;
the other is deleted with what depended on it and tombstoned, so its later ops are dropped.

`postTransactionTx` mints its own id today. Step 1 adds an optional `id` to `PostTransactionInput`, which only this
call uses; `replaceTransactionTx` drops it from the input it spreads (check #12). `replaceTransaction` opens its own
db transaction under a mutex that is not reentrant. Step 1 therefore extracts `replaceTransactionTx(tx, ws, id,
input)`, and `replaceTransaction` wraps it (check #13).

A purchase whose fields arrive in two change-sets (split by §6.2) is posted by the first that carries `money` and
replaced by the second; an op for an unknown lineage without `money` is held in memory until the rest of the
pulled page is applied, then dropped with a logged warning if `money` never came.

### 7.3 The six rules

1. **Per field, the later HLC wins.** The clock comparison.
2. **Money is one atom.** `money` is one field; a replacement posts every line of the winner.
3. **Void wins.** A lineage with no head accepts nothing more. For every other entity, a tombstone does the same.
4. **Structure never destroys money.** If a `line`'s `categoryId` is tombstoned or unknown locally, the line is
   posted against the book's **Uncategorised** expense category — `id = uuidv5(bookId, 'uncategorised')`, created
   on demand, identical on every device.
5. **Two ids are two purchases.** Nothing merges lineages. Two devices correcting the same purchase offline produce
   two `money` values for **one** lineage; the later wins and the purchase is counted once.
6. **Idempotent.** An entry at or below `applied_seq` is skipped; a change-set applied again wins no field.

**A local conversion voids a shared purchase (known behaviour, ruled O5).** Turning a purchase into an investment
buy (`convert.ts`) voids it and posts a trade, which belongs to no book. Void wins, so the purchase disappears from
every member's copy of the book. That is right: it stopped being spending. The history shows the void and who made
it.

**Who changed what.** `postTransactionTx` writes `audit_log` (`'post'`, payload = its input), and so does
`markVoidTx` (`'void'`), which means a replace writes one of each. Step 1 adds an optional `syncAuthor` (a member id)
to `PostTransactionInput`, which lands in the `'post'` payload, and an optional author argument to
`voidTransactionTx` for the `'void'` payload. Apply passes the author's `member` so the history reads "amount
changed by Dewi" (check #16). The owner decided any member may change any
purchase, including one the other person paid; this is that decision's record.

### 7.4 The money side on apply

```
moneySide(L, money):                                                                # corrected in task 4
  own = money.paidBy is this device's member and L exists
        ? L.head's money-side entries on non-placeholder accounts : none
  for each currency c in money.lines:                                               # ruled O2
    if own has entries in c: keep them; if their total is not −sum(lines in c), put the whole difference on the
                             entry in c with the largest |amount| (an entry left at zero is dropped)
    else:                    one entry of −sum(lines in c) on placeholderAccount(bookId, money.paidBy, c)
  lines post with their carried amountBaseMinor (§4.3); every other entry's base figure uses
  ratesToBase = { c: |amountBaseMinor / amountMinor| × 10^(exp(c) − exp(base)) of the first line in c }
```

On the payer's device the head's own money-side accounts are kept, each in its own currency. Their rates come
from the carried pairs in the same way. They are kept only while `money.paidBy` is still this member: any member may
change anything (§0, minor 9), including who paid — a member who says "I paid that" posts the money side on their own
account and sends `paidBy` = themselves — and then the first payer's device moves the money side off its own account
onto the new payer's placeholder (v3 kept the old account, so the two devices read different payers).

On the payer's device the correction therefore goes through `replaceTransactionTx` against the payer's real account.
Everything that function carries across a correction is carried exactly as when the payer edits it themselves: a
set-aside answer, a tagged goal, a bill payment, the card and its statement, point actuals, photos, event items
(confirmed, check #17). It carries a fact only when the input field is **`undefined`**. So `ledgerInput` leaves every
field that is not a winner `undefined`, never `null`: above all `setAside`, `templateId`, `billMonth`, `cardId`,
`eventId` and `mcc`. A `null` clears the fact.

## 8. Invites, devices, ownership

### 8.1 Create an invite (owner's device)

1. `inviteId = uuidv7()`; `S = random(16)`; `expiresAt = now + 7 days`.
2. `inviteKey = HKDF(ikm = S, salt = utf8(inviteId), info = utf8('cicis-invite-v1'))` → AES-GCM 256.
3. `keys = AES-GCM(inviteKey, iv, data = utf8(JSON([{ epoch, key }, … every epoch the book has had])))`.
4. `preview = AES-GCM(inviteKey, iv, data = utf8(JSON({ bookName, inviterName, baseCurrency })))`.
5. `putInvite(bookId, { inviteId, keys, preview, expiresAt, sameMember, memberId?, sig })`.
6. Show the **code** — `base32crockford(inviteId bytes (16) ‖ S (16))`, 52 characters in groups of four — and the
   **link** `cicis://join/<code>`, with a **Share** button. `S` is in neither the relay nor any log.

### 8.2 Join (the other device)

1. Parse the code into `inviteId` and `S`.
2. `previewInvite(inviteId)` → open `preview` with `inviteKey`. Expired or claimed: say so and stop.
3. **Currency check.** `baseCurrency` differs from this device's workspace base currency: refuse — *"This workspace
   keeps its money in IDR; this app keeps yours in SGD. Sharing across currencies isn't supported yet."* Nothing
   was claimed, nothing is stored, the invite is still good for someone else.
4. Show **bookName**, **inviterName**, and **Join**.
5. On Join: `claimInvite(inviteId, devicePublic)` → `{ bookId, epoch, keys, sameMember, memberId }`. The relay
   allow-lists the device and marks the invite claimed.
6. Open `keys`; store every epoch key (§5.5). Insert the `books` row (`kind = 'shared'`) and `shared_books`
   (`member_id = sameMember ? memberId : uuidv7()`, `state = 'active'`).
7. Append the introduction: a change-set whose ops are this `device` (with its public keys) and, unless
   `sameMember`, this `member` with the name the person typed.
8. `pull(bookId, 0)` and apply everything.

### 8.3 Link your own device

**Link a device**, on your own member row: §8.1 with `sameMember: true` and your `memberId`. If the inviter is an
owner, the inviter follows the claim with `setOwners` including the new device.

### 8.4 Remove a device, and rotate

Two acts, by design done by different devices when someone leaves.

**Removal** — by an owner for any device, by any device for itself (**Leave** removes each of the member's
devices). Applying a removal (fix round 1) writes `book_devices.removed_at` = the entry's hlc time and stamps
`sync_field_clocks[device, target, removedAt]` = the entry's hlc, so a later edit of another field by a device that had
not seen the removal cannot undo it:

1. `append({ kind: 'removal', target })`.
2. `removeDevice(bookId, target)` — the relay drops it from the allow-list; it can no longer append or pull.

**Rotation** — `maybeRotate()`, run by **any remaining device** when it applies a `removal` (or makes one for
another device) and `shared_books.epoch` is still the removal's epoch:

1. `next = epoch + 1`; mint a key; seal it (§5.3) for every device in `book_devices` with `removed_at` null.
2. `append({ kind: 'rotation', epoch: next, sealed })`.
3. `201`: store the key, `shared_books.epoch = next`. `409` (someone rotated first): pull; the winner's rotation
   arrives; do nothing more.

A device never rotates on its own removal. Between a removal and its rotation, writes continue under the old
epoch; the removed device cannot pull them, which is the relay's doing until the rotation makes it cryptography's.

### 8.5 Ownership

`book_members.role`, synced. The relay keeps the set of owner **device ids** for authorising `putInvite`,
`removeDevice` of another device, `setOwners`, `deleteBook`. **Make owner**: a `member` op setting `role`, and
`setOwners` with that member's devices added. With every owner device gone the book is **frozen**: members record
and sync, nobody can invite or remove; rotation still works.

### 8.6 Stop sharing

Owner: `deleteBook`. Every other device, on the next call answered `410`, sets `state = 'unshared'`: the book
stays, read-only, labelled *"No longer shared by Fandri"*. Nobody's rows are deleted by someone else's tap.

### 8.7 A restored backup

A backup is the whole database, so it carries `shared_books` and `sync_*` and none of the keys. On open, for each
`shared_books` row: if `KeyStore` has no device key whose `deviceId` is in that book's `book_devices`, or
`book_epoch_keys` does not open, set `state = 'needs_invite'` and clear that book's `sync_outbox`. The workspace
shows **"Ask Dewi for a new invite to keep sharing"**; its rows are all there and recording works, locally.

Rejoining with a fresh invite from that state: steps §8.2 1–7, keeping the existing `books` row and `member_id`;
then pull from 0 and apply (the restored `sync_field_clocks` make the merge correct); then emit, as new, every
local row in scope whose id appears in no op pulled. A local edit newer than the backup that never reached the
relay, on a row the log already knows, is lost to the log's value — the restored database is by definition the
older one.

## 9. The relay

One Cloudflare Worker, one Durable Object per book, Durable Object storage only. Source in `apps/relay/`.

### 9.1 Authentication

```
X-Device:    <deviceId>
X-Timestamp: <unix ms>
X-Signature: base64url(ECDSA(sign.private, SHA-256(utf8(method + '\n' + path + '\n' + timestamp + '\n' + hex(SHA-256(body))))))
```

Refused: a timestamp more than 5 minutes off; an unknown or removed device; a bad signature. `POST /books` and
`POST /invites/:id/claim` come from a device on no list and are verified against the JWK in their own body.
`GET /invites/:id` is unauthenticated: the id is unguessable and the body is sealed.

**As built (task 6).** Every refusal above answers `401`, and so does a missing header. `path` is the request
target as sent — pathname plus query string (`/books/B/entries?since=12`) — so the `since` of a pull is signed too.
"ECDSA(sign.private, SHA-256(m))" is WebCrypto's `ECDSA` with `hash: 'SHA-256'` over `m` (the algorithm hashes); the
signature is WebCrypto's raw r ‖ s (64 bytes), base64url. On `POST /books` and the claim, an `X-Device` that is not
the id derived from the body's `signJwk` answers `403`, a signature that does not verify under that key `401`. For a
member, the book's `404`/`410` are answered before the device check, as `MemoryTransport` does. One file holds the
signing string, the canonical JSON and the verifier for both ends: `packages/db/src/sync/relay-signing.ts`.

An invite's `sig` (§5.4) is ECDSA P-256/SHA-256 over `utf8(JSON(invite without sig, keys sorted))` — the same form
as an entry's (§6.6) — checked at claim time against the pinned key of each current owner device; none verifies:
`403`. The stub `stub-sig:<deviceId>` convention `MemoryTransport` accepts is not accepted by the relay.

**Replay.** `POST /books/:id/entries` with a `(deviceId, hlc)` already in the log answers `200` with the seq the
entry was already given, and stores nothing new — success, not an error, so the client never has to special-case
it. `409` on this endpoint is reserved for the one real conflict: a `rotation` whose `epoch ≠ current + 1`.

### 9.2 Endpoints

| Method and path | Who | Body → Response |
|---|---|---|
| `POST /books` | new device | `DevicePublic` → `201 { bookId }`; the caller is the only owner; `epoch = 1` |
| `POST /books/:id/entries` | member | `LogEntry` → `201 { seq }` new; `200 { seq }` duplicate `(deviceId, hlc)`, the original entry's seq; `409` a `rotation` whose `epoch ≠ current + 1`; `413` over 128 KB |
| `GET /books/:id/entries?since=N` | member | → `200 { entries: SequencedEntry[], latest }`, at most 500 |
| `POST /books/:id/invites` | owner | `InviteRecord` → `201` |
| `GET /invites/:id` | anyone | → `200 { preview, expiresAt, claimed }`; `404` |
| `POST /invites/:id/claim` | new device | `DevicePublic` → `200 { bookId, epoch, keys, sameMember, memberId }`; `409` claimed; `410` expired; `403` bad owner signature; `429` five devices |
| `DELETE /books/:id/devices/:deviceId` | owner, or the device itself | → `204` |
| `PUT /books/:id/owners` | owner | `{ deviceIds }` → `204` |
| `DELETE /books/:id` | owner | → `204`; every later call on the book → `410` |

**As built (task 6)**, the statuses every endpoint can also answer, each the one `MemoryTransport` throws: `401` per
§9.1; `404` an unknown book, invite, device or path; `400` a body or `since` of the wrong shape; `405` a method a path
does not take; `403` a non-owner on an owner-only call, and an append whose `deviceId` is not the caller;
`409` on `POST /books/:id/invites` when another book already holds that invite id; `410` on `GET /invites/:id` and
the claim once the invite's book is deleted; `413` a request body over 1 MB, refused before it is parsed. A removed
device frees its place among the five. The Worker answers CORS preflights and stamps `Access-Control-Allow-Origin`
for the origins in `wrangler.toml`'s `ALLOWED_ORIGINS` (the Vite dev server and preview, `capacitor://localhost`),
allowing `Content-Type`, `X-Device`, `X-Timestamp`, `X-Signature`.

### 9.3 Durable Object state — all of it

```
devices: Map<deviceId, { signJwk, agreeJwk, addedAt, removedAt? }>
owners:  Set<deviceId>
epoch:   number                                  // raised by an accepted rotation
seq:     number
log:     Map<seq, LogEntry>
seen:    Map<deviceId + ':' + hlc, seq>          // lets a duplicate append answer with the original seq
invites: Map<inviteId, InviteRecord & { claimedAt? }>
deleted: boolean
```

No name, no currency, no plaintext, no receipt. What the relay can observe: how many devices a book has, when each
writes, and how much.

**As built (task 6).** Each row is its own storage key (`meta` holds `epoch`, `seq`, `owners`, `deleted` and the
book's id; `device:`, `log:`, `seen:`, `invite:` the rest), so an append writes three small values, never the log.
One more Durable Object class exists, one per invite id, holding only the id of the book that keeps the invite: the
invite endpoints arrive with nothing but the invite id, and a per-book object cannot be searched the way
`MemoryTransport` scans every book in memory. It holds no invite content.

### 9.4 Client behaviour

`RelayTransport` drains `sync_outbox` in `hlc` order and pulls from `applied_seq`, when the app comes to the
foreground and every 30 s while open. A failure leaves the outbox as it was; retry with exponential backoff capped
at 5 minutes. No screen waits on the relay.

**As built (task 6).** `SyncScheduler` (`apps/web/src/sync/sync-scheduler.ts`) owns the timing: a run at start and
on every `trigger()` (foreground, or a local write), then every 30 s after a success; after `n` failures in a row the
wait is `min(30 s × 2ⁿ, 5 min)` — 60, 120, 240, then 300 s. One run at a time: a trigger during a run queues one
follow-up. What a run does is a `syncOnce` callback, built with the engine (tasks 3–4) and wired in task 7.
`RelayTransport` maps every non-2xx answer to `SyncTransportError` with its status, and a relay it cannot reach to
status `0`. The base URL is `VITE_RELAY_URL`, else `http://localhost:8787`.

## 10. Entitlement

`verifyEntitlement(bookId): Promise<boolean>` in `apps/relay/src/entitlement.ts` **returns `true`**. Called on
`POST /books` and on owner appends. When tiers exist: the owner's device sends its StoreKit 2 signed transaction on
`POST /books`; the Worker verifies the chain and keeps `{ entitledUntil }` only; a lapse makes the book read-only
on the relay after 30 days; nothing is deleted. Members never present a receipt. Android: a second verifier behind
the same function. As built, a `false` answers `402` (on `POST /books`, and on an owner's append); it cannot happen
while the function returns `true`.

## 11. Screens

Native kit only.

**Settings → Workspaces → a workspace**

| Row | Shown when | Does |
|---|---|---|
| **Share this workspace** | no `shared_books` row | refuses a book whose currency is not the owner's (§6.5 step 0, ruled O3); otherwise explains what the other person will and will not see, and that a replaced phone needs a new invite; seeds (§6.5); then code, link, **Share** |
| **Members** | `state = 'active'` | a row per member: name, role; under it a row per device: name, "synced 2 min ago", **Remove** |
| **Link a device** | on your own member | §8.3 |
| **Make owner** | you are an owner, on another member | §8.5 |
| **Leave** | you are a member, on yourself | §8.4 |
| **Stop sharing** | you are an owner | confirm, then §8.6 |
| status line | any `shared_books` row | "Up to date" · "3 changes waiting" · "Not synced since Tue" · "Ask Dewi for a new invite to keep sharing" · "No longer shared by Fandri" |

**Workspace switcher.** A shared book's subtitle: **Shared with Dewi**. The **+** menu gains **Join a workspace**:
paste a code or arrive by `cicis://join/…`; then §8.2 steps 2–8.

**A purchase in a shared book.** Subtitle: `paidLabel`, and `· paid by Dewi` when `paidBy` is not you. The receipt
shows both. No link in a shared book leads to an account, card, statement or balance.

## 12. Privacy

- Whether end-to-end encrypted content is "collected" under App Privacy is checked against Apple's definitions at
  the submission that carries sharing, and answered truthfully either way.
- `PrivacyInfo.xcprivacy` is unchanged.
- The relay stores §9.3 and nothing else, and sees no name. Deleting a book deletes all of it.

## 13. Tests

Mutate-twice review on every step.

| File | Proves |
|---|---|
| global `afterEach` + `installCaptureTriggers` | §6.4: no write to a shared row without an op, across the whole existing suite |
| `convergence.property.test.ts` | N databases, random local programs (post, correct, void, budget, bill, category) with offline stretches, `MemoryTransport` in random interleavings → every `SHARED_ENTITIES` projection identical on all. Includes a book **seeded** with history before the second device joins. ≥ 200 programs. |
| `money-atom.property.test.ts` | after every apply: each posted row's entries sum to zero; each lineage has at most one posted row; every money-side entry names a real local account or the payer's placeholder |
| `same-purchase.test.ts` | two devices correct one purchase offline → one lineage, one posted row, the later `money`; the Cashflow total counts it once |
| `void-wins.test.ts` | correct→void and void→correct, every arrival order → void on all |
| `idempotent.test.ts` | any entry twice ≡ once |
| `payer-ledger.test.ts` | a member's correction of the payer's purchase moves the payer's account balance, keeps its set-aside answer and its bill payment |
| `tombstones.test.ts` (task 4) | a skip taken back and made again is back everywhere; a need cleared and set again: the later wins; a removed budget stays removed; two budgets on one category keep the lower id |
| `joined-bootstrap.test.ts` (task 4) | app-open default-tree upkeep never writes into a joined book |
| `rotation.test.ts` | removed at epoch n cannot open n+1; a remaining device opens both; two devices rotating at once → one `201`, one `409`, one epoch; the leaving device never seals |
| `join.test.ts` | a joiner after two rotations reads the whole history; a currency mismatch claims nothing |
| `restore.test.ts` | §8.7: `needs_invite`, then rejoin converges |
| `hlc.test.ts` | monotonic under clock jumps; total order; the 24 h rule blocks and then releases |
| `pinning.test.ts` | an entry signed by a key the relay supplied but no `device` op introduced is refused |
| `crypto.kat.test.ts` | HKDF-SHA-256, AES-GCM, ECDSA P-256, ECDH P-256 against published vectors |
| `relay.test.ts` (Miniflare, to be installed) | every status code in §9.2 |
| `sharing.spec.ts` (Playwright, phone and desktop, `WebKeyStore`) | two contexts, a local Worker: share a book with history, join, record on both, correct each other's, remove, rotate, same Cashflow total |

## 14. Build order

| # | Step | Done when |
|---|---|---|
| 0 | **Confirm `SHARED_ENTITIES`** against the code: every table, key, scope rule and column in §4.1; correct the spec where the code differs. | the constant exists with a test that each named table and column exists in the schema |
| 1 | **Capture and merge, no network.** Migration 0056; `withCapture`; the three ledger doors; `sync_lineage`; HLC; seeding; `apply`, `applyPurchase`, `moneySide`; placeholder accounts; `MemoryTransport`; the trigger harness. Keys are a stub that seals with the identity function. | capture harness, `convergence`, `money-atom`, `same-purchase`, `void-wins`, `idempotent`, `payer-ledger`, `hlc` green; the existing suite green and unchanged |
| 2 | **Keys.** Precondition: `feat/ios-testflight` merged. `KeyStore` both ways; epoch keys; sealing; entry encrypt, sign, verify; pinning; at rest. | `crypto.kat`, `rotation`, `pinning`, `join`, `restore` green; step 1's tests green with real sealing |
| 3 | **The relay.** `apps/relay`; every endpoint; `RelayTransport`; outbox; polling. | `relay.test.ts` green; two simulators converge through a local Worker |
| 4 | **Screens.** §11. | `sharing.spec.ts` green on both projects |
| 5 | **Hiding.** The anti-join on every reader named in §4.4; the disabled flag; no With row. | one e2e per excluded page |
| 6 | **Edges.** Make owner, Leave, Stop sharing, frozen, `410`, `needs_invite`. | covered in `sharing.spec.ts` and `restore.test.ts` |

## 15. Left open

- The keychain plugin for `NativeKeyStore` (step 2).
- The relay's domain and the Cloudflare account (before step 3).
- The App Privacy wording (at submission).
- **Encrypted backups.** Separate work, and independently urgent: today's backup file is a plaintext copy of a
  household's finances wherever it lands.
