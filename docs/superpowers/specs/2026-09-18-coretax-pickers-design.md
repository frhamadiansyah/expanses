# Adding what you own, Coretax-shaped — design

Status: approved · 2026-09-18
Decisions: `scratchpad/decisions-coretax-pickers.md` (user, 2026-09-18)
Mockup: `scratchpad/add-asset.html` — the reference for behaviour and copy. Three flows, two levels each.
Branch: `feat/coretax-pickers` off `main`.

## 1. What we are building

Today, what a thing *is* for tax is decided twice and in two different vocabularies.

- **Add account** (`/accounts`) offers a `Type` select of ledger subtypes — Current account, Cash, Saving
  account, Digital wallet, Fund account, Credit card, Investment, Property, Vehicle, Money owed to me, Loan,
  Money I owe. It writes no `asset_profiles` row at all, so every account created there has **no** Coretax
  code. The tax report falls back to `'0102'` for any cash account, whatever it is: a GoPay balance and an RDN
  both file as *Tabungan*.
- **Add asset** (`/net-worth/assets`) offers a select of eight `AssetKind` presets — Fund, Stock, Bond, Gold,
  Property, Vehicle, Other asset, Bank/cash/deposit. Each carries one code. There is no way to say "unlisted
  shares" (0302), "apartment" (0503), "gold jewellery" (0702) or "patent" (0601) except by adding the nearest
  preset and then hand-typing four digits into the "Tax report code" box on the asset's own page.
- **Add debt** does not exist as a flow. A mortgage means opening a `loan` account on `/accounts`, then going
  to `/net-worth/loans` and filling in terms. A card means `/accounts`. A debt to a person means
  `/net-worth/debts`. Nothing ever asks which kode utang applies; `loan_terms.coretax_code` and
  `debt_profiles.coretax_code` are written by default and have no editor.

The revamp gives all three the same shape, taken from the mockup:

- **Two levels: a family, then the thing.** Exactly like the category picker.
- **The code rides along and is never shown while choosing.** It appears in the tax report and on the thing's
  own page, where it can be changed.
- **The choice fixes both the code and the behaviour** — how it is valued, which fields follow, which balance
  sheet group it counts in — from one fixed table.
- **Nothing existing is renamed underneath.** Every account, asset and debt already in a database keeps
  working and keeps the code it has.

The fixed table is the point of the work. It lives in `packages/core` as a single source of truth that the
three pickers, the two existing forms, the repositories and the tests all read.

## 2. The catalogue

### 2.1 Where it lives

`packages/core/src/assets/catalogue.ts`. Pure data and pure functions, no imports from `packages/db`.

It sits beside `presets.ts` and builds on what is already there: `AssetKind`, `AssetSubtype`, `PlanGroup`,
`UnitKind` from `presets.ts`, `CoretaxSection` from `coretax-fields.ts`, and `KODE_HARTA` / `KODE_UTANG` /
`sectionOfCode` / `hartaLabel` from `coretax/codes.ts`. It does **not** replace `ASSET_PRESETS`: a preset still
says what an `AssetKind` means (`presetFor(kind).valuationMode` is what `assetValuesAt` reads), and a
catalogue item says which kind, code, group and unit a *choice in the picker* maps onto.

### 2.2 The shape

```ts
export type OwnableFlow = 'account' | 'asset' | 'debt';
export type OwnableFamily = 'receivable' | 'invest' | 'movable' | 'immovable' | 'other';

/** The seven kinds of account that hold money. Mirrored by `AccountSubtype` in packages/db; a test holds them in step. */
export type MoneyAccountSubtype = 'cash' | 'bank' | 'savings' | 'time_deposit' | 'ewallet' | 'fund' | 'other_cash';

export type OwnableBehaviour =
  | { opens: 'money'; subtype: MoneyAccountSubtype; valuedBy: 'balance' | 'deposit'; spendable: boolean }
  | {
      opens: 'holding';
      assetKind: AssetKind;
      subtype: AssetSubtype;
      planGroup: PlanGroup;
      valuedBy: 'units' | 'face' | 'grams' | 'value' | 'balance';
      unitKind: UnitKind | null;
      lotSize: number | null;
      priceLabel: string | null;
      /** Gold jewellery: grams × the gold price, or a value typed instead. */
      orTyped?: true;
    }
  | { opens: 'person'; direction: 'lent' | 'borrowed'; valuedBy: 'ledger' }
  | { opens: 'loan'; valuedBy: 'loan'; asksRate: boolean }
  | { opens: 'card'; valuedBy: 'card' };

export interface OwnableItem {
  id: string;
  label: string;
  /** The quiet line under the label in the picker. */
  sub: string;
  code: string;
  /** The Coretax table it files under. Null for a debt: Bagian B is one table. */
  section: CoretaxSection | null;
  behaviour: OwnableBehaviour;
}
```

A discriminated union rather than a dozen nullable columns, so the compiler refuses a holding with no
`assetKind` and a money account with a `lotSize`.

**Ids are unique within a flow, not across flows.** `cash` and `fund` each name one cash item and one asset
item, deliberately: the existing `AddAccountForm` `Type` select is keyed by account subtype
(`selectOption('fund')`) and the existing `AddAssetForm` "What is it?" select is keyed by `AssetKind`
(`selectOption('gold')`), and both are load-bearing: 33 specs drive the `Type` select and 12 assertions drive
"What is it?". Lookup is therefore flow-scoped:
`cashItem(subtype)`, `assetItem(id)`, `debtItem(id)` — never one flat map.

### 2.3 Cash and cash equivalents — the Add account table

Every row: `section: 'kas'`, `behaviour.opens: 'money'`.

| id / account subtype | Label | Sub | Code | Valued by | Spendable | Note |
|---|---|---|---|---|---|---|
| `cash` | Cash | banknotes and coins | 0101 | balance | yes | today's `cash` |
| `bank` | Current account | everyday account at a bank | 0102 | balance | yes | today's `bank`; the mockup said "Bank account", `SUBTYPE_LABELS` says "Current account" — a later ruling gave it to `SUBTYPE_LABELS`, so the app's own name wins and the catalogue carries it |
| `savings` | Saving account | money set aside | 0102 | balance | yes | today's `savings` |
| `time_deposit` | Time deposit | locked until it matures | 0104 | deposit | **no** | **new subtype** |
| `ewallet` | Digital wallet | electronic money — GoPay, OVO, DANA | 0105 | balance | yes | today's `ewallet`, named as `SUBTYPE_LABELS` names it; "electronic money" rides in the sub-line, so searching for it still lands; default code **changes** from 0102 (§7) |
| `fund` | Fund account | broker or RDN cash | 0109 | balance | yes | today's `fund`; default code **changes** from 0102 (§7) |
| `other_cash` | Other cash equivalents | cheque, wesel, commercial paper | 0109 | balance | yes | **new subtype** |

There is no "Something else" on this screen. Four kas codes are therefore not reachable from the picker —
0103 *Giro*, 0106 *Cek*, 0107 *Wesel*, 0108 *Commercial paper*. Cheque, wesel and commercial paper are what
"Other cash equivalents" is for and file correctly as 0109 *Setara kas lainnya*; giro is a current account and
files as 0102 unless the owner says otherwise. Anyone who wants one of the four exactly types it into the
**Tax report code** box on the account's own page (§6), which already exists and already validates four
digits.

The screen ends with two hand-over rows, as the mockup has them: **Add an asset instead** and **Add a debt
instead**.

### 2.4 The five asset families

Every family names its Coretax table, so "Something else" can be computed rather than typed.

| Family | Label | Sub | Section | `HartaFamily` |
|---|---|---|---|---|
| `receivable` | Receivables | money owed to you | `piutang` | `piutang` |
| `invest` | Investments | shares, bonds, funds, insurance | `investasi` | `investasi` |
| `movable` | Movable property | vehicles and machinery | `bergerak` | `bergerak` |
| `immovable` | Immovable property | land and buildings | `tidak_bergerak` | `tidak_bergerak` |
| `other` | Intangible and other | gold, jewellery, patents, things | `lainnya` | `lainnya` |

**Receivables** — `{ opens: 'person', direction: 'lent' }`. The value comes from the Lend & borrow ledger, not
typed; the form asks who and how much is owed now.

| id | Label | Code |
|---|---|---|
| `trade_receivable` | Trade receivables | 0201 |
| `affiliate_receivable` | Affiliate receivables | 0202 |
| `other_receivable` | Other receivables | 0209 |

The family has no "Something else": these three are the whole of the piutang table.

**Investments** — every row `subtype: 'investment'`, `planGroup: 'invest'`.

| id | Label | Code | Valued by | `assetKind` | unit / lot / price label |
|---|---|---|---|---|---|
| `stock` | Listed shares | 0303 | units | `stock` | `shares` / 100 / Closing price |
| `unlisted_stock` | Unlisted stocks | 0302 | value | `other` | — |
| `fund` | Mutual fund (reksadana) | 0307 | units | `fund` | `units` / — / NAV per unit |
| `corporate_bond` | Corporate bonds | 0304 | face | `bond` | `face` / — / Face value |
| `bond` | Government bonds (ORI, SBSN) | 0305 | face | `bond` | `face` / — / Face value |
| `derivative` | Derivatives | 0308 | value | `other` | — |
| `endowment_insurance` | Endowment insurance | 0310 | value | `other` | — |
| `unit_link` | Unit-linked insurance | 0311 | value | `other` | — |

**Movable property** — every row `assetKind: 'vehicle'`, `subtype: 'vehicle'`, `planGroup: 'use'`, valued by a
typed value.

| id | Label | Code |
|---|---|---|
| `motorcycle` | Motorcycle | 0402 |
| `vehicle` | Passenger car | 0403 |
| `other_movable` | Other movable property | 0499 |

**Immovable property** — every row `assetKind: 'property'`, `subtype: 'property'`, `planGroup: 'use'`, valued
by a typed value.

| id | Label | Code |
|---|---|---|
| `property` | Land and/or building for living in | 0502 |
| `apartment` | Apartment | 0503 |
| `empty_land` | Empty land | 0501 |
| `business_property` | Land and/or building for business | 0506 |
| `rented_property` | Land and/or building rented out | 0507 |
| `other_immovable` | Other immovable property | 0509 |

Order follows the decisions file: what people most often own comes first, not the numeric order.

**Intangible and other** — every row `subtype: 'investment'` (the only `AssetSubtype` that is neither property
nor vehicle; it decides nothing beyond which ledger subtype the account gets).

| id | Label | Code | Valued by | `assetKind` | Plan group |
|---|---|---|---|---|---|
| `gold` | Gold bullion | 0701 | grams | `gold` | invest |
| `gold_jewellery` | Gold jewellery | 0702 | grams (or typed) | `gold` | invest |
| `non_gold_bullion` | Non-gold bullion | 0703 | value | `other` | invest |
| `non_gold_jewellery` | Non-gold jewellery | 0704 | value | `other` | use |
| `gemstone` | Gemstones | 0705 | value | `other` | use |
| `art` | Art and antiques | 0706 | value | `other` | use |
| `electronics` | Electronics | 0708 | value | `other` | use |
| `furniture` | Household furniture | 0709 | value | `other` | use |
| `office_equipment` | Office equipment | 0710 | value | `other` | use |
| `patent` | Patent | 0601 | value | `other` | use |
| `royalty` | Royalty | 0602 | value | `other` | use |
| `trademark` | Trademark | 0603 | value | `other` | use |
| `other` | Other property | 0799 | value | `other` | use |

Gold jewellery keeps `planGroup: 'invest'`, like bullion, because it is priced off the same gold price and
moves with it; non-gold jewellery and gemstones are personal use. Every one of these can be moved between
groups afterwards by the **Counts as** select that `AssetSettings` already has.

`gold_jewellery` carries `orTyped: true`. Its form shows a checkbox, *"I'd rather type what it is worth"*;
ticked, the asset is saved with `assetKind: 'other'` (a snapshot valuation) while keeping code 0702 and
section `lainnya`. Nothing else in the catalogue offers two valuations.

**The legacy asset item.** `assetItem('cash')` — *Bank, cash or deposit*, 0102, `assetKind: 'cash'`,
`subtype: 'bank'`, `planGroup: 'liquid'`, `valuedBy: 'balance'` — is kept in the catalogue and in the
`AddAssetForm` select, marked *"better added as an account"*. It is **not** offered in the picker: money
belongs under Add account. It carries `inPicker: false`, and `pickerRows` drops anything so marked, so a
search for "bank", "cash", "deposit" or "account" cannot reach it either — the picker has no other door.
It stays because four Playwright specs add a cash asset through it, and because "keep every existing field
and flow" is a constraint of this work.

### 2.5 "Something else"

`somethingElse(family)` returns every `KODE_HARTA` entry whose `family` matches the picker family's
`HartaFamily`, minus the codes the family's own items already use, in the order `KODE_HARTA` lists them.
Computed, never typed, so a code added to `KODE_HARTA` can never be stranded.

| Family | What it yields |
|---|---|
| `receivable` | nothing — the family is the whole table |
| `invest` | 0301, 0306, 0309, 0399 |
| `movable` | 0401, 0404, 0405, **0406**, 0407, 0408, 0409, 0410, **0411**, 0412 |
| `immovable` | 0504, 0505 |
| `other` | 0699, 0707, 0711, 0712 |

The mockup's hand-written movable list omits 0406 *Kendaraan tujuan khusus* and 0411 *Gerobak*. The decisions
file says "the rest of that family … (e.g. 0401, 0404–0412)", which includes both, and the computed list is
what ships. This is the one place the implementation is deliberately wider than the mockup.

`elseItem(code)` builds the item a "Something else" row stands for: id `else:0406`, label the English gloss
from `HARTA_ENGLISH`, sub the form's own Indonesian words from `hartaLabel(code)`, `section: sectionOfCode(code)`,
and a holding behaviour of `{ assetKind, subtype, planGroup, valuedBy: 'value' }` taken from the family it
came out of — a thing you give a value to, filed under that family's table, exactly as the mockup's hint says.

`HARTA_ENGLISH` is a small map covering only the codes reachable through "Something else", with the mockup's
own words: 0301 Shares bought to resell, 0306 Other debt securities, 0309 Equity not in share form, 0399 Other
investments, 0401 Bicycle, 0404 Bus, 0405 Road transport vehicle, 0406 Special-purpose vehicle, 0407 Train,
0408 Aircraft, 0409 Ship, 0410 Machinery, 0411 Cart, 0412 Yacht, 0504 Vessel, 0505 Land for business, 0699
Other intangible property, 0707 Special sports equipment, 0711 Jet ski, 0712 Business inventory.

### 2.6 Debts

No section: Bagian B is one table. Order follows the mockup.

| id | Label | Code | Opens | Fields |
|---|---|---|---|---|
| `home_mortgage` | Home mortgage | 101 | loan | owed, lender, rate, months left |
| `apartment_mortgage` | Apartment mortgage | 101 | loan | owed, lender, rate, months left |
| `vehicle_leasing` | Vehicle leasing | 101 | loan | owed, lender, rate, months left |
| `credit_card` | Credit card | 102 | card | the card's own form |
| `multi_purpose_loan` | Multi-purpose loan | 101 | loan | owed, lender, rate, months left |
| `personal_loan` | Personal loan | 101 | loan | owed, lender, rate, months left |
| `online_loan` | Online loan or paylater | 101 | loan (`asksRate: false`) | owed, lender, months left |
| `affiliate_debt` | Affiliate debt — family or a related company | 103 | person (`borrowed`) | owed, who |
| `other_debt` | Other debts | 109 | person (`borrowed`) | owed, who |

### 2.7 Functions the catalogue exports

| Name | Returns |
|---|---|
| `CASH_ITEMS` | the seven cash items, in table order |
| `ASSET_FAMILIES` | the five families, each with its items |
| `ASSET_ITEMS` | every family's items plus the legacy `cash` item |
| `DEBT_ITEMS` | the nine debt items |
| `cashItem(subtype)` | one cash item; throws on an unknown subtype |
| `assetItem(id)` | one asset item, `else:NNNN` included; throws on unknown |
| `debtItem(id)` | one debt item; throws on unknown |
| `assetFamily(id)` | one family; throws on unknown |
| `somethingElse(familyId)` | the `CoretaxCode[]` the family has not spent |
| `elseItem(familyId, code)` | the typed-value item for one of those codes |
| `cashCodeForSubtype(subtype)` | the default kas code for any subtype string; `'0102'` when it knows none |
| `searchOwnables(query, flow)` | items of that flow matching every token of the query, by label, sub and code |

## 3. The ledger: two new subtypes and one side table

### 3.1 `time_deposit` and `other_cash`

`accounts.subtype`'s list is a `CHECK` written by 0001 and widened once already by 0045. SQLite cannot alter a
`CHECK`, so migration **0047 `cash_equivalents`** rebuilds the table exactly as 0045 did — `PRAGMA
defer_foreign_keys = ON`, rows aside into a plain table, drop, recreate under the same name `accounts` with the
wider `CHECK` and every other column, default, foreign key and `CHECK` written as 0001 wrote them, rows back,
both indexes recreated (`accounts_workspace_kind`, and `accounts_system_key` in the narrowed form 0043 left it
in). The table has to come back under its own name because the runner already holds a transaction, where
`PRAGMA foreign_keys` cannot be turned off, so the dangling references from `entries`, `investment_trades` and
`parent_id` are satisfied by the copy-back instead.

The two new subtypes take their place in the ledger's lists:

| List | `time_deposit` | `other_cash` |
|---|---|---|
| `accounts.subtype` CHECK (0047) and `schema.ts` enum | yes | yes |
| `BALANCE_SUBTYPES.asset` (`repos/accounts.ts`) | yes | yes |
| `SPENDABLE_SUBTYPES` (`repos/accounts.ts`, `lib/account-types.ts`) | **no** | yes |
| `WALLET_SUBTYPES` (`lib/account-types.ts`, derived) | **no** | yes |
| `GROUP_BY_SUBTYPE` (`repos/asset-values.ts`) | `liquid` | `liquid` |
| `ACCOUNT_TYPES` / `SUBTYPE_LABELS` (`lib/account-types.ts`) | Time deposit | Other cash equivalents |
| `SAVINGS_SUBTYPES` (`repos/flows.ts`) | yes | no |
| `SPENDING_SUBTYPES` (`repos/flows.ts`) | no | yes |

A time deposit therefore holds money and counts as a liquid asset in net worth and on the balance sheet, but
is offered by nothing that asks where money comes from or goes: not a bill, not a card payment, not a loan
instalment, not a repayment, not the cash side of a trade, not a goal's pot. Money reaches it and leaves it by
a **transfer**, which is the only honest description of what a deposit does. `MoneyAccountOptions` in
`TransactionForm` gains a `spendableOnly` prop: expense and income narrow to spendable accounts, a transfer
keeps every money account, so the maturity transfer works and paying for lunch from a deposit does not.

`other_cash` behaves in every way like a current account; only its default code differs.

### 3.2 `deposit_terms`

A time deposit has a maturity and a rate, and no existing table has anywhere to put them. **No new column
goes on an existing table** — the ORM names every column it knows on every insert, so a column added to
`accounts` would break any database still stopped at an older version (migration 0028's comment). 0047 creates
a side table instead, after the accounts rebuild so its foreign key never dangles through the drop:

```sql
CREATE TABLE deposit_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  matures_on TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (rate_bps >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX deposit_terms_workspace ON deposit_terms (workspace_id, matures_on);
```

Every read and write goes through `depositTablesExist(db)`, memoised per handle exactly as `billTablesExist`
is, so a database stopped before 0047 keeps working and the migration test can seed a genuine version-46
database through the ordinary repositories.

Nothing is automated off `matures_on`: no reminder, no interest posting, no roll-over. The date and the rate
are shown on the account's page and on the deposit's row, and the owner moves the money with a transfer when
the day comes. Automation is out of scope (§10).

### 3.3 Where a code is stored, per thing

Nothing new. Each kind of thing already has a home for its code, and the pickers fill it in:

| Thing | Column | Written by |
|---|---|---|
| Cash account | `asset_profiles.coretax_code` (+ `coretax_section = 'kas'`, `asset_kind = 'cash'`) | `openCashAccount` |
| Holding, property, vehicle, other | `asset_profiles.coretax_code` | `saveAssetProfile` |
| Receivable | `debt_profiles.coretax_code` | `openDebtBalance` / `saveDebtProfile` |
| Payable to a person | `debt_profiles.coretax_code` | `openDebtBalance` / `saveDebtProfile` |
| Loan | `loan_terms.coretax_code` | `saveLoanTerms`, or `setLoanCode` when only the code changes |
| Credit card | none — `DEBT_CODE_BY_SUBTYPE` gives 102 | — |

The one genuinely new thing is that **Add account now writes an `asset_profiles` row**. Today it writes none,
which is why every account created there files as 0102.

### 3.4 Three repository additions

- `openCashAccount(database, ws, input)` — new, in `packages/db/src/repos/cash-accounts.ts`. One transaction:
  `createAccountTx` with the item's subtype and the opening balance, then the `asset_profiles` row
  (`assetKind: 'cash'`, `planGroup: 'liquid'`, `coretaxSection: 'kas'`, the item's code), then `deposit_terms`
  when the item is the time deposit. A new file rather than a change to `accounts.ts`, which other work
  touches.
- `openDebtBalance(database, ws, input)` — new, in `repos/debts.ts`. Opens a `receivable` or `payable` account
  with an opening balance and writes its `debt_profiles` row with `personName` and the chosen `coretaxCode`.
  Today a person's account can only be opened by `recordLoan` or `splitBill`, both of which need a money
  account because money moves; a debt you already had needs none, and posts against Opening Balances the way
  every other opening balance does.
- `saveDepositTerms` / `getDepositTerms` / `listDepositTerms` / `depositTablesExist` — new, in
  `repos/deposit-terms.ts`. The reads are what the account's page and the Accounts row print the terms from,
  and `saveDepositTerms` is what the editor beside them writes through.
- `setLoanCode(database, ws, accountId, coretaxCode)` — new, in `repos/loans.ts`. Writes `coretax_code` and
  nothing else, so changing what a loan files as cannot move a rate period.

`saveAssetProfile`, `saveDebtProfile`, `saveLoanTerms` and `setAssetReporting` are unchanged; the pickers pass
`planGroup`, `unitKind`, `lotSize`, `coretaxSection` and `coretaxCode` through the arguments they already take.

## 4. The three flows

Each flow is a screen of its own, reached by a button and by a URL, so the phone gets a back button and the
desktop gets a link it can bookmark. The three cross-link exactly as the mockup does.

| Route | Screen |
|---|---|
| `/accounts/new` | New account — the seven cash rows, then *Add an asset instead* / *Add a debt instead* |
| `/net-worth/assets/new` | What do you own? — the five families, then *Add an account instead* |
| `/debts/new` | New debt — the nine debt rows |

`/net-worth/assets/new` sits beside `/net-worth/assets/$accountId`. TanStack Router scores a static segment
above a dynamic one, so `new` cannot be read as an account id; an e2e assertion pins it.

One component draws all three pickers: `OwnablePicker`, a list of rows with an icon tile, a label, a quiet
sub-line and a chevron, with a search box above it. On a phone it fills the screen; on a wider screen it is
the same list inside a `Card`, with the chosen thing's form appearing below it rather than replacing it —
desktop sees the list and the form at once, so it is never weaker than the phone. **No row shows a code.**

### 4.1 Add account

Level one is the only level: the seven rows of §2.3, each with the mockup's copy, under the kicker *Cash and
cash equivalents*. Below them, the mockup's hint: *"Only money lives here: what you can spend, or will spend
once it matures. A house, gold or shares go under Add asset; a card or a loan under Add debt."*

Choosing a row opens the account form with the item's fields:

| Item | Fields |
|---|---|
| Cash, Digital wallet, Other cash equivalents | Name, Balance now, Currency, Balance as of |
| Current account, Saving account, Fund account | Name, Balance now, Bank, Currency, Balance as of |
| Time deposit | Name, Balance now, Bank, Currency, **Matures on**, **Interest rate**, Balance as of |

Every one of the seven is asked which currency it holds, not only the three kept at an institution: a wallet
in dollars, cash in euros and a deposit in Singapore are all ordinary, and taking the workspace's own currency
without asking would quietly mis-state them.

Foreign currency keeps the rate field and the rate check the existing form has. The time deposit's form ends
with the mockup's note: *"When it matures, move the money to an account with a transfer."* It cannot be paid
from, and nothing in the app will offer it as a source.

Saving calls `openCashAccount`, which writes the account, the profile and — for the deposit — the terms.

**The existing inline form on `/accounts` stays.** Its `Type` select is rebuilt from `CASH_ITEMS` plus the
non-cash types `ACCOUNT_TYPES` already lists, keeping the option *values* it has today (`bank`, `cash`,
`savings`, `fund`, `ewallet`, `credit_card`, …) and gaining `time_deposit` and `other_cash`; picking a cash
type there now goes through `openCashAccount` too, so the code is written whichever door was used. This keeps
every field and flow that exists today, and keeps 33 Playwright specs driving the form they already drive.

### 4.2 Add asset

Level one: the five families, with the mockup's hint *"Money you can spend — cash, bank, e-wallet, broker cash
— is an account, not an asset."* and the hand-over row *Add an account instead*.

Level two: that family's items, each with the mockup's sub-line naming how it is valued — *units × price*,
*face value × price*, *grams × gold price*, *a value you type*, *from what people owe you* — and, at the
bottom, **Something else** with *"N more kinds the form knows"*. Choosing it opens a third list of the
family's unspent codes, under the mockup's hint: *"Anything here is recorded as a thing you give a value to,
and files under <family> in the tax report."*

Choosing an item opens `AddAssetForm`, which keeps every field it has today — Name, Currency, rate to base,
past purchases (date, how much, total cost) for anything valued in units, Bought on / What it cost and What
it is worth now / Where that came from for anything typed, and the section's Coretax detail fields — and gains
what the item needs: the gold-jewellery "type a value instead" checkbox, and, for a receivable, *Who* and
*Owed now* instead of a purchase.

The form's own "What is it?" select stays, now listing every catalogue item grouped by family, with the eight
legacy `AssetKind` ids unchanged as option values. The picker sets it; the select can still change it.

Saving:

- A holding, property, vehicle or other thing → `createAccount` + `saveAssetProfile` with the item's
  `assetKind`, `planGroup`, `unitKind`, `lotSize`, `coretaxSection` and `coretaxCode`, then the opening trades
  or the first valuation, exactly as `planNewAsset` does today.
- A receivable → `openDebtBalance` with `direction: 'lent'` and the item's code. No `asset_profiles` row is
  written: a receivable's code lives on its debt profile, which is where the report reads it, and writing both
  would give one thing two codes that could disagree.

### 4.3 Add debt

One level, nine rows, with the mockup's hint *"A credit card keeps everything it has today: statement, bill,
points and instalments."*

- **A 101 row** asks Owed now, Lender, Interest rate (except the paylater row) and Months left. It always
  opens the `loan` liability account with the opening balance. When Months left is given it also writes loan
  terms — `originalMinor` = what is owed now, `firstPaymentOn` = the same day next month clamped to the 28th,
  `paymentDay` = that day, `method` = annuity when a rate was typed and zero when none was, `coretaxCode` =
  101 — so the schedule and the ratios work immediately. Every one of those can be corrected in full on the
  loan's own page, which is where a loan's terms have always been edited. With Months left left empty, only
  the account is opened, and `/net-worth/loans` lists it as a loan still waiting for its terms, as it does
  today.
- **Credit card** hands over to the card form the Accounts page already has (`createCardAccount`: name, bank,
  last 4, currency, amount owed). The card keeps its statement, bill, points and instalments because nothing
  about it changes; 102 comes from `DEBT_CODE_BY_SUBTYPE` as it does today.
- **Affiliate debt** and **Other debts** ask Who and Owed now, and call `openDebtBalance` with
  `direction: 'borrowed'` and code 103 or 109.

## 5. How an item maps to today's model

Nothing in `packages/core/src/assets/presets.ts` changes, and no new `AssetKind` is invented — a new kind
would mean rebuilding `asset_profiles`' `CHECK`, and the eight kinds already cover every valuation the
catalogue needs.

| `valuedBy` | `assetKind` used | `presetFor(kind).valuationMode` | What the value is |
|---|---|---|---|
| `balance` | `cash` (asset flow) or no profile kind (money flow) | `derived` | the ledger balance |
| `deposit` | `cash` | `derived` | the ledger balance; maturity and rate ride beside it |
| `units` | `stock`, `fund` | `market` | units × the last price on or before the date |
| `face` | `bond` | `market` | face × the last price |
| `grams` | `gold` | `market` | grams × the gold price |
| `value` | `other`, `property`, `vehicle` | `snapshot` | the latest valuation, or cost until one is typed |
| `ledger` | — | — | the receivable's balance in the ledger |
| `loan`, `card` | — | — | the liability's balance in the ledger |

Plan groups follow §2.4 and land in `asset_profiles.plan_group`, which `assetValuesAt` already prefers over
`GROUP_BY_SUBTYPE`. So an unlisted holding counts under Investments, a patent under Personal use, a time
deposit under Cash & equivalents, and the **Counts as** select on the asset's page still moves any of them.

## 6. Where the code is shown, and how it is changed

The picker never shows a code. Afterwards, three places do.

1. **The tax report** (`/tax-report`) — unchanged. `SectionTable` already prints the code and, under it,
   `hartaLabel(code)` or `utangLabel(code)`.
2. **An asset's or an account's own page** (`/net-worth/assets/$accountId`) — `AssetSettings` already has a
   **Tax report code** field validating four digits, with `hartaLabel` as its hint. It gains a select above the
   box listing every item of the code's own family plus *Something else*, so the code can be re-chosen in the
   catalogue's words; the four-digit box stays beneath it for a code the catalogue does not name, because DJP
   itself tells people to pick a code to match their situation, and choosing *Type a code instead* puts the
   cursor in that box. Two items can share a code — 0102 is both a current account and a saving one, 0109 both
   a fund account and other cash equivalents — so the select is given the thing's own item id (a money
   account's subtype) and opens on the choice that matches it, not on the first item to claim the code.
   A time deposit's page also prints its terms — *Matures 1 Mar 2027 · 6,25%* — with an editor beside them,
   so a maturity or a rate typed off a certificate can be corrected. Money accounts reach this page now that they
   have profiles: the Accounts list links every account's type line to it and prints the code beside the type.
3. **A debt's own page** — two new editors, matching the one assets have:
   - `LoanDetailPage` gains a **Tax report code** select of the four kode utang, saved through `setLoanCode`,
     which writes the code and nothing else: re-sending the whole terms would rewrite the opening rate period
     and move a period that began before the first instalment.
   - `PersonCard` gains the same select for a person's debt, saved through `saveDebtProfile`'s existing
     `coretaxCode` argument — 0201/0202/0209 for money owed to you, 101/103/109 for money you owe.

## 7. What happens to what is already there

**Nothing is rewritten.** 0047 changes one `CHECK` and adds one empty table. No row of `accounts`,
`asset_profiles`, `debt_profiles`, `loan_terms`, `transactions` or `entries` is touched. The migration test
snapshots every account row, every column, the table's own DDL and both indexes before and after, and compares
them.

**An asset, receivable, payable or loan that has a code keeps it.** The catalogue changes what a *new* choice
defaults to and nothing else. An existing gold holding stays 0701, an existing property stays whatever the
owner set, an existing loan stays 101 or whatever was chosen.

**The one visible change is the fallback for accounts that never had a code.** An account created by today's
Add account form has no `asset_profiles` row at all, so `coretaxInputsFor` falls back to a flat `'0102'` for
every derived-value account. That fallback becomes subtype-aware:

```ts
inputs.cash.push({ …, code: code ?? cashCodeForSubtype(subtype) });
```

cash → 0101, bank and savings → 0102, time deposit → 0104, e-wallet → 0105, fund account and other cash
equivalents → 0109, anything else → 0102. This is what "the default code changes for new accounts only, unless
the user has not set one" means: an owner who has never chosen a code has not chosen 0102 either — they have a
fallback, and a wallet filing as *Tabungan* was always wrong. An account **with** a profile code keeps that
code untouched, whatever it is.

So on the first report run after upgrading, an existing GoPay account moves from 0102 to 0105 and an existing
RDN from 0102 to 0109, both within the same *Kas dan Setara Kas* table, with no change to any figure. Frozen
and filed reports do not move: `tax_year_rows` holds what was filed and, as 0013 and 0014 both say in their
own comments, a filed return is never rewritten after the fact.

**Existing databases that have not run 0047** keep working: `depositTablesExist` guards every read and write
of `deposit_terms`, and no other new table exists.

## 8. The tax report

Unchanged, deliberately. `coretaxInputsFor` reads `asset_profiles.coretax_code`, `debt_profiles.coretax_code`
and `loan_terms.coretax_code` exactly as it does today; `sectionOfCode` puts each row in its table;
`coretaxRows` and the converter are not touched. The only edits are the subtype-aware cash fallback of §7 and
the two new subtypes reaching `assetValuesAt` through `BALANCE_SUBTYPES.asset`.

A time deposit therefore appears in *Kas dan Setara Kas* as 0104 with the kas fields (account number, name on
the account, bank, country) that `CORETAX_SECTIONS.kas` already asks for. Other cash equivalents appear as
0109 in the same table.

## 9. Testing

**Pure, in `packages/core/test/assets-catalogue.test.ts`** — the catalogue is a table, so it is tested as one:
every item's code exists in `KODE_HARTA` (or `KODE_UTANG` for a debt); every item's `section` equals
`sectionOfCode(code)`; ids are unique within each flow; `somethingElse` and the family's items together
account for exactly that `HartaFamily`'s codes and never overlap; `cashCodeForSubtype` answers for all seven
subtypes and falls back for anything else; `searchOwnables` finds things by label, sub-line and code; every
`MoneyAccountSubtype` has an item and every item a subtype. Property-style rather than example-style, so a row
typed wrong fails loudly.

**In `packages/db`**

- `test/cash-equivalents-migration.test.ts` — modelled directly on `account-types-migration.test.ts`: a
  version-46 database with accounts, transactions and entries written as a version-46 build would write them;
  then `migrate` and assert every row, every column, the table's own DDL with only the subtype list blanked,
  both indexes, every balance, and an empty `PRAGMA foreign_key_check`. Then: the new subtypes are accepted,
  a nonsense subtype is still refused, an asset with no currency is still refused, the system-key index still
  bites, and both new subtypes were refused before it ran.
- `test/deposits.test.ts` — `openCashAccount` writes account, profile and terms; a time deposit is not in
  `SPENDABLE_SUBTYPES`; a goal refuses to be funded from one; a transfer into and out of one works; net worth
  counts it as liquid.
- `test/tax-inputs.test.ts` (existing, extended) — an account with no profile files under its subtype's code;
  an account with a profile keeps its own code whatever the subtype.
- `test/debts.test.ts` (existing, extended) — `openDebtBalance` both ways, with the code it was given.
- `test/database.test.ts` — the applied-versions list gains 47.

**In `apps/web`** — pure view modules beside their components: `ownables/catalogue-view.test.ts` (picker rows,
search rows, which fields an item asks for), `networth/add-asset.test.ts` (extended: a plan per item kind,
including a "Something else" code and gold jewellery both ways), `ownables/debt-form.test.ts` (the three debt
shapes, and what is refused). `lib/account-types.test.ts` keeps the web and ledger spendable lists in step,
which is what stops a time deposit quietly becoming spendable.

**End to end**

- `e2e/coretax-pickers.spec.ts` (chromium): open a time deposit through the picker, see it counted in net
  worth, see it absent from "Paid with", move it out with a transfer when it matures; add gold jewellery and
  an apartment through the picker; add a mortgage through Add debt; then read `/tax-report` and see 0104,
  0702, 0503 and 101 each in its own table.
- `e2e/phone-coretax-pickers.spec.ts` (phone): the same three flows by thumb — family, item, back, search,
  "Something else" — and the two hand-over rows.
- Every existing spec keeps passing untouched. That is the acceptance test for "keep every existing field and
  flow".

## 10. Out of scope

- **No new `AssetKind` and no change to `asset_profiles`' CHECKs.** The eight kinds carry every valuation
  the catalogue needs.
- **No reclassification of existing things.** No migration guesses a better code for an asset that has one.
- **No automation around maturity.** `matures_on` is stored and shown; nothing reminds, posts interest, rolls
  over, or moves money by itself.
- **The DJP converter, the frozen-report rows and the utang table are untouched.** There is still no kode
  utang 104, and Bagian B is still typed by hand.
- **No presets, banks or products by country.** Only the codes themselves are Indonesian, as they must be.
- **The emergency-fund denominator** and whether a time deposit belongs in it stay open, tracked with the rest
  of the net-worth decisions.
- **Books and workspace scoping** are not touched; `feat/workspace-switching` owns that ground.
- **Crypto** has no kode harta of its own and is not added.
