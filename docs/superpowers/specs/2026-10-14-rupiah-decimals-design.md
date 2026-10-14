# Decimals on whole-unit currencies (rupiah) — design

Date: 2026-10-14. Owner decisions: B2, round up per transaction, points on the amount rounded down, income rounds down, single amount only.

## 1. Why

The owner's cards charge each purchase rounded **up** to the whole rupiah, but earn points on the amount rounded **down**. A purchase of Rp 12.500,30 is billed 12.501 and earns points on 12.500. Today cicis refuses "12.500,30" for IDR ("IDR allows 0 decimal places"), so the exact figure, and with it the right points, is lost.

## 2. What the owner sees

- Typing a decimal amount is allowed on the **single amount** of an Expense (including a refund typed with a leading "−") and of an Income. The keypad offers a "," key for these. Splits, transfers, bills, budgets and every other money field stay whole units.
- After saving, the amount is shown in whole units **everywhere**: lists, totals, reports, the receipt, and the edit form (option B2). The decimals are visible only while typing.
- An expense or refund saves as the amount rounded **up** (12.500,30 → 12.501). An income saves as the amount rounded **down** (12.345,67 → 12.345). Balances, totals, budgets and reports add up those whole amounts, one transaction at a time, as the bank statement does.
- Card points for that purchase are worked out from the exact amount rounded **down** (12.500), then the card's points rule.
- Editing a transaction without changing its amount keeps the stored exact figure. Changing the amount replaces it (or clears it when the new amount has no decimals).
- The same applies to every currency with no minor unit (IDR, JPY, KRW). Currencies with decimals are unchanged.

## 3. Design: keep the ledger whole, store the exact figure beside it

Rejected alternative: changing IDR's exponent from 0 to 2. It touches 40+ tables, JSON blobs, backups, price scales and the household sync logs already stored on other phones and the relay. Every peer would have to migrate in lockstep. Too risky for what it buys.

Chosen: the ledger keeps whole units. Every posted amount is the rounded figure, so balances, reports, budgets, statement checks, the tax report and sync are untouched. One new nullable column holds the exact figure:

- `transactions.exact_hundredths INTEGER NULL`: the typed magnitude in hundredths of the transaction's currency unit (12.500,30 → 1250030). Set only when the typed amount had a non-zero fraction; null otherwise. Always positive; the sign lives in the lines.
- Migration `0068_exact_hundredths`, added the way `day_order` was (0067): an undeclared column behind a cached column-exists check, because declaring it on the drizzle table breaks tests that stop at older migrations.
- `replaceTransactionTx` carries it forward like `mcc`, `cardId` and `day_order`, unless the edit supplies a new value (including an explicit null).

## 4. Rules in core

- `parseFractionalMajor(text, currency, direction: 'up' | 'down')` → `{ minor, exactHundredths | null }` for exponent-0 currencies: accepts up to 2 decimals, returns the whole figure rounded in `direction` and the exact hundredths when the fraction is non-zero. For other currencies it behaves exactly like `parseMajor`. `parseMajor` itself is unchanged, so its ~60 other callers keep refusing decimals.
- Keypad `evaluateAmount(expression, currency, { refund?, fractional?: 'up' | 'down' })`: sums the operands exactly in hundredths, then rounds once at the end in `fractional`'s direction, returning `exactHundredths` as well. "12.500,30+0,80" = 12.501,10 → 12.502, exact 1250110.
- Rounding direction: Expense and refund round up (a refund is money back of a charge rounded up). Income rounds down.

## 5. Points

`cardSpendLines` (packages/db/src/repos/points.ts) is the single funnel into the points engine. For a transaction with `exact_hundredths` set (always a single expense line, since splits don't take decimals), the line's `amountMinor` becomes `floor(exact_hundredths / 100)` with the line's sign (a refund's negative line becomes `−floor(exact/100)`). The engine and its rounding modes are untouched. The "which card" recommendation's typed amount is not affected.

## 6. Capture and import

- Screenshots, notifications, receipt photos: `toMinor` in packages/core/src/capture/amount.ts rounds to the nearest unit today. For exponent-0 currencies it keeps the exact hundredths on the reading; the draft's amount is rounded up for money out and down for money in; confirming the draft passes `exactHundredths` to the posting.
- CSV import: `parseCsvAmount` accepts up to 2 decimals for exponent-0 currencies with the same direction rule and passes the exact figure.
- Statement check: unchanged. A statement prints the charged, whole figure.

## 7. Sync

`exactHundredths` becomes a purchase sync field (shared-entities.ts), so the owner's phone and Mac both hold it. An older build ignores the unknown field: it changes no money, though an op whose only winning field is `exactHundredths` makes an older peer repost the purchase identically (as with `dayOrder`). A newer peer writes an exact-only op in place, like the `dayOrder` fast path.

## 8. Not in scope

Decimals in split rows, transfers, bills, budgets, loans, goals, assets, the statement check's correct sheet. Showing the decimals after saving (B1). Changing any currency's exponent.

## 9. Testing

- core: parse and keypad properties (fast-check): `minor` is `ceil`/`floor` of the exact value, exact round-trips, whole input gives null exact; other currencies unchanged.
- db: posting stores and carries the exact figure; editing with an unchanged amount keeps it, with a new amount replaces or clears it; points use the floored exact figure (the 2.499,70 case earns 0 at 1 per 2.500 while the card is charged 2.500); refund reverses with the same floor; sync round trip and an older-peer op.
- web: the form (expense up, income down, refund, splits refuse decimals), the keypad "," key.
- capture/CSV: a decimal reading becomes a rounded draft with its exact figure.
- e2e phone: type 12.500,30 → row shows 12.501 → reopen shows 12.501 → points estimate uses 12.500.
