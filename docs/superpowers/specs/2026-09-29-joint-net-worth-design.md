# Joint net worth — design

Status: draft for the owner's review, 2026-09-29. Builds on household sharing
(`2026-09-26-household-sharing-design.md`, "the sharing spec", §n below prefixed **S**). Brainstormed with the owner;
mockups in `.superpowers/brainstorm/62062-1790645752/content/` (not committed).

## 1. Purpose

Two people who share a Household workspace want to see what they own and owe **together**: bank accounts, cards,
deposits, investments, a house, a car, loans. How they file tax decides what "together" means:

- **One tax ID for the household.** The yearly return lists both people's everything, assets and liabilities. The app's
  Net worth and tax report must be the household's.
- **Separate tax IDs.** Each return lists only its owner's items. Net worth stays personal; the partner's shared items
  are visible and usable (pay with, transfer to) but not counted.

Nothing here is Indonesia-specific except the tax report it feeds, which already exists. Joint filing is a two-person
concept in every country that has it.

Success: both phones show the same joint total; each person's private lines never leave their phone; the partner can
pay with a shared card and it lands on the owner's real card; a transfer between the two lands on both real accounts.

## 2. Decisions (from the brainstorm)

| # | Decision |
|---|---|
| D1 | Every item has **one owner**, a person. Sharing is visibility, never co-ownership. |
| D2 | Net-worth sharing is **optional**, off by default, inside a shared workspace. Workspace sharing without it works exactly as today (flatmates, business partners). |
| D3 | Each member **opts in** for themselves. The members who opted in form the **net-worth group**. |
| D4 | The group has a **filing mode**: `joint` (one tax ID) or `separate`. `joint` needs **exactly two** group members. |
| D5 | Setup order: one proposes a mode → every other group member confirms → each reviews their own items → only then are summaries sent. |
| D6 | Any change of mode or group needs **every** group member's confirmation. The old state holds until then. Leaving is unilateral. |
| D7 | Per item, one setting: **Balance + one total** (default) or **Don't share**. `Don't share` is allowed only in `separate`. |
| D8 | Separate → joint: nothing hidden is revealed until its owner taps **Share**. The joint report says "Rina hasn't added N items yet" and is not complete until then. |
| D9 | New items: shared automatically in `joint` (the add form says so); in `separate` the add form has a **Share with Household** switch, on by default. |
| D10 | Transport is **approach A**: the owner's phone computes each shared item's summary and sends only that. Private lines never leave the owner's phone. |
| D11 | The partner sees a shared account or card as: balance, chart, the Household lines, and **one** "Rina's other use" total (no split by workspace). |
| D12 | **Net worth page is one view, chosen by the mode.** `joint`: the household's items and total, grouped by kind as today; owner shown by the icon circle's ring color only (same icon per kind), a legend with each person's subtotal under the total, owner in the item's details. `separate` (or no group): personal, as today. No Mine/Household switch. |
| D13 | Rows stay one line. "Updated …" and "not yet on Rina's phone" live in the item's details, never on the list. The joint tax report does mark items waiting for a year-end value. |
| D14 | **Shared way to pay:** a group member may pick the other's shared account or card in **Paid with**, in the shared workspace only. It lands on the owner's real account or card on the owner's phone (statement, cycle, points). |
| D15 | **Transfer between partners:** one record, both sides land — out of her real account on her phone, into his real account on his phone. |
| D16 | Business-owned items (the business as owner, a company return) are **out of scope**. |

## 3. Glossary

- **Group** — the members of one shared workspace who opted in to net-worth sharing.
- **Group log** — the group's own encrypted log on the relay (§4).
- **Item** — one net-worth row the owner holds: an asset account (bank, cash, e-wallet, deposit, investment, property,
  vehicle, receivable) or a liability account (credit card, loan, payable). One `accounts` row.
- **Summary** — what the owner's phone sends about one item (§5.2).
- **Household lines** — purchases of the shared workspace whose money side is on the item.
- **Other use** — the item's movement in the period that is not Household lines.

## 4. Where it lives: a group log

The shared workspace's log is readable by **every** workspace member: its epoch key is sealed to all of them (S5). A
summary sent there would reach a member who did not opt in — the adult son of D3's example, or a flatmate — and be
hidden only by the app. That breaks D10.

So the group gets its own log: a second shared book on the relay, the **group log**, linked to the workspace
(`group_logs(book_id, group_book_id, invites_json)`), with its own epoch key sealed only to group members' devices. It reuses the
sharing machinery unchanged: HLC, change-sets, sealing, signing, pinning, the relay's Durable Object, removal and
rotation (S5–S9). What differs:

- **No invite code.** Every group member's devices are already pinned through the workspace (S5.4). The proposer's
  phone creates the group log and lets each invited member's pinned devices in. The workspace log carries one row,
  `net_worth_group { groupBookId, invites }`, so members' phones know it exists and can join it. A member outside the
  group learns only that a group exists (and how many invites wait).

  *Correction (task 4, code reality):* the relay admits a device to a book only by an invite claim (S9.3), and a
  rotation in the group log cannot hand a device the key of the entries before it (S9.3 rotations raise the epoch by
  exactly one, and a device reads the log from its first entry). So admitting a member makes one relay invite per
  pinned device of theirs, carrying every epoch key as S8.1's invites do, and the invite's code is sealed to that
  device's pinned agreement key (S5.3's ECDH sealing) and carried in `invites`, with no device id beside it: each device
  tries each one and only its own opens. The device claims it on its next workspace sync, then introduces itself. In
  the group log a device is admitted when the linked workspace's view pinned it as the same member, with no invite
  terms; a pull that meets a device the workspace view does not know yet waits for the workspace. Every group member is
  an owner of the group log (on the relay too), so any of them can admit a device or remove a member who left.
  `group_logs` gains `invites_json`. Since any workspace member may rewrite `net_worth_group`, the link only tells a
  device what to join: which group log a device is in, for which workspace, is its own local record (`nw_group_books`,
  never synced), so a rewritten link cannot move it off its group log. The link also names the group log's relay book,
  and which log and relay book it names are written once (refused at capture and on every peer; never deleted by an
  op); a device claims only an invite whose preview and whose relay answer name that log.

  *Correction (task 5, code reality):* a member outside the group holds no copy of the group log, so it cannot ask the
  group's view who may end the link. The link carries its own proof instead: the group log's id is
  `uuidv5(ns, proof)`, where `proof` is derived from the log's first epoch key, which only group members' devices hold.
  When the group dissolves (§6) a member's device **closes** the link — `relayBookId` becomes `closed:<proof>` — and
  every device, outsiders included, checks the proof against the id it has; nobody else can close or delete it. Every
  device ever in the group holds that key, so a former member can close a live group's link: disruption, never
  disclosure (task 5 review ruling). The group recovers on its own: a current member's device that finds its live
  group's link closed writes it open again (same log, same relay book) on its next sync. A closed link names no group,
  so a new setup writes a new link over it. A new or re-opened link must name a version-5 id, and a device keeps an
  invite's keys only when epoch 1's key derives the id the link names. A member who left the group log is never
  proposed back into it; their `confirm` answers read as `left`, and where they gave no answer none is made up.

  *Accepted residual (task 5 review round 2):* a former member who is still in the workspace can, with a modified
  app, close the link and at once write a new link of their own before any member's device syncs. The household's
  group log is then no longer linked: its members keep it and keep sharing, but a later device of theirs cannot be let
  in, and a member's new device may join the other group instead. This is disruption only — nothing is shared with
  anyone until that device's member confirms a proposal there. The remedy is for the members to set up net worth
  again.

  Two members opening a group at the same moment: the first link in the workspace log is the link on every device;
  the device whose own link was not yet back from the log yields to it, abandons its lone group log, and joins the
  linked one when a member lets it in. A group member's device lets in any later device of a group member that the
  workspace has admitted.
  Out of the workspace is out of the group (§6, last bullet): a device whose workspace sharing ends leaves the group
  log (or forgets it, when the relay cannot be reached), and any group member's device removes, with rotation, a device
  the workspace's view has removed.
- **Membership follows the group** (§6). A member leaving the group is removed from the group log with rotation (S8.4);
  the workspace membership is untouched.
- **No seeding** (S6.5): a new group log starts empty; each member's phone sends its summaries after review.
- **Book scope:** the group log holds only the entities of §5. It has no categories, budgets or purchases. The Cashflow
  and every workspace reader ignore it.

**One group per person.** A member can be in the net-worth group of one shared workspace at a time. (YAGNI: an item
shared into two groups would need two settings and two summaries.)

## 5. Data

### 5.1 New synced entities (group log)

Added to `SHARED_ENTITIES` with the group log as their scope. Same clocks and apply rules as S7.3.

| Entity | Key | Fields | Written by |
|---|---|---|---|
| `nw_proposal` | `proposalId` | `mode: 'joint' \| 'separate'`, `members: memberId[]`, `proposedBy`, `cancelled` | the proposer; `cancelled` only by them |
| `nw_answer` | `(proposalId, memberId)` | `answer: 'confirm' \| 'decline' \| 'left'` | that member only |
| `nw_item` | `itemId` | the summary (§5.2), `removed` | the item's owner only |
| `nw_pending` | `memberId` | `count` — items the member still has to share after a switch to `joint` (D8) | that member only |
| `member_transfer` | `transferId` | §7.2 | either party |

`itemId = uuidv5(groupBookId, 'item:' + accountId)`. The owner's phone keeps the map; other phones never see
`accountId`.

**Author check.** Apply refuses an op whose author (the signing device's member, S6.6) is not the entity's writer as
listed above. A refused op is logged and skipped, and wins no field. So nobody can change another person's balance.

### 5.2 The summary

```ts
type ItemSummary = {
  owner: string;              // memberId
  kind: 'asset' | 'liability';
  subtype: string;            // an AccountSubtype: bank, credit_card, property, … (string in core, which cannot import db)
  name: string;               // "BCA ···· 1234"
  currency: string;
  balanceMinor: number;       // value (asset) or owed (liability), in `currency`, today
  asOf: string;               // the owner's date when it was computed
  card: { limitMinor: number; cycleStart: string; cycleEnd: string } | null;
  period: { start: string; end: string };   // the card's current cycle, else the calendar month
  openingMinor: number;       // balance at period.start
  householdMinor: number;     // Household lines in the period, signed
  otherUseMinor: number;      // everything else in the period, signed
  monthEnds: { month: string; balanceMinor: number }[];  // last 24 month-ends, for the chart and year-end
  tax: TaxRow | null;         // only when the group's mode is joint (§8.4)
};
```

Invariant (tested): `openingMinor + householdMinor + otherUseMinor = balanceMinor`. For a card,
`available = limitMinor − balanceMinor`, so the partner's limit bar always adds up (the "where did 1 jt go" problem).

`TaxRow` is the item's row of the harta or utang list as `coretaxInputsFor` builds it for the latest finished tax year
(code, acquisition year, cost, value at 31 December), in the shape `@expanses/core` already renders.
Correction (task 10, code reality): `tax` is `{ taxYear, part: CoretaxRowPart } | null`, where `part` is the item's slice
of `CoretaxInputs` (`cash` / `holdings` / `estimated` / `receivables` / `debts`, empty when it files nothing that year) —
the inputs, not rendered rows, so the reader's own settings (property basis, rows per year, KMK rates) apply. Each row's
`accountId` is the item's id, a foreign holding carries no `purchases` (each buy is a private line), and the row's
`fields` (the details its table asks for, e.g. an account number) do travel: the joint return needs them.

### 5.3 A purchase paid from someone else's item

The purchase's `money` atom (S4.3) gains one field:

```ts
paidFrom: { owner: string; itemId: string } | null;   // null = the payer's own account, as today
```

`paidBy` stays who paid ("paid by Andi"); `paidFrom.owner` is whose account the money side is on. `moneySide` (S7.4)
changes one line: the **account owner** is `paidFrom?.owner ?? paidBy`. On the account owner's devices the money side
is posted on the local account that `itemId` maps to (the owner's real card: statement, cycle, points); on every other
device on the placeholder of the account owner. Old devices (no `paidFrom`) read `paidBy` as today: the owner's phone
must be updated for such a purchase to land on her card, so the field ships with a minimum app version check (§9).

`paidFrom` holds only an opaque id, so a workspace member outside the group learns nothing new. `paidLabel` is built by
the payer's device from the summary's `name`, as it is from a local account today.

### 5.4 Local tables (never synced)

- `nw_share_settings(account_id PK, setting 'total' | 'hidden')` — owner scope, like the accounts it describes. Absent
  = not yet reviewed; the setup review writes a row for every item.
- `nw_items` — the summaries received from other members, one row per `itemId`. A member's own items are never read
  from here: the joint view reads them live from the local ledger, as Net worth does today.

## 6. The group and its filing mode

**State is derived, never stored.** On every device: the **active** proposal is the latest (by HLC of its creation)
proposal that is not cancelled and that every listed member confirmed — and, when it changes an active group, every
current member of that group it leaves out confirmed too (see **Change**). Its `members` are the group; its `mode` is the
mode. No active proposal = no group. Every device derives the same answer from the same log.

- **Setup.** One member taps **Share net worth** in the shared workspace, answers "How does your household file tax?",
  and picks who to invite. This creates the group log (§4) and `nw_proposal { mode, members: [me, them] }` with their own
  `confirm`. Their phone shows "Waiting for Andi".
- **Confirm.** The invited member's phone shows "Rina set up household net worth: one tax ID. [Confirm] [Choose
  differently]". Choose differently = `decline` plus a new proposal of their own.
- **Review.** When a proposal becomes active, each member reviews their own items (§8.1) before their phone sends
  anything. The phone keeps a local mark per activation (the active proposal) that its person pressed Share; a share
  setting, or a review of an earlier proposal, is not a review of this one. After a Change (mode or members) the review
  is asked again: until that Share, items already live in the log keep refreshing and a new item waits. A removal
  (Don't share, archive, delete) is never held back (wave 3 merge, review rounds 1–2).
- **Change** (mode or members). A new proposal; the active one holds until the new one is fully confirmed — by every
  member it lists **and** every current member of the active group it leaves out, so nobody is dropped without saying
  yes (D6, task 5 review round 2). The proposer may cancel; anyone asked may decline. Once made, a proposal's
  `proposedBy`, `createdHlc`, `mode` and `members` never change (refused at capture and on every peer).
  **A Change never adds anyone** (wave 3 round 2): it may change the mode or leave members out, never list someone
  outside the active group. The group log keeps every summary ever sent, and a device let in is handed every epoch
  key, so a new member would read the group's whole history. Such a proposal never activates and is never pending
  (every device derives it alike); the app refuses it (`adds-members`) and the Change screen offers only current
  members: "To add someone, stop sharing net worth and set it up again." Setting up again (the group dissolves, §4)
  makes a new group log with new keys. No device lets in a device of anyone but the active group's members (before
  any activation: the members of the pending proposal, as `deriveGroup` gives it — not someone listed only on a
  declined or cancelled one). Someone let in to be asked who is not in the group when it activates (they declined,
  or a newer proposal left them out) is removed from the log, with rotation, by any member's device, so they read
  nothing sent after; what the log held before activation was no summary. The removal comes first: on a group log's
  sync, after the pull and before anything waiting is sealed, a member's device takes such a device out and rotates;
  while one is still in, no summary is written (Share, a setting, a refresh are held and go out whole on the sync
  after) and none waiting is sealed. A member whose invite never went out (the relay failed after the proposal was
  written) is invited again on a later sync, as long as they still have a device in the workspace.
- **`joint` needs exactly two members.** A proposal with `joint` and not two members cannot be made in the UI and is
  never active on apply.
- **Once active, a proposal stays active** until a newer one becomes active; a later `decline` does not undo it.
- **Leaving** is unilateral: the member sets their own `nw_answer` on the active proposal to `left`. The group is the
  active proposal's members minus those who left. Their devices are removed from the group log with rotation, and
  every phone deletes that member's summaries. Fewer than two members left = no group; the log is deleted (S8.6) and
  the workspace's link closed (§4, task 5 correction). A member all of whose devices are out of the group log (they
  left the workspace or were removed from it) counts as having left. A proposer who cancels the only proposal of a log
  with nothing active dissolves it the same way.
- **Separate → joint (D8).** On activation, each member whose items include `hidden` ones sees "Household now files with
  one tax ID. Share Business Mandiri with Andi? [Share]". Their `nw_pending.count` is the number not yet shared; the
  joint report is incomplete while any count is above zero.
- Leaving the workspace, being removed from it, or the workspace stopping sharing removes the member from the group
  too.

## 7. Paying with and transferring to the other's item

### 7.1 Paid with

In the shared workspace's add form, **Paid with** lists the member's own accounts, then a group **"Rina's, shared"**
with Rina's shared items that can pay (bank, cash, e-wallet, credit card). Picking one sets `paidFrom`. Outside the
shared workspace the group never appears (D14). An item that stops being shared disappears from the list; purchases
already recorded stay.

### 7.2 Transfer between partners

`member_transfer` fields, each with its own clock: `occurredOn`, `amountMinor`, `currency`, `from: { owner, itemId }`,
`to: { owner, itemId }`, `description`, `void`. Both items must be in `currency` (the Transfer form offers only matching
items).

On apply, each device posts **only its owner's side**, through the ledger doors (S6.3):

- the `from` owner's device: `from` account −amount, the `to` owner's placeholder +amount;
- the `to` owner's device: `to` account +amount, the `from` owner's placeholder −amount;
- any other device: nothing.

Placeholders are excluded from Net worth (S4.4), so her Net worth drops 5 jt and his rises 5 jt. An edit replaces both
sides; `void` wins. Either party may record or edit it. In the Transfer form the **To** list (and **From**, for the
receiving side) shows the other member's shared items under "Andi's, shared with Household".

## 8. Screens

### 8.1 Setup and review

Settings → the workspace → **Share net worth**: the filing question, who to invite, then "Waiting for Andi". After
activation, **Review your items**: every account, card and asset, grouped by kind as in Net worth, each with its
setting. `joint`: no switch; a line "Your household files with one tax ID, so every item is in the joint report."
`separate`: a switch per item, on by default. **Share** sends the summaries.

Each item's page gets a **Share with Household** row (the two settings; `Don't share` greyed out in `joint` with the
same line). The add form for a new account, card or asset gets the switch of D9.

### 8.2 Net worth

- **`joint`:** the household's total. Same drawers by kind as today, each with its subtotal. Each row's icon circle has
  the owner's ring color (member colors assigned in join order, fixed per group); same icon per kind; one line per
  row. Under the total a legend: "● Rina 58,8 jt · ● Andi 400 jt". Screen readers get the owner in the row's label.
  Health ratios use the household total.
- **`separate` or no group:** personal, as today. The other's shared items appear in **Accounts** under "Andi's,
  shared" and are not counted.

### 8.3 An item of the other's

Tapping opens a read-only page: balance, the chart from `monthEnds`, the Household lines of the period, one **"Rina's
other use"** line (`otherUseMinor`, "total only"), and for a card the limit bar (Household · other use · available).
The details show Owner, Updated (`asOf`), and "not yet on Rina's phone" when purchases paid from it are in the log but
newer than the summary (the bar then subtracts them).

### 8.4 Tax report

- **`joint`:** each member can open the joint report: their own rows plus each received `tax` row. Marked incomplete
  while any `nw_pending.count > 0` or an item's `monthEnds` lacks 31 December of the year ("waiting for Rina's
  phone").
- **`separate`:** unchanged; each report lists its owner's items, hidden ones included.

## 9. Sending, receiving, and what goes wrong

- **When a summary is sent.** After any write that changes an item's balance or profile (a ledger door, a new asset
  value, a setting change), the owner's phone recomputes that item's summary at commit and queues it; the outbox sends
  it with the next sync. Unchanged summaries are not re-sent.
- **Don't share** sends `nw_item.removed = true`; every other phone deletes the item and its history. Sharing again
  sends a fresh summary.
- **Owner offline.** The partner keeps the last summary; nothing on the list says so (D13); details show `asOf`.
- **Paid with while the owner is offline.** The purchase waits in the workspace log and lands on her card when her
  phone syncs; meanwhile the partner's view subtracts it (§8.3).
- **Stale app version.** A device that does not understand `paidFrom` or the group entities must not be the card
  owner's only device: setup requires every group member's devices to report the minimum version; a device below it
  blocks setup with "Update the app on Andi's iPad". (Plan correction: the relay records no app version, so each
  device reports it itself as a new synced field `appVersion` on the workspace's `device` entity; a device that never
  sent one is below the minimum.)
- **Currencies.** Summaries are in the item's currency. The joint total converts with the viewer's rates, as Net worth
  does today; a missing rate leaves the total blank, as today.
- **Restored backup** (S8.7). The owner's phone recomputes and re-sends every shared item's summary after rejoining.

  *Correction (task 6, code reality):*
  - **What is sent.** An item goes out when its setting is `total`; a missing row (not reviewed) or `hidden` sends
    nothing. In `joint` the review writes `total` for every item, so a `hidden` row there is exactly one still pending
    (D8). The summary travels as this member's own `nw_items` row in the group log (captured, writer-checked), and
    Don't share, archive and delete write `removed = 1` with the summary blanked (`'null'`), so no history is left on
    the other phones. Capture recomputes, at flush, every account a transaction touched: its entries (the ledger's
    doors), its `category` row (rename, archive, delete), and the writes that call `markAccountDirtyTx` (a price, an
    estimate, a security price for every holding of it, a holding's link, card terms, an asset profile; task 5's share
    setting should call it too).
  - **Valued assets.** A price or estimate moves the value without a ledger line; that change counts as other use, so
    `openingMinor + householdMinor + otherUseMinor = balanceMinor` still holds.
  - **Restored backup.** At open the group log goes `needs_invite` like the workspace (S8.7). Once the workspace is
    rejoined, any group member's device re-admits the phone (`admitToGroupLog`, as for a new device). The phone then
    clears its copy of the group log, pulls it from the first entry, and sends every shared item (`nw_sent` cleared).
    A group log that this device left, or was removed from, is still never rejoined.
  - **Groups only in group logs.** Capture refuses the five group entities in any book that is not a group log, and
    `net_worth_group` inside one.
  - **What the totals reveal.** The one other-use total is the sum of the private lines in the period. So a period's
    only private line shows its own amount, and two summaries sent one after the other show, by their difference, what
    was recorded in between. The line's description, id and account never leave the phone.

## 10. Tests

Money and merge logic test-first; property tests with `fast-check`.

- **Summary maths:** `openingMinor + householdMinor + otherUseMinor = balanceMinor` for random ledgers, cards and
  periods; a card's `limitMinor − balanceMinor` is its available.
- **Privacy:** a capture-harness check that no op in the group log or workspace outbox carries a private line's
  amount, description or id, or any `accountId`; a `hidden` item emits nothing; a member outside the group cannot
  decrypt the group log.
- **Group state:** propose, confirm, decline, cancel, leave, concurrent proposals, `joint` with three members never
  active, separate → joint pending counts. Derived identically on N devices (convergence property test, S13).
- **Author check:** a summary, answer or pending count from the wrong member is refused.
- **Paid with:** lands on the owner's real card (statement, points) on her device and on her placeholder elsewhere;
  changing `paidFrom` moves it.
- **Transfer:** each owner's device posts its side; a third device posts nothing; edit and void.
- **Joint total:** equals the sum of both members' items on both devices.
- **E2E** (`sharing.spec.ts`, two contexts): setup and confirm, review, joint Net worth equal on both, pay with the
  other's card, transfer, one side offline, don't share, leave.

## 11. Build order

1. Group log: `group_logs`, creating it from a proposal, sealing to pinned devices, removal on leave.
2. Proposals and answers, derived group state; setup and confirm screens.
3. Share settings, review screen, summaries: compute, send, apply, author check.
4. Net worth by mode, the other's item page, Accounts "…, shared".
5. `paidFrom` and Paid with.
6. `member_transfer` and the Transfer form.
7. Joint tax report; separate → joint pending flow.

## 12. Out of scope, and left open

- Items owned by a business (D16).
- A person in two groups at once.
- Transfers between items in different currencies.
- Splitting "other use" by workspace (rejected, D11).
- Member ring colors: two fixed, distinct from the kind icons' colors, readable in dark mode — picked in the build.
