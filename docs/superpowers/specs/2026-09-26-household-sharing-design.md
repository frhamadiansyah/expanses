# Household sharing — design

Status: draft for review · 2026-09-26
Builds on: `2026-09-17-workspaces-design.md` §5.4 (the room left for sharing), `2026-09-18-data-safety-design.md` (the promise a backup file makes).
Reference looked at: Monveo's Space sharing (sign-in gate, invite link + code, 7-day expiry, 5 members).

## 1. What we are building

Two people in one household record into one workspace, each paying from their own accounts, and both see the
same book: the same categories, budgets, bills and transactions, with the same numbers, on both phones, whether or
not the other person is awake.

**What the user said.** Sharing works like Monveo: an invitation code from your partner or family member joins
you to their space. Sharing is the only reason to talk to a server. The server must not be able to read anything.
There are no accounts. The thing in the middle is a relay we run, not the members' own cloud folders. The person who
creates the shared workspace pays; the people they invite do not.

**What this design assumes, and the user should correct if wrong:**

- The household is small — two people typically, five at most — and they trust each other. This is not a team
  product; it needs no approval flows, no audit of who changed what beyond the history the app already keeps.
- A member should be able to edit anything in the shared book, including a purchase the other person paid for.
  Re-filing your spouse's purchase into the right category is the whole point.
- "Works offline" is not negotiable. A phone with no signal records exactly as it does today; the relay catches up
  later. The local database is the truth on every device.
- Android is coming. Nothing here may depend on an Apple-only service.

**Success looks like:** two phones, one shared workspace, both recording for a month, and the Cashflow page shows
the same total on both. A lost phone is cut off in one tap and the other members carry on. Nobody, including us, can
read a shared purchase without one of the phones.

## 2. The decisions, and why

| Decision | Chosen | The alternative, and why not |
|---|---|---|
| What signing in buys | **Sharing only.** No cloud backup, no multi-device sync of personal data. | Monveo bundles all four behind one sign-in. Each extra one is more of other people's money in our custody, and the App Store privacy answer changes for everyone. Backup and multi-device stay separate decisions (§12). |
| Can the server read it | **No — end-to-end encrypted.** Keys live only on members' devices. | A readable server is easier to build, debug and support, and it is a database of households' spending that we hold. The product's whole difference from Money Lover is that we cannot read your money. |
| Identity | **Keys only. No accounts.** A device keypair, an invite code, a named "link a device" flow, a revocable device list. | Sign in with Apple/Google recovers membership on a new phone without a backup. With E2E it buys little else, drags an identity provider onto Android, and puts a user record on a server that otherwise knows nobody. |
| What sits between the phones | **A relay we run.** | A folder the members share in their own cloud keeps the privacy card untouched and gives us nothing to operate, but has no push, weak ordering, and awkward file access on iOS. CloudKit is free and Apple does the work, and it forecloses Android. |
| Who pays | **The owner. Members join free, on any platform.** | Everyone paying means telling your wife to subscribe before she can help with the groceries, and her Android receipt is invisible to your iOS one. |
| Conflicts | **Last-writer-wins per field, money as one atom, delete wins, no conflict inbox.** | Per-record LWW silently drops one person's edit. A full CRDT is a heavy library for records that never need character merging. A conflict queue is a punishment nobody will use. |

Two things the user asked that shaped these, recorded so the reasoning survives:

- *"Can it work multi-platform?"* Keys are bytes and the invite is text; WebCrypto exists in WKWebView and Android's
  WebView alike. Keys-only is the **better** option across platforms. Sign in with Apple is the one that hurts there.
- *"If I add cloud backup later, do I need accounts?"* No. With E2E, an account only rescues someone if the server
  can do something with their data, and it cannot. What survives a lost phone is a key, and keys survive through the
  platform keychain, a written recovery phrase, or a password-wrapped copy on a server — the last needs an account,
  the first two do not. Backup does not force this decision; it stays open.

## 3. Out of this build

- Cloud backup of any kind. The backup is still the file you download or share (data-safety spec).
- Syncing your **personal** workspace between your own devices. Linking a second device to a *shared* workspace is
  in (§6); syncing everything you own is not.
- A web version. A browser has nowhere safe to keep a key.
- Accounts, sign-in, passwords, email.
- The folder backend. The transport is behind one interface (§8.5) so it could come later; it is not designed here.
- Android's receipt verification. The entitlement check has one named slot for it (§10); iOS ships first.
- Viewer and admin roles. Two roles only: owner and member (§7).

## 4. The model

### 4.1 Where the truth is

**Each device.** Every member holds the whole shared workspace in their own local SQLite, exactly as every
workspace is held today, and it works with no signal. The relay holds a **journal** of encrypted changes and a
**rendezvous** for invites. If the relay vanished, nobody would lose a row; they would stop hearing from each other.

### 4.2 What a shared workspace is

A `books` row with `kind = 'shared'` — the row the workspaces build already reserved. It has everything a
workspace has (its own base currency, its own categories, budgets and bills) plus a `shared_books` side row (§9.1)
carrying the relay's id for it and the current key epoch. Nothing is added to `books` itself: the ORM names every
column on insert, so a new column on an existing table breaks any database stopped at an older version (the rule
from migration 0028 and the workspaces design §4).

### 4.3 What syncs, and what never does

**Syncs — everything scoped to the book:**

| Thing | Rows |
|---|---|
| The book itself | `books` (name, currency, `count_events_in_budget`), `shared_books` |
| Categories | the income/expense `accounts` rows tagged into the book by `book_categories`, and that tag |
| Category sets | `category_sets` and their members, where tagged to the book |
| Transactions | `transactions` + `book_transactions`, with the payment *label* rather than the ledger entries (§4.4) |
| Splits, shares, MCC, channel, excluded, event, photos | the side rows a transaction carries, photos as the file bytes (§4.5) |
| Budgets and bills | `budgets`, `bills` and their items, scoped to the book |
| Events | `events` and `event_plan_items` when the event belongs to the book |

**Never syncs — the owner scope, which §5.4 of the workspaces design fenced off:**

accounts and cards, balances, statements, points and the reward programs, the net worth pages, goals and set-aside,
loans and debts, securities, FX rates, settings, other books. A member sees none of these of yours, and you none of
theirs.

### 4.4 A purchase the other person paid for

On the payer's phone a purchase is a real ledger transaction: entries against their card and against a category.
On the other member's phone the card does not exist and never will. The synced record therefore carries:

- the payment **label** the workspaces design already asked for: account name and, for a card, its last four —
  "BCA KrisFlyer ···· 1467";
- **who paid**: the member id (§5.3), so the row can say "paid by Fandri".

On the member's device the purchase is materialised as an ordinary `transactions` row whose money entry is posted
against a **placeholder account for that member**: one `accounts` row per other member, `kind = 'asset'`,
`subtype = 'cash'`, named after them, with a `book_member_accounts` side row that marks it as *external*. Every
existing reader — Cashflow, budgets, bills, the day list, splits — works unchanged, because the row is shaped like
every other row. What the side row changes: the placeholder is hidden from the Accounts page, the Net worth page,
transfers, Paid-with pickers and the tax report, and its balance is meaningless and never shown.

This is a projection, not a second model: the alternative — a side table of "foreign transactions" and a change to
every reader that sums money — touches dozens of files to express one fact, that this purchase came from someone
else's account.

### 4.5 Photos

A receipt photo attached to a shared purchase syncs as an encrypted blob keyed by the photo's id, pulled lazily when
the row is opened rather than with the change log. Photo downscaling (already queued) becomes a prerequisite here:
a 4 MB receipt through a relay is a cost nobody asked for.

## 5. Keys

### 5.1 The device key

Every install generates one keypair on first run: **Ed25519** for signing, **X25519** for key agreement, derived
from one 32-byte seed. The seed lives in the platform keychain — iOS Keychain marked synchronizable so iCloud
Keychain restores it to a replacement iPhone; Android's equivalent through the same plugin. The public half is the
device's identity everywhere.

The seed is **not** written into the backup file. Backups are plaintext today, and a key in a plaintext file is a key
in the clear. Until backups are encrypted — separate work, noted in §15 — the keychain is the seed's only home, and a
phone restored from a backup file alone rejoins the shared workspace by an ordinary invite. That is the honest
trade, and it is stated on the Share screen in one line.

### 5.2 The workspace key

One **AES-256-GCM** key per shared book per **epoch**. Epoch 1 is minted by the owner's device when the book is
shared. Every change-set and snapshot is encrypted under the key of the epoch it was written in and carries the epoch
number in its clear header. A revocation mints a new epoch (§6.3). A device keeps every epoch key it has ever
received, so history it already holds stays readable; a revoked device never receives the epoch minted after it.

### 5.3 Members

A member is a stable id, a display name the member typed, and the set of devices they hold. The first device that
joins under an invite *is* the member; a device that joins under a "link a device" invite is added to the same member
(§6.2). The relay stores none of this beyond device public keys; member names travel inside the encrypted log.

### 5.4 Primitives

WebCrypto only — `crypto.subtle` is present in WKWebView and Android WebView. Ed25519 and X25519 are available in
WebKit since iOS 17, which is the deployment target. No crypto library is added; a key-derivation or AEAD mistake
is a data-loss bug with no reset button, so the surface is kept to what the platform ships and what a known-answer
test can pin.

## 6. Invites, devices, revocation

### 6.1 Inviting a person

The owner taps **Share this workspace**. Their device:

1. mints an invite id and a 128-bit secret `S`;
2. wraps the current epoch key under a key derived from `S` (HKDF), and posts `{inviteId, wrappedKey, expiresAt,
   entitlement token (§10), signature}` to the relay — `S` never leaves the device;
3. renders the **code** and the **link**: the code is `inviteId ∥ S`, base32 in groups of four, about forty
   characters; the link is `https://cicis.app/join#<code>`, with the code in the fragment so it never reaches a
   web server's log. Both shown; the link is what you send, the code is what you read aloud.

The joiner pastes the code or taps the link. Their device:

4. presents its public key and the invite id to the relay, which checks the owner's signature and the expiry, adds
   the device to the book's allow-list, returns the wrapped key and the snapshot pointer (§8.3), and marks the
   invite **claimed** — one use, ever;
5. unwraps the epoch key with `S`, pulls the snapshot, follows the log from there.

**Expiry 7 days. One claim. Five devices per book** (Monveo's numbers; they are sensible hygiene and there is no
reason to differ). An invite is revocable before it is claimed.

**The wrong person.** Anyone holding the code before it is claimed can join, exactly as with a Monveo code. Three
things bound it: the code dies at first use; the owner sees the new device appear by name within seconds, with
**Remove** one tap away; and each side can show a **safety number** — the first eight characters of a hash over the
two devices' public keys — for the two people to compare aloud if they care to. That is Signal's answer and it is
enough for a household.

### 6.2 Linking your own device

**Link a device**, a door of its own under the book's members, is the same mechanism with one difference: the invite
is marked *same member*, so the joining device is added to the inviter's member rather than becoming a new one. Your
iPhone and your Mac are then one "Fandri" with two devices. It exists as a named flow rather than "invite yourself"
because the device list has to know which devices are yours to show them as yours, and because the Mac tier will
lean on it.

### 6.3 Removing a device

The owner removes any device; a member removes their own. Removal:

1. tells the relay to drop the device's key from the allow-list — it can no longer append or pull;
2. mints the next epoch key on the removing device;
3. wraps the new key for every remaining device's X25519 public key and posts the set to the relay as a **rotation
   record**; each device unwraps its own copy on next sync;
4. writes every later change under the new epoch.

The removed device keeps what it already downloaded — no system can take back what a phone already has — and cannot
read anything written after step 4. A device offline through a rotation picks up the record when it returns; two
rotations racing are ordered by the relay's sequence and both applied in turn.

**A lost phone** is exactly this, done by whichever member still has a phone. Rejoining later is an ordinary invite.

### 6.4 Ownership

A book has at least one owner. An owner may make any member an owner, and a second owner is encouraged at the point
of sharing ("Make Dewi an owner too, so the workspace survives a lost phone"). If the last owner's every device is
gone, the members keep their local copies and their relay access, and nobody can invite, remove or rotate: the book
is frozen, not lost. The way out is that a member creates a new shared book and the others join it — which is why
the second owner is asked for up front.

**Unsharing.** The owner may stop sharing: the relay's book is deleted, every other member's copy is marked *no
longer shared* and stays on their phone as an ordinary read-only workspace they can archive or keep. Nobody's rows
are deleted by someone else's tap.

## 7. Roles and what a member may do

Two roles. **Owner**: everything a member may, plus invite, remove devices, promote, unshare, and hold the
entitlement. **Member**: record, edit and delete anything in the book — including a transaction the other person
paid for — create and change categories, budgets, bills and events, link their own devices, remove their own devices,
leave.

Editing money someone else paid is allowed, and the change lands on the payer's real ledger through the ordinary
apply path (§9.4). It is recorded, like every change, with who made it; the history view shows "amount changed by
Dewi". This is a household, not an approval workflow.

## 8. The relay

### 8.1 What it holds, and what it cannot know

Per shared book: an opaque book id; the allow-list of device public keys; a sequence counter; the encrypted change
log; the current snapshot; pending invites; rotation records; the entitlement state (§10). It never holds a key it
could use, a member's name, a currency, a figure, or anything about the owner scope.

### 8.2 Shape

A **Cloudflare Worker** with one **Durable Object per book** and **R2** for blobs. The Durable Object gives each
book a single-threaded owner for its sequence counter, allow-list and websocket fan-out, which is precisely the
ordering guarantee the merge relies on; R2 holds change-set bodies over a few KB, every snapshot and every photo.
Cost at household scale rounds to zero; the operational fact that matters is that it is one Worker and one script.

Every request is signed by the device's Ed25519 key over `(method, path, body hash, timestamp)`; the Worker checks
the signature, the timestamp is within five minutes, and the key is on the book's allow-list. There is no session.

### 8.3 Surface

| Call | Who | Does |
|---|---|---|
| `POST /books` | owner device | creates a book id, allow-lists the caller, records the entitlement (§10) |
| `POST /books/:id/changes` | any member device | appends one encrypted change-set; returns its `seq` |
| `GET /books/:id/changes?since=seq` | any member device | returns change-sets after `seq`, oldest first |
| `WS /books/:id` | any member device | pushes "new seq" so a phone pulls at once rather than on a timer |
| `PUT /books/:id/snapshot` | any member device | replaces the encrypted snapshot late joiners start from |
| `POST /books/:id/invites` | owner device | stores a signed invite (§6.1) |
| `POST /invites/:id/claim` | the joining device | verifies, allow-lists, returns wrapped key + snapshot pointer, marks claimed |
| `DELETE /books/:id/devices/:key` | owner, or the device's own member | drops a key from the allow-list |
| `POST /books/:id/rotations` | the removing device | stores the wrapped new-epoch keys |
| `POST /books/:id/acks` | any member device | "I have applied up to seq N", for retention |
| `DELETE /books/:id` | owner device | unshares (§6.4) |

### 8.4 Retention

Change-sets are kept until every allow-listed device has acknowledged past them, plus thirty days, then dropped —
the log is a queue, not an archive. The snapshot is replaced by whichever device last uploaded one and is refreshed
by the owner's device weekly or after 500 changes, whichever first, so a late joiner never replays months. Photos
stay while the transaction they belong to exists. A claimed or expired invite is deleted.

### 8.5 The transport is an interface

The app talks to `SyncTransport` — `append`, `pull`, `subscribe`, `putBlob`, `getBlob` — and the relay client is its
first implementation. This is not to design a second one now; it is so that the sync engine, the crypto and the
merge can be tested against an in-memory transport, and two databases in one test process can converge with no
network at all (§13).

## 9. Change-sets, capture and merge

### 9.1 New tables

All side tables, no new columns on existing tables, one migration (`0056_household_sharing.sql`):

| table | key | holds |
|---|---|---|
| `shared_books` | `book_id` | relay book id, current epoch, this device's role, `shared_at`, `unshared_at` |
| `book_members` | `member_id` | display name, `is_self`, joined at |
| `book_devices` | `device_public_key` | `member_id`, device name, added at, removed at |
| `book_member_accounts` | `account_id` | the placeholder account for `member_id` (§4.4) |
| `book_epoch_keys` | `(book_id, epoch)` | the wrapped epoch key, decryptable only by this device |
| `sync_outbox` | `id` | change-sets written locally and not yet acknowledged by the relay |
| `sync_cursor` | `book_id` | last relay `seq` applied, last `seq` acknowledged |
| `field_clocks` | `(entity, id, field)` | the HLC and device that last wrote each synced field (§9.4) |

The device seed is **not** in the database: it is in the keychain, and in the backup file under its own encryption.

### 9.2 The clock

Every change carries a **hybrid logical clock**: 48 bits of wall-clock milliseconds, 16 bits of counter, and the
device public key as the final tiebreak. A device never issues a value below one it has seen. Two devices given the
same set of changes compute the same order, offline, without asking anyone — which is what lets the merge be a pure
function.

### 9.3 Capture — and why `audit_log` is not it

The workspaces design said every change already lands in `audit_log` and a sync could build on it. **That is not
true today: 5 of the 64 repositories write `audit_log`** (`ledger`, `accounts`, `books`, `goal-funding`,
`workspaces`). Budgets, bills, category edits, events, splits and settings do not. Capture is a piece of work, not a
given, and it is the first thing this build does.

Capture happens at the repository boundary, not in the UI: every repository that writes a book-scoped row does so
through `recordChange(tx, bookId, ops)` inside the same database transaction, so a change-set is committed exactly
when its rows are, or neither is. A change-set is:

```
{ hlc, device, epoch, member, ops: [ { entity, id, op: 'upsert' | 'delete', fields: { name: value, ... } } ] }
```

with one change-set per committed database transaction, so a split bill's five rows travel as one unit. It is
JSON, compressed, encrypted under the epoch key, signed by the device, and appended to `sync_outbox`; a background
loop drains the outbox to the relay and marks each row acknowledged on the relay's `seq`.

**Completeness is enforced, not hoped for.** A test walks every exported repository function against an in-memory
database with a shared book, diffs every book-scoped table before and after the call, and fails if a row changed
without a change-set that describes it. A repository that writes a shared row and does not capture it cannot be
merged.

### 9.4 Apply and merge

Pull returns change-sets in relay order. Each is decrypted with its epoch's key, its signature checked against a
device on the book's list at that time, and applied in one local transaction under these rules:

1. **Per field, the later HLC wins.** `field_clocks` holds the winner for every synced field of every synced row; a
   field in an incoming change-set older than the stored clock is ignored, a newer one is written. If you change the
   note while your spouse changes the category, both survive.
2. **Money is one atom.** A transaction's amount, currency, charged amount, and its split and share rows are a single
   field for this purpose, named `money`, with one clock. The later complete edit wins whole. Merging them apart can
   produce an amount of 200.000 over splits summing to 150.000 — a number nobody typed — and this rule exists to
   make that impossible.
3. **Delete wins.** A delete writes a tombstone, and a tombstone beats every edit of that row whatever its clock:
   a deleted row never resurrects. The losing edit is kept in `audit_log` on every device, so the history view can
   show it and a person can re-enter it.
4. **Structure never destroys money.** A category deleted on one phone while a purchase is filed into it on another
   leaves the purchase in place, uncategorised. A budget or bill merges per field like anything else. Marking a bill
   paid is idempotent.
5. **Duplicates are not conflicts.** Two members recording the same Superindo run is two rows, and the app must
   never merge them. A "possibly the same purchase" hint on same-day, same-amount, same-book rows is cheap and
   truthful; it is a hint, never an action.
6. **Apply is idempotent.** Re-applying a change-set already applied changes nothing, so a crash between pull and
   cursor update is harmless.

There is **no conflict inbox**. The rules always produce an answer; the history is where a person goes when the
answer was wrong.

### 9.5 Applying to the payer's ledger

On the device that paid, an incoming edit to `money` on its own transaction re-posts the ledger entries through the
same function a local edit uses, so the card's statement and balance move exactly as if the payer had typed it.
On every other device the transaction is the placeholder-account projection (§4.4) and `money` is simply written.

## 10. Entitlement

The owner needs the subscription; members do not. On `POST /books`, the owner's device sends its StoreKit 2
**signed transaction** (a JWS); the Worker verifies the chain against Apple's root, checks the product id and the
expiry, and stores `{entitledUntil}` on the book — nothing else from the receipt. Every invite the owner signs
carries `entitledUntil`, and the relay refuses `POST /books/:id/changes` from any device once it has passed, with a
grace period of 30 days in which the book is read-only for everyone and the owner is told why. Members' devices
never present a receipt.

This is the relay's one piece of knowledge that touches an identity: a StoreKit transaction is tied to an Apple
account. The Worker verifies and discards it; only the expiry is kept. **Android** gets a second verifier behind the
same `verifyEntitlement(payload)` seam when the Android app ships; until then an Android member can join and record
but not create a shared book.

Consistent with the pricing rule recorded on 2026-09-19: a lapsed subscription never deletes anything — every
device keeps its full local copy of the book and can keep recording into it locally; only the relay stops carrying
changes.

## 11. What the app shows

**Settings → Workspaces → a workspace** gains, for a book that is or could be shared:

- **Share this workspace** (owner, unshared book): explains in one paragraph what the other person will and will not
  see, asks for a second owner, then shows the code and the link with a **Share** button to the share sheet.
- **Members**: each member with their devices under them, the device's name and when it last synced; **Remove** on
  every device; **Make owner** on a member; **Link a device** on yourself; **Leave** on yourself; **Stop sharing** on
  the owner.
- **Join a workspace** (a door of its own, in the workspace switcher): paste a code, or arrive by link; shows the
  workspace's name and the inviter's name before **Join**; then the safety number.
- A shared workspace is labelled **Shared with Dewi** in the switcher where a personal one says nothing, so the two
  never look alike.
- **Sync state**, quietly: "Up to date", "3 changes waiting", "Not synced since Tuesday" under the workspace name.
  Never a spinner over the content; recording never waits for the relay.

**On a purchase in a shared book:** the payment label, and "paid by Dewi" when it was not you. On the receipt, the
same two lines. Nowhere in a shared book is there a link to an account, a card, a statement or a balance.

Every screen follows the native kit already in use; this design adds rows and sheets, not new components.

## 12. Privacy and the App Store

- **App Privacy.** Apple counts data as *collected* when it is transmitted off the device in a way that lets the
  developer access it. Content encrypted end-to-end that we cannot decrypt may therefore still qualify as **not
  collected** — and it may not; Apple's guidance has moved on this. **Verify against the current App Privacy
  definitions before the submission that carries sharing, and answer whatever is true.** If it must be declared, it
  is "Other User Content — not linked to identity — not used for tracking", which with keys-only is honestly the
  strongest form of that entry. This is marked as the design's one unverified claim, deliberately.
- **Privacy manifest.** The relay's domain is a first-party service, not a tracking domain; nothing changes in
  `PrivacyInfo.xcprivacy` beyond the existing declarations.
- **What we hold and for how long** is written down in §8.4 and must be true in the Worker's code: bounded logs,
  one snapshot, photos for the life of their row, nothing after unsharing.
- **Backup and multi-device sync of personal data remain separate decisions.** If they come, the device-key and
  epoch machinery here is what they would reuse; nothing in this design assumes they will.

## 13. Testing

Money paths, so the review rule is mutate-twice: plant a plausible bug and a test must fail; delete a neighbouring
guard and a test must fail.

- **Convergence, as a property.** Two or more in-memory databases, a random program of local edits on each including
  offline stretches, an in-memory transport delivering in arbitrary interleavings: every database ends identical on
  every synced table. Hundreds of random programs per run, the way set-aside's rulings were checked.
- **The money atom.** Under the same random programs, on every database after every apply: every transaction's splits
  sum to its amount, and every shared transaction's shares sum to its own share. A merge that breaks this is the bug
  the rule exists for.
- **Delete wins; resurrection is impossible.** Edit-then-delete and delete-then-edit, in every order of arrival.
- **Idempotent apply.** Every change-set applied twice equals once.
- **Capture is complete** (§9.3): every exported repository function, diffed.
- **Rotation excludes.** A device removed at epoch *n* cannot decrypt any change-set at epoch *n+1*; a device present
  through the rotation can read both.
- **Known answers** for HKDF, AES-GCM, Ed25519 and X25519 against published vectors, so a platform difference between
  WebKit and Android surfaces as a red test and not a household that cannot read each other.
- **The clock never goes backwards** on a device, under randomised wall-clock jumps.
- **The relay** under Miniflare: signature and allow-list refusals, one-time claim, expiry, retention arithmetic,
  the entitlement gate and its grace period.
- **End to end**: two Playwright contexts, one local Worker, one shared book; record on both, edit each other's,
  remove a device, rotate, and read the same Cashflow total on both — on the phone project and on desktop.

## 14. Build order

Each step lands green on its own and is reviewed before the next.

1. **Capture and merge, no network.** Migration 0056; `recordChange` in every book-scoped repository; the
   completeness test; the HLC; `field_clocks`; apply with the six rules; convergence and money-atom properties over
   an in-memory transport. The largest step and the one that decides whether the rest is worth building.
2. **Keys.** Device seed in the keychain and in the backup file; epoch keys; wrap and unwrap; known-answer tests.
   No relay yet; encrypt and decrypt through the in-memory transport.
3. **The relay.** The Worker, the Durable Object, R2; the `SyncTransport` client; signed requests; outbox draining;
   push over the websocket; Miniflare tests. Two real installs converge.
4. **Sharing UI.** Share, code and link, join, the members and devices list, link a device, remove, rotation,
   safety number, sync state. The e2e in §13.
5. **The member's view.** Placeholder accounts, the payment label and "paid by", hiding from every owner-scope page,
   the duplicate hint.
6. **Snapshots and photos.** Late joiners; the encrypted photo blob; refresh cadence; retention.
7. **Entitlement.** StoreKit 2 verification in the Worker; the grace period; the Android seam left named.
8. **Ownership edges.** Second owner, promote, leave, unshare, the frozen-book case.

Photo downscaling, already queued, goes before step 6.

## 15. Left open, on purpose

- The App Privacy answer for end-to-end encrypted content (§12) — verified at submission, not assumed now.
- The keychain plugin. Capacitor has no first-party Keychain plugin; the candidates are checked in step 2 for
  `kSecAttrSynchronizable` support, which is what makes a restored iPhone keep its membership.
- Whether events are book-scoped today or owner-scoped. §4.3 lists them as syncing when they belong to the book;
  step 1 confirms which they are and the table follows the truth.
- Android's entitlement verifier, and whether an Android owner can create a shared book before it exists.
- The relay's domain and who administers the Cloudflare account. Operational, not design, and it needs an answer
  before step 3.
- **Encrypted backups.** Not part of this build, but the moment they exist the device seed can travel in them and a
  restored backup becomes a full member again with no invite. Worth doing soon regardless: today's backup file is a
  plaintext copy of a household's finances wherever it lands.
- Ed25519 and X25519 in WebCrypto on Android's WebView — present in current Chrome, confirmed by the known-answer
  tests in step 2 on a real device before anything is shipped there.
