# MCC Layer and Per-Transaction Points — Design

Addendum to `docs/superpowers/specs/2026-09-11-card-catalogue-design.md`. Approved section by section with the owner on 2026-09-11 (MCC option A with a bundled merchant list; per-transaction option D3; order N1: build this, then the Maybank entries, then review and finish the branch).

## 1. Goal

Issuers decide points by merchant category code (MCC), while users categorise spending by budget category. One sub-category can span MCCs that earn differently (Maybank earns on MCC 5812 restaurants but not 5814 fast food; Manchester United "sports" includes 5691 clothing and 5661 shoe stores). Some issuers also credit points per purchase, so users want to check each purchase, not only the statement total.

This addendum gives every card purchase an effective MCC, lets catalogue rules match MCCs, shows estimated points per purchase, records actual points per purchase for cards that credit that way, and explains differences with fixes.

## 2. Decisions

| Topic | Decision |
|---|---|
| MCC source | Layered: typed on the transaction → user merchant memory → bundled merchant list → category default |
| Merchant memory | Applies to past and future purchases on every card |
| Bundled merchant list | About 80 common Indonesian merchants, our own research, marked "typical" |
| Rule matching | `mccs` and `excludeMccs` beside category keys and keywords; conditions AND-ed, exclusions OR-ed |
| Crediting | Per program: `per_transaction` or `per_statement`; catalogue default, user can change without customising |
| Per-transaction actuals | Row actuals for per-transaction cards; statement total stays for per-statement cards |
| Hints | Row hints (per transaction) and ranked cycle hints (per statement), each with fixes |
| Detection of payment method | Still description keywords (QRIS, VA, installments), per owner preference |

## 3. MCC resolution (core)

```ts
export type MccSource = 'typed' | 'memory' | 'bundled' | 'category';
export interface MerchantMcc { pattern: string; mcc: string | null }   // mcc null: ignore bundled entries with this pattern
export interface MccSources {
  typed: string | null;                                  // on the transaction
  memory: MerchantMcc[];                                 // user entries, active only
  bundled: MerchantMcc[];                                // bundled list
  categoryDefault: (categoryId: string) => string | null;
}
export function resolveMcc(description: string, categoryId: string, sources: MccSources): { mcc: string | null; source: MccSource | null };
export function mccInRange(mcc: string, spec: string): boolean;   // "5812" or "3000-3299"
```

- Order: typed, then memory, then bundled, then category default. The first source with an MCC wins.
- Memory and bundled patterns match whole words or phrases, case-insensitive, like catalogue keywords (`containsKeyword`). When several match, the longest pattern wins; ties go to the earlier entry.
- A memory entry with `mcc: null` stops bundled entries with the same pattern from matching; resolution continues to the category default.
- Split purchases: typed, memory, and bundled MCCs apply to the whole purchase; the category default applies per split line.
- Category default: the workspace override for the category, else the built-in default for its key, else the parent category's override or built-in default, else null.
- `SpendLine` gains `mcc: string | null` and `mccSource: MccSource | null`, resolved in the database layer before the engine runs.

### 3.1 Built-in category defaults (`DEFAULT_CATEGORY_MCCS`, core)

| Key | MCC | Key | MCC |
|---|---|---|---|
| food, food.dining | 5812 | health | 8099 |
| food.groceries | 5411 | health.medical | 8062 |
| food.coffee | 5814 | health.pharmacy | 5912 |
| transport.fuel | 5541 | health.insurance | 6300 |
| transport.ride_hailing | 4121 | entertainment | 7999 |
| transport.parking_tolls | 7523 | entertainment.events | 7832 |
| transport.public | 4111 | entertainment.hobbies | 5945 |
| shopping | 5311 | entertainment.games | 5816 |
| shopping.clothing | 5651 | entertainment.sports | 5941 |
| shopping.electronics | 5732 | travel | 4722 |
| shopping.household | 5719 | travel.flights | 4511 |
| utilities, utilities.electricity, utilities.water, utilities.gas | 4900 | travel.hotels | 7011 |
| utilities.internet_phone | 4814 | travel.activities | 7999 |
| utilities.subscriptions | 5968 | education, education.courses | 8299 |
| housing, housing.rent, housing.real_estate | 6513 | education.books | 5942 |
| housing.maintenance | 1520 | personal_care | 7230 |
| gifts_donations, gifts_donations.gifts | 5947 | gifts_donations.donations | 8398 |
| government | 9399 | business | 7399 |

`transport`, `fees` and its children, `other_expense`, and income categories have no default. `food.coffee` defaults to 5814 because Indonesian coffee chains usually carry it; users can change it.

### 3.2 New default category

`entertainment.sports` "Sports & Fitness" under Entertainment. `ensureCategoryKeys` creates it in existing workspaces like the other catalogue-era defaults.

### 3.3 MCC reference list

`packages/core/src/mcc/codes.ts` bundles MCC codes and names from a public-domain ISO 18245 dataset, with its source and licence recorded in the file header. Implementation verifies the licence before bundling; if none is public domain, names are written from the public Visa and Mastercard merchant data manuals. `mccName(code): string | null`.

## 4. Storage — migration `0006_mcc_points`

| Table | Change |
|---|---|
| `transactions` | add `mcc TEXT` (null or four digits) |
| `merchant_mccs` (new) | `id, workspace_id, pattern, mcc (nullable), created_at, archived_at`; one active row per pattern per workspace |
| `category_mccs` (new) | `workspace_id, category_id PRIMARY KEY, mcc` |
| `reward_programs` | add `crediting TEXT NOT NULL DEFAULT 'per_statement' CHECK (crediting IN ('per_transaction','per_statement'))` |
| `transaction_point_actuals` (new) | `workspace_id, program_id, transaction_id, actual_points REAL, edited_after_check INTEGER NOT NULL DEFAULT 0, recorded_at`; primary key `(program_id, transaction_id)`; one decimal place |

- `PostTransactionInput` and `TransactionView` gain `mcc`. Replace keeps the original MCC unless the edit sets it, like original currency.
- `replaceTransaction` moves the purchase's point actuals to the replacement transaction and sets `edited_after_check = 1`.
- Per-statement programs: `cycle_actuals.actual_points` is the statement total, as today. Per-transaction programs: it is only points credited outside purchases (bonuses, extras) and the UI labels it "Bonus points credited".
- `cardSpendLines` resolves MCC for each line with the workspace's memory, the bundled list, and category defaults.

Repository functions: `listMerchantMccs`, `saveMerchantMcc`, `archiveMerchantMcc`, `countMatchingPurchases(pattern)`, `listCategoryMccs`, `saveCategoryMcc`, `clearCategoryMcc`, `setProgramCrediting`, `listTransactionPointActuals(programId, from, to)`, `recordTransactionPointActual`, `clearTransactionPointActual`. Crediting changes never touch `catalog_status`.

## 5. Catalogue format and engine

- `RuleMatch` and `CatalogMatch` gain `mccs?: string[]` and `excludeMccs?: string[]`. Entries are four digits or a range `NNNN-NNNN` with start ≤ end; validation rejects anything else.
- Matching: a rule with `mccs` matches a line only when the line's MCC is in one of the entries; a line without an MCC does not match. `excludeMccs` excludes a line whose MCC is listed; a line without an MCC is not excluded. Cycle bonuses match the same way.
- `CatalogEntry.program` gains `crediting?: 'per_transaction' | 'per_statement'` (default `per_statement`). `applyCatalogEntry` and `resetToCatalog` set the program's crediting; `syncLinkedPrograms` and `applyCatalogUpdate` leave it.
- `describeEntry` names MCCs ("Excludes MCC 5814 Fast Food Restaurants"); ranges show as "MCC 3000–3299". `diffCatalogEntries` reports added and removed MCCs and crediting changes.
- `PurchaseQuery` gains `mcc: string | null`; the recommender page resolves it from the merchant text and chosen category.

### 5.1 Bundled merchant list

`packages/catalog/merchants/merchants.json`: `{ "version": 1, "verifiedOn": "YYYY-MM-DD", "merchants": [{ "pattern": "mcdonald", "mcc": "5814", "name": "McDonald's", "basis": "..." }] }`.

- Patterns are lowercase and unique; MCCs four digits; `basis` states the evidence (public network airline and hotel chain codes, issuer documents, or "typical for the merchant type").
- About 80 merchants across fast food and coffee chains, fuel, minimarkets and supermarkets, marketplaces, ride hailing, cinemas, sports retailers, telcos, utilities, insurers, tax and BPJS, airlines, and hotel chains.
- Validated in tests; never copied from IndoMiles.

## 6. Points per purchase and hints (core)

```ts
export interface CycleEarn { /* existing */ pointsByTransaction: Record<string, number>; approximateTransactionIds: string[] }

export type Suggestion =
  | { kind: 'mcc'; transactionId: string; mcc: string; pointsWith: number; moves: number }
  | { kind: 'bonus_threshold'; bonusId: string; eligibleSpendMinor: number; tierMinSpendMinor: number; bonus: number }
  | { kind: 'rounding'; points: number };

export function explainTransaction(context: CycleContext, transactionId: string, actualPoints: number): Suggestion[];
export function explainCycle(context: CycleContext, actualPoints: number, limit?: number): Suggestion[];
// CycleContext = { lines, rules, ancestors, options: EarnOptions }
```

- `pointsByTransaction` sums allocations per transaction in tenths reported as points. Rules rounding the cycle total (`per_cycle_sum`) share their points in proportion to each purchase's spend for that rule; those transactions are listed as approximate. Refunds carry negative points.
- Candidate MCCs: every single code and every range start named in the card's rules and bonuses (`mccs` and `excludeMccs`), de-duplicated.
- `explainTransaction`: for a purchase whose MCC source is `bundled`, `category`, or null, recompute the cycle with the purchase set to each candidate MCC. Candidates whose points for that purchase equal the actual are suggestions, sorted by code.
- `explainCycle`: for every such purchase and candidate, recompute; keep candidates whose recomputed cycle total is closer to the actual than the estimate is; rank by how much closer, then by purchase amount. Add `bonus_threshold` when the actual differs from the estimate by a tier's bonus and eligible spend is within that tier's refunds or 1% of its threshold. Add `rounding` when the remaining difference is smaller than the number of purchases. Return at most `limit` (default 5).

## 7. Screens

- **Transaction form (card expenses):** "Spent in another currency?" becomes a collapsed "Card purchase details" section with original currency, original amount, and MCC. The MCC field searches codes and names, accepts any four digits (warning when the code has no name), and shows the current guess with its source when empty ("Using 5812 Restaurants (from Dining Out)"). "Remember for purchases containing ___" (pattern pre-filled from the description, editable) saves merchant memory instead of a typed MCC.
- **Merchants page (Cards › Merchants):** the user's merchants with pattern, MCC, name, and matching purchase count; add, edit, remove. Bundled merchants, searchable, marked "typical", with "Use a different MCC" and "Ignore". Saving states how many purchases change, including past cycles.
- **Categories page:** each expense category shows its card MCC (built-in default or override) with reset.
- **Card page, "Purchases this cycle":** date, description, amount, estimate (≈ when approximate), MCC chip with source (typed, yours, typical, category guess).
  - Per-transaction cards: actual field per row, "checked N of M" and running total in the header, a row hint when the actual differs with fixes (remember merchant, this purchase only, change category), "edited after checking" marker, and "Bonus points credited" for the cycle.
  - Per-statement cards: estimates only on rows; the statement check stays, and when the statement total differs a panel lists up to five `explainCycle` suggestions with the same fixes.
  - Crediting setting on the card page: "Bank credits points per purchase / per statement".
- **Transactions list:** card purchases show a small points estimate under the amount, computed within the purchase's own cycle for the card's program.
- **Which card?:** under Merchant, the MCC used and its source.

## 8. Catalogue data changes

### 8.1 Existing entries

- `bca-sq-krisflyer-visa-signature` and `bca-sq-krisflyer-visa-infinite` version 2: both terms periods add `excludeMccs: ["4900", "8398", "8661", "9211", "9222", "9223", "9311", "9399", "9402", "9405"]` to every rule and bonus, keeping their category exclusions (Reward BCA "Penting Diketahui").
- `mandiri-world-prioritas` version 2: `program.crediting: "per_transaction"`.
- CIMB, Marriott Mandiri, and UnionPay keep `per_statement` and their rules.

### 8.2 Maybank entries (verified 2026-09-11)

Common to all five:

- Program: points, "Maybank TREATS Points", statement cycle, `crediting: "per_transaction"`. One terms period from null (the exclusion list before 10 September 2026 was not retrieved; noted).
- Exclusions on every rule and bonus: keywords `xbill`, `x-bill`, `xcash`, `balance conversion`, `qris`, `qr`; MCC `9211`, `9222`, `9311`, `9399`, `5814` (TREATS page and announcement of 31 July 2026, effective 10 September 2026).
- Rule `utilities-over-10m`, priority 100, 0 per Rp 10.000, `mccs: ["4900"]`, `minTransactionMinor: 10000001`: utility payments above Rp 10.000.000 earn nothing ("per kartu" modelled per purchase).
- Transfer partners (TREATS page): KrisFlyer, GarudaMiles, Asia Miles 20.000 → 20.000, step 20.000; AirAsia points 5.000 → 5.000, step 5.000. Notes: above 200.000 TREATS converted in 12 months the ratio becomes 20.000 → 6.666 (AirAsia 5.000 → 1.666); Rp 20.000 fee per mileage conversion.
- Cash value: Rp 100.000 per 1.500 TREATS (MAP Club, Traveloka, Blibli Tiket points, and e-vouchers).
- Sources: TREATS page https://www.maybank.co.id/id/creditcard/treatspoint-jan-2026 ; announcement https://www.maybank.co.id/NewsAndAnnouncement/NewsAndAnnouncements/2026/07/29/06/43/Pembaruan-Informasi-Perolehan-Maybank-TREATS-pada-Maybank-Kartu-Kredit ; each product page and RIPLAY below.

Hotel, airline, restaurant, and travel MCC list (BMW/MINI and Manchester United bonus PDFs): `0101, 0401, 0411, 1301, 3000-3299, 3301-3302, 3501-3791, 3793, 3795, 3802, 3811, 3812, 3813, 3816, 3819, 3824, 3825, 3826, 3828, 3829, 3830, 3831, 3837, 3838, 4111, 4511, 4722, 4723, 5462, 5499, 5812, 5813, 5814, 7011, 7999` (5814 stays excluded by the common exclusion).

**`maybank-visa-platinum`** — base 1 per Rp 20.000 (`per_increment`, priority 0); stackable +2 per Rp 20.000 at restaurants and supermarkets, `mccs: ["5411", "5422", "5441", "5451", "5462", "5499", "5812", "5813"]`, `capPoints: 2500`; stackable +2 per Rp 20.000 online, keywords tokopedia, shopee, lazada, blibli, tiktok shop, bukalapak, zalora, amazon, `capPoints: 2500`. Fees Rp 600.000 / Rp 300.000. Welcome up to 5.000 TREATS after Rp 10.000.000 within 3 months. Notes: 10x on the birthday is not modelled; the bank's own MCC list for the bonus mixes unrelated codes, so standard restaurant and supermarket codes are used. Sources: https://www.maybank.co.id/id/creditcard/maybank-platinum-credit-card ; RIPLAY https://www.maybank.co.id/-/media/Downloaded-Content/RIPLAY/Credit-Card/RIPLAY-UMUM-Visa-Platinum-updated.pdf

**`maybank-visa-infinite`** — 1 per Rp 8.888 everywhere (`per_increment`). Fees Rp 1.500.000 / Rp 750.000, condition "first year free or per the programme at application". Welcome 10.000 TREATS after Rp 30.000.000 within 3 months. Sources: https://www.maybank.co.id/id/creditcard/maybank-visa-infinite-credit-card ; RIPLAY https://www.maybank.co.id/-/media/Downloaded-Content/RIPLAY/Credit-Card/RIPLAY-UMUM---Visa-Infinite---New.pdf

**`maybank-bmw`** and **`maybank-mini`** — `per_increment`:
- `dealer`, priority 30, 1 per Rp 3.333, `capPoints: 7500`, `currencies: ["IDR"]`, keywords BMW: bmw, bestindo, tunas, asset, trans eurokars, astra auto, tmp, tomang, performance moto; MINI: plaza auto, mini auto, mini maxindo, mini bengkel, mini showroom, mini plaza, auto mini, maxindo mini, bengkel mini, showroom mini, plaza mini (Maybank bonus PDF). Note: tunas, asset, and tmp can match other merchants.
- `dining-travel`, priority 20, 1 per Rp 7.500, `capPoints: 3500`, the hotel, airline, restaurant, and travel MCC list.
- `foreign`, priority 15, 1 per Rp 7.500, `capPoints: 7500`, `origin: "foreign"`.
- `base`, priority 0, 1 per Rp 8.888.
- Fees Rp 1.500.000 / Rp 750.000, condition "first year free; later years free after at least one BMW (MINI) transaction the previous year". Welcome 10.000 TREATS after Rp 30.000.000 within 3 months plus a Rp 1.000.000 service voucher. Note: spend beyond a cap falls to the next matching rule. Sources: https://www.maybank.co.id/id/creditcard/bmw-maybank-credit-card or https://www.maybank.co.id/id/creditcard/mini-cobrand-card ; RIPLAY-UMUM-Visa-Infinite-BMW.pdf or RIPLAY-UMUM-Visa-Infinite-MINI.pdf ; https://www.maybank.co.id/-/media/Downloaded-Content/Credit%20Card/SnK-Bonus-Maybank-TREATS-MCC-BMW-MINI-241217-v2.pdf

**`maybank-manchester-united`** — base 1 per Rp 20.000 (`per_increment`); stackable +2 per Rp 20.000 at sports merchants, `mccs: ["5655", "5661", "5691", "5940", "5941", "7941", "7997", "8049"]`, `capPoints: 2500`; stackable +2 per Rp 20.000 on the hotel, airline, restaurant, and travel MCC list, `capPoints: 2500`. Fees Rp 600.000 / Rp 300.000, condition "first year free; later years free after Rp 12.000.000 spend the previous year". Welcome 500.000 MAP Club points after Rp 5.000.000 within 3 months. Note: 10x on Manchester United Premier League win days is not modelled. Sources: https://www.maybank.co.id/id/creditcard/maybank-kartu-kredit-manchester-united ; RIPLAY https://www.maybank.co.id/-/media/Downloaded-Content/RIPLAY/Credit-Card/RIPLAY-UMUM-Manchester-United.pdf ; https://www.maybank.co.id/-/media/Downloaded-Content/Credit%20Card/SnK-Bonus-Maybank-TREATS-Points-MU-241217-v2.pdf

## 9. Testing

- Core: resolution order and sources; longest pattern; ignored bundled pattern; split purchases; category default falling back to the parent; `mccInRange`; include and exclude matching with and without an MCC; points per purchase for floor, per-increment, cycle-sum (approximate), and refunds; `explainTransaction` finding 5814 for a Maybank purchase with actual 0; `explainCycle` ranking and bonus threshold.
- Catalog: MCC and range validation; crediting; bundled merchant list validation; entries validate; BCA version 2 excludes MCC 8398 on 2025-09-22 and 2025-09-23; Maybank utilities above Rp 10.000.000 earn 0.
- Database: migration 0006; merchant memory changes past cycle lines; category override; typed MCC round-trip and keep-on-replace; point actuals move on replace and mark edited; crediting set on apply and reset, untouched by sync and customisation.
- Web unit: helpers for the MCC picker, hint wording, and checked totals.
- End-to-end: Maybank Visa Platinum dinner at "MCDONALD SENAYAN" earns no extra after remembering MCDONALD as 5814; a per-transaction actual that differs shows the 5814 hint; BMW dealer purchase earns 1 per Rp 3.333; a shoe store purchase with MCC 5661 earns the Manchester United sports extra; a per-statement BCA card lists a cycle hint when the statement differs.

## 10. Delivery

Four drops, each test-first with the existing gate (unit tests, typecheck, end-to-end):

- **D:** core resolution, matching, MCC list, defaults, Sports & Fitness; catalogue MCC fields and crediting; migration 0006 and repositories; spend lines with MCC.
- **E:** points per purchase, `explainTransaction`, `explainCycle`; transaction point actuals.
- **F:** transaction form MCC, Merchants page, category MCC, card purchase list, actuals, hints, crediting setting, transactions list estimates, recommender MCC.
- **G:** bundled merchant list, BCA and Mandiri version 2, five Maybank entries, end-to-end tests, preview rebuild, execution status.

Then an independent code review of the branch and finishing the branch.

## 11. Known limitations

- Bundled MCCs are typical codes; acquirers can assign others.
- Without typed MCCs or memory, estimates rely on category defaults.
- Maybank "per card" thresholds are modelled per purchase; merchant country is approximated by currency.
- Birthday and match-day multipliers, tiered annual transfer ratios, and conversion fees are notes only.
- Hints suggest; they never change data without the user choosing a fix.

## 12. Card fees never earn (approved 2026-09-11)

Issuer charges never earn points or count toward cycle bonuses on any card, whatever its rules:

- Purchases in Fees & Charges or any category under it.
- Purchases whose description contains a card fee phrase (`CARD_FEE_PHRASES` in core): biaya notifikasi, notification fee, biaya materai, bea materai, biaya meterai, bea meterai, stamp duty, biaya administrasi, biaya admin, administration fee, admin fee, biaya cetak tagihan, biaya lembar tagihan, statement fee, iuran tahunan, annual fee, biaya keterlambatan, late fee, late charge, late payment fee, biaya tarik tunai, cash advance fee, biaya overlimit, biaya over limit, overlimit fee, biaya bunga, interest charge, finance charge. Phrases only: a single word such as "bunga" would match a florist.
- Fees & Charges gains Notification Fee, Statement Fee, Stamp Duty, and Administration Fee (`fees.notification`, `fees.statement`, `fees.stamp_duty`, `fees.administration`), created in existing workspaces.
- `cardSpendLines` sets `SpendLine.cardFee`; `CycleEarn.cardFeeSpendMinor` reports fee spend, which no longer counts as spend no rule matched. The card page says "Rp X in card fees and charges earns no points" and marks fee rows.

## 13. Review fixes (2026-09-11)

The independent review of the branch changed three behaviours; these replace catalogue spec §5.3 and §5.4 where they differ.

- **Refunds reverse their purchase.** A refund line reverses the points of the latest earlier purchase in the cycle with the same category and MCC whose description the refund repeats (equal, or contained as whole words) and that still has at least the refunded amount unrefunded. Each rule gives back its share of that purchase's spend and points in proportion to the amount. A refund that matches no purchase deducts what its amount would earn from each matching rule, as before. Refunding a purchase made after a cap was reached no longer takes back points the purchase never earned.
- **Bonuses span term changes.** Cycle bonus rows sharing a key are one bonus. Each purchase counts under the row valid on its date, eligible spend adds up across the change, and the row valid at the end of the cycle pays; every row in the group reports the same eligible spend.
- **Hints compute each outcome once.** Candidate MCCs that give a purchase the same matching rules and bonuses share one recomputation, and the web app computes hints once per saved result. explainCycle, 200 purchases, Manchester United rules: 1519 ms, 5 suggestions.
- Also fixed: refunds show as negative points in the transaction list; the card page and transaction list pass the card's billing currency; a failed catalogue sync no longer blocks opening the app; merchant counts use one scan; GrabFood and GoFood are bundled as fast food; statement totals accept one decimal; hint fixes include Change category.
