# An event plan is an RAB — design

Status: approved · 2026-09-18
Decisions: `scratchpad/decisions-event-plan.md` (user, 2026-09-18), plus four additions approved the same day —
quantity × price, a link field, one receipt settling several items, and a plan that is per category rather than per
event.
Mockup: `scratchpad/event-plan.html` — the reference for behaviour and copy. Two events walked through the same
screens: **Newborn**, which has a plan, and **Bali holiday**, which has none and then gains one. Screens: Events, the
event page (planned and unplanned), the whole plan (and its empty state), an item, the first item, Buy it,
Ticked off, **One receipt, many items**, and **Only one category planned**.

## 1. What we are building

An event is planned today the way a month is budgeted: pick a category, type a figure, and the figure becomes a cap for
that category. `event_budgets (event_id, category_account_id, planned_minor)` holds it, `eventSheet` reads planned
against actual per category, and the "Against the plan" page of the chart measures what was spent against the caps
added up.

That is the wrong shape for what people actually do before a wedding, a birth or a renovation. They write an **RAB** —
*rencana anggaran biaya*, a bill of quantities: a list of the things they mean to buy, how many of each, and roughly
what one costs. Nobody decides that Hospital shall cost twenty-one million; they decide they need a delivery package
at eighteen and six check-ups at five hundred thousand each, and twenty-one million is what that comes to.

So:

- **A plan is a list of items.** An item is a **name**, **how many** and **a price each**; the estimate is the product.
  It optionally carries a **category**, a **link** and a **note**.
- **There is no cap anywhere.** A category line on the plan is only the sum of the items filed under it. Nothing is set
  per category, and there is nothing to set.
- **A plan is per category, not per event.** An event may plan the tickets and not the food. Categories with no items
  keep adding up exactly as they do today, marked "no items", and the event's planned total is only what was actually
  planned — it never pretends to cover the rest.
- **There is no date on an item.** The date arrives when it is bought, from the purchase itself.
- **Estimates never change.** Buying something cheaper or dearer keeps the estimate and shows the difference — per
  item, per category, and for the event.
- **An event may have no plan at all.** It then behaves exactly as today: it adds up what was tagged to it, grouped by
  category. Adding the first item turns it into a plan, and nothing that was already tagged moves.
- **An item can be bought.** "Buy it now" opens Add Transaction with the amount, the category and this event already
  filled in; saving records what it really cost and ties the purchase to the item.
- **One receipt can settle several items.** A link carries a **share**, so one Mothercare receipt can answer newborn
  clothes, muslin wraps and a steriliser at once. What is left on the receipt stays as *not planned* spending in its
  category. The transaction itself is never split.
- **Unlinking leaves the transaction alone** — it simply becomes not-planned spending again.

There is no priority field (must-have / nice-to-have): the user judged it noise.

The per-category event budgets are **replaced outright**. The app is not launched and every event budget in existence
is dummy data, so there is no compatibility shim, no dual read, and no setting: `event_budgets` and the whole
`eventSheet` reading go away in the same commit the items arrive.

## 2. The item model

### 2.1 `event_items`, a table of its own

| column | notes |
|---|---|
| `id` | PK, `uuidv7()` |
| `workspace_id` | owner scope, as every table |
| `event_id` | the event it plans |
| `name` | what the thing is ("Stroller Bugaboo"). Required, trimmed |
| `quantity` | INTEGER above nought. 1 is the ordinary case and the default |
| `unit_price_minor` | INTEGER above nought. Minor units of the workspace base currency |
| `category_account_id` | nullable — an item need not be filed anywhere |
| `link` | nullable URL: a shop page for the thing |
| `note` | nullable free text ("Second-hand is fine if under 10m") |
| `transaction_id` | nullable — the purchase that answered it |
| `share_minor` | nullable INTEGER above nought — how much of that purchase this item is |
| `sort_order` | INTEGER, appended at `max + 1` within the event |
| `created_at` | ISO timestamp |

Indexes: `event_items_event (workspace_id, event_id, sort_order)` and `event_items_purchase (workspace_id,
transaction_id)` — **not unique**, because one receipt answers many items.

`events` and `transactions` gain **no column**. The ORM names every column it knows on every insert, so a column on an
existing table breaks any database still stopped at an older version (migration 0028's comment; the same reason books
attach through membership tables in 0042 and bills through side tables in 0044). An item is a new fact, so it gets a new
table, and every read and write of it goes through `eventItemsExist(db)`, memoised the way `hasBooks` and
`billTablesExist` are. Without the table every function behaves as though the event has no plan — a real state of the
feature, not a degraded one, so an older database simply reads as an unplanned event.

### 2.2 The estimate is derived, never stored

`estimateMinor = quantity × unitPriceMinor`. Both are integers in minor units, so the product is exact — no rounding, no
division, and no second figure that can drift out of step with the two it came from. Storing the product as well would
be a third number to keep true, and the first edit of a price would make a liar of it.

The consequence on screen: **How many** and **Price each** are the fields; **Estimate** is a read-only row showing the
product. With quantity 1 — the ordinary case, and the default — typing a price each is exactly what typing an estimate
used to be. A line reads "6 × Rp500.000" under the name only when the quantity is more than one; one of something needs
no arithmetic shown.

### 2.3 Why no cap and no date

**No cap**, because a cap is a second, contradictory source of truth. If Hospital could be capped at 20 000 000 while
its items add to 21 000 000, the screen would have to say which one is *the plan*, and every figure below would need a
rule for the disagreement. With items only, the category total is derived and cannot disagree with itself.

`events.planned_minor` (one figure for the whole event) is left in the table but is **no longer read**, and the
"Planned total" field leaves the new-event form: the figure for the event is what the items add up to, and a number
that overrides the sum would be the same contradiction at the top. This matters more now that a plan is per category —
a whole-event figure would be exactly the "pretending to cover the rest" that §5.6 exists to prevent.

**No date**, because an item is a thing, not an appointment. Giving each item a due date invents a schedule the user
never made, creates overdue states for things that are simply not bought yet, and would need its own "Upcoming / Late"
sections — a second, weaker Recurring screen. The event already carries the only dates that matter, and the one date an
item really has arrives with the purchase, for free.

### 2.4 The link

An optional URL, the page where the thing is sold. It is stored as typed, with two liberties taken: it is trimmed, and
a value with no scheme gets `https://` put in front of it, so `tokopedia.com/bugaboo-fox-5` works. It is refused only
when it contains whitespace, or carries a scheme that is not `http` or `https` (`BAD_LINK`) — `javascript:` in an
`href` is the one real hazard here.

The app **never fetches it**: no preview, no favicon, no title lookup. Nothing about an event leaves the device, and a
shop link is exactly the sort of thing that would leak an intention to a third party. On the item screen it is one row,
rendered as `<a target="_blank" rel="noreferrer noopener">`.

### 2.5 One receipt, several items

The link between an item and its purchase carries an amount:

- **An item has at most one purchase.** Its row shows one merchant and one date; two would have nothing sensible to
  show.
- **A purchase may answer many items.** The rows simply name the same `transaction_id`, each with its own
  `share_minor`.

This is why `share_minor` lives on `event_items` rather than in a join table: the many-to-one direction is the only one
that exists, so a second table would buy nothing and cost a join on every read.

The rules:

1. **Shares against one transaction may not exceed its amount.** `setPurchaseCover` and `linkEventItem` both refuse with
   `OVER_ALLOCATED`, naming what is left.
2. **What is left over is not-planned spending in its category.** It is not lost, not hidden, and not an error: the
   Mothercare receipt of Rp 4.150.000 with Rp 2.880.000 given to items leaves Rp 1.270.000 reading as "not planned"
   under Clothes. When a purchase is split across categories, its leftover is filed under the **largest** of its expense
   entries (ties broken by category id) — deterministic, exact in minor units, and for the ordinary single-category
   purchase simply "its category".
3. **Unlinking one item leaves the others alone.** Each row is independent; clearing one changes only that item and
   raises that receipt's leftover.
4. **The transaction is never split.** No entry is added, moved or divided. The statement, the points, the balances, the
   card cycle and the tax report all see exactly the transaction that was posted. A share is a reading of it, not a
   change to it.
5. **Shares default to the item's estimate**, clamped to what is left on the receipt, so ticking three items on a
   receipt usually needs no typing at all.
6. **"Buy it now" makes one share equal to the whole amount**, because the transaction it just posted is that item and
   nothing else.

**When a purchase is corrected to a smaller amount** (`replaceTransaction`), the shares follow it to the new
transaction id. If they still fit, they are kept exactly. If their sum now exceeds the new amount, every share is
reduced in proportion — `floor(share × newTotal / oldTotal)` — and the rounding remainder is added to the largest one,
so the shares always sum to exactly the new amount; a share that would round down to nought is unlinked instead, since
nought is not a share. A correction is never refused for this reason: refusing to let someone fix a wrong figure,
because the figure is wrong, would be the worst of both.

### 2.6 Writing

`packages/db/src/repos/event-items.ts`:

- `saveEventItem(database, ws, eventId, { id?, name, quantity?, unitPriceMinor, categoryAccountId?, link?, note? })` —
  insert or edit. Refusals: `NAME_REQUIRED`; `QUANTITY_RANGE` unless `quantity` is an integer above nought (absent
  means 1); `PRICE_RANGE` unless `unitPriceMinor` is an integer above nought; `NOT_A_CATEGORY` when a category is given
  that is not an `expense` account of this workspace; `BAD_LINK` per §2.4. Blank link and note are stored as NULL.
  `sort_order` is set on insert only. An edit never touches `transaction_id` or `share_minor`.
- `removeEventItem(database, ws, itemId)` — deletes the row. The purchase, if any, is left alone; its share returns to
  the receipt's leftover and becomes not-planned spending.
- `linkEventItem(database, ws, itemId, transactionId, shareMinor?)` — the transaction must be posted, in this
  workspace, and already tagged to the item's event (`NOT_TAGGED` otherwise). The share defaults to the item's
  estimate, clamped to what is left on the receipt; an explicit share above what is left refuses with
  `OVER_ALLOCATED`.
- `unlinkEventItem(database, ws, itemId)` — clears both `transaction_id` and `share_minor`.
- `setPurchaseCover(database, ws, transactionId, covers: { itemId, shareMinor }[])` — what the "What it covers" screen
  saves: it links every item named, with the share given, and unlinks every item that named this transaction and is no
  longer in the list. One transaction, one write, one refusal (`OVER_ALLOCATED`) when the shares add to more than the
  purchase.
- `purchaseCover(database, ws, transactionId)` — what that screen reads: the transaction's expense total, its current
  covers, and what is left.
- `carryEventItemTx(tx, ws, from, to, newTotalMinor)` — moves every link onto a corrected purchase and scales the
  shares per §2.5. Called by `replaceTransaction`.

### 2.7 Migration 0049 `event_plan_items`

`0049` is the first number that cannot collide: `main` ends at **0045**, the three projects queued before this one take
**0046** (workspaces switching), **0047** (Coretax pickers) and **0048** (the Add Transaction rebuild), and the
data-safety project adds none. Even if Add Transaction lands after this one, 0048 is already spoken for in its plan, so
0049 is free either way.

1. Create `event_items` and its two indexes.
2. Convert every `event_budgets` row that carries a figure into one item named after its category, with `quantity` 1
   and `unit_price_minor` the old cap, keeping the cap's own id, `created_at` and event, ordered by `created_at` within
   the event. A cap with `planned_minor` NULL was never a figure — it only said "this event draws on this category",
   which the item's own category now says — so it is dropped rather than turned into an item with no price. A cap whose
   category no longer exists is dropped by the join.
3. `DROP TABLE event_budgets`.

No figure the app reads survives in a different shape: the sheet those caps fed is deleted in the same change. What the
conversion buys is that the dummy events already in a database still read as plans rather than as empty ones.

## 3. The figures

`packages/core/src/events/plan.ts` exports one pure function, `eventPlan(input): EventPlan`. It replaces
`packages/core/src/events/sheet.ts` (`eventSheet`) outright; `sheet.ts` and `packages/core/test/event-sheet.test.ts` are
deleted.

### 3.1 Input

```ts
export interface EventPlanItemInput {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  categoryId: string | null;
  link: string | null;
  note: string | null;
  /** The purchase that answered it, and how much of it this item is. */
  purchase: { transactionId: string; shareMinor: number } | null;
}

/** One expense entry of one posted transaction tagged to the event, in the scope being read. */
export interface EventActual {
  transactionId: string;
  occurredOn: string;
  description: string;
  categoryId: string;
  amountBaseMinor: number;
}

export interface EventPlanInput {
  items: EventPlanItemInput[];
  actuals: EventActual[];
  categoryNames: Record<string, string>;
}
```

`actuals` is entry-level, not transaction-level: a split purchase arrives as one row per expense entry, each with its
own category. That is what lets a category line stay honest when one payment was split across two of them.

### 3.2 The figures

| Figure | Rule |
|---|---|
| **Planned** | Σ `quantity × unitPriceMinor` over every item |
| **Spent** | Σ `amountBaseMinor` over every actual — planned or not |
| **Spent in planned categories** | Σ of the actuals whose category has at least one item |
| **Still to buy** | Σ estimates of items **not bought in this reading** |
| **Difference so far** | (Σ shares of bought items) − (Σ estimates of bought items). Signed: positive is over |
| **Not planned** | Spent − Σ shares of bought items |

An item is **bought in this reading** when it has a purchase and at least one actual carries that transaction id. This
one rule is what makes every figure add up under a workspace tab as well as whole (§6): a purchase that is out of scope
takes its item's share out of `Spent` and its estimate back into `Still to buy` at the same moment, so the two
invariants hold in any scope:

- `Planned = Still to buy + Σ estimates of bought items`
- `Spent = Σ shares of bought items + Not planned`

`Not planned` is computed by subtraction rather than by hunting for actuals with no item, so the second invariant is
true by construction and cannot drift — and it absorbs a part-allocated receipt's leftover without any special case.

An item's **actual** is its share, never the whole receipt. Its difference is that share minus its estimate.

**Spent in planned categories** is the figure the "Against the plan" chart and the Plan card's header measure against
`Planned` — see §5.6. Where every category is planned it is simply `Spent`.

### 3.3 Lines

One line per category that either side mentions, plus one line for items with no category:

```ts
export interface EventPlanLine {
  /** Null on the line holding items filed in no category. */
  categoryId: string | null;
  name: string;
  /** True when this category has at least one item: this is the category that is planned, not the event. */
  planned: boolean;
  /** Σ estimates of the items filed here. The only meaning a category has. */
  plannedMinor: number;
  /** Σ actuals whose entry landed here. */
  actualMinor: number;
  itemCount: number;
  boughtCount: number;
  /** Distinct transactions that landed here — what "4 purchases" counts. */
  purchaseCount: number;
  items: EventPlanItemView[];
  /** Money here that no item claims: a whole untagged-to-an-item purchase, or the leftover of a part-allocated one. */
  unplanned: { transactionId: string; occurredOn: string; description: string; amountBaseMinor: number; partial: boolean }[];
  unplannedMinor: number;
}
```

The plan groups by the **item's** category; the money groups by the **transaction's** category. They are the same
category in every ordinary case, because "Buy it now" fills the category from the item. When someone changes the
category while buying, the item stays on the line where it was planned and the money shows on the line where it was
spent, and the item's row says where it went (§5.4). Nothing is counted twice: each estimate is in exactly one line's
`plannedMinor`, each actual in exactly one line's `actualMinor`.

A leftover row carries `partial: true`, so the screen can say "part of this receipt" rather than implying nothing on it
was planned.

Order: lines by `plannedMinor` descending, then `actualMinor` descending, then name; the no-category line always last.
Items within a line: unbought first (that is the list of things still to do), then bought, each group in `sort_order`.
Unplanned rows come after the items, newest first.

### 3.4 The whole

```ts
export interface EventPlan {
  /** False when the event has no items: it reads as it does today, adding up what was tagged. */
  hasPlan: boolean;
  itemCount: number;
  boughtCount: number;
  /** Distinct transactions tagged to the event — "21 purchases" on the events list. */
  purchaseCount: number;
  /** Categories with money in them and no items: how much of the event is deliberately unplanned. */
  unplannedCategoryCount: number;
  plannedMinor: number;
  spentMinor: number;
  plannedSpentMinor: number;
  toBuyMinor: number;
  boughtEstimateMinor: number;
  boughtActualMinor: number;
  /** Signed: positive is over estimate, negative under, nought exact. */
  differenceMinor: number;
  notPlannedMinor: number;
  /** Items bought for more than their estimate. */
  overCount: number;
  lines: EventPlanLine[];
}
```

With no items at all, `hasPlan` is false, `plannedMinor`, `plannedSpentMinor` and `toBuyMinor` are nought, every actual
is unplanned, and `lines` is exactly a grouping of tagged spending by category — which is both the mockup's unplanned
Bali page and what an event does today. One function serves every state; there is no second code path for unplanned
events, and none for partly planned ones either.

### 3.5 Reading it from the database

`eventPlanFor(database, ws, eventId): Promise<EventPlan>` in `packages/db/src/repos/events.ts` replaces
`eventSheetFor`. It reads:

- items through `listEventItems`, narrowed by `ofBook` on the item's category — the same subquery `listEventBudgets`
  uses today. An item with no category is owner-wide and appears under every tab.
- actuals: `entries` joined to `transactions` and `accounts`, `status = 'posted'`, `event_id = eventId`,
  `accounts.kind = 'expense'`, narrowed by `ofBook` on the entry's category. No `GROUP BY` — one row per entry,
  carrying the transaction's id, date and description.
- names for every category either side mentions.

`suggestForEvent` keeps its shape but takes its categories from `eventCategories(database, ws, eventId)`: the distinct
categories of the event's items, plus the categories of the event's category set when it has one (`events.set_id`). The
old source — the categories with an `event_budgets` row — is gone with the table. The set half is what keeps an event
with no plan able to suggest anything at all.

## 4. Buying, covering, unlinking

### 4.1 Buy it now

An item's screen has one primary button, **Buy it now**. It opens Add Transaction with the amount (the estimate), the
category and this event already filled in; the user corrects the real price and saves. Saving posts the transaction,
tags it to the event and links it to the item with a share equal to the whole amount, and lands back on the plan where
the tick and the difference are now visible.

The Add Transaction rebuild may land before or after this work, so the target lives in exactly one place:
`apps/web/src/features/events/buy-item.ts`.

- **Today** `buyTarget(eventId, itemId)` returns `{ to: '/events/$eventId', params: { eventId }, search: { buy: itemId } }`.
  The event page already owns an "Add spending to this event" card that posts and tags in one action — the only path in
  the app today that can fill in an event, since `TransactionForm` has no event field and tagging is a second write.
  With `?buy=<itemId>` the card opens seeded from the item (description = the item's name, amount = the estimate,
  category = the item's category) and its save calls `linkEventItem` with the new transaction id.
- **After the rebuild** `buyTarget` returns `{ to: '/transactions/new', search: { amount, category, event, planItem } }`
  and the new form's save calls the same `linkEventItem`. One function body and one call site change; no screen of this
  feature moves.

Today's card is gated on `event.setId` — an event without a category set has no way to add spending at all. That gate
goes: the card is offered for every event, and its category list is the same list the item form uses.

### 4.2 What it covers

Under "Already bought it?" the item screen offers **Link a purchase**, subtitled "one receipt can cover several items".
It is two steps:

1. **Pick the purchase** — the transactions tagged to this event that still have something left on them, newest first,
   each showing what is left.
2. **What it covers** — the receipt at the top (merchant, date, account, total), then every item of the event with a
   tick box, its estimate under the name, and its share; the item you came from starts ticked. Ticking sets the share
   to the item's estimate clamped to what is left; the share can then be typed. Three figures close it: **Receipt**,
   **Given to items**, and **Left on this receipt**, the last badged "not planned" when it is above nought.

Save writes the whole set at once (`setPurchaseCover`), so ticking three items and unticking a fourth is one write and
one refusal. Over-allocation is refused before anything is written, naming what is left.

### 4.3 Unlinking

The tick box on a bought row, and "Remove the link" on the item screen, both call `unlinkEventItem`. The transaction
stays exactly as it is: still posted, still tagged to the event, still in the history. From that moment its share
returns to the receipt's leftover and reads as not-planned spending, and the item's estimate returns to "Still to buy".
Unticking never deletes money, and never touches the other items on the same receipt.

### 4.4 When the purchase is voided

Every read joins `transactions.status = 'posted'`, so a voided purchase drops out of `actuals` and every item it
answered reads unbought: their estimates return to "Still to buy", their differences leave "Difference so far", and
their rows show "estimate" again. The rows are **kept** rather than cleared, so nothing has to guess what to restore,
and linking a different purchase simply overwrites one.

Correcting a purchase is a void plus a repost under a new id (`replaceTransaction`), so `carryEventItemTx` moves every
link to the replacement inside the same transaction, beside the lines that already carry `card_postings`,
`card_settlements` and points across a correction, and scales the shares if the new amount is smaller (§2.5).

### 4.5 When a category changes

- **The item's category** (editing the item): the item and its estimate move to the new category's line. The money does
  not move — it is where it was spent. Estimates never change, so the figures do not move either, only which line they
  are under. A category that loses its last item stops being planned and goes back to reading "no items".
- **The purchase's category** (editing the transaction): the money moves to the other line; the item stays where it was
  planned, keeps its tick, its share and its difference, and its row reads "bought in *Clothes*" when the purchase's
  category is not the item's. The event totals are unaffected, because none of them is per category.

## 5. The screens

Routes, all of them working in `chromium` and `phone`:

| Route | Screen |
|---|---|
| `/events` | the events list |
| `/events/$eventId` | the event page, planned, unplanned or partly planned |
| `/events/$eventId/plan` | the whole plan, and its empty state |
| `/events/$eventId/plan/new` | adding an item |
| `/events/$eventId/plan/$itemId` | one item |
| `/events/$eventId/plan/$itemId/edit` | editing an item |
| `/events/$eventId/plan/link` | pick the purchase |
| `/events/$eventId/plan/link/$transactionId` | what it covers |

Every plan route takes `?ws=<bookId>`, carried from the event page's open tab, so opening the plan from one workspace's
tab keeps reading in it. None of the plan screens draws tabs of its own: the tab is chosen on the event page and the
plan follows it.

### 5.1 The events list

One line changes. A planned event reads "Planned · Rp 37.200.000 still to buy" under its name, with
`plannedSpentMinor` **of** `plannedMinor` on the right. An unplanned one reads "No plan · 21 purchases", with
`spentMinor` and the word "spent". The thin bar stays, and is drawn only when the event has a plan.

### 5.2 The event page, planned

The order does not change: chart, **Plan card**, suggestions to tag, Transaction history, Add spending, Mark as done,
Remove event. Workspace tabs stay under the title.

The chart card keeps the `Deck`: page one is "Where it went" (the donut over `spentMinor`, unchanged), page two is
"Against the plan", shown only when `hasPlan`. That page keeps the `BudgetGauge` the month uses — the mockup draws the
figure as a full ring, but the arc is already this page's chart and is shared with Cashflow, so the shape stays and the
reading changes:

- the arc measures **`plannedSpentMinor` against `plannedMinor`** (§5.6);
- its three figures become **Planned**, **Spent**, **Still to buy** (the third slot today holds the event's length);
- `overCount` becomes items bought over their estimate, said as "3 items over";
- beneath the gauge, in the mockup's order: **Still to buy**, **Difference so far** (in the difference words) and
  **Not planned**, each omitted when nought.

The day count the third slot gives up moves next to the dates in the card's header, so no figure is lost.

The **Plan card** replaces today's "add a category and a figure" form entirely:

- header "Plan", and on the right `plannedSpentMinor` of `plannedMinor`;
- one row per planned category line: the name with its icon, "3 items · 1 bought" beneath, and what its items add up to
  on the right under the word "planned";
- a row **See the whole plan ›** / "tick things off, add items";
- a row **＋ Add an item** / "plan another thing, in any category".

### 5.3 The event page, unplanned and partly planned

**Unplanned** (`hasPlan` false) is today's page: one chart page, the donut over what was spent, the categories listed
as "Hotels · 4 purchases · Rp 9.200.000", the history, Add spending. In place of the Plan card there is one row, **Plan
what to buy ›** / "turn this into a list with estimates", which opens the plan screen's empty state.

**Partly planned** is the same page with both halves true at once, and it is the case the whole design turns on:

- the chart keeps both pages; "Where it went" lists **every** category, with a "no items" pill on the ones with no
  items and `actual of planned` on the ones with items (Activities: "Rp 0" small "of Rp 3.500.000", "nothing spent
  yet", a blue "planned" pill);
- the summary reads **Planned so far** rather than **Planned** whenever at least one category has money and no items —
  the words admit that the figure is not the trip;
- the Plan card lists only the planned categories, and its "＋ Add an item" row says "plan another thing, in any
  category".

### 5.4 The whole plan

Header: back to the event, "Plan · *event*", and ＋ to the new-item screen.

- A summary block: **Planned**, **Bought so far** (Σ shares), **Still to buy**, and **Difference so far** once anything
  has been bought.
- Then, per category line: a kick line with the category and "Rp 8.100.000 of Rp 26.000.000", and its rows.
  - An **unbought item**: an empty box, the name, "6 × Rp500.000 · estimate" beneath (the quantity half only when the
    quantity is above one), and the estimate in grey with "to buy".
  - A **bought item**: a green ticked box, the name, "6 × Rp500.000 · RS Bunda · 2 Sep" beneath, its share, and the
    difference in green or red.
  - A **not-planned purchase**: a dashed empty box, the description with an amber "not planned" pill, "bought 14 Sep"
    beneath, and the amount. A leftover says "part of this receipt" instead.
- **＋ Add an item** at the foot, and the hint: "A category line is the sum of its items — there is no cap to set.
  Something tagged to the event with no item sits under its category as "not planned"."

The tick box on a bought row is its own control (`aria-label="Unlink <name>"`), a sibling of the link that opens the
item rather than nested inside it. On an unbought row the box is decoration: buying needs a form, and a box that
silently marked something bought for no money would be a lie.

**Empty state** (an event with no items): "Nothing planned yet. Add the things you mean to buy and roughly what they
cost.", a dark **＋ Add the first item**, and the reassurance that what is already tagged does not go anywhere — once
there is an item, it simply reads as "not planned" beside it.

### 5.5 One item, and adding one

**One item.** Header: back to the plan, and ✎ to the edit screen.

- Hero, unbought: the estimate large, "*Stroller Bugaboo* · estimate", the category as a blue pill.
- Hero, bought: its share large, "*Stroller Bugaboo* · *Toko Bayi* · 12 Sep", the difference beneath, and "bought in
  *Clothes*" when the purchase's category is not the item's.
- **Buy it now** (dark, full width) while unbought.
- The fields, read-only rows: **How many**, **Price each**, **Estimate**, **Category**, **Link** (a real link, new tab)
  and **Note**.
- The hint that names them: "**Name** is what the thing is. **Note** is anything you want to remember about it.
  **Estimate** is how many × price each, so 6 check-ups × Rp500.000 reads as Rp3.000.000."
- "Already bought it?" → **Link a purchase** / "one receipt can cover several items".
- While bought, the purchase as a row (merchant, date, share of the total) and **Remove the link**.
- **Remove this item**, in red, with "Removing an item leaves any purchase alone — it becomes 'not planned'."

**Adding one.** Cancel / "New item" / Save in the header. Fields: **What**, **How many** (default 1), **Price each**,
**Estimate** (read-only, the product), **Category**, **Link**, **Note**. The hint: "No date. How many × price each makes
the estimate; one of something is the ordinary case."

Then **After saving**, live from what is typed: "*event*, planned", **Still to buy**, and **Not planned** — the last
being what is already tagged and unclaimed, which is what makes the first item on an unplanned event honest rather than
alarming. The edit screen is the same component with the item loaded and the same live figures, computed with the
item's old estimate taken out first.

### 5.6 Why the chart measures only the planned categories

Bali has Rp 18.400.000 tagged to it and Rp 3.500.000 planned, in one category, with nothing spent there yet. Measuring
everything spent against everything planned would say the trip is Rp 14.900.000 over plan, which is false: the food was
never planned, so there is nothing for it to be over.

So the second chart page and the Plan card's header both measure **spending in categories that have items** against
**what those categories' items add up to**. Bali reads "Rp 0 of Rp 3.500.000" — the truth. Newborn, where every
category has items, reads "Rp 12.830.000 of Rp 49.200.000", exactly as it would have. The first chart page is always
the whole of what was spent, so nothing disappears from view; and "Not planned", which is a whole-event figure, still
counts every unclaimed rupiah wherever it was spent.

## 6. Workspace tabs

An event is owner-level — a wedding touches Personal and Business alike — so its screens read whole by default, and a
tab asks for one workspace at a time. The tabs are unchanged: `booksInEvent` still lists the workspaces that have
**spending** tagged to the event, and a workspace that only has items planned in it still gets no tab.

A tab narrows three things, each by the same subquery every book-scoped read uses:

- **the plan's items**, by the item's category — the same narrowing `listEventBudgets` does today. An item with no
  category belongs to no workspace and shows under every tab.
- **the plan's actuals**, by the entry's category.
- **the history**, as today.

Because an item bought through "Buy it now" is posted into the item's own category, an item and its purchase are in the
same workspace in every ordinary case. The only way to part them is to cover an item with a purchase from another
workspace by hand; then that tab reads the item as still to buy — the honest answer, because the money is not in this
workspace.

There is no per-tab plan total to reconcile with a whole-event figure, because there is no whole-event figure any more:
`Planned` under a tab is what that workspace's items add up to.

## 7. Testing

- **Core** — `packages/core/test/event-plan.test.ts`, over the mockup's own fixture (three categories, seven items,
  three bought, one unclaimed purchase of Rp 900.000, one item of six at Rp 500.000). It asserts every figure in §3.2,
  both invariants, the derived estimate, per-item and per-category arithmetic, line and item order, the empty plan, the
  **partly planned** plan (Bali: `plannedSpentMinor` 0 of 3 500 000, three unplanned categories), the no-category line,
  the split purchase, the **shared receipt** (Mothercare 4 150 000 covering three items with 1 270 000 left, filed as a
  partial unplanned row), and the out-of-scope purchase that puts an item back into "Still to buy".
- **Database** — `packages/db/test/event-items.test.ts`: saving with quantity and price, every refusal (including
  `BAD_LINK` and the `https://` prefix), removing, linking, the default share, `OVER_ALLOCATED`, `setPurchaseCover`
  ticking and unticking in one write, unlinking one item of three, a voided purchase, a corrected purchase carrying its
  shares, and a correction to a smaller amount scaling them to sum exactly.
- **Migration** — `packages/db/test/event-plan-migration.test.ts` seeds a genuine version-48 database with two caps, one
  figure-less, and asserts that 0049 makes exactly one item, quantity 1 at the cap's price, and that `event_budgets` is
  gone.
- **Workspaces** — `packages/db/test/book-events.test.ts`: a plan across two workspaces, read whole and under each tab,
  with both invariants asserted in all three readings.
- **Web view model** — `apps/web/src/features/events/plan-view.test.ts`: the gauge input (and that it uses
  `plannedSpentMinor`), the difference words, the quantity words, the Plan card rows, the "Where it went" rows with
  their "no items" pill, `afterSaving`, `itemSubline`, the events-list subline, and the cover sheet's three figures.
- **End to end** — `apps/web/e2e/event-plan.spec.ts` (chromium) plans an event, buys an item through "Buy it now" at a
  different price, covers three items with one receipt and reads the leftover as not planned, unticks one, and reads
  every figure. `apps/web/e2e/event-partly-planned.spec.ts` plans one category of an event that already has spending in
  three and proves the chart does not call it over plan. `apps/web/e2e/phone-event-plan.spec.ts` drives the main
  journey by thumb. The existing `events.spec.ts` and `phone-events.spec.ts` are rewritten to plan with items.
- The sample seed plans the Singapore weekend as six items instead of six caps, so `sample-data.test.ts`,
  `books-sample.test.ts` and `books-sample-migration.test.ts` keep exercising a realistic plan.

Every figure named in §3.2 has a test that names it. Nothing in this feature is proved by a screenshot alone.

## 8. Out of scope

- **Caps of any kind** — per category, per event, or per item. There is nothing to set.
- **Dates, deadlines, reminders or overdue states on items.** The event's own dates are the only dates.
- **Splitting the transaction itself.** A share is a reading of a purchase, never a change to it: no entry is added,
  moved or divided, and statements, points, balances and the tax report are untouched.
- **One item answered by several purchases.** A purchase answers many items; an item has one purchase, because its row
  has one merchant and one date to show.
- **Fetching a link**, previewing it, reading its title, or storing anything from it. Nothing leaves the device.
- **Priority, supplier, or a photo of the thing.** The first the user judged noise; the rest are an RAB spreadsheet.
- **Reordering items by hand.** `sort_order` exists so the order is stable, not so it can be dragged.
- **A currency per item.** Prices are minor units of the workspace base currency, like every other plan figure.
- **Any compatibility with `event_budgets`.** No shim, no setting, no dual read.
- **`events.planned_minor`.** The column stays; nothing reads it, and the form stops offering it.
- **Sharing a plan, or assigning items to people.** Who bought what is the Add Transaction rebuild's "With".
- **Changing how event spending meets the monthly budget.** `count_events_in_budget` and the budget sheet's event line
  are untouched.
