# Mutual funds: tracked by money, held at a place

Status: agreed with the owner on 2026-10-19; not planned or built. **Replaces** `2026-10-19-fund-held-at-design.md`:
the owner asked for "where it is held" to be built together with this, as one piece of work.

## Why

The owner holds mutual funds (reksadana) through Bibit, a bank or a broker, and almost never knows the units or the
NAV. What they do know is the money: what they put in, what they took out, and the fund's total value when they look at
the platform's app. Today the app refuses that:

- A fund buy or sell must have units, or a NAV to work them out from (`fund-trade.ts` returns null with no NAV; the add
  form's purchase row needs units and cost; the full trade form needs units).
- A fund's value is only ever units × NAV (`assetValueAt`, mode `market`). There is no way to type the total.

So the owner's real habit, "I put Rp 1.000.000 in, Bibit now says Rp 1.052.000", can't be recorded at all.

## Goals

- **Buy by amount.** Record money going into a fund: amount, paid from, date. Nothing else is asked.
- **Sell by amount.** Record money coming out: amount, paid into, date.
- **Update value.** On the fund's page, one number: what the platform shows now. Done at random times, one fund at a
  time, whenever the owner happens to look. (No bulk "update all funds" screen is needed for this.)
- **Value between updates follows the money.** The fund's value is the last typed value, plus every buy after it, minus
  every sell after it. Net worth stays right until the next update.
- **Profit = value − money still in.** A sell takes out the same share of the money put in as it takes of the value.
- **Units and NAV are optional.** Nobody has to type them. (Whether a fund that has them keeps a units path is the
  builder's call; see "Left to the builder".)
- **Existing funds switch over.** Funds already entered with units and NAV move to the money way, keeping their history.
- **Held at.** Each fund holding says where it is held, and the same fund at two places is grouped under one fund (see
  "Where it is held").

## The owner's worked example (agreed)

| Step                         | Value     | Money put in | Profit  |
|------------------------------|-----------|--------------|---------|
| Buy Rp 1.000.000             | 1.000.000 | 1.000.000    | 0       |
| Update to Bibit's 1.052.000  | 1.052.000 | 1.000.000    | +52.000 |
| Buy Rp 500.000               | 1.552.000 | 1.500.000    | +52.000 |
| Sell Rp 776.000 (half value) | 776.000   | 750.000      | +26.000 |

The sell records +26.000 profit on that sale: it removes half the money put in (750.000) because it took half the value
(776.000 of 1.552.000). The money still in is 750.000 against a value of 776.000.

The proportion is taken against the value **at the moment of the sale** (last typed value + flows since, before this
sale). A sell larger than that value is refused, or capped at "All", as the builder sees fit; "All" takes everything,
money put in included, and books the whole difference as profit.

## Non-goals

- Fetching NAVs or values from any platform. Values stay typed (the "commercial, no scraping" rule).
- A bulk "update all fund values" screen.
- Dividends or income distributions for funds (Indonesian reksadana reinvest; the owner sees it in the value).
- Changing listed shares, gold, deposits, property or vehicles.
- Moving a holding between places (a transfer between platforms). If needed: a sell at one and a buy at the other.
- Government bonds / ORI held at a bank. They have the same "held at" question and should later take the same row, but
  not in this piece of work.

## Anti-goals

- Making the owner type units or NAV anywhere in the everyday flow, including Add asset.
- A buy that does not raise the value until the next update (the property-style "latest valuation only" rule would show
  the old value after a top-up; that is wrong for funds).
- Losing history when an existing fund switches: past buys, sells and their transactions stay as they were.

## Where it is held

A fund is bought through somewhere: a securities broker (Mandiri Sekuritas), a bank (Bank Mandiri) or a platform
(Bibit). The owner sometimes holds **the same fund at two places at once**, and each place shows its own number.

- **Held at.** A fund holding says where it is held: one of the owner's accounts (broker cash, bank, platform), or a
  typed name for a place with no account in the app. It is a row on the fund's add form and on its Edit screen.
- **Held at an account:** stored as the holding's existing `holding_links.broker_account_id`, as listed shares already
  do. The holding then appears on that account's page, and Buy/Sell pay from and into that account by default. The tax
  report's Nama institusi is filled from the account (still editable).
- **Held at a typed name:** no link; the name goes to Nama institusi only.
- **The same fund at two places** is two holdings grouped under one fund: the fund shows the total, each place below
  it. Each place has its **own** money put in, typed value and profit; Bibit's number and the bank's are typed
  separately, which is how each platform shows them.
- **Adding a fund already held:** the add flow offers the existing fund and asks only the new place, as adding a share
  already held at another broker does.
- **Tax report:** one row per holding (per place), each with its own Nama institusi and account number. This is the
  owner's understanding, to be checked against a real SPT before building.

```
Assets › Investments
│ Sucorinvest Equity Fund        Rp 48.200.000 │  ← the fund, total of its places
│   Mandiri Sekuritas            Rp 30.100.000 │
│   Bibit                        Rp 18.100.000 │
```

Anti-goal: money, value or profit mixed across places. Selling at Bibit never touches the Mandiri holding.

What the old held-at spec said about one NAV per fund no longer applies: a fund tracked by money has no NAV to share.

Known code facts carried over: `securities.kind` allows `share | etf | other`; a fund needs a kind of its own (`fund`,
a CHECK change, i.e. a table rebuild) or uses `other` — the builder's call. Existing fund holdings are each moved onto a
fund of their own, merged only when the owner says two are the same fund.

## Tax report (Coretax)

The year-end value of a fund is its value on 31 December by the rule above: the last typed value on or before that day,
plus buys, minus sells, up to that day. Acquisition year and cost come from the money put in as today.

## Existing funds

Every fund holding switches to the money way:

- Its value at the switch becomes its first typed value: units × the last NAV if it has one, otherwise what it cost.
- Its money put in is its current cost basis.
- Past trades keep their units and amounts as recorded; from the switch on, only amounts matter.
- **History stays (builder's call, made at design time):** every NAV typed before the switch becomes a typed value on its
  own date (units held that day × that NAV). Net worth history and earlier Coretax year-end values do not change.

## Goals

Today a goal's share of a fund is counted in units (each buy tags units to a goal; a goal's value is its units × NAV;
a sell takes units from the goal it names). With no units that falls to zero, so goals change too. The owner said it is
fine to change: their fund data so far is test data, and they do not rely on goal links to funds yet.

- **A goal's share of a fund holding is money.** Each buy tagged to a goal adds its amount to that goal's money put in.
- **A goal's value is its share of the holding's value**, in proportion to money put in: a goal that put in 60% of the
  money still in the holding has 60% of its value. (Design-time call.)
- **A sell named to a goal** takes that goal's money out in proportion, the way a sell takes money put in out of the
  holding as a whole; it cannot take more than that goal's share of the value.
- **Monthly buys set in units** become monthly buys by amount; a template that only had units is converted at its last
  NAV, or turned off and listed for the owner when there is none.

## Calls made at design time (not the owner's words; check them)

- **A sell's profit is fixed when it is saved.** Adding, editing or deleting something dated before an existing sell
  does not re-book that sell's profit, so a profit already reported for tax is never rewritten. Store the cost each sell
  took out with the sell. Editing the sell itself recomputes it.
- **A value typed on a day includes that day's buys and sells.** "Value on day D" = what the platform showed at the end
  of D. Flows dated D are not added on top of a value typed on D; flows dated after D are.
- **Which accounts Held at offers:** broker cash, bank and e-wallet/platform accounts, plus "type a name".

## Left to the builder

- How the "tracked by money" state is stored (a new valuation mode beside `derived` / `snapshot` / `market`, a flag on
  the holding, or making `market` fall back when units are absent), and whether a fund that has units and a NAV keeps a
  units path at all. The owner only asked that units and NAV become optional.
- Whether trades keep `units_micro` NOT NULL (with 0 for money-only trades) or it becomes nullable.
- How the typed value is stored (the existing `valuations` rows with basis `estimate` are the obvious home) and how the
  proportional cost of a sell is booked in the ledger (the realised gain/loss must match the table above).
- Migration numbering: next free is 0075 as of 2026-10-19; check before taking it.
- Wording and layout of Buy, Sell and Update value, following the existing fund trade sheet and the asset Update value
  sheet.
