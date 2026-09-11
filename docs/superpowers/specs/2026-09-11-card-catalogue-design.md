# Credit Card Points Catalogue — Design

**Date:** 2026-09-11
**Status:** Approved design, pending implementation plan
**Parent spec:** `docs/superpowers/specs/2026-09-11-personal-finance-platform-design.md` (§10 points engine). This design brings the "curated Indonesian card catalog" forward from phase 2.

## 1. Goal

Users pick their credit card from a catalogue instead of writing earn rules by hand. Each catalogue entry encodes the bank's published earn rates, bonuses, exclusions, transfer partners, and fees, with sources and a verification date, and keeps working as banks change terms.

## 2. Decisions

| Decision | Choice |
|---|---|
| Data source | Research of banks' official pages and terms now; community submissions or licensed data later |
| Third-party catalogues | Not copied. IndoMiles prohibits reproduction without written permission (site footer, verified 2026-09-11) |
| First coverage | The owner's cards first (3 BCA entries in §9; PPS Club researched and parked in §12), then about 10 popular Indonesian cards researched one by one |
| Delivery | Versioned JSON bundled in the app (`packages/catalog`); same format can be served from a URL later |
| Apply behaviour | Linked by default with automatic updates; editing makes a card customised with review-and-apply prompts; reset re-links |
| History safety | Every change carries an effective date; past cycles keep the terms that applied then |
| Change reports | Prefilled email; address is a build-time constant; button hidden until set |
| Double points by currency | UnionPay double points apply when the transaction's original currency matches (owner's reading); BCA's page words it by country |

## 3. Catalogue entry format

One JSON file per card under `packages/catalog/entries/`. Excerpt of the Visa Signature entry showing its first terms period (the full entry adds the 2025-09-23 period from §9):

```json
{
  "id": "bca-sq-krisflyer-visa-signature",
  "entryVersion": 1,
  "bank": "BCA",
  "name": "BCA Singapore Airlines KrisFlyer Visa Signature",
  "network": "visa",
  "currency": "IDR",
  "program": { "unit": "miles", "name": "KrisFlyer", "cycleAnchor": "statement" },
  "fees": [
    { "effectiveFrom": null, "effectiveTo": null, "annualFeeMinor": 500000, "supplementaryFeeMinor": 300000 }
  ],
  "terms": [
    {
      "effectiveFrom": "2024-08-12",
      "effectiveTo": "2025-09-22",
      "rules": [
        {
          "key": "base",
          "name": "Base",
          "rateNum": 1,
          "rateDen": 13500,
          "rounding": "per_transaction_floor",
          "priority": 0,
          "stackable": false,
          "match": { "excludeCategoryKeys": ["utilities.electricity", "utilities.water", "utilities.gas", "government", "gifts_donations.donations", "fees"] }
        }
      ],
      "cycleBonuses": [
        {
          "key": "monthly-spend",
          "name": "Monthly spend bonus",
          "tiers": [{ "minSpendMinor": 20000000, "bonus": 1000 }],
          "match": { "excludeCategoryKeys": ["utilities.electricity", "utilities.water", "utilities.gas", "government", "gifts_donations.donations", "fees"] }
        }
      ]
    }
  ],
  "transferPartners": [],
  "cashValue": null,
  "welcomeBonus": "3.000 KF miles after activation and first transaction; +7.000 after Rp 5.000.000 within 2 months of approval. Primary card only.",
  "notes": [
    "BCA Installment purchases earn full miles on the total at purchase (terms art. 5.2).",
    "Product page says the bonus is 'setiap bulan'; applied per monthly statement (terms art. 8.3)."
  ],
  "sources": [
    { "title": "BCA product page", "url": "https://www.bca.co.id/id/Individu/produk/Kartu-Kredit/Sq-Visa-Signature" },
    { "title": "Reward BCA", "url": "https://www.bca.co.id/id/Individu/produk/Reward-BCA" }
  ],
  "verifiedOn": "2026-09-11"
}
```

### Field rules

- `entryVersion` increments on every change to the file.
- `terms` is an ordered list of non-overlapping periods. `effectiveFrom: null` means "since before the catalogue knew"; `effectiveTo: null` means "still current". A bank change closes the current period the day before and appends a new one.
- `fees` follows the same period rules.
- Rule `match` accepts `categoryKeys`, `excludeCategoryKeys`, `merchantPatterns`, `excludeMerchantPatterns`, and `currencies`. Category references are always stable keys, never database ids.
- `cycleBonuses[].tiers` are ascending by `minSpendMinor`; the highest tier reached pays once per cycle.
- `transferPartners[]`: `{ "key", "program", "points", "partnerUnits", "incrementPoints", "effectiveFrom", "effectiveTo" }` — `points` of this card convert to `partnerUnits` of `program`, in steps of `incrementPoints`.
- `cashValue`: `{ "valueMinor", "perPoints", "currency" }` or null.
- `welcomeBonus` and `notes` are displayed, never calculated.
- `sources` (at least one) and `verifiedOn` are required.

### Validation

`packages/catalog/src/validate.ts` runs over every entry in tests. It rejects: missing sources or `verifiedOn`; overlapping or unordered periods; non-ascending tiers; non-positive rates; unknown category keys; duplicate rule, bonus, or partner keys within a period. An invalid entry fails the build.

### Staleness

An entry whose `verifiedOn` is more than 180 days before today is stale. Stale entries still apply, with a warning linking to their sources.

## 4. Stable category keys

Default categories receive `accounts.system_key` values:

```
food                      food.groceries        food.dining            food.coffee
transport                 transport.fuel        transport.ride_hailing transport.parking_tolls   transport.public
shopping                  shopping.clothing     shopping.electronics   shopping.household
utilities                 utilities.electricity utilities.water        utilities.gas (new)       utilities.internet_phone   utilities.subscriptions
housing                   housing.rent          housing.maintenance
health                    health.medical        health.pharmacy        health.insurance
entertainment             entertainment.events  entertainment.hobbies  entertainment.games
travel                    travel.flights        travel.hotels          travel.activities
education                 education.courses     education.books
personal_care
gifts_donations           gifts_donations.gifts (new)                  gifts_donations.donations (new)
government (new: "Government & Taxes")
fees                      fees.bank             fees.card_annual       fees.interest
other_expense
income.salary  income.bonus  income.investment  income.cashback  income.gifts  income.other
```

`government` covers tax, customs, immigration, BPJS, and postal services. `gifts_donations.donations` covers charities, social services, and religious organisations.

`ensureCategoryKeys(database, ws)` runs on app open and is idempotent:

1. For each default category without a key, find the account with the matching seed name under the matching parent and set its key.
2. Create missing defaults (`utilities.gas`, `government`, `gifts_donations.gifts`, `gifts_donations.donations`).
3. A renamed or deleted default is not recreated or keyed. Catalogue exclusions referencing it cannot be mapped; the apply preview lists them.

User-created categories have no key. They earn under catalogue rules and cannot be targeted by catalogue exclusions.

## 5. Engine changes (`packages/core/src/points`)

### 5.1 Original currency

`SpendLine` gains `originalCurrency: string | null`. Rule `currencies` matches `originalCurrency ?? currency`. `TWD` is added to the currency table (exponent 2). `CNH` in bank wording maps to `CNY`.

### 5.2 Merchant exclusions

`RuleMatch` gains `excludeMerchantPatterns`, matched case-insensitively against the description like `merchantPatterns`.

### 5.3 Tiered cycle bonus

```ts
interface CycleBonus {
  id: string;
  key: string;
  name: string;
  tiers: { minSpendMinor: number; bonus: number }[];
  match: RuleMatch;
  validFrom: string | null;
  validTo: string | null;
}
```

Eligible spend is the sum of positive lines matching `match` (validity checked against each line's date), minus refunds matching `match`, floored at zero. The highest tier with `minSpendMinor <= eligible spend` is awarded once per cycle, provided the bonus is valid on the cycle's end date. `computeCycleEarn` takes `bonuses` and returns `bonusByKey`, `eligibleSpendByBonus`, and a `totalPoints` that includes bonuses.

### 5.4 Refunds

A negative line (refund charged back to the card) runs through matching primary rules by priority. For each rule it deducts `min(|refund remaining|, spend recorded for that rule this cycle)` from `spendByRule`, and deducts points computed with the rule's rate and rounding on the deducted amount. Stackable rules deduct the same way independently. Per-rule points and spend never go below zero. Refunds landing in a later cycle deduct in that cycle. This approximates the issuer reversing the original purchase's reward; statement checks reveal any gap.

### 5.5 Transfer conversion

```ts
convertPoints(points: number, partner: { points: number; partnerUnits: number; incrementPoints: number }): number
// floor(points / incrementPoints) * incrementPoints * partnerUnits / partner.points, floored
// 1.240 UnionPay → KrisFlyer (200 = 100, step 20) = 620
// 1.240 UnionPay → GarudaMiles (150 = 100, step 15) = 820
```

`estimatePartnerUnits(points, partner)` omits increment rounding and is used for single-purchase comparisons.

### 5.6 Recommender

`recommendCards` accepts a comparison target: `{ kind: 'value' }` (existing rupiah value) or `{ kind: 'program', program: string }`. A card whose own unit program equals the target counts its points directly; otherwise it converts through a matching transfer partner valid on the purchase date; otherwise the result is not comparable and ranks last. The purchase query gains optional `originalCurrency`.

## 6. Storage — migration `0004_catalog`

| Table | Change |
|---|---|
| `transactions` | add `original_currency TEXT`, `original_amount_minor INTEGER` |
| `reward_programs` | add `catalog_entry_id TEXT`, `catalog_entry_version INTEGER`, `catalog_status TEXT CHECK (catalog_status IN ('linked','customised'))`, `catalog_dismissed_version INTEGER` |
| `earn_rules` | add `catalog_key TEXT` |
| `redemption_options` | add `catalog_key TEXT` |
| `cycle_bonuses` (new) | `id, workspace_id, program_id, key, name, tiers_json, match_json, valid_from, valid_to, catalog_key, archived_at, created_at` |
| `transfer_partners` (new) | `id, workspace_id, program_id, key, program_name, points, partner_units, increment_points, valid_from, valid_to, catalog_key, archived_at, created_at` |

Existing rows are untouched. `card_terms` is unchanged; applying an entry sets `annual_fee_minor` to the fee valid today.

## 7. Applying entries

### 7.1 Planning (pure, `packages/core`)

`planCatalogApply(entry, categoryIdsByKey, today)` returns rules, bonuses, partners, cash value, and the current fee, with every terms period expanded into rows carrying `valid_from`/`valid_to`, plus `unmappedKeys`.

### 7.2 Writing (`packages/db/src/repos/catalog.ts`)

- `applyCatalogEntry(database, ws, cardAccountId, entryId)`: one transaction. Archives existing catalogue-keyed rows (and, when the user confirmed replacement, manual rows), inserts the plan, sets `catalog_status='linked'` and `catalog_entry_version`.
- `syncLinkedPrograms(database, ws, catalog)`: on app open, re-applies every linked program whose entry has a higher `entryVersion`.
- Any mutation of rules, bonuses, partners, or redemption options on a linked program sets `catalog_status='customised'`.
- `applyCatalogUpdate(database, ws, programId)`: for customised programs, replaces catalogue-keyed rows with the current entry, keeps rows without `catalog_key`, and sets the new version.
- `dismissCatalogVersion(database, ws, programId, version)`: stores `catalog_dismissed_version`.
- `resetToCatalog(database, ws, programId)`: archives all rules, bonuses, partners, and catalogue redemption options, re-applies, sets linked.

### 7.3 Update diff

`diffCatalogPlans(previousEntryVersion, currentEntry)` compares by key: rates, rounding, exclusions, tiers, partners, cash value, and fees, producing human-readable change lines for the review banner.

## 8. Screens

- **Card page step 2** offers "Choose from catalogue" and "Set up manually". Catalogue search filters by bank and name. Selecting an entry shows a plain-language preview (rates, tiers, exclusions with dates, fee, welcome bonus, notes, sources, verified date, unmapped exclusions) before "Use these terms". Catalogue cards skip step 3.
- **Catalogue card page** shows a badge ("From catalogue · Linked" or "Customised"), sources and verified date, stale warning, update banner with diff (Apply update / Skip this version), Reset to catalogue, welcome bonus and notes, bonus progress per tier, refunds in the cycle summary, and transfer estimates for the cycle.
- **First edit** of a linked card confirms that it becomes customised.
- **Transaction form**: when the payment account is a credit card, a collapsed "Spent in another currency?" section captures original currency and amount. The transaction list shows the original amount beneath the billed amount.
- **Which card?** adds "Compare in" (Rupiah value or any program reachable by the user's cards) and optional original currency.
- **Report a change** (catalogue card page) opens `mailto:` with entry id, entry version, verified date, card name, and blanks for the change and source link. No transactions or balances are included. Hidden while the build constant `CATALOG_REPORT_EMAIL` is null.
- CSV import does not capture original currency in this version.

## 9. Initial entries

All verified 2026-09-11 against the sources listed. Shared BCA Mastercard/Visa exclusions (Reward BCA page, "Penting Diketahui"): from 2024-08-12, donations (including social services), government services (including tax, customs, immigration, BPJS), electricity, water and gas, and MCC 8398, 9211, 9222, 9311, 9399, 4900, 8661, 9223, 9402, 9405 earn no Reward BCA or KrisFlyer miles; from 2025-09-23, Prudential insurance earns none. BCA Card, BCA JCB Black, BCA UnionPay, and BCA American Express Platinum are exempt. Cash advances and card fees earn nothing on any card. Transaction cancellations or corrections may reverse rewards.

Shared KrisFlyer notes (BCA Singapore Airlines Visa terms): miles per transaction at a rate BCA notifies (art. 5.1); fees, interest, stamp duty, and insurance premiums do not count (art. 5.1); BCA Installment purchases earn in full on the total at purchase (art. 5.2); foreign-currency transactions earn on the rupiah amount after BCA's conversion (art. 9.1); miles credit within 14 days of the statement and supplementary card miles go to the main cardholder (art. 9.2); billing statements are monthly (art. 8.3). BCA's own mileage calculator truncates fractional miles. QRIS payments using a BCA credit card in myBCA earn nothing.

KrisFlyer card terms periods: `2024-08-12 → 2025-09-22` with the category exclusions; `2025-09-23 → current` adding `excludeMerchantPatterns: ["prudential"]`. Cycle bonuses use the same exclusions.

### 9.1 `bca-sq-krisflyer-visa-signature`

- Program: miles, KrisFlyer, statement cycle
- Base: 1 per Rp 13.500, per-transaction floor
- Cycle bonus: 1.000 at Rp 20.000.000; "tidak berlaku kelipatan"; product page says "setiap bulan", applied per monthly statement
- Fees: Rp 500.000 primary, Rp 300.000 supplementary
- Welcome: 3.000 KF miles after activation and first transaction; +7.000 after Rp 5.000.000 within 2 months of approval; primary card only
- Sources: https://www.bca.co.id/id/Individu/produk/Kartu-Kredit/Sq-Visa-Signature ; BCA Singapore Airlines Visa terms https://www.bca.co.id/en/Individu/produk/Kartu-Kredit/-/media/Files/Individu/produk/Credit%20Card/Perjanjian%20Baku/perjanjian-baku-kartu-kredit-bca-visa-singapore-airlines-en?v=1 ; Reward BCA https://www.bca.co.id/id/Individu/produk/Reward-BCA

### 9.2 `bca-sq-krisflyer-visa-infinite`

- Program: miles, KrisFlyer, statement cycle
- Base: 1 per Rp 10.800, per-transaction floor
- Cycle bonus tiers: 1.000 at Rp 20.000.000; 2.000 at Rp 50.000.000; "no multiples apply"
- Fees: until 2026-06-02 Rp 750.000 / Rp 450.000; from 2026-06-03 Rp 1.000.000 / Rp 500.000
- Welcome: 3.000 KF miles after activation and first transaction; plus 9.500 after Rp 10.000.000 within 2 months, or 7.000 after Rp 5.000.000 within 2 months
- Sources: https://www.bca.co.id/en/Individu/produk/Kartu-Kredit/Sq-Visa-Infinite ; BCA Singapore Airlines Visa terms (as 9.1) ; Reward BCA (as 9.1)

### 9.3 `bca-unionpay`

- Program: points, UnionPay Points, statement cycle
- Base: 1 per Rp 10.000 ("1 poin kelipatan Rp10 ribu"), per-transaction floor; category exclusions: `fees` only (UnionPay is exempt from the Mastercard/Visa exclusion list)
- Double points: stackable rule, +1 per Rp 10.000, `currencies: ["SGD", "HKD", "CNY", "TWD"]`; permanent; product page wording: "double BCA UnionPay Point untuk transaksi retail di Singapura, Hongkong, China dan Taiwan"
- No cycle bonus
- Transfer partners (Reward BCA page): JAL 200 → 100, step 20; GarudaMiles 150 → 100, step 15 (GarudaMiles table effective 2025-11-01); KrisFlyer 200 → 100, step 20; AirAsia point 100 → 100, step 10
- Cash value: 1 UnionPay point = Rp 20
- Fees: Rp 125.000 primary, Rp 100.000 supplementary
- Welcome: 5.000 UnionPay Points for every accumulated Rp 5.000.000 spent within 3 months of issuance; primary card only
- Sources: https://www.bca.co.id/unionpay ; Reward BCA (as 9.1)

## 10. Testing

- **Core golden tests:** Signature bonus at Rp 19.999.999 and Rp 20.000.000; Infinite at Rp 19,9 / 20 / 50 / 60 juta; UnionPay SGD purchase earning double and IDR purchase earning single; conversions 1.240 → 620 KrisFlyer and 1.240 → 820 GarudaMiles; refund deduction within a cycle and across cycles; Prudential excluded on 2025-09-23 but not 2025-09-22; original-currency matching; comparison in a program with and without a transfer partner.
- **Catalogue tests:** every bundled entry validates; each validation failure case is rejected; `planCatalogApply` expands periods into dated rows and reports unmapped keys; `diffCatalogPlans` describes rate, tier, exclusion, partner, and fee changes.
- **Database tests:** migration 0004; `ensureCategoryKeys` on a fresh workspace, on an existing workspace with a renamed default, and on a second run; apply; linked auto-sync on a higher version; mutation flips to customised; apply update keeps user rows; dismiss; reset.
- **Browser tests:** apply the Visa Signature entry, post Rp 21.000.000 of eligible purchases, and see base miles plus the 1.000 bonus with the progress bar full; UnionPay purchase with original currency SGD earns double; editing a catalogue rule shows the customised badge.

## 11. Known limitations

- Merchant category codes are not captured; exclusions rely on the user's category and merchant description.
- Refund reversal is approximate (§5.4).
- Welcome bonuses are informational.
- QRIS-in-myBCA and installment timing are notes only.
- Entries are only as current as `verifiedOn`; banks may change terms without fixed notice (BCA terms art. 5.1).

## 12. Parked entries

Researched and verified but not bundled in the first release, at the owner's request. Add by creating the entry file, validating it, and bumping nothing else.

### `bca-sq-pps-club-visa-infinite` (researched 2026-09-11, not bundled)

- Program: miles, KrisFlyer, statement cycle
- Base: 1 per Rp 5.000, per-transaction floor
- No monthly bonus
- Fees: until 2026-06-02 Rp 1.000.000 / Rp 600.000; from 2026-06-03 Rp 2.000.000 / Rp 1.000.000
- Welcome: 4.000 KF miles after activation and first transaction; +13.500 after Rp 10.000.000 within 2 months
- Note: only for Singapore Airlines PPS Club members; BCA may replace the card with a KrisFlyer card if PPS membership ends (terms art. 2.6)
- Sources: https://www.bca.co.id/en/Individu/produk/Kartu-Kredit/Singapore-Airlines-PPS-Club-Visa-Infinite-Card ; BCA Singapore Airlines Visa terms (as 9.1) ; Reward BCA (as 9.1)

## 13. Addendum — CIMB Niaga and Mandiri cards (2026-09-11, approved)

Three more cards revealed earning mechanics the design above could not express. The owner approved these changes, with payment methods detected by keywords only.

### 13.1 Earning per spend multiple

- New rounding mode `per_increment`: points for a purchase = `floor(billed rupiah for the rule / rateDen) × rateNum`. Mandiri World Prioritas at 3 per Rp 20.000: Rp 25.000 counts as Rp 20.000 and earns 3. CIMB at 7,5 per Rp 50.000: Rp 60.000 earns 7,5.
- `per_transaction_floor` with `rateNum: 1` is numerically identical, so the BCA entries are unchanged.
- The multiple applies to the rupiah amount billed, including foreign purchases after conversion.

### 13.2 Half points

- `rateNum` may carry one decimal place. The engine computes in integer tenths of a point and reports points with at most one decimal.
- How issuers credit fractions is not published (CIMB). Estimates keep the fraction; cycle statement checks reveal the issuer's treatment.
- `capPoints` and cycle bonus amounts remain whole points.

### 13.3 Domestic and foreign

- `RuleMatch.origin?: 'domestic' | 'foreign'`. Foreign means `originalCurrency ?? currency` differs from the card's billing currency (IDR). Domestic means it equals it.
- Mandiri defines overseas bonuses by currency (Livin'poin page, Fengshui and Precious footnotes). Mandiri's Marriott Bonvoy terms define "Transaksi Internasional" by merchant country; the owner chose the currency reading for that card too. A foreign merchant billing in rupiah is treated as domestic.

### 13.4 Keywords and precedence

- `merchantPatterns` and `excludeMerchantPatterns` match whole words or phrases, case-insensitive, at non-alphanumeric boundaries (`grab` matches `GRAB*FOOD`, `va` does not match `Java`).
- Payment methods are detected only from description keywords: `qris`, `qr`, `cicilan`, `installment`, `power buy`, `power installment`, `va`, `virtual account`. There is no payment-method field; manually typed transactions without these words earn as card payments.
- Precedence uses existing rule priority. Every rule and bonus carries the card's exclusions. Reduced-rate rules sit above foreign and domestic rules, so a taxi paid in CNY on Mandiri World Prioritas earns the transport rate (1 per Rp 100.000), not the overseas rate. A rule's conditions are AND-ed; alternatives (category OR keyword) are separate rules at the same priority.

### 13.5 Categories, statement day, fees, bonuses

- New default categories: `housing.real_estate` ("Real Estate") and `business` ("Business & Invoices").
- `program.fixedStatementDay?: number`. When present (CIMB: 22), the catalogue preview shows it and card setup pre-fills the statement day.
- Fee periods gain optional `condition` text; `fees` may be empty when unpublished.
- Tiers remain "at least". Terms that say "exceeds" (melebihi) encode `minSpendMinor` as the threshold plus Rp 1.

### 13.6 Additional initial entries

All verified 2026-09-11.

#### `cimb-niaga-world-all-accor`

- Program: points, "ALL - Accor Live Limitless", statement cycle, `fixedStatementDay: 22` (posting date 23rd of the previous month to the 22nd)
- Rules, `per_increment` per Rp 50.000:
  - `accor` priority 10, 7,5, merchant keywords: accor, sofitel, pullman, novotel, mercure, grand mercure, ibis, swissotel, swissôtel, fairmont, raffles, movenpick, mövenpick, mgallery, mantra, peppers, adagio, rixos, banyan tree
  - `foreign` priority 10, 7,5, `origin: foreign`
  - `domestic` priority 0, 2,5, `origin: domestic`
- Terms `null → 2025-12-31` exclusions: keywords qris, qr, cicilan, installment, cash plus, octo; categories `fees`, `health.insurance`
- Terms `2026-01-01 → current` exclusions: keywords qris, qr, cicilan, installment, cash plus, octo, balance transfer, forex; categories `fees` (insurance premiums no longer excluded)
- Fees: none published (product page and product summary checked)
- Welcome: 4.000 ALL points for each primary card active within 3 months of approval
- Notes: points credited within 7 working days after the cycle; conversion to installment or cancellation after the statement deducts points in the next period; transactions above twice the permanent limit and high-risk transactions are excluded but not detectable; fractional crediting unconfirmed; Accor Plus membership requires Rp 10.000.000 in the first 3 months and Rp 150.000.000 per year to renew
- Sources: https://www.cimbniaga.co.id/id/personal/kartu-kredit/world-all-accor-live-limitless ; product summary https://www.cimbniaga.co.id/content/dam/cimb/kartu-kredit/MC%20WORLD%20ACCOR%20REV.pdf

#### `mandiri-world-prioritas`

- Program: points, "Livin'poin", statement cycle
- Exclusions on every rule: categories `gifts_donations.donations`, `utilities`, `government`, `business`, `fees`; keywords cicilan, installment, power installment, power buy, power cash, pln, va, virtual account
- Rules, `per_increment`:
  - `reduced-categories` priority 20, 1 per Rp 100.000, categories `transport` (includes fuel), `housing.real_estate`, `education`
  - `reduced-qris` priority 20, 1 per Rp 100.000, keywords qris
  - `reduced-insurance` priority 20, 1 per Rp 100.000, keywords axa, power bill
  - `foreign` priority 10, 4 per Rp 20.000, `origin: foreign`
  - `domestic` priority 0, 3 per Rp 20.000, `origin: domestic`
- Fees: Rp 0 primary and supplementary, condition "while a Bank Mandiri Prioritas customer"
- Welcome: cashback worth Rp 3.000.000 after activation and first transaction
- Notes: Power Bills at PLN earn nothing while Power Bills insurance earns the reduced rate; converting a purchase to Power Installment or Power Buy deducts its points (add "cicilan" to the description); airline conversion is advertised as "1:1 Mileage Redemption" but ratios are not published in page text
- Sources: https://www.mandirikartukredit.com/produk/prioritas ; https://www.mandirikartukredit.com/livinpoin

#### `mandiri-marriott-bonvoy`

- Program: points, "Marriott Bonvoy", statement cycle
- Exclusions on every rule and the bonus: categories `transport`, `housing.real_estate`, `education`, `health.insurance`, `utilities`, `government`, `gifts_donations.donations`, `business`, `fees`; keywords qris, va, virtual account, cicilan, installment, power installment, power buy, power cash, power bill, pln, balance transfer
- Rules, `per_increment` per Rp 20.000:
  - `marriott` priority 10, 5, keywords marriott, ritz-carlton, ritz carlton, st. regis, st regis, luxury collection, w hotel, bulgari hotel, sheraton, westin, le meridien, le méridien, renaissance, autograph collection, tribute portfolio, gaylord, courtyard, four points, springhill, protea, fairfield, ac hotel, aloft, moxy, residence inn, towneplace, delta hotels, bonvoy
  - `airfare` priority 10, 5, keywords garuda indonesia, garuda, singapore airlines, airasia, air asia, lion air, citilink, batik air, super air jet, pelita air, cathay pacific, qatar airways, emirates, etihad, klm, turkish airlines, qantas, japan airlines, all nippon, korean air, thai airways, malaysia airlines, eva air, china airlines, scoot, jetstar, vietnam airlines, philippine airlines
  - `international` priority 10, 5, `origin: foreign`
  - `base` priority 0, 3
- Cycle bonus: 2.500 when eligible spend exceeds Rp 30.000.000 (`minSpendMinor: 30000001`), same exclusions
- Fees: Rp 750.000 primary, Rp 375.000 supplementary
- Welcome: 5.000 Marriott Bonvoy points after the first transaction within 3 months of approval; one free night worth up to 20.000 points after Rp 20.000.000 within 3 months (primary card only)
- Notes: terms define "Transaksi Internasional" by merchant country, applied here by currency; airfare means purchases directly from airlines, not travel agents; supplementary card spend does not count toward the milestone but the estimate cannot tell them apart; cancelled transactions and chargebacks reverse points; automatic Silver Elite, Gold Elite at Rp 150.000.000 within a year
- Sources: https://www.mandirikartukredit.com/produk/mandiri-marriott-bonvoy-card ; https://www.mandirikartukredit.com/artikel/syarat-dan-ketentuan-marriott-bonvoy-mandiri-kartu-kredit

### 13.7 Additional known limitations

- Payment methods rely on description keywords.
- Merchant-country definitions are approximated by currency.
- Brand and airline keyword lists need maintenance and can miss merchants whose statement names differ.
