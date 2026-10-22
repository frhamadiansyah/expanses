# Split one buy (or sell) between goals — design

Date: 2026-10-22. Owner asked: "in one transaction I buy 8 lots of BBCA, I want to tag 5 lots for the emergency fund
and 3 lots for the education fund." Mockup agreed: buy-sell-v2.html, section 8.

## Intent

One purchase is one purchase: one row in Cashflow, one ledger transaction, as on the broker's confirmation. Today a
buy funds at most one goal, so the owner has to record two buys and divide the fee by hand. A split lets one buy (and
one sell) carry several goals, each with its own lots — or its own amount, for a fund tracked by money.

## Goals

- A buy can be split between up to any number of goals; what no goal takes stays "not for a goal".
- A sell can say which goals it takes from, split the same way.
- Every goal figure that reads a buy's goal today reads the parts instead: units per goal, money per goal (funds by
  money), monthly contributions, the set-aside lowered when a goal's money buys the holding.
- A split can be changed later, from the trade's sheet on Buy & sell (re-split replaces the parts).

## Non-goals

- Monthly plans (templates), Convert, Buy-in from the Add screen, Add a holding: they keep one goal.
- The short holding sheets (listed, fund, gold) keep no goal; More options opens the full form, which has the split.
- No sync: trades, goals and their draws are device-local (shared-entities has none of them).

## Anti-goals

- Two cash rows for one purchase.
- A goal ending up with units or money the holding never had (parts must add up to at most the trade).
- Any existing single-goal trade reading differently after the change.

## Decisions

1. **Storage.** New table `trade_goal_parts (trade_id, goal_id, units_micro, money_minor)`, migration 0083. A trade
   with one goal keeps using `investment_trades.goal_id` exactly as today; parts rows exist only when a trade is
   split between two or more goals, and then `goal_id` is null. Old trades and old databases are untouched. The
   table is read only when it exists (pragma guard), like `plan_off` and `number_last4`.
2. **Core.** `TradeRecord.goalParts?: { goalId: string; unitsMicro: number; moneyMinor: number }[]`.
   `goalUnitsOf`, `goalMoneyOf`, `retagFits` walk the parts when present (each part adds to / takes from its goal,
   checked per goal), the remainder going to "not for a goal". Output shape unchanged, so `goalLinksFor` and the
   goal pages need nothing.
3. **Money per part.** Units holdings: a part's share of the buy's whole outflow (gross + fee + tax) is in proportion
   to its units; rounding goes to the largest part. Funds by money: the owner types each part's amount of the gross;
   fee and tax follow in proportion. A sell by money takes each part's basis in proportion to its amount.
4. **Set-aside.** A split buy lowers each goal's set-aside on the paying account by that goal's share of the outflow
   (one `goal_draws` row per goal, as `loweringOfTx` already allows), and every goal in the split counts as "own" in
   the set-aside question (`checkOutflow` takes a list).
5. **Contributions.** One contribution event per part, at the part's money.
6. **UI.** In the full form, "For goal" / "Sell from goal" gains "Split between goals…", opening the parts editor:
   a row per goal with lots (units, grams) or amount, "＋ Add a goal", "Not for a goal" showing the rest, and
   "Placed 8 of 8 lots"; more than the trade turns the line red and keeps Done off. On Buy & sell, a trade's sheet
   shows "Goals" (one name, or "Emergency 5 · Education 3") opening the same editor; the history line shows each
   goal as a small label.
7. **Edit and delete.** Editing a trade (replace) carries its parts; deleting voids the transaction, which gives the
   draws back as today.

## Left to the builder

- Exact component split of the parts editor; reuse of SelectRow/TextRow inside a Sheet.
- Tests: core unit tests for the walks (split buy, split sell, oversell per part, unit change scaling with parts,
  money split rounding), db tests for record/replace/retag/delete with parts and the lowering per goal, one e2e for
  the editor.
