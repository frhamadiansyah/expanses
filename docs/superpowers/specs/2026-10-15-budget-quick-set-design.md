# Budget: fewer taps to set a cap — design

Date: 2026-10-15 · Branch: `feat/uiux` · Mockup: https://claude.ai/artifact/62kXk9XBQkLGLdHXZBHfkn (screens 1–3; screen 4 dropped)

## Why

Setting a budget takes too many taps. Today:

| Task | Now |
|---|---|
| New cap, one category | ⋯ → Add a budget → Category picker → pick → Cap field → type → Save (6 taps), or No budget → pick → field → type → Save (4) |
| Change one cap | row → field → clear old figure → type → Save (3 + clearing) |
| Set ten categories | 40–60 taps |

Target after this change:

| Task | After |
|---|---|
| New cap, one category | Set → type → ✓ (2 taps), or Set → chip → ✓ (3 taps, no typing) |
| Change one cap | row → type over the selected figure → ✓ (2 taps) |
| Set ten categories | Edit budgets → Fill empty from last month → adjust a few → Save (≈3 taps plus edits) |

## What changes

Three pieces. Nothing about how caps are stored, counted or rolled up changes.

### 1. Budget page (Spending tab)

- **Edit budgets** text button in the large-title bar, left of ⋯. Opens the Edit budgets screen (part 3) for the month shown.
- ⋯ loses **Add a budget**. Its other items stay.
- The single "No budget" row and its sheet (`NoBudgetSheet`) are replaced by a **No budget yet** group on the page:
  - One row per *root* category with no cap that spent something this month (`view.noBudget` entries with `spentMinor > 0`), sorted by spend, largest first.
  - Row: category mark, name, "Rp X spent this month" under it, and a **Set** button at the end. The Set button and the row itself both open the one-budget sheet (part 2) for that category.
  - Header right side: what these categories spent between them.
  - Footer line: "Several to set? **Edit budgets** sets them all on one screen." The link opens part 3.
  - Uncapped child categories and categories with nothing spent are not listed here; Edit budgets reaches every category.
- When nothing is budgeted yet, the Budgeted group's single row reads **Set budgets** and opens Edit budgets (today it opens the Add sheet).

### 2. One-budget sheet (`CapSheet`)

- Always opened for a known category. The **Category** picker and the `categoryId: null` path are removed, along with the `options` prop.
- On open, the Cap field has focus and its whole figure is selected, so typing replaces it. On a phone the keyboard is up at once.
- **Use a figure** chips under the first group, each showing a label and a figure:
  - *Last month* — what the category spent the month before the one shown.
  - *3-month average* — the mean of the three months before the one shown, rounded **up** to a whole major unit.
  - *Spent so far* — this month's spend.
  - A chip is hidden when its figure is 0. Tapping a chip puts the figure in the Cap field and sets Every to Month (the figures are monthly). Nothing is saved until ✓.
- Everything else stays as it is: Every, Per month preview, Just this month, Spent so far / Of it, bills, Remove budget.

### 3. Edit budgets screen (new)

Route `/budget/edit?month=YYYY-MM`. Full screen on a phone, in the way Add transaction is, and in the content area on wider screens.

- **Bar:** Cancel · *Edit budgets* · Save. If anything was changed, Cancel asks "Discard changes?" first.
- **Summary card** at the top, updated as figures are typed:
  - **Budgeted**: the total of the typed caps, counted with the same outermost-cap rule the sheet uses (a cap inside a capped parent is not counted twice).
  - Bar and line: Debt · Goals · **Unplanned**, against the take-home. Unplanned = take-home − debt − goals − budgeted.
- **Fill empty from last month** (text button above the list) fills every row that:
  - is empty, and
  - has no children, and
  - has no capped ancestor among the figures on screen, and
  - spent more than 0 last month.

  The figure used is last month's spend, rounded up to a whole major unit. Rows filled this way are marked until saved. If no row qualifies, the button is disabled. Cancel undoes the fill.
- **List:** every category of the open book's monthly tree (the same set the page budgets for: expense categories, not in an event set, in the open book). One group per root, with the root's mark and name in the header.
  - A root with children: the first row is **All <Root>**, the root's own cap, followed by one row per child. Grandchildren are indented one step further.
  - A root with no children: a single row.
- **Row:** the name, a hint under it, the amount field, and a unit select.
  - Hint: "Last month Rp X". If this month has its own figure (an override), the hint says "<Month> only: Rp X" instead.
  - Amount field: the plan as it was typed (`amountAsSetMinor`), grouped as typed (`groupTypedAmount`). Empty when there is no cap.
  - Unit select: /day /wk /mo /qtr /yr, defaulting to /mo.
  - The focused row also shows the *Last month* and *3-month average* chips.
- **Keyboard:** each field has `enterkeyhint="next"`, and Enter moves focus to the next field. The last field uses `done`. The mockup's accessory bar is the system's own; no custom one is built.
- **Edits the plan only.** This-month-only figures are changed in the one-budget sheet, as today. Saving a plan leaves a month's override standing.
- **Save** compares each row with what is stored:
  - new or changed figure or unit → saved
  - an existing cap whose field was cleared → removed
  - unchanged → not written
  - **Everything is written in one transaction.** If any row is refused (for example a figure that comes to nothing a month), nothing is written. The error names the category and the screen stays open with the figures kept.
- After saving, the screen returns to the Budget page for the same month.

## Building blocks

- **core** — `outermostCapsTotal(lines)` is taken out of `budgetSheet`'s walk and exported. `budgetSheet` calls it, and so does the Edit budgets summary. Plus `roundUpToMajor(minor, currency)`.
- **db** — `saveBudgets(database, ws, { save: SaveBudgetInput[], remove: string[] })` runs every check `saveBudget` runs, for every row, before anything is written, then writes them all in one transaction with sync capture. `saveBudget` and `removeBudget` share their row-level writes with it, so the rules live in one place.
- **db** — `spendingHistory(database, ws, month, count = 3)` returns, per category id, its `totalMinor` (rolled up, same events rule as the sheet) for each of the `count` months before `month`. It is built from `budgetSheetFor` for each month, so its figures match what a cap measures.
- **web** —
  - `useSpendingHistory(month)`
  - a pure `edit-budgets-model.ts`: rows from the tree, the fill rule, the live total, and turning the screen's state into `{save, remove}`
  - `EditBudgetsPage.tsx`
  - changes to `BudgetPage`, `CapSheet` and `budget-rows`
  - `NoBudgetSheet` is deleted.

## Testing

- **core:** `outermostCapsTotal` (nested caps counted once, matching `budgetSheet`'s old total); `roundUpToMajor` for IDR, USD and JPY.
- **db:** `saveBudgets`
  - writes saves and removals together
  - one refused row → nothing written
  - leaves an override standing
  - keeps the unit and the figure as typed

  `spendingHistory`: totals match `budgetSheetFor`'s lines, and months with no spend give 0.
- **web unit:** the model's fill rule (skips parents, rows under a capped ancestor, and rows with no spend), the live total, and the diff (unchanged rows not sent, cleared rows removed).
- **e2e (Playwright, phone and desktop):**
  - Set on a page row → type → ✓ shows the cap
  - opening a capped row has the figure selected, and typing replaces it
  - a chip fills the figure
  - Edit budgets → Fill → Save shows the new caps and Budgeted total
  - a refused row keeps the screen open and writes nothing

  Existing specs that use ⋯ Add a budget or the No budget sheet (`budget.spec.ts`, `phone-budget-page.spec.ts`, `phone-budget-tabs.spec.ts`, `phone-budget-frequency.spec.ts`, `category-sets.spec.ts`, helper `e2e/budget.ts`) move to the new paths.

## Out of scope

- This-month-only figures in Edit budgets.
- Event (set) budgets, which are planned on the event's page.
- The Plan tab, the take-home sheet, and the ⋯ items that stay.
- Rounding suggestions to "nice" figures beyond whole major units.
