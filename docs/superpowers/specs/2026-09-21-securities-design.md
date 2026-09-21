# Securities — one stock, several brokers — design

Status: approved, with the owner's answers to §12 (2026-09-21/22) · re-scanned against main `9fce369` on 2026-09-22
Decisions: `decisions-securities.md` (user, 2026-09-19)
Mockup: `securities.html`, published at https://claude.ai/artifact/PFmupJdLtdrvtQYshTZrF7 — the interactive phone
(Investments → stock → price, Add a holding, broker pages), R1–R3 (R1 chosen), C2 (the daftar harta table), and
the "Free records it, paid fills it in" panel. Binding where the decision record says so; the example figures in
it are examples, and §11 lists the three places this design reads differently from a drawing and why.
Migration: **0051**.

Rulings from the dispatch on what the record left open:

- **Country-neutrality.** A ticker list is a catalogue of real products, exactly like the credit-card catalogue
  already shipped in `packages/catalog`. It is treated the same way, and every security carries a **`market`**
  field so another exchange is a new list and a new row in a table, never a rework.
- **Keeping the list current.** The list ships with the app and refreshes when the app updates. A listing the user
  owns before the next release is covered by **Name it myself**. Accepted.
- **Security-level concentration warning.** Deferred to a later build. Not here.
- **Kurs pajak (KMK) per transaction** — recorded as "a field you fill" in the record — is **deferred**: the
  rupiah cost of a foreign holding uses the **transaction rate**. The year-end KMK rate the tax report already
  uses for the 31 December *value* (`kmk-rates.ts`) is untouched.

**Re-scan, 2026-09-22.** Main gained currency pockets, set-aside, deposit maturity, the Debts page and the Option B Add
Transaction card after this was written. The design now reuses them rather than restating them: every two-currency total
is `sumToBase` (a missing rate is no total, never the rest summed), every foreign figure is drawn with the kit's
`ApproxFigure` / `approxLine` / `rateLine` and every parent that adds its children with `GroupedRow`, today's rates on a
screen are `useHeldRates`, a typed day rate goes through `openingRateFor`, and a buy is a set-aside door. The sections
below say where.

## 1. What we are building

Today a holding *is* an account, and a price belongs to an account (`prices` is keyed `(account_id, on_date)`).
BBCA at Stockbit and BBCA at Mandiri Sekuritas are two unrelated assets: the price is typed twice, nothing totals
the stock, nothing groups by broker. And a US holding cannot be traded at all today (§5.3).

This build adds a **security** — ticker, name, market, currency, lot size — that a holding points at, moves the
**price** from the holding to the security, and names the **broker** a holding is kept at. On top of that:

- **Investments** (G1) — one row per stock, then **Where they are kept** listing each broker with its total and
  share of the portfolio, under a summary tile. Stock rows and broker rows each open a page.
- **A stock page**, **a price page** (one price values every broker that holds it) and **a broker page**.
- **Add a holding** — search starts from a ticker; **Name it myself** for anything not on a list.
- **R1** — a holding leads in its own currency; any figure converted at today's rate carries `≈`.
- **C2** — the daftar harta names the broker: `Saham BBCA — Stockbit`; a foreign holding reports its rupiah cost at
  the rate of the day it was bought.
- **Free records it, paid fills it in** — IDX ships to everyone; the foreign (US) list is the paid convenience.

What deliberately does **not** change: shares, cost basis, realised gains and the per-year buckets stay **per
holding**. A sale at Stockbit uses the Stockbit basis. The blended average on a stock page is display only; nothing
computes a gain from it.

## 2. The data

### 2.1 Three side tables, migration 0051

No column is added to `accounts`, `asset_profiles`, `prices` or any other existing table (the ORM names every
column it knows on every insert, so a column there breaks any database stopped at an older version).

| Table | One row per | Columns |
|---|---|---|
| `securities` | security the owner holds or held | `id`, `workspace_id`, `ticker` (null for something with no ticker), `name`, `market` (`''` when not on an exchange), `currency`, `lot_size` (null = no lots), `kind` (`share` · `etf` · `other`), `source` (`catalogue` · `owner`), `created_at` |
| `holding_links` | holding that has a security, a broker, or both | `account_id` (PK), `workspace_id`, `security_id`, `broker_account_id`, `created_at` |
| `security_prices` | security and date | `security_id`, `workspace_id`, `on_date`, `price_micro`, `source` (`manual`), `created_at`; PK `(security_id, on_date)` |

A unique index on `securities (workspace_id, market, ticker) WHERE ticker IS NOT NULL` makes BBCA on IDX one row
however it was reached — from the list, typed by hand, or both.

Securities, links and prices are **owner-level**, keyed by `workspace_id` like `accounts` and `prices`: they
belong to the owner, not to a book (the workspaces design puts net worth and tax with the owner).

`migrate` is set-based: 0051 is pure `CREATE TABLE` / `CREATE INDEX` and depends on nothing 0050, 0053 or
0054 (or any later migration) make, so any order of landing is harmless. Nothing is backfilled: an existing holding has no link, and reads
exactly as it does today.

### 2.2 The guard

Every read and write of the three tables asks `securityTablesExist(db)` first — a `WeakMap<Db, boolean>` that
remembers only a positive answer, exactly like `extrasTablesExist`. Without the tables: `listSecurities` and
`listHoldingLinks` return `[]`, `upsertPrice` / `listPrices` / `assetValuesAt` behave exactly as today, and
`addHolding` / `linkHolding` / `upsertSecurityPrice` refuse with a message rather than half-writing.

### 2.3 What a security carries

Ticker · name · market · currency · lot size · kind. BBCA is IDX, IDR, a lot of 100, a share. AAPL is NASDAQ, USD,
no lot, a share. VOO is NYSE ARCA, USD, no lot, an ETF. Market and currency come from the security, so nothing is
typed twice and nothing is guessed.

A security's `source` says where its facts came from. A security copied from a bundled list is a **row in the
owner's database** from then on: it does not point back at the list, so it keeps working when the list changes or
when a subscription lapses (§6.5).

### 2.4 The broker

A broker is **the broker cash account** — the RDN / brokerage cash the app already models as subtype `fund` (the
owner's ruling, 2026-09-22). Not a bank or a wallet, and not a pocket: a `fund` account that holds pockets (IBKR with a
USD and an IDR pocket) is itself the broker, and its pockets are its cash in each currency. The mockup's broker page
shows "Cash idle $640.00" and the Add form offers "IBKR cash · USD" as the paying account: both are that account's
balance. A holding names its broker in `holding_links.broker_account_id`.

- **Another broker** in the Add form opens a new `fund` account with the name and currency the owner gives it.
- A holding may name no broker (every holding recorded before this build). It is listed under **No broker named**.
- A second holding cannot name the same security **and** the same broker: BBCA at Stockbit is one holding, and a
  second buy there is a trade on it.

This reading was confirmed by the owner (§12.1).

## 3. Prices

### 3.1 One price per security

A linked holding is valued **only** from its security's prices. `assetValuesAt` reads `security_prices` for every
holding with a `security_id`, and `prices` for every holding without one. Typing BBCA's price once values Stockbit
and Mandiri Sekuritas together.

### 3.2 Every existing way in follows the security

`upsertPrice(accountId, …)` and `listPrices(accountId)` are where every price screen writes and reads —
`PriceForm` on the asset page, `UpdatePricesSheet` on the Assets page, the sample seed. For a linked holding they
**route to the security**: `upsertPrice` writes `security_prices`, `listPrices` reads it. No screen can type a price
that the valuation then ignores.

### 3.3 Linking carries the holding's prices over

When a holding is linked to a security, every price it had of its own is copied to the security **unless the
security already has a price on that date** (the security's stands). Nothing typed is lost, and from that moment
every holder of the security reads the same series. The holding's own rows are then removed from `prices` (ruling
m12, 2026-09-22), so no stale series is left to come back; an unlink gives the holding the security's latest price as
its own.

### 3.4 A price is typed in the security's currency

A US price is typed in dollars. The rupiah figure follows from the day's rate; nobody types a converted price.
The holding's currency must equal the security's (§5.1), so a price and the units it multiplies are always in one
currency.

## 4. Two currencies

### 4.1 Where each rate does its job

- **A buy pins the rupiah cost at the rate of its own day**, and it never moves again. That is the ledger's
  `entries.amount_base_minor` on the holding's line of the buy, fixed when the trade posts.
- **Today's value uses today's rate.** Every converted figure carries `≈`.
- **Never convert a dollar cost basis at today's rate.** It would rewrite what was paid every time the rupiah
  moved, and quietly change last year's tax figure.

### 4.2 Cost in the base currency, per holding

`baseCosts(database, ws, upTo?)` walks each holding's trades exactly as `positionAfter` does, with each buy's cost
replaced by its pinned base amount (the holding line's `amount_base_minor`). A sell takes its share of that base
cost at the same average and the same rounding (`shareOut`: proportional, difference to the largest bucket). The
result is a `Position` whose `costMinor` and `byYear[…].costMinor` are in the base currency. For a base-currency
holding it is `positionAfter` unchanged.

This is what "Put in" on every screen reads, and what the daftar harta reads (§8.2).

### 4.3 The portfolio total and the currency's move

A holding leads in its own currency. The portfolio total cannot — it sums two currencies — so it stays in the base
currency, marked `≈`, and its percentage includes the currency's move. The summary names that part:

> *currency move* = Σ over foreign holdings of ( value converted at today's rate − value converted at the rate the
> holding was bought at )

where "the rate it was bought at" is the holding's own `costBase / cost` — in the mockup, AAPL and VOO are worth
$3,707.80: Rp 59.052.680 at their purchase rates, Rp 60.251.750 at today's, so Rp 1.199.070 is the move. The sum is
of signed figures; a strengthening base currency gives a negative move and says so.

The mockup's sentence says "the rupiah's move". The app is country-neutral, so the line reads
**"Rp 1.199.070 of that is exchange-rate movement"** — the figure is the mockup's, the words name no currency.

A currency with **no rate for today** is not counted as zero, and the rest is not summed without it: the summary's value,
gain and move are **no figure**, the currencies are named, and every row below keeps its own exact figure — `sumToBase`'s
rule, the one the Assets page and pockets already follow. What was put in (its base cost, pinned on each buy's day)
needs no rate and still shows. A holding worth nothing needs no rate either.

### 4.4 Shares of the portfolio

Each broker's share is a whole-number percentage of the portfolio total, and the shares add up to exactly 100: each
share is floored and the remainder goes to the **largest** broker (the project's rounding rule). With the mockup's
figures that reads **71% · 18% · 11%**, where the mockup drew 70 · 18 · 12 (§11) — confirmed by the owner (§12.4). With
a broker whose total cannot be converted there is no whole, so no broker shows a share.

## 5. Trades in a foreign currency

### 5.1 A holding's currency is its security's

A holding opened here takes the security's currency. Linking an existing holding refuses a security in another
currency ("BBCA is in IDR; this holding is in USD").

### 5.2 How a trade gets its rates

A trade posts lines in the holding's currency and, when it is paid from an account in another currency, in the
cash account's currency too (`tradePostings` → the two Currency Exchange legs). The ledger needs a rate for every
currency other than the base. Three cases, decided by one pure function `tradeRateNeeds(holding, cash, base)`:

| Holding | Paid from | What the form asks | Where the rate comes from |
|---|---|---|---|
| base (BBCA, IDR) | base | nothing | none needed |
| USD | USD cash (IBKR) | nothing, unless the day has no stored rate | the day's rate from `resolveRates`; missing → a **Rate that day** row, typed |
| USD | base (BCA, IDR) | **Charged in IDR** — what left the account | **worked out from the two amounts**: `rateFromAmounts(cost, USD, charged, IDR)`; no rate field |
| base | USD cash | **Charged in USD** | worked out from the two amounts |
| USD | SGD cash | **Charged in SGD** | both day rates from `resolveRates`; a missing one is typed |
| any | Opening balance (owned before the app) | nothing extra | as "paid from" the holding's own currency |

The mockup's hint "fill the rate only when the money came from a rupiah account" is the third row: there the rate
is the ratio of the two amounts — of what left the account and the buy's **whole cost, fee included** (what the
holding's line posts) — shown back in the kit's words as **Rate that day 15.800 IDR per 1 USD**, and the rupiah cost is
exactly what left the account. A worked-out rate is used for that trade only and is never stored as the day's rate.

The charged amount sits **on the trade itself** (`cashMinor`) from the moment it is typed, not only at save. A buy is a
set-aside door: the question "which goal paid?" weighs what leaves the paying account, and for a dollar holding paid
from rupiah that is the rupiah typed under Charged in — never the holding's dollar cents read as rupiah.

A typed day rate goes through `openingRateFor` — the existing `parseRate`, `ratePreview` and `checkManualRate`
(ten-times-off guard), stored as a `manual` rate for the day, the one path every form that opens money uses. The row
shows `ratePreview` ("Reads as 1 USD = 16.250 IDR") as it is typed: `parseRate` reads a single separator as a decimal
point, so "16.250" is sixteen and a quarter, and with no earlier USD rate on the device the ten-times guard has
nothing to compare against — the preview is what catches it.

### 5.3 The two existing trade forms get the same rows

Today neither the Buy & sell form (`TradeForm`) nor the Buy / sell tab of the Add Transaction card passes
`ratesToBase` or `cashMinor` to `recordTrade`, so **any trade on a non-base holding fails** with *No USD→IDR
rate*, and a USD holding paid from a rupiah account fails with *needs the amount in IDR*. A free user who adds AAPL
by hand could never sell it. Both forms gain the **Charged in** row and the **Rate that day** row from §5.2,
through the one shared function the Add a holding form uses (`tradeRatesForSave`, with `withCharged` putting the
charged amount on the input). Each keeps its set-aside question and sends its answer, as today.

Buy & sell keeps its Edit and Delete (§12.5, the owner's ruling). Both rework every later sell, and today that rework
posts a sell again at the **edited** trade's rates and without the amount that reached a cash account in another
currency — harmless while no trade could cross a currency, wrong once one can. A reworked sell now reads both back
from its own posted lines (the ledger already holds them; no column is added).

## 6. The catalogue

### 6.1 Two lists, in `packages/catalog`

| List | Markets | Rows (approx.) | Who gets it |
|---|---|---|---|
| `idx` | IDX | ~950 | everyone |
| `us` | NASDAQ, NYSE, NYSE ARCA, NYSE AMERICAN, CBOE BZX, IEX | several thousand | the paid tier |

Each list is a JSON file of `[ticker, name, market, kind]` rows plus an `asOf` date. A `MARKETS` table in the same
module maps a market to its currency and lot size (IDX → IDR, 100; the US markets → USD, none), so a row never
repeats either. A new exchange is a new list file and new `MARKETS` rows: nothing else changes.

The lists are generated from the exchanges' own published files by two scripts in `packages/catalog/scripts/`
(IDX's *Daftar Saham*; Nasdaq Trader's `nasdaqlisted.txt` and `otherlisted.txt`), run by hand at release time, and
committed. Test issues, warrants, rights and units are left out.

### 6.2 Search

`searchSecurities(list, query)` — case-insensitive, trimmed:
exact ticker → ticker prefix → a word of the name starting with the query → the name containing it; ties by
ticker. At most 30. The market sits beside every result ("Apple Inc. · NASDAQ · USD"), so two tickers that look
alike never get mixed up. A security the owner already holds is listed first with "you hold 10".

### 6.3 What shipping the lists does to the app's size

The web bundle is one 1.72 MB chunk today (476 KB gzipped; the record measured 422 KB). Neither list may add a byte
to it:

- Both lists are loaded with a **dynamic `import()`**, so the bundler puts each in a **chunk of its own**. The IDX
  chunk is read the first time the owner opens Add a holding or links a holding; the US chunk only when an entitled
  owner searches. A user who never holds a foreign stock never parses it.
- In the **native apps** both chunks are inside the app package, so they add their size to the download (about
  12 KB and 70 KB gzipped by the record's estimate) but never to start-up. On the **web**, the service worker
  already caches every `/assets/` file on first fetch; offline before the first fetch, search says the list could
  not be read and Name it myself stays available.
- `npm run build` ends with `apps/web/scripts/check-bundle.mjs`, which **fails the build** if either list's text is
  found in the entry chunk, if either list is not in exactly one chunk of its own, or if a list chunk passes its
  budget (IDX 25 KB gzipped, US 160 KB gzipped — raised from 150 KB by the owner's ruling, after rows that are not
  ordinary holdings were dropped). The gate every task runs therefore guards the size for good. While the IDX list
  has no rows (the exchange's file is pending), its check is a warning, "IDX list: pending", not a failure.

### 6.4 Keeping the lists current

The lists refresh when the app updates. A security already in the owner's database is never changed by a new list;
a listing newer than the app is added by **Name it myself** and, if a later list carries it, search finds the owner's
own row first (same market and ticker is the same security, §2.1).

### 6.5 Free records it, paid fills it in

- A free user can hold **any** security on **any** market: **Name it myself** — ticker, name, market, currency and
  lot size, typed once — and from then on it behaves like every other holding: prices, broker, trades, tax rows.
- The **foreign list** is the paid convenience: search finds AAPL and fills in NASDAQ / USD / no lot.
- A lapsed subscription keeps every existing holding working — values, tax rows, net worth. Only search stops
  finding **new** foreign tickers; a foreign security already held is still found, from the owner's own rows.
- There is no purchase machinery yet (`workspaces.plan` is `'free'` only). The build adds one seam,
  `apps/web/src/lib/entitlements.ts`, whose only question is *is `foreign_securities` granted?*. Its source today is
  a device-local list (`localStorage` key `expanses.entitlements`); when store purchases exist, that one module reads
  them instead. Until then the owner grants it with a **preview switch on a developer settings screen**
  (`/settings/developer`), linked from nowhere (§12.2). Turning the switch off is exactly a lapse.

## 7. Screens

All built from the native kit (`apps/web/src/ui/native/`): `LargeTitle` with a back destination, `Hero`,
`InsetGroup`, `InsetRow`, `TextRow`, `SelectRow`, `ReadOnlyRow`, `Panel`, `RecordTable`, and pockets' `ApproxFigure`
(a figure in its own currency with its `≈` line beneath) and `GroupedRow` (a parent that adds its children up) — kit
tokens only, dark mode by the tokens. Corner actions are glyphs at every width. A row never contains a button. The
Add a holding form and Name it myself are built in the **Option B** look of the Add Transaction card's Buy / sell tab:
one card of rows, a second for the goal, the set-aside question, and a dock with Cancel and the pill that saves.

### 7.1 Investments — `/net-worth/investments`

- **Summary** (`Hero`): `≈` total in the base currency; caption: gain and percentage "in {base}", then the
  exchange-rate line (§4.3) when there is a foreign holding; then **Put in** and **Holdings "5 stocks · 3 brokers"**
  as a group of two read-only rows.
- **By stock** (`InsetGroup`): one row per security (and one per unlinked stock or fund holding, by its account
  name). Title: ticker (or name). Value: the stock's total **in its own currency**. Subtitle: shares, lots when the
  lot size is more than one, "2 brokers" or the one broker's name, the gain percentage, and "Update price" when the
  price is stale, as the Assets row says. The value is drawn with `ApproxFigure`: the native figure, and `≈ Rp …`
  beneath it for a foreign stock (or "No USD rate yet"). Ordered by base value, largest first. A row opens the stock
  page; an unlinked holding opens its existing asset page.
- **Where they are kept** (`InsetGroup`): one row per broker: its name; value in its currency when every holding
  there is in that currency (with its `≈` line beneath), else a `GroupedRow` whose figure is the `≈` total in base or
  the missing rate named; subtitle "2 holdings · USD · 71%". Opens the broker page. Holdings with no broker are one row,
  **No broker named**.
- **Add a holding** — a corner glyph (`+`), to `/net-worth/investments/new`.

Which holdings appear: every holding linked to a security, and every unlinked `market`-valued holding whose asset
kind is `stock` or `fund`, with units still held. Gold and bonds stay on the Assets page only, as today.

Reached from: a row **Investments** at the top of Buy & sell (`/net-worth/trades`), and a row **By stock and
broker** in the Investments group of the Assets page. The five net-worth segments are unchanged, and the page does not
draw them: it is the Assets page's Investments group regrouped, pushed with a back line to Assets. It reads the same
values at the same held rates through the same `sumToBase`, so its total is that group's total for the same holdings.

### 7.2 A stock — `/net-worth/investments/security/$securityId`

- `LargeTitle`: the ticker; back to Investments.
- `Hero`: the total in the security's currency; caption "{gain} · {pct}" and, for a foreign stock,
  "≈ Rp … · at 16.250 IDR per 1 USD".
- For a foreign stock, a group **In {base}**: the base gain and percentage ("+20,8% · +Rp 5.988.750") and
  **Bought at 15.800 IDR per 1 USD** — the base cost divided by the native cost. Both are true; R1 puts the native
  one in the big text.
- **Avg price** (display only, blended across brokers) and **Now** (the latest security price).
- **Price today** — a row showing the latest price and "Set by you · 19 Sep"; opens the price page.
- **Held at** — one row per broker holding: "Stockbit · 1.000 shares · avg Rp 8.750", its value and gain. Opens the
  holding's existing asset page (holding-level detail, settings, the tax fields).
- **Recent** — up to ten trades across its holdings, newest first, **read-only**: "Bought 10 shares · Interactive
  Brokers · 8 Mar 2025 · at 15.800 IDR per 1 USD", native amount, and the pinned base amount for a foreign buy. No row edits
  or deletes a trade (§9).
- Footer under Held at: "Each broker keeps its own average price and its own cost basis."

One broker only: the page reads as a plain holding — Held at has one row; nothing else changes.

### 7.3 The price — `/net-worth/investments/security/$securityId/price`

`TextRow` **Price** (typed in the security's currency, read by `parsePriceMicro`), `TextRow` **As of** (a date, not
after today), a line "Last set 12 Sep at Rp 9.550", and **This changes** — one read-only row per holding with its new
value and the difference from the last price. **Save price** writes `upsertSecurityPrice`. Footer: "One price values
every broker that holds {ticker}."

### 7.4 A broker — `/net-worth/investments/broker/$accountId` (and `/broker/none`)

`LargeTitle` "{broker} · {currency}". `Hero`: the total — in the broker's currency when every holding there shares
it (its `≈` line beneath), else `≈` in base, or the missing rate named. Read-only rows **Put in** (base cost, never
converted) and **Cash idle** (the broker account's balance in its own currency; for a broker holding pockets, one row
per pocket, each in its own currency). **Holdings here**: one row per holding, native value and gain,
opening the stock page. "Nothing is converted twice": a USD broker's own figures are USD.

### 7.5 Add a holding — `/net-worth/investments/new`

One screen, three steps, Back undoing one at a time (as `OwnablePicker` does):

1. **Search** — a search box ("Ticker or name"), then **You hold** (the owner's securities that match), then
   **Shares & funds** (list results). A free user's results come from IDX only; with nothing found the group says
   "Nothing on IDX matches AAPL". An entitled user's come from IDX and the US list together. Under the results, a
   group **Not listed?** with one row, **Name it myself**.
2. **Name it myself** — `TextRow` Ticker (optional), Name, Market (optional), `SelectRow` Currency (default the
   base), `TextRow` Lot size (optional, a whole number). Continue.
3. **The form** — a heading line "Adding AAPL · Apple Inc. · NASDAQ · trades in USD", then:
   - **Where is it kept** — `SelectRow`: the owner's brokers (`fund` accounts that are not pockets), each marked
     with the shares already held there; **Another broker…**; **No broker**.
     Another broker adds `TextRow` Broker name and `SelectRow` Its currency (default the security's).
   - **What you bought** — `TextRow` **Lots** on a lot-sized security (shares shown under it), else **Shares**
     (fractional allowed); `TextRow` **Price per share ({cur})**; `ReadOnlyRow` **Total** = shares × price, exact;
     `TextRow` **Fee**; `TextRow` **Date**.
   - **Paid from** — `SelectRow`: the spendable money accounts (`moneyHolders`: a pocket parent holds nothing, so
     its pockets are offered), each as "Name (CUR)", and **Owned before this app** (Opening balance, so no bank
     balance moves). Then the rows of §5.2: **Charged in {cash}**, **Rate that day** (read-only when worked out or
     held, typed when missing), and a read-only **Cost in {base}** — the whole cost, fee included, at the rate the
     save will use.
   - **For goal** (when there are goals), as both trade forms have; and the **set-aside question** when the buy takes
     more than is free in the paying account.
   - **Add holding**, the dock's pill. On a phone, nothing about the form is narrower than on a desktop.

The Fee row is not in the mockup; it is in both existing trade forms, and a buy's cost includes its fee (Pasal 10),
so leaving it out would understate every IDX cost basis.

When the chosen security is already held at the chosen broker, the buy is recorded **on that holding** — the mockup's
"Existing" — rather than opening a second one.

Save is **one database transaction** (`addHolding`): record the security, open the broker account if asked, open the
holding and its profile if needed, link them, record the buy. A refusal at any step leaves nothing behind.

**Add asset → Listed shares** (the picker at `/net-worth/assets/new`) opens this flow (the record: "Search in Add
asset starts from a ticker"). The inline Add asset form on the Assets page keeps every field it has — two existing
end-to-end journeys and the desktop's quick entry depend on it — and gains one row above them when Listed shares is
chosen, **Find it by ticker**, to this flow. A stock added through the inline form is an unlinked holding that can be
linked later (§7.6). Every other item is unchanged.

A holding opened here takes the **Listed shares** item's profile (asset kind `stock`, code 0303, units in shares)
with the security's lot size — a foreign ETF included (§12.3); the code stays the owner's to change in the asset's
settings, as today.

### 7.6 Linking a holding recorded before this build

On an asset page of a `market`-valued holding, a group **Stock and broker**:

- **Ticker** — the security it is, or "Not set"; opens the same search with `?link={accountId}`, where choosing a
  result (or Name it myself) links instead of opening the form.
- **Kept at** — `SelectRow` of the brokers, and **No broker**.

Linking a ticker carries the holding's prices (§3.3) and sets the holding's lot size to the security's; the Lot size
setting is hidden for a linked holding ("Set by BBCA"). The price form on a linked holding's page says "This price is
BBCA's, and values every broker that holds it."

**Re-pointing a linked holding (accepted at the S5 review, concern 6).** Changing a linked holding's ticker from X to
Y moves no price: X's prices are X's stock price, not the holding's, and carrying them into Y would put one stock's
prices into another's series. The holding's own rows were already removed at the first link (ruling m12), so nothing
stale comes back. From the moment it is re-pointed the holding is valued at Y's price, and its lot size becomes Y's,
so lots typed afterwards count Y's shares. The ledger — units, cost and every balance — is untouched by a link, an
unlink or a re-point; only where the price comes from changes.

## 8. The tax report

### 8.1 C2 — the row names the broker

A holding linked to a security is named on the daftar harta:

- a **share** with a ticker: `Saham BBCA — Stockbit`;
- anything else (an ETF, a fund, something with no ticker): its name, `Vanguard S&P 500 ETF — Interactive Brokers`;
- no broker named: the same without ` — {broker}`.

A holding with no security keeps its account name. Rows still split by year of purchase when the report asks.
This is the tax report, the one Indonesia-specific screen, so the word *Saham* belongs there.

### 8.2 A foreign holding's harga perolehan is its rupiah cost on the day it was bought

Today the report takes a holding's per-year cost **in the holding's own currency** and files it as rupiah: a USD
holding bought for $1,825.00 reports **Rp 182.500**. The report now reads a foreign holding's per-year cost from
`baseCosts` (§4.2): **Rp 28.835.000**, the rupiah that left at Rp 15.800 on 8 March 2025, never today's rate and never
the year-end KMK rate. Base-currency holdings read exactly as today. The 31 December **value** of a foreign holding
still uses the KMK year-end rate, as today.

Under each foreign row, the report shows how its cost was reached: one purchase —
"US$1.825,00 at Rp 15.800 · 8 Mar 2025"; several — "3 purchases, each at its own day's rate". (This is the row's
live note; a frozen report keeps its saved figures.)

A report frozen before this build holding a foreign position will show the corrected cost as a **difference** the
owner can accept — the existing `compareRows` behaviour, which is what should happen.

### 8.3 Not in this build

US dividend withholding and any foreign tax credit; the per-transaction kurs pajak field (§ rulings).

## 9. Refusals the new surfaces inherit

- **A trade is never edited or deleted from a new surface.** The stock page, the broker page and the Investments
  list show trades read-only. The only way to change a trade stays where it is today — Buy & sell's Edit and Delete,
  through `replaceTrade` / `deleteTrade`, which retire the trade, void its transaction and work later sells out
  again. The transaction receipt, the full form, the edit sheet and the table keep refusing a trade's transaction
  (`useChangeable` → `isTrade`), untouched.
- **Setting a price is not editing a trade**: it writes a price row, as `PriceForm` does today.
- **Other workspaces.** Every new repository function checks the account, the broker and the security belong to
  `ws.workspaceId` (`assertAccountInWorkspace`), exactly as `upsertPrice` and `recordTrade` do.
- **Opening positions.** "Owned before this app" pays from Opening Balances through `writeTradeTx`, exactly as the
  existing Add asset form does; no bank balance moves.
- **Selling more than the holding holds** is refused by `writeTradeTx` per holding — a Stockbit sale cannot take
  Mandiri's shares.
- **A credit card** may pay for a buy (points still count) but never receives proceeds — unchanged in `writeTradeTx`.
- **A buy is a set-aside door** on every way in — Buy & sell, the Buy / sell tab and Add a holding: it asks which goal
  paid when it takes more than is free, sends the answer with the save, and a buy for a goal lowers that goal's
  promise as `writeTradeTx` already does (a move with no destination, which a void gives back).
- **A sell reworked by an edit** keeps its own day's rates and what reached its cash account (§5.3).

## 10. Combinations to walk end to end

Each must be driven by keystrokes, not `fill()`, on both the `chromium` and the `phone` projects where marked.

| # | Security | Broker | Paid from | Expect |
|---|---|---|---|---|
| 1 | BBCA (IDX list) | new: Stockbit, IDR | BCA (IDR) | holding "BBCA · Stockbit", 10 lots = 1.000 shares; BCA down exactly price × shares + fee |
| 2 | BBCA again | new: Mandiri Sekuritas | Opening balance | second holding, same security; BCA untouched; Investments shows BBCA once, "2 brokers" |
| 3 | BBCA again | Stockbit (existing) | BCA | no new holding; Stockbit now 1.500 shares |
| 4 | — | — | — | price set once on BBCA's price page values both holdings; asset page of either shows it |
| 5 | AAPL, Name it myself (free) | new: Interactive Brokers, USD | BCA (IDR), Charged in IDR 28.835.000 | Rate that day reads 15.800 IDR per 1 USD; Cost in IDR Rp 28.835.000; the ledger line is exactly that |
| 6 | AAPL (US list, switched on in developer settings) | Interactive Brokers | IBKR cash (USD) | no Charged row; day rate used; a missing day rate asks for it, and the typed "16250" is stored |
| 7 | AAPL | — | Buy & sell: **sell** 3 shares into BCA (IDR) | Charged in IDR row on `TradeForm`; sell posts; Stockbit basis untouched |
| 8 | AAPL | — | Add Transaction → Buy / sell, paid from BCA | Charged in IDR row on the card; buy posts |
| 9 | — | free user searches AAPL | — | "Nothing on IDX matches AAPL"; Name it myself offered |
| 10 | the switch turned off after 6 | — | — | AAPL still on Investments, valued, and found under You hold; the US list is not searched |
| 11 | existing gold / legacy stock holding | Kept at: Stockbit | — | links; its old price carried to the security; lot setting hidden |
| 12 | tax report 2026 | — | — | `Saham BBCA — Stockbit`, `Saham BBCA — Mandiri Sekuritas`, AAPL cost Rp 28.835.000 |
| 13 | phone, 390 px | — | — | Investments, stock, price, broker and Add pages: no horizontal scroll, every row reachable, dark mode by tokens |
| 14 | BBCA (Add a holding) and AAPL (Buy & sell) from Jenius, more than is free | — | Jenius | the set-aside question asks, in rupiah; the answer lands on the goal |

## 11. Where this reads differently from the mockup, and why

1. **Broker shares 71 · 18 · 11**, not 70 · 18 · 12 — the project's rounding rule (floor, remainder to the largest).
2. **The `≈` line sits under the figure**, as drawn — on a list row through the kit's `ApproxFigure` (currency
   pockets added it after this was first written), on a detail page in the `Hero`. No ticker/initial tiles: they are
   not a kit primitive, and this build adds no visual treatment.
4. **Rates read in the kit's words** — "15.800 IDR per 1 USD" (`rateLine`), not the mockup's "Rp 15.800 / $", so a rate
   reads the same here as on every pocket and transaction screen.
3. **"of that is exchange-rate movement"** rather than "the rupiah's move" — country-neutral copy, same figure.

Also: the mockup's daftar harta shows code 0121 for shares; the catalogue's Listed shares item is **0303**, which is
what the report files under.

## 12. The owner's answers (2026-09-21/22)

1. **What a broker is:** the existing broker cash account, subtype `fund` (§2.4).
2. **Granting the paid list before store purchases exist:** a preview switch hidden in developer settings
   (`/settings/developer`, linked from nowhere) (§6.5).
3. **Coretax code for a foreign ETF:** it opens as Listed shares (0303); the owner changes the code per holding.
4. **Rounding the broker shares:** floor and remainder to the largest — 71 · 18 · 11.
5. **Buy & sell keeps its existing Edit and Delete.**

## 13. Found in the code while writing this (contradicting the record or the brief)

1. **"A trade cannot be edited or deleted from any surface"** — Buy & sell (`TradesPage.tsx`) has an **Edit** button
   (`replaceTrade`) and a **Delete** button (`deleteTrade`) on every history row. The refusal exists on the
   transaction surfaces only (receipt, full form, edit sheet, table). This design keeps both as they are and adds no
   new way to change a trade.
2. **"KMK is a new source value on the rates machinery"** — `fx_rates.source` already has `'kmk'`: year-end KMK rates
   are entered per year (`kmk-rates.ts`, `KmkRates.tsx`) and the report already uses them for foreign *values*.
3. **The report's cost for a foreign holding is wrong today** (§8.2): `HoldingInput.byYear` says "Cost is already
   historical IDR", but for a non-IDR holding it is the holding's own currency.
4. **No trade on a non-base holding can be recorded today** (§5.3): neither trade form passes rates or the charged
   amount.
5. **Bundle size**: the entry chunk is 476 KB gzipped today, not the 422 KB the record measured.
6. **Tax code**: the mockup's 0121 for shares is not the catalogue's code (0303).
7. **A typed rate's separator**: `parseRate("16.250")` is 16,25, and `checkManualRate` passes anything when the device
   has no earlier rate for the currency. Existing behaviour, reused here as the brief requires; the preview line is the
   only guard on a first foreign rate.
8. **A sell reworked by an edit** (re-scan, 2026-09-22): `recalculateSells` reposts a later sell with the edited trade's
   rates (`undefined` from a delete) and no `cashMinor`, so once a trade can cross a currency, editing or deleting an
   earlier buy would fail or post the sell at the wrong day's rate (§5.3).
