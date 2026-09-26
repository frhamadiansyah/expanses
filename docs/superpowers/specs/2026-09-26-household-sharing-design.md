# Household sharing — design

Status: draft v2 for review · 2026-09-27
Builds on: `2026-09-17-workspaces-design.md` §5.4, `2026-09-18-data-safety-design.md`.

## 0. What v2 changed from v1

v1 argued the decisions. v2 keeps them and cuts everything that is not needed to prove them, then states what remains
exactly enough to implement without guessing. Dropped from this build, each recoverable later behind a seam that is
named here:

| Dropped | Why | Comes back through |
|---|---|---|
| Photo sync | blobs, lazy loading and downscaling, for a receipt the other person rarely needs | `SyncTransport.putBlob/getBlob` |
| Snapshots for late joiners | a household's whole log is a few MB; replaying it takes seconds | a `snapshot` log entry kind |
| Log retention / acks | needed only once snapshots exist | same |
| R2 storage | with no blobs and no snapshots, the Durable Object's own storage holds everything | same |
| WebSocket push | polling on foreground and every 30 s is enough to test the model | `SyncTransport.subscribe` |
| Events, category sets, "With" shares | events' scope is unclear; shares create receivables, which are owner scope | the `SHARED_TABLES` list |
| Cross-currency books | a book must have the members' base currency; FX never enters sync | the join check in §8.3 |
| Ed25519 / X25519 | not in every WebView yet; P-256 has been everywhere for a decade and is no weaker here | none needed |
| Entitlement verification | tiers do not exist in the app yet | `verifyEntitlement()` returns `true` |
| Safety number, duplicate hint, second owner prompt | nice; not load-bearing | later steps |

## 1. Purpose

Two people in one household record into one workspace, each paying from their own accounts, and both phones show
the same book with the same numbers, offline or not.

Decided with the user (2026-09-26): sharing is the **only** thing a server is for; the server **cannot read**
anything; there are **no accounts**; the middle is **a relay we run**; the **owner pays**, members join free; the
merge is **last-writer-wins per field, money as one atom, delete wins, no conflict inbox**.

Assumed, correct if wrong: a small, trusting household (≤ 5 devices); any member may edit anything in the book,
including the other person's purchases; offline recording is untouched; Android is coming, so nothing Apple-only.

## 2. Glossary

| Word | Means |
|---|---|
| **workspace** (UI) / **book** (DB) | one `books` row; the unit of sharing |
| **owner scope** | everything keyed by `workspace_id` that is not in a book: accounts, cards, net worth, goals, settings |
| **device** | one install, identified by its P-256 signing public key |
| **member** | a person; one or more devices |
| **epoch** | one workspace key; bumps on every device removal |
| **change-set** | one encrypted, signed record of one local database transaction |
| **relay** | the Cloudflare Worker; one Durable Object per shared book |

## 3. Truth and transport

Each device's local SQLite is the truth. The relay is an append-only log per book plus the device allow-list; it
never holds a usable key or a readable field. If the relay is gone, every member still has everything.

The app talks to one interface, so the engine is tested with no network:

```ts
interface SyncTransport {
  createBook(ownerDevice: DeviceKeys): Promise<{ bookId: string }>;
  append(bookId: string, entry: LogEntry): Promise<{ seq: number }>;
  pull(bookId: string, since: number): Promise<{ entries: LogEntry[]; latest: number }>;
  putInvite(bookId: string, invite: InviteRecord): Promise<void>;
  claimInvite(inviteId: string, device: DeviceKeys, deviceName: string): Promise<ClaimResult>;
  removeDevice(bookId: string, deviceId: string): Promise<void>;
  setOwners(bookId: string, deviceIds: string[]): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
}
```

Two implementations: `MemoryTransport` (tests) and `RelayTransport` (§9).

## 4. Data

### 4.1 What syncs

`SHARED_TABLES`, a named constant in `packages/db/src/sync/shared-tables.ts`. Every row in these tables that belongs
to a shared book syncs; nothing else does.

| table | scope rule |
|---|---|
| `books` | the shared row itself: `name`, `base_currency`, `count_events_in_budget`, `archived_at` |
| `accounts` | only rows tagged to the book by `book_categories` (categories) |
| `book_categories` | rows for the book |
| `budgets`, `budget_overrides`, `budget_frequencies`, `book_budget_settings` | rows for the book |
| `bills`, `bill_windows`, `bill_skips`, `bill_payments` | rows for the book |
| `transactions` | rows tagged by `book_transactions`; **the money projection replaces `entries`** (§4.3) |
| `book_transactions`, `transaction_flags` | rows for those transactions |

Step 1 confirms each table's book scoping against the code and corrects this list; the list in code is the truth.

**Never syncs:** `entries` as such, every owner-scope table, `settings`, `fx_rates`, photos, other books.

### 4.2 New tables — migration `0056_household_sharing.sql`

Side tables only. No column is added to any existing table (workspaces design §4).

```sql
CREATE TABLE shared_books (
  book_id      TEXT PRIMARY KEY,
  relay_book_id TEXT NOT NULL,
  epoch        INTEGER NOT NULL,          -- current epoch this device writes under
  role         TEXT NOT NULL,             -- 'owner' | 'member'
  member_id    TEXT NOT NULL,             -- this device's member
  shared_at    TEXT NOT NULL,
  unshared_at  TEXT                       -- set when the owner stops sharing; book becomes read-only
);
CREATE TABLE book_members (
  book_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL, joined_at TEXT NOT NULL,
  PRIMARY KEY (book_id, member_id)
);
CREATE TABLE book_devices (
  book_id TEXT NOT NULL, device_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL,
  added_at TEXT NOT NULL, removed_at TEXT,
  PRIMARY KEY (book_id, device_id)
);
CREATE TABLE book_member_accounts (       -- the hidden placeholder account per other member (§4.3)
  account_id TEXT PRIMARY KEY, book_id TEXT NOT NULL, member_id TEXT NOT NULL
);
CREATE TABLE book_epoch_keys (            -- AES key bytes, encrypted at rest by the device key (§5.3)
  book_id TEXT NOT NULL, epoch INTEGER NOT NULL, key_wrapped BLOB NOT NULL,
  PRIMARY KEY (book_id, epoch)
);
CREATE TABLE sync_outbox (                -- change-sets written locally, not yet accepted by the relay
  id TEXT PRIMARY KEY, book_id TEXT NOT NULL, hlc TEXT NOT NULL, body BLOB NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE sync_cursor (
  book_id TEXT PRIMARY KEY, applied_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_field_clocks (
  entity TEXT NOT NULL, id TEXT NOT NULL, field TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (entity, id, field)
);
CREATE TABLE sync_tombstones (
  entity TEXT NOT NULL, id TEXT NOT NULL, hlc TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
```

`book_members`, `book_devices` and the placeholder rows are themselves synced (they travel as ops in change-sets),
so every device knows every member and device by name. `shared_books`, `book_epoch_keys`, `sync_*` are local only.

### 4.3 The money projection

A purchase is `transactions` + `entries`. Entries name the payer's accounts, which the other member does not have.
So a synced transaction carries, instead of entries, one field named **`money`**:

```ts
type Money = {
  lines: { categoryId: string; amountMinor: number }[]; // category side, in the book's currency
  originalCurrency: string | null;                       // display only, as on transactions today
  originalAmountMinor: number | null;
  paidLabel: string;                                     // "BCA KrisFlyer ···· 1467", built by the payer's device
  paidBy: string;                                        // member_id of the payer
};
```

Amounts are in the book's currency, which equals every member's base currency (§8.3), so `amountBaseMinor` is the
same number and no rate is ever needed on apply.

**Applying `money` on a device:**

1. Delete the transaction's existing `entries`.
2. Insert one entry per `line` against `categoryId`, `currency = book.base_currency`, `fx_rate_to_base = 1`,
   `amount_base_minor = amountMinor`.
3. Insert the balancing entry for `-sum(lines)` against **the asset account**: if the transaction already had an
   asset-side entry on this device against a non-placeholder account (this device is the payer), keep that account;
   otherwise the placeholder account for `paidBy` (create it if missing: `accounts` row, `kind='asset'`,
   `subtype='cash'`, `name = member name`, plus a `book_member_accounts` row).

**Placeholder accounts** are excluded, by joining `book_member_accounts`, from: the Accounts page, Net worth, the
Paid-with picker, Transfer's From/To, the tax report, backup reminders. Their balance is never shown. Every other
reader (Cashflow, budgets, bills, the day list, receipts) sees an ordinary transaction.

**Building `paidLabel` on the payer's device:** account name, and for a card `' ···· ' + last4` of the card that paid
(the `cards` row named by the purchase), else the account name alone.

In a shared book the **currency flag is drawn but disabled** (there is no "Charged in" — the book is in the base
currency and so is the payer's account by §8.3), and the **With** row is not offered.

## 5. Keys

All WebCrypto; no library.

| Purpose | Algorithm | Stored as |
|---|---|---|
| Device signing | ECDSA P-256, SHA-256 | JWK pair in the keychain plugin, key `cicis.device.sign` |
| Device agreement | ECDH P-256 | JWK pair in the keychain plugin, key `cicis.device.agree` |
| Workspace (epoch) key | AES-GCM 256, 32 random bytes | `book_epoch_keys`, encrypted under the device key (§5.3) |
| Key derivation | HKDF-SHA-256 | — |

### 5.1 Device identity

`deviceId = hex(SHA-256(rawPublicKey(sign)))[0:32]`. Generated on first launch; **never** written to the database
or the backup file (backups are plaintext today). iOS Keychain item marked synchronizable; a phone restored from a
backup file alone rejoins by invite, and the Share screen says so in one line.

### 5.2 Wrapping an epoch key for a device (rotation, §8.5)

`ephemeral = ECDH.generateKey()`; `shared = ECDH.deriveBits(ephemeral.private, device.agree.public, 256)`;
`wrapKey = HKDF(shared, salt = utf8(bookId), info = utf8('cicis-epoch-v1'), 256)`;
`ct = AES-GCM(wrapKey, iv = random(12), plaintext = epochKey, aad = utf8(\`${bookId}:${epoch}:${deviceId}\`))`.
Record: `{ deviceId, epoch, ephemeralPublicJwk, iv, ct }`.

### 5.3 Wrapping an epoch key for an invite (§8.1)

`wrapKey = HKDF(ikm = S, salt = utf8(inviteId), info = utf8('cicis-invite-v1'), 256)`; then AES-GCM as above with
`aad = utf8(\`${bookId}:${epoch}\`)`. Record: `{ epoch, iv, ct }`. `S` never leaves the two devices.

### 5.4 At rest

`book_epoch_keys.key_wrapped` is the epoch key AES-GCM-encrypted under a key derived from the device's agreement
private key with `info = 'cicis-at-rest-v1'`; the same construction as §5.2 with the device's own public key as the
peer. Losing the keychain therefore loses the epoch keys too, which is the intended property.

## 6. Change-sets

### 6.1 The clock

HLC string, lexicographically ordered:

```
hlc = hex(ms, 12 digits) + hex(counter, 4 digits) + '-' + deviceId
```

Rule: `next = max(now_ms, last_ms)`; if equal to `last_ms`, `counter += 1`, else `counter = 0`. Persist `last`
in `settings` under `sync.hlc`. On receiving a change-set, `last_ms = max(last_ms, its ms)`.

### 6.2 Shape

```ts
type ChangeSet = {
  v: 1;
  hlc: string;
  member: string;                 // member_id of the author
  ops: Op[];
};
type Op =
  | { entity: string; id: string; op: 'upsert'; fields: Record<string, unknown> }   // only fields that changed
  | { entity: string; id: string; op: 'delete' };
```

`entity` is the table name. `fields` for `transactions` may include `money` (§4.3); it never includes
`workspace_id`, `created_at`, or any owner-scope column. One change-set per committed local database transaction.

### 6.3 Capture — `withCapture`

`audit_log` is not the capture point: 5 of 64 repositories write it. Capture is a wrapper every write to a
`SHARED_TABLES` row goes through, in `packages/db/src/sync/capture.ts`:

```ts
await withCapture(tx, { bookId, entity, id }, async () => { /* the existing write */ });
```

It reads the row (and, for `transactions`, its money projection) **before**, runs the write, reads **after**, and
emits an op with only the fields whose values differ (`delete` when the row is gone). Ops from one database
transaction are collected and, at commit, encrypted (§6.4) and inserted into `sync_outbox` in that same transaction
— the change-set is durable exactly when its rows are. A write outside a shared book emits nothing.

**Completeness test** (`capture.test.ts`): for every exported function of every repository under `repos/`, run it
against an in-memory database seeded with one shared book, snapshot all `SHARED_TABLES` before and after, and fail
if any row changed without an op describing it. A repository that fails this cannot be merged.

### 6.4 The log entry

```ts
type LogEntry =
  | { kind: 'change';   seq?: number; deviceId: string; epoch: number; hlc: string; iv: string; ct: string; sig: string }
  | { kind: 'rotation'; seq?: number; deviceId: string; epoch: number; wrapped: WrappedFor[]; sig: string }
  | { kind: 'member';   seq?: number; deviceId: string; memberId: string; deviceName: string; sig: string };
```

`ct = AES-GCM(epochKey[epoch], iv, deflate(JSON(changeSet)), aad = utf8(\`${bookId}:${epoch}:${deviceId}\`))`.
`sig = ECDSA(device.sign, SHA-256(utf8(kind + bookId + epoch + hlc) ‖ ct))` (for `rotation`/`member`, over the JSON
of the entry without `sig`). Base64url throughout. The relay assigns `seq`.

## 7. Apply and merge

Pull returns entries in `seq` order. For each `change` entry: check `sig` against a device that was on the
allow-list at that `seq` (the relay includes the device's public key in the pull response); decrypt with
`book_epoch_keys[epoch]` (skip and retry later if that epoch's key has not arrived yet); apply in one local database
transaction:

```
for op in cs.ops (in order):
  if tombstones[op.entity, op.id] exists: continue
  if op.op == 'delete':
    tombstones[op.entity, op.id] = cs.hlc
    delete row and its dependent rows (entries, book_transactions, transaction_flags for a transaction)
    continue
  for (field, value) in op.fields:
    cur = field_clocks[op.entity, op.id, field]
    if cur == null or cs.hlc > cur:
      if field == 'money': applyMoney(op.id, value)      // §4.3
      else: write column field = value
      field_clocks[op.entity, op.id, field] = cs.hlc
  if the row did not exist: insert it with the written fields plus the table's defaults, and the book tag row
sync_cursor.applied_seq = entry.seq
```

The six rules, as this algorithm enforces them:

1. **Per field, later HLC wins** — the `field_clocks` comparison.
2. **Money is one atom** — `money` is a single field with a single clock; `applyMoney` replaces every entry.
3. **Delete wins, no resurrection** — a tombstone short-circuits every later op on that row, whatever its HLC.
4. **Structure never destroys money** — a category deleted while a purchase was filed into it: `applyMoney` writes
   the line against the category id; if that `accounts` row is now a tombstone, the line is written against the
   book's **Uncategorised** category (created on demand, one per book, id derived as `uuidv5(bookId, 'uncategorised')`
   so every device makes the same one).
5. **Duplicates are not conflicts** — two ids are two rows; nothing merges rows.
6. **Idempotent** — re-applying an entry with `seq ≤ applied_seq` is skipped; re-applying a change-set otherwise
   changes nothing because every clock comparison fails.

Local writes go through the same path: a local op is applied to the local database directly by the repository, and
its clock recorded in `field_clocks` by `withCapture`, so a later incoming op is compared against it.

**Applying to the payer's own transaction** (someone else edited money you paid): `applyMoney` keeps the existing
asset account (§4.3 step 3), so the card's statement and balance move as if the payer had typed it.

## 8. Invites, devices, ownership

### 8.1 Invite a person

Owner's device:

1. `inviteId = uuidv7()`, `S = random(16 bytes)`, `expiresAt = now + 7 days`.
2. Wrap the current epoch key under `S` (§5.3).
3. `putInvite(bookId, { inviteId, wrapped, expiresAt, sameMember: false, sig })`, `sig` over the JSON without `sig`.
4. Show the **code**: `base32crockford(inviteIdBytes(16) ‖ S(16))` = 52 chars, drawn in groups of 4; and the
   **link**: `cicis://join/<code>`. A **Share** button hands the link to the share sheet.

Joining device:

5. Parse the code; `claimInvite(inviteId, deviceKeys, deviceName)`. The relay checks the owner's `sig`, expiry, and
   that the invite is unclaimed and the book has fewer than 5 devices; allow-lists the device; marks the invite
   claimed; returns `{ bookId, epoch, wrapped, sameMember, memberId? }`.
6. Unwrap the epoch key with `S`; store it (§5.4); insert `shared_books` with `role='member'`, `member_id =
   sameMember ? memberId : uuidv7()`; append a `member` log entry with its name.
7. `pull(bookId, 0)` and apply everything.

### 8.2 Link your own device

**Link a device**, under Members on the owner's or a member's own row: identical to §8.1 with `sameMember: true`
and `memberId` = the inviter's. The joining device becomes another device of that member. Owner status follows the
member (the relay's owner set gains the new device when the inviter is an owner).

### 8.3 The join check

Before step 6, the joiner compares the book's `base_currency` (sent in the claim result, in the clear — a currency
code is not a secret) with its own workspace base currency. Different → refuse: *"This workspace keeps its money in
IDR; this app keeps yours in SGD. Sharing across currencies isn't supported yet."* Nothing is stored.

### 8.4 Remove a device

Owner removes any device; a member removes their own (also **Leave**, which removes all of their devices).

1. `removeDevice(bookId, deviceId)` — the relay drops it from the allow-list (no more append or pull).
2. Mint `epochKey[n+1]`; wrap it for every remaining device (§5.2); `append({ kind: 'rotation', epoch: n+1, wrapped })`.
3. Every later change-set from this device uses epoch `n+1`. Other devices, on pulling the rotation, unwrap their
   copy, store it, and switch. A device offline through two rotations applies both in `seq` order.

The removed device keeps what it downloaded and cannot read epoch `n+1`. A lost phone is this, done from any other
device.

### 8.5 Ownership

`shared_books.role`. The relay keeps the set of **owner device ids** for authorising `removeDevice`, `setOwners`,
`putInvite`, `deleteBook`. **Make owner** on a member: `setOwners(bookId, [...owners, ...thatMember'sDevices])` and a
`book_members` op setting `role`. If every owner device is gone, the book is **frozen**: members keep recording
locally and syncing among themselves but nobody can invite, remove or rotate. **Stop sharing** (owner):
`deleteBook`; every other device, on the next failed pull (`410 Gone`), sets `unshared_at` and shows the book as
read-only, *"No longer shared by Fandri"*. Nothing is deleted on anyone's phone.

## 9. The relay

One Cloudflare Worker, one Durable Object per book, DO storage only. Source lives in `apps/relay/`.

### 9.1 Authentication

Every request carries:

```
X-Device:    <deviceId>
X-Timestamp: <unix ms>
X-Signature: base64url(ECDSA(device.sign, SHA-256(method + "\n" + path + "\n" + timestamp + "\n" + hex(SHA-256(body)))))
```

The Worker rejects a timestamp more than 5 minutes off, an unknown device, a removed device, or a bad signature.
`POST /books` and `POST /invites/:id/claim` are the two calls made by a device not yet on any allow-list; they carry
the device's public JWKs in the body and are verified against those.

### 9.2 Endpoints

| Method and path | Auth | Body → Response |
|---|---|---|
| `POST /books` | new device | `{ signJwk, agreeJwk, deviceName, baseCurrency }` → `201 { bookId }`; caller becomes the sole owner |
| `POST /books/:id/entries` | member | `LogEntry` without `seq` → `201 { seq }` |
| `GET /books/:id/entries?since=N` | member | → `200 { entries: (LogEntry & { seq, signJwk })[], latest }` — at most 500 per page |
| `POST /books/:id/invites` | owner | `InviteRecord` → `201` |
| `POST /invites/:id/claim` | new device | `{ signJwk, agreeJwk, deviceName }` → `200 { bookId, epoch, wrapped, sameMember, memberId, baseCurrency }`; `409` if claimed, `410` if expired, `403` bad owner sig, `429` if 5 devices |
| `DELETE /books/:id/devices/:deviceId` | owner, or the device itself | → `204` |
| `PUT /books/:id/owners` | owner | `{ deviceIds }` → `204` |
| `DELETE /books/:id` | owner | → `204`; every later call on the book answers `410` |

### 9.3 Durable Object state

```
devices: Map<deviceId, { signJwk, agreeJwk, name, addedAt, removedAt? }>
owners:  Set<deviceId>
seq:     number
log:     Map<seq, LogEntry>               // DO storage, one key per seq
invites: Map<inviteId, InviteRecord & { claimedAt? }>
baseCurrency: string
deleted: boolean
```

Nothing else. No names beyond a device's own label, no emails, no receipts, no plaintext.

### 9.4 Client behaviour

`RelayTransport` drains `sync_outbox` in `hlc` order whenever the app is foregrounded and every 30 s while open;
on success deletes the row. It pulls from `applied_seq` at the same times. A failed request leaves the outbox
intact and is retried on the next tick with exponential backoff capped at 5 minutes. Nothing in the UI ever waits
on the relay.

## 10. Entitlement

`verifyEntitlement(bookId): Promise<boolean>` in `apps/relay/src/entitlement.ts` **returns `true`** in this build.
It is called on `POST /books` and on `POST /books/:id/entries` from owner devices, and its result is the only thing
that will gate them later. When tiers arrive: the owner's device sends its StoreKit 2 signed transaction on
`POST /books`, the Worker verifies the chain and keeps `{ entitledUntil }` only; a lapse makes the book read-only
on the relay after 30 days. Members never present a receipt. Android gets a second verifier behind the same seam.

## 11. Screens

Native kit only; rows and sheets, no new components.

**Settings → Workspaces → *a workspace***

| Row | When | Does |
|---|---|---|
| **Share this workspace** | owner scope, `books.kind != 'shared'` or not yet in `shared_books` | one explanatory paragraph (what the other person will and will not see; the backup-file line from §5.1), then the code, the link, **Share** |
| **Members** group | shared | one row per member, name + role; under it one row per device: name, "last synced 2 min ago", **Remove** (owner, or own device) |
| **Link a device** | shared, on your own member row | §8.2 |
| **Make owner** | owner, on another member | §8.5 |
| **Leave** | member, on own row | §8.4 for all own devices |
| **Stop sharing** | owner | confirm sheet, then `deleteBook` |
| **Sync** line under the name | shared | "Up to date" / "3 changes waiting" / "Not synced since Tue" / "No longer shared by Fandri" |

**Workspace switcher:** a shared book's subtitle reads **Shared with Dewi** (names of the other members). Its **+**
menu gains **Join a workspace**: paste a code (or arrive by `cicis://join/…`), see the book's name and the inviter's
name, **Join**, then the currency check (§8.3).

**On a transaction in a shared book:** the row's subtitle carries `paidLabel`, and `· paid by Dewi` when
`paidBy` is not this device's member. The receipt shows the same two facts. No link anywhere in a shared book leads
to an account, a card, a statement or a balance.

**The add form in a shared book:** currency flag drawn but disabled; no With row; otherwise unchanged.

## 12. Privacy

- App Privacy: whether end-to-end encrypted content counts as "collected" is verified against Apple's current
  definitions at the submission that carries sharing, and answered truthfully either way. If declared: *Other User
  Content — not linked to identity — not used for tracking*.
- `PrivacyInfo.xcprivacy`: unchanged; the relay is a first-party domain, not a tracking domain.
- What the relay stores is exactly §9.3, and deleting a book deletes all of it.

## 13. Tests

Money paths: mutate-twice review applies to every step.

| Test | Proves |
|---|---|
| `convergence.property.test.ts` | N in-memory databases, random local edits with offline stretches, `MemoryTransport` delivering in random interleavings → identical `SHARED_TABLES` on all. ≥ 200 programs per run. |
| `money-atom.property.test.ts` | after every apply in the above: every transaction's category entries sum to minus its asset entry, and every asset entry names either a real local account or the payer's placeholder |
| `delete-wins.test.ts` | edit→delete and delete→edit, every arrival order; the row is gone on all devices |
| `idempotent.test.ts` | applying any entry twice ≡ once |
| `capture.test.ts` | §6.3 completeness, over every exported repository function |
| `rotation.test.ts` | a device removed at epoch n cannot decrypt any entry at n+1; a device present throughout reads both; two rotations racing both apply |
| `hlc.test.ts` | never goes backwards under random wall-clock jumps; ordering is total |
| `crypto.kat.test.ts` | HKDF-SHA-256, AES-GCM, ECDSA P-256, ECDH P-256 against published vectors |
| `relay.test.ts` (Miniflare) | every `4xx` in §9.2; signature and allow-list refusals; one-time claim; 5-device cap; `410` after delete; owner-only calls |
| `sharing.spec.ts` (Playwright, phone + desktop) | two browser contexts, one local Worker: share, join, record on both, edit each other's, remove a device, rotate, same Cashflow total on both |

## 14. Build order

Each step lands green, reviewed, before the next.

| # | Step | Done when |
|---|---|---|
| 1 | **Capture and merge, no network.** Migration 0056; `SHARED_TABLES`; `withCapture` in every book-scoped repository; HLC; `applyEntry`; `applyMoney`; placeholder accounts; `MemoryTransport`. | `capture`, `convergence`, `money-atom`, `delete-wins`, `idempotent`, `hlc` tests green; full existing suite untouched. |
| 2 | **Keys.** Keychain plugin chosen and wired; device keys; epoch keys; wrap/unwrap for device and invite; at-rest encryption; log entry encrypt/sign/verify. | `crypto.kat`, `rotation` green; step-1 tests still green with encryption on. |
| 3 | **The relay.** `apps/relay`, Worker + DO, every endpoint, signed requests; `RelayTransport`; outbox draining; polling. | `relay.test.ts` green under Miniflare; two real simulator installs converge through a local Worker. |
| 4 | **Screens.** Everything in §11. | `sharing.spec.ts` green on both projects. |
| 5 | **Hiding.** Placeholder accounts excluded from every owner-scope reader listed in §4.3; disabled flag and no With row in a shared book. | one e2e per excluded page asserting the placeholder is absent. |
| 6 | **Ownership edges.** Make owner, Leave, Stop sharing, the frozen and `410` cases. | covered in `sharing.spec.ts`. |

Estimate at the fast-track cadence: step 1 is the largest; steps 2–3 together about the size of step 1; 4–6
together smaller than 1.

## 15. Left open

- The keychain plugin (step 2 picks; must support iOS synchronizable items).
- The exact membership of `SHARED_TABLES` (step 1 confirms each against the code).
- The relay's domain and Cloudflare account (before step 3).
- App Privacy wording for E2E content (at submission).
- **Encrypted backups** — separate work, and the moment they exist the device keys can travel in them. Independently
  urgent: today's backup file is a plaintext copy of a household's finances wherever it lands.
- Everything in §0's table, each behind its named seam.
