# Shared goals — design

Status: draft v2 · 2026-11-10. Decisions D1–D10 are the owner's (2026-11-10; D6–D10 answer the five questions of
draft v1). Every remaining **(my call)** is the writer's and waits for the owner's check. Calls that D6–D10 replaced
keep their numbers, struck through to the decision, so references stay stable.
Builds on: household sharing (`2026-09-26-household-sharing-design.md`, cited **S§n**), joint net worth
(`2026-09-29-joint-net-worth-design.md`, **J§n**), shared events (`2026-10-15-shared-events-design.md`, **E§n**),
set-aside (`2026-09-21-set-aside-design.md`).
Checked against main `f8a26cc9`. File references are to that commit.

## 1. Purpose

Two people in one household save for one thing together: a hajj, a house, a child's school. Each pays in from their
own accounts. Today each phone can only hold its own copy of the goal, so neither sees the whole: the target is typed
twice, the stages are marked paid twice, and "To go" is wrong on both phones.

With this build a goal can be **shared** with the partner in a shared workspace. Both phones show one goal: one target,
one set of stages, and what each person has put toward it, by account name. The money does not move: each person's
set-asides and holdings stay on their own phone and in their own accounts, and only the goal and a summary of each
person's funding travel.

Success: every phone in the household shows the same target, the same Saved split per person, the same To go and the
same stages; a stage marked paid on one phone reads paid on the others; turning sharing off leaves the sharer with an
ordinary private goal and every other member with a private copy holding their own money and History.

## 2. Goals, non-goals, anti-goals

**Goals**
- A per-goal switch that shares a goal with the other members of a shared workspace, and turns it off again.
- One goal on every member's phone: name, kind, target, due dates, stages and payments, assumptions, a calculator's working.
- Each person's funding of the goal (set-asides by account name, tagged holdings by name) shown on every phone, with a
  subtotal per person, counted in the goal's status, bar and monthly figures.
- History with both people's moves, each named.

**Non-goals (v1)**
- Sharing with friends or with anyone outside a shared workspace (events cover friends).
- Sharing with only some members of a workspace: every current and later member sees a shared goal (D6).
- A per-person split of the monthly need ("Rina puts in Rp 2 juta, Bima Rp 3 juta").
- Tapping through to the partner's account, even when joint net worth shows it.
- A Share page row for goals (events have one, `apps/web/src/features/sharing/SharePage.tsx:53`).

**Anti-goals (must never happen)**
- A partner's balance, other transactions, account id or "short by" figure leaving their phone.
- A partner's money counted in this person's net worth, tax report, health ratios, idle cash or monthly put-away.
- Money moving between people or workspaces because a goal is shared.
- A goal deleted for real coming back on any phone, or a goal turned off still syncing to anyone.
- A member's own money, contributions or History lost because someone else tapped off, delete or archive (D7).

## 3. Constraints

- **Goals are owner scope.** `goals.workspace_id` is the person (workspaces spec §2), not a UI workspace (`books`).
  A shared goal therefore shows on the partner's Goals page whatever workspace is open, and apply stamps the partner's
  own workspace id on it (`packages/db/src/sync/apply.ts:282`).
- **Accounts are the owner's and never travel** (S§4.1). An account id means nothing on the other phone, and
  `goal_earmarks.account_id` has a foreign key to `accounts` with `foreign_keys = ON`
  (`packages/db/src/node-executor.ts:9`). A partner's account reaches this phone only as a name, as a bill's
  `payer.label` does (S§4.4, `shared-entities.ts:250-251`) and a joint-net-worth summary does (J§5.2).
- **The workspace log is read by every member** (J§4): anything sent there reaches every member's devices.
- **Rule 3 tombstones.** An entity keyed by its own `id` never comes back after a delete
  (`apply.ts:349-354`, `capture.ts:635-637`). A plain "delete on off, insert on on" cannot express a real on/off.
- **Older builds stop on an unknown entity.** `entityOf` throws (`shared-entities.ts:607-611`), called outside the
  op's savepoint (`apply.ts:1155`), and a plain error is not a deterministic refusal (`apply.ts:954-967`): the entry
  rolls back and that device's sync of the whole workspace stops until it updates.
- **One currency per book** (ruled O3, `apply.ts:58-61`): both members' base currencies are the book's. A goal may still
  be in its own currency (0091).
- **Nothing escapes capture** (S§6.4): every write path to a synced goal table must go through `withCapture`
  (`capture.ts:656`). No goal repo calls it today.
- **No "you" in UI copy**; no sample numbers in placeholders (owner rules).
- Migration number **0109** (next free; 0108 is `0108_card_terms_days_optional.sql`).

## 4. Decided by the owner (2026-11-10)

| # | Decision |
|---|---|
| D1 | A goal is shared by a **per-goal switch** "Shared with <partner name>" on Add goal and Edit goal. Off by default. Shown only when a household exists (a shared workspace with another member). Household members only, never friends. |
| D2 | **Option A — accounts shown.** "Funded by" is grouped per person (Me / partner's name), each with a subtotal. Each person's set-asides are listed by **account name**. The partner's rows carry the caption "<Name>'s account" and are not tappable. Both phones see the same list. |
| D3 | Hero: one target; the bar splits **Me / partner / To go** with a legend of amounts; a "Shared with <name>" line with both initials under the title. The Goals list marks a shared goal with both initials. |
| D4 | One target, one set of stages and payments for both. **Either person can mark a stage paid.** Purchases and holdings tagged to the goal count from either phone. History lists both people's moves, each with the person's name. |
| D5 | A **real on/off**, unlike events: nothing moves between workspaces, each person's money stays in their own accounts, only the goal and set-aside rows sync. **Turning it off removes the shared goal from the partner's phone** — amended by D7: a private copy with the partner's own money stays. |
| D6 | **Everyone in the household workspace sees a shared goal**, with account names and amounts, including a member who joins later. It rides the household book's log; no per-goal log. The switch label says who will see it (C31). Replaces C2. |
| D7 | When the sharer turns sharing off or deletes the goal, or another member leaves, **that member keeps a private copy**: it becomes their own goal on their phone with their set-asides, contributions, draws and History intact, and their past "put away" figures do not change. Replaces C13 and C14 in part. |
| D8 | **Shared emergency fund:** the months-of-spending target is frozen when the calculator is saved (the figure travels in the calculator's saved inputs), so every phone shows the same target. Either person can recalculate, which re-reads spending on their own phone and saves a new frozen figure. Replaces C24. |
| D9 | **Privacy accepted:** the others see the amount actually counted per account (even when it reveals an account holds less than promised), and "Spent" History lines carry the purchase description. Confirms C6 and C8. |
| D10 | **Only the sharer archives** (as delete); the other members can Leave. Confirms C12. |

**The approved mock-up, in words** (goal page, sharer's phone): title **Hajj 2030**; under it "Shared with Rina" and two
initials (F, R). Hero: target **Rp 180.000.000**, the bar in three parts with the legend **Me Rp 28.000.000 · Rina
Rp 14.000.000 · To go Rp 138.000.000**. An **Each month** box with the combined figure to stay on track. **Funded by**:
group **Me — Rp 28.000.000** with *BCA Tahapan* Rp 20.000.000 and *Mandiri Tabungan* Rp 8.000.000, then a
**＋ Set aside** row; group **Rina — Rp 14.000.000** with *Jenius* Rp 10.000.000 and *money-market fund* Rp 4.000.000,
each captioned "Rina's account", not tappable. Then the **History** row. Rina's phone shows the same page with the
groups named the other way round (Me = Rina).

## 5. My calls

Each is the writer's; one line of why.

**Who, and where it travels**

- **C1 (decided by D6) Transport: the household book's own log**, rows scoped by a new link row naming the book — not a relay
  book per goal as events have. Why: only workspace members are eligible (D1), their devices are already pinned, so no
  invite, key or rotation machinery is needed, and seeding, rejoin and restore (S§6.5, S§8.7) already carry the log to a
  partner's new phone. Alternatives in §8.7.
- **C2 → replaced by D6.** Any active shared book with at least one other current member is eligible; every member,
  later ones too, sees the goal. A member who joins later reads it from the log (S§8.1: invites carry every epoch key).
- **C3 (my call) Several eligible workspaces:** the row becomes a picker "Shared with: Off / Family · Rina /
  Business · Adi" (book name · its other members, C31). A goal is in one book at a time. Why: a person may share Family with a spouse and Business with a partner.
- **C4 (my call) A link row, not a column on `goals`.** The brief said "a shared-book column"; the link needs its own
  writer rules and states, and a new column on an ORM table needs the 0091 workaround (`goals.ts:15-36`). The
  workspaces spec §4.1 prefers membership tables for the same reason.

**What the partner learns**

- **C5 (my call)** The partner sees each account's **name** and the **amount counted for the goal** — never the
  balance, other transactions, account id or "short by". Short-by is worked out only on the owner's phone from its own
  balances (`goal-funding.ts:257-281`). Why: D2 needs names and amounts, nothing else.
- **C6 (decided by D9)** The amount that travels is the **counted** figure (`coveredMinor`, capped at what the account
  holds), not the promise, so every phone adds up to the same Saved. The owner accepts that a figure below the promise
  tells the others roughly what the account holds.
- **C7 (my call)** A tagged holding of the partner's appears as a **Funded by line** (name, value, "Rina's account").
  The trade and `transactions.goal_id` never sync (`shared-entities.ts:574` stays). History keeps today's kinds, which
  do not include buys (`goal-funding.ts:459`). Why: History shows no buys today for anyone; adding a "Bought" line is a
  change for every goal, not this build. (The brief asked for a contribution line with description and date — this
  differs; see §13.)
- **C8 (decided by D9)** A **Spent** move carries its draw's description (the transaction it paid for, as History shows today,
  `goal-funding.ts:484`). Why: "Spent Rp 30.000.000 · Garuda tickets" is what the goal was for; nothing else of the
  transaction travels.
- **C9 (my call)** Each funding line carries the holding's **risk** band. Why: the "can fall in value before it is
  needed" warning (`packages/core/src/goals/plan.ts:187-191`) then reads the same on both phones.

**Who may do what**

- **C10 (my call)** Either member edits name, kind, target, due dates, stages, payments, assumptions and the
  calculator, and marks a stage paid or not paid — last writer wins per field by the existing HLC rules (S§7.3).
- **C11 (my call)** Each person sets aside, takes back, uses, moves and tags only **their own** money. Nothing new is
  needed: set-asides are local rows.
- **C12 (decided by D10)** Only the **sharer** (the member who turned it on) turns sharing off, deletes the goal, or
  archives it. Archiving stops a goal claiming money on every phone (`set-aside.ts:71`), the same reach as off.
- **C13 (my call, amended by D7)** Any other member can **Leave**. The leaver keeps a private copy (D7, C30); for
  everyone else the goal stays shared, with the leaver's lines gone and a History line "Rina left". The leaver is out
  until the sharer turns sharing off and on again (a new round, §7.2). Why: with several members (D6), one person
  leaving must not end the share for the rest.
- **C14 (my call, amended by D7)** When the sharer turns it off, every other member's phone turns its copy into a
  private goal (C30) with that member's own money and History; the others' lines are dropped. The sharer's History
  records "Stopped sharing with Rina". On delete, the sharer's goal is deleted (`goals.ts:294-318`) and every other
  member keeps a private copy the same way.
- **C15 (my call)** When the household share itself ends on a phone (stopped, left, removed, kept as own copy — S§8.6),
  each shared goal is handled as an off: the sharer keeps it private, everyone else keeps a private copy. Why: S§8.6
  promises "nobody's rows are deleted by someone else's tap", and D7 says the same for goals.

**Money and figures**

- **C16 (my call) Currency.** The goal keeps its own currency (0091). Each phone converts its own set-asides and
  holdings at its own stored rates, as today (`goal-funding.ts:294-314`), and sends each line **in the goal's
  currency** (`goalMinor`). Why: the receiver adds the figure as it is, needs no rate, and both phones' totals agree to
  the unit. A line with no rate on its owner's phone travels with no amount and is left out on both phones, said as the
  no-rate sentence says it today (`goal-funding.ts:367-370`). History moves travel in their own currency (display only).
- **C17 (my call) Standing monthly is per person.** `standing_monthly_minor` and `standing_note` do not sync; each
  person's planned monthly (their standing amount plus their monthly buys tagged to the goal,
  `goal-funding.ts:344-355`) travels as one figure in the goal's currency. Why: a standing order runs from one person's
  account.
- **C18 (my call) Each month box: combined, no per-person split** (brief). Needed a month from the shared plan; Set up
  a month = mine + partner's; Short by / Room from those.
- **C19 (my call) Status counts both.** The plan's links are this phone's own plus the partner's lines; status, bar and
  "To go" read the total (`plan.ts:143-206`).
- **C20 (my call) What this phone plans for.** In the goals fit (`goal-funding.ts:393`) and the budget's savings plan
  (`budget-sheet.ts:109-112`) a shared goal counts **its monthly need less the other members' planned monthly**,
  floored at nought. Why: the partner's standing order covers part of the need; with neither set up, both phones count it whole,
  which errs on the side of saving.
- **C21 (my call) The Goals list total counts only this person's money**; the shared goal's own row and card show both.
  Why: the total sits beside this person's other figures and must not include money in someone else's accounts.
- **C22 (my call) No "Fully funded since" for a shared goal.** `goalWholeness` gives `since: null`
  (`goal-funding.ts:404-426`). Why: the dated trail spans two phones; the "whole" flag itself still counts both.

**Calculators**

- **C23 (my call)** Calculator goals (Emergency fund, Education, Retirement) can be shared; the working
  (`goal_calculators`, `goal_stage_terms`) syncs, so both phones show the same figures. Inputs read from spending are
  re-read only on the phone that opens and saves the calculator.
- **C24 → replaced by D8.** Today an emergency target is months × this phone's own monthly outgoing, read live from
  flows (`goal-funding.ts:334-338`), so two phones would show two targets. A shared emergency goal reads the outgoing
  frozen in its working instead: written at share time (from the sharer's spending) and each time anyone saves the
  calculator (from that phone's spending). A working with a typed `monthlyOutgoingMinor` already is frozen.
- **C25 (my call)** The silent re-working at app open (`upgradeCalculatorGoals`, `apps/web/src/db/bootstrap.ts:115`)
  runs for a shared goal **only on the sharer's phone**. Why: two phones re-working the same rows every day, on
  different days near midnight, write over each other.

**Screens and copy**

- **C26 (my call)** On another member's phone Edit goal shows the switch on and disabled, footer "Shared by Bima", and
  a **Leave goal** row in place of Archive and Delete.
- **C27 (my call)** History lines on a shared goal end with the person: "Me" for own lines, the member's name for the
  partner's, matching Funded by.
- **C28 (my call)** All partner rows carry "<Name>'s account" as decided, holdings included.
- **C29 (my call)** A shared goal arriving on the partner's phone goes to the end of their list (`rank` is each
  person's own order and does not sync).

**Added with D6–D10**

- **C30 (my call) A private copy gets a new id.** When a non-sharer's copy becomes private (off, delete, Leave, share
  ended), their phone re-keys it locally: the goal and its stages get new ids, and every local row naming them
  (`goal_earmarks`, `goal_contributions`, `goal_draws`, `goal_calculators`, `goal_stage_terms`, `trade_goal_parts`,
  `investment_trades`, `trade_templates`, `asset_sales`, `transactions`, `events`) follows. Why: if the sharer turns
  sharing on again, the shared goal arrives as a new goal beside the private copy; keeping the old ids would make the
  arriving rows collide with private edits and leave stages one phone has and the others never hear of.
  The sharer's own goal keeps its id.
- **C31 (my call) The label names who sees it.** "Shared with" + the other current members' names from
  `book_members` ("Rina", "Rina and Adi", "Rina, Adi and Sari"); with four or more others, the workspace name and a
  count ("Family · 4 people"). It is read live, so it changes when a member joins. Why: names say exactly who will see
  the goal, and match the approved mock-up's "Shared with Rina".
- **C32 (my call) Rounds.** The link counts how many times sharing was turned on (`round`). A Leave records the round
  it left in; a member is in when they have no Leave for the current round. Why: lets one member leave without ending
  the share, and lets the sharer bring everyone back by off and on.
- **C33 (my call) Many members on screen.** The bar and legend carry one segment per member with money in the goal
  (Me first, then the others in the order they joined the workspace); Funded by has one group per such member; a member
  with no money has no group. The title line shows up to three initials, then "+N". Why: D2/D3 drawn for two, kept
  readable for more.

## 6. Left to the builder

- Names of tables, entities, functions and the exact JSON of the funding summary.
- How capture leaves out the deletes of rows that leave scope with their link (§8.3, option b) — or a better way that
  keeps the same outcomes, checked against `capture.ts:740-765`.
- When summaries are recomputed (§8.5): the hook, and how to keep it cheap.
- The version number (`SHARED_GOALS_MIN_APP_VERSION`) and the bump of `apps/web/package.json` (now `0.4.0`; the
  TestFlight marketing version is separate).
- Layout and spacing within D2/D3; the exact History and footer wording within the rules above.
- Whether `goal_share_log` (§7) can be folded into something that already exists.

## 7. Data — migration `0109_shared_goals.sql`

### 7.1 Goal tables today, and what syncs

| Table / column | Syncs? | Notes |
|---|---|---|
| `goals` (0008, 0091) | **yes**: `name`, `kind`, `growth_bps`, `return_bps`, `currency`, `status` | never: `workspace_id` (stamped), `rank` (C29), `standing_monthly_minor`, `standing_note` (C17), `created_at` (local on insert) |
| `goal_stages` (0008) | **yes**: `goal_id`, `name`, `target_minor`, `target_months`, `due_on`, `sort`, `paid_on` | never: `workspace_id` |
| `goal_stage_terms` (0053) | **yes**, key `stage_id`: `goal_id`, `return_bps`, `derived_key` | never: `workspace_id`. Needed so an education goal's per-level returns agree |
| `goal_calculators` (0017) | **yes**, key `goal_id`: `kind`, `inputs_json`, `computed_minor`, `computed_at` | never: `workspace_id`. Emergency outgoing frozen in `inputs_json` (D8) |
| `goal_earmarks` (0008) | **never** | names a local account (FK). Reaches the partner as a funding line |
| `goal_contributions` (0016) | **never** | this person's put-away (`goal-contributions.ts:155`). Reaches the partner as a move |
| `goal_draws` (0050) | **never** | names a transaction and accounts. Reaches the partner as a move |
| `trade_goal_parts` (0083), `investment_trades.goal_id`, `trade_templates.goal_id` | **never** | reach the partner as funding lines and the planned monthly |
| `transactions.goal_id` (0009) | **never** | stays in `NEVER_SYNCED_COLUMNS` (`shared-entities.ts:574`). Only a tagged transfer writes it (`goal-contributions.ts:56`), and a transfer belongs to no book |
| `asset_sales.goal_id` (0092), `events.goal_id` (0026), `audit_log` retags | **never** | local records |

### 7.2 New tables

```sql
-- Which goals are shared, into which book, by whom, and whether sharing is on. One row per goal, never deleted:
-- the state changes instead, so a goal can be turned off and on again (a deleted row could never come back, §8.3).
CREATE TABLE goal_shares (
  goal_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  shared_by TEXT NOT NULL,                 -- member id of the sharer; written once
  state TEXT NOT NULL CHECK (state IN ('on', 'off', 'deleted')),
  state_on TEXT NOT NULL,                  -- YYYY-MM-DD
  round INTEGER NOT NULL DEFAULT 1 CHECK (round >= 1)  -- +1 each time it is turned on again (C32)
);
CREATE INDEX goal_shares_book ON goal_shares (book_id, state);

-- A member who left a shared goal, and in which round. Written only by that member, never by the sharer.
CREATE TABLE goal_share_leaves (
  goal_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  left_on TEXT NOT NULL,
  PRIMARY KEY (goal_id, member_id)
);

-- What one member's money does for a shared goal, as that member's phone worked it out. Written only by that member.
CREATE TABLE goal_member_funding (
  goal_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  -- [{ ref, name, kind: 'earmark' | 'tagged', amountMinor: number | null, risk: 'low' | 'medium' | 'high' | null }]
  -- amountMinor in the goal's currency, null when the owner's phone had no rate. ref is stable per line, not an id.
  lines_json TEXT NOT NULL,
  planned_monthly_minor INTEGER NOT NULL DEFAULT 0,   -- goal currency (C17)
  as_of TEXT NOT NULL,
  PRIMARY KEY (goal_id, member_id)
);

-- One History line of a member's, for a shared goal. id is stable from its local source (a contribution, a draw,
-- a tagged transfer), so a line written twice is the same line; an undone source deletes it.
CREATE TABLE goal_member_moves (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('set-aside', 'taken-back', 'borrowed', 'spent', 'moved')),
  occurred_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,           -- signed, in `currency` (display only)
  currency TEXT NOT NULL,
  text TEXT NOT NULL,                      -- account name, or a spend's description (C8)
  stage_id TEXT                            -- the stage a spend paid, so it cannot be removed (§9.4)
);
CREATE INDEX goal_member_moves_goal ON goal_member_moves (goal_id, occurred_on);

-- Local only, never synced: the share's own History lines ("Shared with Rina", "Rina left", "Stopped sharing",
-- "No longer shared by Bima"). A private copy (C30) keeps its lines under its new goal id.
CREATE TABLE goal_share_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('shared', 'stopped', 'left', 'unshared', 'ended')),
  member_name TEXT NOT NULL,
  amount_minor INTEGER,                    -- goal currency: the member's last counted total, when one stops counting
  copied_from TEXT,                        -- on a private copy's 'unshared' line: the shared goal's id (C30)
  occurred_on TEXT NOT NULL
);
```

Follow 0050's rule: depend on nothing another migration made, so the set-based runner can apply it in any order.

## 8. Sync

### 8.1 New entities in `SHARED_ENTITIES`

All in the household book's log. "On links" below is
`SELECT goal_id FROM goal_shares WHERE book_id = ${bookId} AND state = 'on'`. Every member's phone holds every row in
scope (D6); a member who left reads but does not show them (§8.3).

| Entity | Table | Key | Scope | Fields | Writer |
|---|---|---|---|---|---|
| `goal_share` | `goal_shares` | `goal_id` | `t.book_id = bookId` (any state) | `sharedBy`, `state`, `stateOn`, `round` | the predicate in §8.4 |
| `goal_share_leave` | `goal_share_leaves` | `goal_id`, `member_id` | `t.goal_id IN (SELECT goal_id FROM goal_shares WHERE book_id = bookId)` | `round`, `leftOn` | `key.member_id`, never the link's `sharedBy` |
| `goal` | `goals` | `id` | `t.id IN (on links)` | `name`, `kind`, `growthBps`, `returnBps`, `currency`, `status` | anyone; `status` the sharer (D10) |
| `goal_stage` | `goal_stages` | `id` | `t.goal_id IN (on links)` | `goalId`, `name`, `targetMinor`, `targetMonths`, `dueOn`, `sort`, `paidOn` | anyone |
| `goal_stage_term` | `goal_stage_terms` | `stage_id` | `t.goal_id IN (on links)` | `goalId`, `returnBps`, `derivedKey` | anyone |
| `goal_calculator` | `goal_calculators` | `goal_id` | `t.goal_id IN (on links)` | `kind`, `inputs`, `computedMinor`, `computedAt` | anyone |
| `goal_member_funding` | `goal_member_funding` | `goal_id`, `member_id` | `t.goal_id IN (on links)` | `lines`, `plannedMonthlyMinor`, `asOf` | `key.member_id` (as `nw_answer`, `shared-entities.ts:323`) |
| `goal_member_move` | `goal_member_moves` | `id` | `t.goal_id IN (on links)` | `goalId`, `memberId`, `kind`, `occurredOn`, `amountMinor`, `currency`, `text`, `stageId` | `fields.memberId`, frozen (`authority.ts:452`) |

`NEVER_SYNCED_COLUMNS` (`shared-entities.ts:552`) gains every column in §7.1 marked never plus each new table's
`workspace_id`; the completeness test then holds the lists to the schema. Apply's `PARENTS` (`apply.ts:222-233`) gains
goal → link, stage/term/calculator/funding/move → goal, term → stage, so an op whose parent is missing is dropped
("ended") or skipped ("unknown") as today. `goals.rank` gets a local value on insert (C29).

### 8.2 Turning sharing on

One transaction on the sharer's phone, inside `withCapture` with targets for the link and every row of the goal:
insert `goal_shares (state 'on', shared_by = this member, round 1)` — or, turning it on again, set `state 'on'` and
`round + 1` — then let capture emit, in order: the link, the
goal, its stages, terms, calculator, this member's funding summary, and this member's existing History of the goal as
moves (so the others see the goal's whole history from the start), and a `goal_share_log` line "Shared with Rina"
(local). For an emergency goal, the working's outgoing is frozen first (D8).

On every other member's phone apply inserts each row with that member's own `workspace_id` (`apply.ts:282`). A phone
writes its own funding summary only once it holds money for the goal (§11, second device).

### 8.3 Turning it off, Leave, delete — without tombstones

Off and delete are **state changes on the link** (`'off'`, `'deleted'`), never a delete of the link; Leave is a
`goal_share_leave` row for the current round. On off and delete the goal's other rows leave scope. Two things in
today's code stop that working as plain deletes:

1. An entity keyed by its own `id` (goal, stage, move) would be tombstoned for ever (`apply.ts:349-354`), so turning
   it on again would never bring it back.
2. On the sharer's phone, capture would emit deletes of the partner's funding and move rows and judge them by their
   writer (`capture.ts:745`): the write is refused and the whole off rolls back.

**Recommended (option b):** a row that leaves scope **because its link left `'on'`** emits no op. Every phone, on
applying (or making) the change, drops the other members' funding and move rows locally with no tombstone, clears the
field clocks of the goal's synced rows, and then does its own follow-up:

| Change | Sharer's phone | Every other member's phone |
|---|---|---|
| link → `off` | keeps the goal, private; log "Stopped sharing with Rina" | re-keys its copy into a private goal (C30) with its own set-asides, contributions, draws and History; log "No longer shared by Bima" |
| link → `deleted` | the goal is deleted (`deleteGoal`) | as `off` |
| Rina leaves (her phone writes the leave) | the goal stays shared; Rina's funding and moves dropped; log "Rina left" with her last counted total | Rina's phone: as `off`. Other members: as the sharer's column |
| link → `on` again (round + 1) | the rows re-enter scope: capture emits every field at a fresh clock (as for any row entering a book) | inserts the goal as new, beside any private copy (whose ids differ, C30); a member who left is back in |
| household share ends (C15) | as `off`, locally, no op | as `off`, locally |

A member who left keeps receiving the goal's ops (the log reaches everyone, D6); their phone drops them while their
leave names the current round. That drop is the leaver's own devices', not a refusal, so it is not recorded in
`sync_skipped`.

**Option c, considered:** mark the goal entities revivable (a `revivable` flag beside `isRevivable`,
`capture.ts:635`). It reuses the re-make path, but still needs (2) solved, and lets a late edit revive a goal deleted
for real. Option b keeps "a deleted goal never comes back" with no new rule in apply's merge.

**An op for a goal whose link is not `'on'`** is dropped as ended, the same on every device. "Not on" must be read at
the op's place in the log — as the authority view reads membership (S§7.1, fix round 2) — not from this device's
unsent local state, or a sharer's second device and a third device could disagree about a crossing edit.

### 8.4 Who may write what

A goals predicate in the shape of `events/authority.ts:46-60`: pure, read from the stored row, the new row, the key and
the writing member, applied at capture (`capture.ts:712-731` does this for events) and on apply alike.

- `goal_share`: insert only with `state 'on'`, `round 1` and `sharedBy` = the writer. `sharedBy` never changes. Every
  later write only by `sharedBy`. `round` rises by exactly one, and only on `'off' → 'on'`. Nothing leaves `'deleted'`.
- `goal_share_leave`: only by `key.member_id`, never by the link's `sharedBy`, and only with the link's current
  `round`; never deleted (a later round makes it stale).
- `goal.status`: only the link's `sharedBy` (D10).
- A delete op of `goal` is refused (a goal ends by its link). Stage, term and calculator deletes are anyone's (Edit goal
  removes a payment; typing a target by hand drops the working, `goals.ts:241-243`).
- Funding and move rows: their member only (table above).

Refusals land in `sync_skipped` as today (`apply.ts:1000-1024`).

### 8.5 Capture points to add

No goal repo calls `withCapture` today. Each write below needs it; the S§6.4 harness fails any that is missed.

- `goals.ts`: `saveGoalTx` (162), `archiveGoal` (290), `deleteGoal` (299, sharer: link → `'deleted'` first),
  `setStagePaid` (329). Not `reorderGoals` or `setStandingMonthly` (fields that do not travel).
- `goal-calculators.ts`: every write of `goal_calculators` / `goal_stage_terms`, including `setEmergencyOwnTarget`,
  `clearGoalCalculator` and `upgradeCalculatorGoals` (sharer only, C25).
- `set-aside-tx.ts` `applySetAsideTx` (307): a spend that marks a stage paid.
- The funding summary and moves: recomputed at the end of any transaction that changes this member's money for a
  shared goal — set-aside, take back, move, use, a tag or split of a trade, a monthly buy, a tagged transfer, a posting
  on an earmarked account (the covered figure can change) — and once a day at app open (prices and rates move). The
  net-worth summaries are the model: dirty marks during the transaction and a send at flush (`capture.ts:292`, `339`).
  A recompute caused by apply waits for a transaction of its own (ruling R9, `capture.ts:618-626`).

### 8.6 Who gets it, and old builds

- **A partner's new or restored phone** reads the log from its first entry (S§8.1: the invite carries every epoch key)
  and gets every shared goal with no extra step. Re-sharing a stopped book seeds at kept clocks (S§6.5): the goal
  entities join `rowsInScopeTx` (`seed.ts:188-201`) after bills, link before goal before stages.
- **Version gate.** `SHARED_GOALS_MIN_APP_VERSION`, compared with each device's `appVersion`
  (`shared-entities.ts:157-159`, `meetsVersion` in `sync/events/version.ts`). The switch is offered only when every
  device in the book not removed meets it. A device on an older build that joins later stops at the first goal entry
  until it updates (§3) — the accepted residual, as shared events §7 accepts it.

### 8.7 Transport alternatives

| Option | For | Against |
|---|---|---|
| **A. Household book log (decided, D6)** | no invite, keys or rotation; joiners, restores and second devices already handled; every member sees it, as D6 wants | an old build in the book stalls |
| B. A relay book per goal (events, E§3) | only the people in it; not tied to a workspace | invites, epochs, rotation and Leave all again; the partner joins each goal by link; nothing here needs a non-member |
| C. The net-worth group log (J§4) | already limited to opted-in members | exists only when net worth sharing is set up; mixes two features' lifetimes |


## 9. Reads

### 9.1 Funding, plan and status (`goal-funding.ts`)

`goalLinksWithRates` (186) adds, for each shared goal, one `GoalLinkRow` per line of every **other** member's
`goal_member_funding` (members who left this round excluded): `kind` as sent, `name`, `valueMinor = goalMinor = baseMinor-in-goal = amountMinor`,
`currency` = the goal's, `shortMinor 0`, `overBalance false`, `promisedMinor null`, `risk` as sent, and a new
`owner` (member id; absent = this phone's own). This phone's own lines stay as today, with their short-by.
`goalPlansFor` (319) adds the others' `plannedMonthlyMinor` to `plannedMonthlyMinor`, uses the working's frozen
outgoing for a shared emergency goal (D8), and applies C20 to the fit and C22 to wholeness. `goalHasFunding`
(`goals.ts:251`) also reads the others' funding and moves, so the currency stays locked once anyone funds it.

### 9.2 History (`goalHistory`, `goal-funding.ts:445-501`)

Entries gain `by: string | null` (null = this phone's member). For a shared goal the reader adds the other members'
`goal_member_moves` and this phone's `goal_share_log` lines. New kinds: `shared`, `stopped`, `left`, `unshared`,
`ended` (titles "Shared with Rina", "Stopped sharing with Rina", "Rina left", "No longer shared by Bima", "Workspace
no longer shared"), amount = the member's last counted total when there is one. A private copy (C30) keeps its own
moves and its log lines; the others' moves go. `GoalHistoryPage.tsx:9-16` gains their titles; the subtitle ends "· Me" or "· Rina" (C27).
`cardHistory` (`goal-cards.ts:161`) is unchanged; its funded window gets nothing for a shared goal (C22).

### 9.3 Readers that must not see the partner's money

Net worth, the tax report, health ratios (the emergency-fund ratio reads this person's money only), idle cash,
`setAsideViews` (`set-aside.ts:72`) and `goalContributionsFor` (`goal-contributions.ts:155`) read local tables only, so
they stay as they are. A test per reader proves a partner line does not reach it.

### 9.4 Stage removal

`drawnStageIds` (`goals.ts:278-283`) also reads `goal_member_moves.stage_id`, so Edit goal refuses to remove a stage the
partner spent against, as it does for this phone's own draws (`goals.ts:203-207`).

## 10. Screens

- **Add goal / Edit goal** (`GoalForm.tsx`): a `SwitchRow` labelled per C31 ("Shared with Rina") in the group with
  Currency and Funding (`GoalForm.tsx:376-384`), off by default, shown only when eligible (D6, C3, §8.6), with an info
  line naming what the others see ("Rina sees this goal, its payments, and the names and amounts of the accounts
  funding it; so does anyone who joins Family later"). The model is the net-worth add-form switch
  (`sharing/ShareWithHousehold.tsx:100-122`). Turning it off asks first: "Stop sharing Hajj 2030? Rina keeps a copy
  with Rina's own money in it." On another member's phone: C26; Leave asks "Leave Hajj 2030? A copy with the money
  set aside from this phone stays here."
- **Goal page** (`GoalPage.tsx`): under the title, the C31 line and the members' initials (C33). Hero bar segments
  Paid / Me / each other member (`GoalPage.tsx:196-209`), legend Paid (when any) · Me · Rina · To go
  (`GoalPage.tsx:210-214`). Each month as
  C18 (`GoalPage.tsx:252-264`). Funded by (`GoalPage.tsx:266-284`) in one group per member with money (C33), each with a subtotal; own rows as today
  (`funding.tsx:36-57`, tappable, short-by); a "＋ Set aside" row closing the Me group; partner rows without `to`,
  captioned "Rina's account". ⋯ menu: Leave goal on the partner's phone. Short-by under the figure is own only.
- **Goals list** (`GoalsPage.tsx:40-72`): the members' initials on a shared goal's row (C33); the total per C21.
- **A link to the shared goal** opened after it became a private copy (a notification, a back stack): the existing
  "Goal not here" page (`GoalPage.tsx:100-110`) offers the private copy ("No longer shared · Open the copy").
- Initials and names come from `book_members.name`. New strings are checked for "you"/"your".

## 11. Edge cases

- **Off then on while the partner is offline.** The partner applies both in order: a private copy (new id) with
  their money, then the shared goal again, new, with none of their money. Moving money across is theirs to do
  (Move to another goal, `goals.ts:408`; retag a buy). Accepted.
- **Partner sets aside while the sharer turns off.** On the sharer's phone the partner's summary op arrives for a goal
  not on: dropped. On the partner's phone the new set-aside is in the private copy. Nothing is lost.
- **Both edit one stage offline.** Per field, later HLC wins. A stage removed on one phone while marked paid on the
  other: the removal wins (rule 3), and so does a removal crossing a spend (the spend's `stage_id` then names a stage
  that is gone; History still reads).
- **Currency changed while the partner funds it offline.** The lock is local; on the race the partner's phone
  recomputes its lines in the new currency after apply. The moves keep their own currency.
- **No rate** on the owner's phone: the line travels with no amount; both phones leave it out and say so (C16).
- **Partner renames, archives or deletes an account.** Its line's name changes or the line goes at the next summary.
- **A member joins the workspace later.** Their phone reads the log from its first entry and shows every goal shared
  in it, as D6 wants; the switch label on every phone now names them (C31).
- **A member who left, while the goal stays shared.** Their phone keeps receiving its ops and drops them (§8.3).
- **Household share ends** (S§8.6 stop, Leave workspace, removal, Keep as my own copy): C15. If the book is shared
  again later, the seed carries the sharer's goal with its old id; every other phone's private copy has a new id
  (C30), so nothing collides.
- **Second device of the same member** (S§8.3) holds the goal but none of the member's accounts. It must never write
  that member's funding summary (it would write an empty one over the real one): a device writes a summary only while
  it holds the member's funding for the goal, or after having written one. Its Me group shows the member's synced row.
- **Read-only book.** Rows of an `unshared` book refuse writes (`capture.ts:54-59`, `665-683`); C15's local unlinking
  must run before any goal write is attempted, or the goal page would throw `BookReadOnlyError`.
- **Restore from an iCloud backup** on one phone: the local goal rows come back with the link; the rejoin pulls from 0
  (S§8.7) and the summaries are recomputed at the next open.
- **Size.** A summary with many accounts is still far below the 64 KB change-set cap (S§6.2).
- **Older partner build**: switch hidden (§8.6).
- **Archived shared goal**: promises nothing on either phone (`set-aside.ts:71`); unarchive is the sharer's.

## 12. Test plan outline

- **Core** (`packages/core/src/goals/plan.ts`): a plan with partner links counts them in current, status and to go;
  planned adds the partner's; risk from a partner line warns; the C20 need-less-partner figure, floored.
- **DB, sync**
  - `SHARED_ENTITIES` completeness: every column of the five synced tables sorted (the existing test).
  - Capture: share-on emits link, goal, stages, terms, calculator, summary, moves in that order; off/delete emit
    only the link, Leave only the leave row; no write path to a synced goal table escapes (S§6.4 harness, every function in §8.5).
  - Apply: off drops rows with no tombstone and clears clocks; on again re-inserts; an op for a goal not on is dropped
    alike on three devices (two of one member); delete-for-real never comes back after a late edit.
  - Authority: each rule in §8.4 refused at capture and on apply, recorded in `sync_skipped`.
  - Privacy: no op payload for a shared goal contains an account id, a balance, a short-by figure or a transaction id
    (scan every op in the outbox after a scripted month of activity).
  - Convergence: two phones on `MemoryTransport` end with the same target, Saved per member, To go and stage marks.
  - Private copy (D7, C30): off, delete, Leave and share-end each leave the member's `goal_earmarks`, contributions,
    draws, tags and History intact under a new goal id; `goalContributionsFor` for a past month is unchanged; turning
    sharing on again brings a second goal, no collision; the sharer's History gets "Rina left" with her last total.
  - Readers in §9.3 unchanged by partner rows.
  - Version gate and second-device rule.
- **Web**: switch visibility and label (no household, one other member, three others, five others, old device, two
  books → picker); partner rows not
  tappable and captioned; hero legend; list initials; Leave; copy grep for "you".
- **E2E** (two phones): the mock-up — Hajj 2030, Rp 180.000.000; Bima sets aside BCA Tahapan 20.000.000 and Mandiri
  Tabungan 8.000.000; Rina sets aside Jenius 10.000.000 and tags a money-market fund worth 4.000.000; both phones read
  Me/Rina/To go 28/14/138 juta; Rina marks the first payment paid; Bima turns sharing off; Rina's phone has a
  private Hajj 2030 holding Jenius 10.000.000 and the money-market fund, Bima's shows only his own. Fixture figures are invented, per the owner's rule on real data.

## 13. Conflicts with the household-sharing design and the brief

1. **S§8.6 "Nobody's rows are deleted by someone else's tap"** vs D5 as first drawn: resolved by D7 (a private copy
   stays) and C15.
2. **J§4: the workspace log reaches every member.** Resolved by D6: every member is meant to see shared goals.
3. **Rule 3** (S§7.3) makes a plain on/off impossible for id-keyed rows; §8.3 adds a scope-leave rule to capture.
4. **New entities in the workspace log stall older builds** (§3): the first time the workspace log gains an entity
   since sharing shipped (net-worth entities sit in their own group log, events in their own books).
5. **Brief, "a shared-book column on the goal"** → a link table (C4).
6. **Brief, "a tagged purchase appears as a contribution line in History"** → today History lists no buys for any
   goal (`goal-funding.ts:459`); a partner's tagged holding shows in Funded by instead (C7).
7. **Brief, Emergency fund "spending-based inputs re-read on the phone that opens the calculator"** holds only once the
   outgoing is frozen in the working; today it is read live on every open of the goal. Resolved by D8.

## 14. Build order

1. Migration 0109, `SHARED_ENTITIES` records, never-synced lists, `PARENTS`, the predicate (§8.4), with tests.
2. Capture: wrap every goal write (§8.5); the scope-leave rule, apply's local drop, re-key into a private copy (C30)
   and follow-ups (§8.3).
3. Summaries and moves: compute, mark dirty, send at flush, second-device rule; `goal_share_log`.
4. Reads: links, plan, fit, budget, wholeness, history, `goalHasFunding`, `drawnStageIds`; reader isolation tests.
5. Version gate and eligibility; the switch, goal page, list, Leave.
6. Two-phone E2E; then review with focus on §13 items 1–4 and the privacy test.
