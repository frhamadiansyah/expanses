# Securities — one stock, several brokers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a holding a **security** (ticker, name, market, currency, lot size) and a **broker**, move the price from the holding to the security so one price values every broker that holds it, add the Investments list (by stock, then where kept), stock / price / broker pages and an Add a holding flow that starts from a ticker, make foreign holdings tradeable and report their rupiah cost at the rate of the day they were bought, and ship the IDX list to everyone and the US list as the paid convenience — without adding a byte of ticker data to the entry chunk.

**Architecture:** Migration **0051** adds three side tables — `securities`, `holding_links`, `security_prices` — and no column anywhere; every read and write goes through `securityTablesExist(db)` (a `WeakMap<Db, boolean>` guard shaped exactly like `extrasTablesExist`). The price choke points `upsertPrice`, `listPrices` and `assetValuesAt` route a linked holding to its security, so every existing price screen stays correct without being touched. Base-currency cost comes from the ledger: each buy's holding line `amount_base_minor` is fed through `positionInBase` (a pure re-walk of `positionAfter`), which the tax inputs and the portfolio figures both read. Trades gain their missing rates through one web function, `tradeMoneyForSave`, called by `TradeForm`, the Add Transaction card's Buy / sell tab and the new Add a holding form. The two ticker lists are JSON files in `packages/catalog/securities/`, loaded by dynamic `import()` so each is its own chunk; `apps/web/scripts/check-bundle.mjs` fails the build if either leaks into the entry chunk or passes its budget. The paid tier is one seam, `apps/web/src/lib/entitlements.ts`.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/catalog`, `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports, `better-sqlite3` in tests), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium`, `phone`).

**Spec:** `docs/superpowers/specs/2026-09-21-securities-design.md`

## Global Constraints

- **No new columns on existing tables** (`transactions`, `accounts`, `entries`, `cards`, `asset_profiles`, `prices`, `expense_templates`, …). Drizzle names every column it knows on every insert, so a new column breaks any database stopped at an older version. New facts go in `securities`, `holding_links`, `security_prices`. Widening a CHECK would need a full table rebuild — none is needed here.
- **Older databases:** every repository read or write of the three new tables asks `securityTablesExist(db)` first. Without them: `listSecurities` / `listHoldingLinks` return `[]`, `upsertPrice` / `listPrices` / `assetValuesAt` / `coretaxInputsFor` behave exactly as today, and `addHolding` / `linkHolding` / `upsertSecurityPrice` throw `AssetError` before writing anything. Migration tests seed an older database with `MIGRATIONS.filter((m) => m.version !== 51)` — never `<= 49`, because 0050, 0052–0054 land from other branches.
- **Migration number is 0051 and only 0051.** The runner is set-based; 0051 is pure `CREATE TABLE` / `CREATE INDEX` and depends on nothing another migration makes. In `packages/db/test/database.test.ts`, insert `51` into the applied-versions list **in order**, keeping every other number main has at that moment.
- **Money is integer minor units, never float.** IDR exponent 0, USD 2, JPY 0, KWD 3. Products that can pass 2^53 go through BigInt (`divRound`, `unitsValueMinor`, `priceMicroFrom`). Sum **signed** values, then clamp if a rule says so — never `Math.abs` before a sum. Shares of a whole: floor each, remainder to the **largest** (`percentShares`).
- **Call existing readers; never write a second one.** A typed amount is read by `parseMajor`; units by `parseUnits`; a price by `parsePriceMicro`; a typed rate by `parseRate` + `checkManualRate`; units × price by `unitsValueMinor`; a conversion by `convertMinor`; a position by `positionAfter`; rates by `resolveRates` (`useResolveRates` / `useStoredRates`). Signatures below were read on 2026-09-21; if the compiler disagrees, re-read the type and match it rather than changing the function.
- **Refusals are inherited, never bypassed.** No new surface edits or deletes a trade: trades are read-only on the stock, broker and Investments pages. Buy & sell's existing Edit/Delete (`replaceTrade` / `deleteTrade`) and the transaction surfaces' `isTrade` refusal are untouched. Every new repository function checks every id it is handed belongs to `ws.workspaceId`.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- **Every screen is built from the native kit** `apps/web/src/ui/native/` (`LargeTitle`, `Hero`, `InsetGroup`, `InsetRow`, `TextRow`, `SelectRow`, `ReadOnlyRow`, `Panel`). Corner actions are glyphs at every width. Kit tokens only (`var(--ph-…)`), never a literal colour, so dark mode follows. No new visual treatment: no ticker tiles, no initials chips. A row never contains a button.
- **Desktop is the highest paid tier and is never weakened.** Nothing is removed from Buy & sell, the Assets page, the inline Add asset form or the asset page; the new pages work by keyboard and by URL.
- **Country-neutral.** No locale presets and no copy naming a country's currency ("exchange-rate movement", not "the rupiah's move"). Only the tax report is Indonesian (`Saham …`).
- **The UI never contains the strings `Bank Central Asia` or `Apple Inc`** — `check-bundle.mjs` uses them as sentinels for the two lists.
- Branch `feat/securities`. Commit per task; merge and push only when the user asks. Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Gate before every commit, no exceptions:** from the root `npm run typecheck`, `npm test`, `npm run build` (which now includes the bundle check), then the task's targeted Playwright specs (`cd apps/web && npx playwright test <spec> --workers=2`). The full Playwright suite runs in Task 15. A per-package vitest run is the inner loop only.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/assets/securities.ts` | `SecurityKind`, `positionInBase`, `percentShares`, `gainBps`, `formatBps`, `portfolioSummary`, `tradeRateNeeds`, `rateFromAmounts`, `tradeCashMinor`, `perUnitInBase`, `taxHoldingName` |
| `packages/core/src/coretax/rows.ts` | `HoldingPurchase`, `HoldingInput.purchases`, the purchase note on foreign rows |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/securities-math.test.ts`, `securities-trade-rates.test.ts`, `coretax-foreign-note.test.ts` | pure tests |
| `packages/catalog/securities/idx.json`, `us.json` | the two lists (generated, committed) |
| `packages/catalog/scripts/build-idx-list.mjs`, `build-us-list.mjs` | generators from the exchanges' files |
| `packages/catalog/src/securities.ts` | `MARKETS`, `FREE_LISTS`, `validateSecurityList`, `expandList`, `loadSecurityList`, `searchSecurities` |
| `packages/catalog/src/index.ts` | export it |
| `packages/catalog/test/securities.test.ts` | the lists and search |
| `packages/db/migrations/0051_securities.sql` | three tables, two indexes |
| `packages/db/src/schema-securities.ts` | Drizzle tables |
| `packages/db/src/migrations.ts` | register 0051 |
| `packages/db/src/repos/securities.ts` | guard, securities, links, security prices, `addHolding` |
| `packages/db/src/repos/base-costs.ts` | `baseCosts` |
| `packages/db/src/repos/prices.ts`, `asset-values.ts`, `tax-inputs.ts` | routing and the tax inputs |
| `packages/db/src/index.ts` | exports |
| `packages/db/test/securities-migration.test.ts`, `securities.test.ts`, `security-prices.test.ts`, `add-holding.test.ts`, `tax-foreign-cost.test.ts`, `database.test.ts` | db tests |
| `apps/web/src/lib/entitlements.ts` (+ `.test.ts`) | the paid seam |
| `apps/web/src/features/networth/trade-money.ts` (+ `.test.ts`) | `tradeMoneyForSave`, `baseCostPreview` |
| `apps/web/src/features/networth/TradeForm.tsx`, `TradesPage.tsx`, `AssetsPage.tsx`, `AssetDetailPage.tsx`, `AddAssetForm.tsx`, `StockAndBroker.tsx` | trade rows, entry rows, linking |
| `apps/web/src/features/transactions/buy-in-form.ts`, `TransactionCard.tsx` | Charged in on the Buy / sell tab |
| `apps/web/src/features/ownables/AddAssetPage.tsx` | Listed shares → the ticker flow |
| `apps/web/src/features/investments/queries.ts` | query hooks, `usePortfolio` |
| `apps/web/src/features/investments/portfolio-view.ts` (+ `.test.ts`) | stock rows, broker rows, price change lines, labels |
| `apps/web/src/features/investments/add-holding.ts` (+ `.test.ts`) | the Add form's planner |
| `apps/web/src/features/investments/InvestmentsPage.tsx`, `SecurityPage.tsx`, `SecurityPricePage.tsx`, `BrokerPage.tsx`, `AddHoldingPage.tsx`, `SecuritySearch.tsx`, `NameItForm.tsx`, `AddHoldingForm.tsx` | screens |
| `apps/web/src/app/router.tsx` | five routes |
| `apps/web/scripts/check-bundle.mjs`, `apps/web/package.json` | the size gate |
| `apps/web/e2e/securities.ts`, `foreign-trades.spec.ts`, `securities.spec.ts`, `phone-securities.spec.ts` | end to end |

---

## Step 1 — The pure parts

### Task 1: Core — base cost, shares of a whole, gains, the portfolio summary

**Files:**
- Create: `packages/core/src/assets/securities.ts`, `packages/core/test/securities-math.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `positionAfter`, `Position`, `TradeRecord` (`assets/position.ts`); `divRound` (`assets/units.ts`, internal import); `convertMinor` (`money/money.ts`).
- Produces: `type SecurityKind = 'share' | 'etf' | 'other'`; `positionInBase(trades: readonly TradeRecord[], baseCostOfBuy: Readonly<Record<string, number>>, upTo?: string): Position`; `percentShares(parts: readonly number[]): number[]`; `gainBps(valueMinor: number, costMinor: number): number | null`; `formatBps(bps: number, locale?: string): string`; `interface PortfolioHolding { currency; valueMinor; costMinor; costBaseMinor }`; `interface PortfolioSummary { valueBaseMinor; costBaseMinor; gainBaseMinor; gainBps: number | null; currencyMoveMinor; converted: boolean; missingRates: string[] }`; `portfolioSummary(holdings: readonly PortfolioHolding[], base: string, ratesToBase: Readonly<Record<string, number>>): PortfolioSummary`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/securities-math.test.ts
import { describe, expect, it } from 'vitest';
import { formatBps, gainBps, percentShares, portfolioSummary, positionAfter, positionInBase, type TradeRecord } from '../src/index';

const t = (id: string, kind: TradeRecord['kind'], occurredOn: string, shares: number, grossMinor: number): TradeRecord => ({
  id, accountId: 'aapl', kind, occurredOn, createdAt: `${occurredOn}T00:00:00Z`, unitsMicro: shares * 1_000_000, grossMinor, feeMinor: 0, taxMinor: 0,
});

describe('positionInBase', () => {
  // Two buys at two rates, then 4 of 15 shares sold. 4/15 is not a .25/.5/.75 fraction, so a floor, a round and a
  // wrong proportion all give different figures here.
  const trades = [
    t('b1', 'buy', '2025-03-08', 10, 182_500), // $1,825.00 at 15.800 → Rp 28.835.000
    t('b2', 'buy', '2026-01-21', 5, 107_035), //  $1,070.35 at 16.100 → Rp 17.232.635
    t('s1', 'sell', '2026-06-01', 4, 90_000),
    { ...t('d1', 'income', '2026-07-01', 0, 5_000) },
  ];
  const base = { b1: 28_835_000, b2: 17_232_635 };

  it('keeps each buy at its own day’s base cost, and a sell takes its average share of it', () => {
    const position = positionInBase(trades, base);
    expect(position.unitsMicro).toBe(11_000_000);
    expect(position.costMinor).toBe(33_782_932); // 46.067.635 − divRound(46.067.635 × 4, 15)
    expect(position.byYear).toEqual({
      '2025': { unitsMicro: 7_333_333, costMinor: 21_145_666 },
      '2026': { unitsMicro: 3_666_667, costMinor: 12_637_266 },
    });
  });

  it('is not the native cost, nor the native cost at any single rate', () => {
    const native = positionAfter(trades);
    expect(native.costMinor).toBe(231_628); // cents: what the old report wrongly filed as rupiah
    expect(positionInBase(trades, base).costMinor).not.toBe(Math.round((native.costMinor / 100) * 16_300));
  });

  it('stops at upTo, and refuses a buy it has no base cost for rather than counting it as nothing', () => {
    expect(positionInBase(trades, base, '2025-12-31').byYear).toEqual({ '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } });
    expect(() => positionInBase(trades, { b1: 28_835_000 })).toThrow(/b2/);
  });
});

describe('percentShares', () => {
  it('floors each share and gives what is left to the largest part', () => {
    // 70,32 · 18,11 · 11,57: rounding would say 70/18/12, largest-remainder 70/18/12; the rule says 71/18/11.
    expect(percentShares([60_251_750, 15_515_000, 9_915_500])).toEqual([71, 18, 11]);
  });
  it('adds up to 100, and is all zeros when there is nothing', () => {
    expect(percentShares([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentShares([0, 0])).toEqual([0, 0]);
    expect(percentShares([])).toEqual([]);
  });
});

describe('gainBps and formatBps', () => {
  it('is signed basis points of cost, half away from zero', () => {
    expect(gainBps(85_682_250, 78_008_060)).toBe(984);
    expect(gainBps(5_740_000, 6_200_000)).toBe(-742);
    expect(gainBps(100, 0)).toBeNull();
  });
  it('reads one decimal, half away from zero, with a real minus sign', () => {
    expect(formatBps(984)).toBe('+9,8%');
    expect(formatBps(985)).toBe('+9,9%'); // 98,5 tenths → 99, not 98
    expect(formatBps(-742)).toBe('−7,4%');
    expect(formatBps(-745)).toBe('−7,5%');
    expect(formatBps(0)).toBe('0,0%');
  });
});

describe('portfolioSummary', () => {
  // The mockup's portfolio, figure for figure.
  const holdings = [
    { currency: 'USD', valueMinor: 214_300, costMinor: 182_500, costBaseMinor: 28_835_000 }, // AAPL
    { currency: 'USD', valueMinor: 156_480, costMinor: 149_460, costBaseMinor: 24_063_060 }, // VOO
    { currency: 'IDR', valueMinor: 9_775_000, costMinor: 8_750_000, costBaseMinor: 8_750_000 }, // BBCA · Stockbit
    { currency: 'IDR', valueMinor: 4_887_500, costMinor: 4_700_000, costBaseMinor: 4_700_000 }, // BBCA · Mandiri
    { currency: 'IDR', valueMinor: 5_740_000, costMinor: 6_200_000, costBaseMinor: 6_200_000 }, // TLKM
    { currency: 'IDR', valueMinor: 5_028_000, costMinor: 5_460_000, costBaseMinor: 5_460_000 }, // BBRI
  ];

  it('totals in base, and names the part that is the exchange rate moving', () => {
    expect(portfolioSummary(holdings, 'IDR', { USD: 16_250 })).toEqual({
      valueBaseMinor: 85_682_250,
      costBaseMinor: 78_008_060,
      gainBaseMinor: 7_674_190,
      gainBps: 984,
      currencyMoveMinor: 1_199_070, // 60.251.750 at today’s rate − 59.052.680 at the rates bought at
      converted: true,
      missingRates: [],
    });
  });

  it('gives a negative move when the base currency strengthened, summed signed', () => {
    expect(portfolioSummary(holdings.slice(0, 2), 'IDR', { USD: 15_000 }).currencyMoveMinor).toBe(
      (32_145_000 - 33_859_400) + (23_472_000 - 25_193_280),
    );
  });

  it('leaves a currency with no rate out of every figure rather than counting it as nothing', () => {
    const summary = portfolioSummary(holdings, 'IDR', {});
    expect(summary.missingRates).toEqual(['USD']);
    expect(summary.valueBaseMinor).toBe(25_430_500);
    expect(summary.costBaseMinor).toBe(25_110_000);
    expect(summary.converted).toBe(false);
    expect(summary.currencyMoveMinor).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail** — `cd packages/core && npx vitest run test/securities-math.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
// packages/core/src/assets/securities.ts
import { convertMinor } from '../money/money';
import { type Position, positionAfter, type TradeRecord } from './position';
import { divRound } from './units';

/** A share with a ticker, an exchange-traded fund, or anything else (an unlisted share, a private fund). */
export type SecurityKind = 'share' | 'etf' | 'other';

/**
 * A holding's position with its cost in the base currency: each buy at the base amount the ledger pinned on its
 * own day, walked exactly as `positionAfter` walks it — a sell takes its average share, per-year buckets are shared
 * out with the difference to the largest. Units are the same units. Realised gains and income are not base facts
 * here and read as nothing; nothing may read them from this position.
 */
export function positionInBase(trades: readonly TradeRecord[], baseCostOfBuy: Readonly<Record<string, number>>, upTo?: string): Position {
  const walked: TradeRecord[] = [];
  for (const trade of trades) {
    if (upTo && trade.occurredOn > upTo) continue;
    if (trade.kind === 'income') continue;
    if (trade.kind === 'buy') {
      const base = baseCostOfBuy[trade.id];
      if (base === undefined) throw new Error(`No base-currency cost for buy ${trade.id}`);
      walked.push({ ...trade, grossMinor: base, feeMinor: 0, taxMinor: 0 });
    } else {
      walked.push({ ...trade, grossMinor: 0, feeMinor: 0, taxMinor: 0 });
    }
  }
  return { ...positionAfter(walked, upTo), realizedMinor: 0, incomeMinor: 0 };
}

/** Whole percentages of a total that add up to exactly 100: each part floored, the remainder to the largest part. */
export function percentShares(parts: readonly number[]): number[] {
  if (parts.some((part) => part < 0)) throw new Error('A share of a whole cannot be negative');
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (parts.length === 0 || total <= 0) return parts.map(() => 0);
  const shares = parts.map((part) => Number((BigInt(part) * 100n) / BigInt(total)));
  let largest = 0;
  parts.forEach((part, i) => {
    if (part > parts[largest]!) largest = i;
  });
  shares[largest] = shares[largest]! + (100 - shares.reduce((sum, share) => sum + share, 0));
  return shares;
}

/** Gain as signed basis points of cost, half away from zero. Null when nothing was paid. */
export function gainBps(valueMinor: number, costMinor: number): number | null {
  if (costMinor <= 0) return null;
  return Number(divRound(BigInt(valueMinor - costMinor) * 10_000n, BigInt(costMinor)));
}

/** "+9,8%": one decimal, half away from zero, a real minus sign. */
export function formatBps(bps: number, locale = 'id-ID'): string {
  const tenths = Number(divRound(BigInt(bps), 10n));
  const sign = tenths > 0 ? '+' : tenths < 0 ? '−' : '';
  return `${sign}${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(tenths) / 10)}%`;
}

export interface PortfolioHolding {
  currency: string;
  /** Today's value and the cost of what is held, both in the holding's own currency. */
  valueMinor: number;
  costMinor: number;
  /** The same cost in base, each buy at its own day's rate (`positionInBase`). */
  costBaseMinor: number;
}

export interface PortfolioSummary {
  valueBaseMinor: number;
  costBaseMinor: number;
  gainBaseMinor: number;
  gainBps: number | null;
  /** How much of the gain is the rate moving: today's rate against the rate each holding was bought at. Signed. */
  currencyMoveMinor: number;
  /** True when any figure in it was converted at today's rate, so the total carries ≈. */
  converted: boolean;
  /** Currencies with no rate today, whose holdings are left out of every figure above. */
  missingRates: string[];
}

export function portfolioSummary(holdings: readonly PortfolioHolding[], base: string, ratesToBase: Readonly<Record<string, number>>): PortfolioSummary {
  let valueBaseMinor = 0;
  let costBaseMinor = 0;
  let currencyMoveMinor = 0;
  let converted = false;
  const missing = new Set<string>();
  for (const holding of holdings) {
    if (holding.currency === base) {
      valueBaseMinor += holding.valueMinor;
      costBaseMinor += holding.costBaseMinor;
      continue;
    }
    const rate = ratesToBase[holding.currency];
    if (rate === undefined) {
      missing.add(holding.currency);
      continue;
    }
    const today = convertMinor(holding.valueMinor, holding.currency, base, rate);
    valueBaseMinor += today;
    costBaseMinor += holding.costBaseMinor;
    converted = true;
    if (holding.costMinor > 0) {
      const atCostRate = Number(divRound(BigInt(holding.valueMinor) * BigInt(holding.costBaseMinor), BigInt(holding.costMinor)));
      currencyMoveMinor += today - atCostRate;
    }
  }
  return {
    valueBaseMinor,
    costBaseMinor,
    gainBaseMinor: valueBaseMinor - costBaseMinor,
    gainBps: gainBps(valueBaseMinor, costBaseMinor),
    currencyMoveMinor,
    converted,
    missingRates: [...missing].sort(),
  };
}
```

Add to `packages/core/src/index.ts`:

```ts
export {
  formatBps,
  gainBps,
  percentShares,
  type PortfolioHolding,
  type PortfolioSummary,
  portfolioSummary,
  positionInBase,
  type SecurityKind,
} from './assets/securities';
```

- [ ] **Step 4: Run** `cd packages/core && npx vitest run test/securities-math.test.ts` → PASS; then the root gate.
- [ ] **Step 5: Commit** `feat(core): base-currency cost, shares of a whole and the portfolio summary`

### Task 2: Core — trade rates, the tax name, the foreign row's note

**Files:**
- Modify: `packages/core/src/assets/securities.ts`, `packages/core/src/coretax/rows.ts`, `packages/core/src/index.ts`
- Create: `packages/core/test/securities-trade-rates.test.ts`, `packages/core/test/coretax-foreign-note.test.ts`

**Interfaces:**
- Consumes: `convertMinor`, `currencyInfo`, `formatMinor`; `TradeKind`; `coretaxRows(taxYear, inputs, settings)` (existing signature, `rows.ts`).
- Produces: `interface TradeRateNeeds { charged: boolean; derived: string | null; dayRates: string[] }`; `tradeRateNeeds(holding: string, cash: string, base: string): TradeRateNeeds`; `rateFromAmounts(amountMinor: number, currency: string, baseMinor: number, base: string): number`; `tradeCashMinor(kind: TradeKind, grossMinor: number, feeMinor: number, taxMinor: number): number`; `perUnitInBase(rate: number, currency: string, base: string): number`; `taxHoldingName(security: { ticker: string | null; name: string; kind: SecurityKind } | null, brokerName: string | null, accountName: string): string`; `interface HoldingPurchase { occurredOn: string; nativeMinor: number; baseMinor: number }`; `HoldingInput.purchases?: HoldingPurchase[]`.

- [ ] **Step 1: Failing tests**

```ts
// packages/core/test/securities-trade-rates.test.ts
import { describe, expect, it } from 'vitest';
import { convertMinor, perUnitInBase, rateFromAmounts, taxHoldingName, tradeCashMinor, tradeRateNeeds } from '../src/index';

describe('tradeRateNeeds', () => {
  it('asks nothing when all of it is base', () => {
    expect(tradeRateNeeds('IDR', 'IDR', 'IDR')).toEqual({ charged: false, derived: null, dayRates: [] });
  });
  it('asks the day’s rate for a foreign holding paid from the same currency', () => {
    expect(tradeRateNeeds('USD', 'USD', 'IDR')).toEqual({ charged: false, derived: null, dayRates: ['USD'] });
  });
  it('works the rate out from the two amounts when one side is base', () => {
    expect(tradeRateNeeds('USD', 'IDR', 'IDR')).toEqual({ charged: true, derived: 'USD', dayRates: [] });
    expect(tradeRateNeeds('IDR', 'USD', 'IDR')).toEqual({ charged: true, derived: 'USD', dayRates: [] });
  });
  it('needs both day rates when neither side is base', () => {
    expect(tradeRateNeeds('USD', 'SGD', 'IDR')).toEqual({ charged: true, derived: null, dayRates: ['SGD', 'USD'] });
  });
});

describe('rateFromAmounts', () => {
  it('is base per one major unit, and converts back to exactly what was charged', () => {
    expect(rateFromAmounts(182_500, 'USD', 28_835_000, 'IDR')).toBe(15_800);
    // Non-round on purpose: $1,234.57 that cost Rp 20.000.001.
    const rate = rateFromAmounts(123_457, 'USD', 20_000_001, 'IDR');
    expect(convertMinor(123_457, 'USD', 'IDR', rate)).toBe(20_000_001);
  });
  it('respects each currency’s exponent', () => {
    expect(rateFromAmounts(1_000, 'KWD', 53_000_000, 'IDR')).toBe(53_000_000); // 1,000 KWD
    const jpy = rateFromAmounts(10_000, 'JPY', 1_070_000, 'IDR'); // ¥10.000 for Rp 1.070.000
    expect(jpy).toBe(107);
    const toUsd = rateFromAmounts(16_250_000, 'IDR', 100_000, 'USD');
    expect(convertMinor(16_250_000, 'IDR', 'USD', toUsd)).toBe(100_000);
  });
  it('refuses nothing for something', () => {
    expect(() => rateFromAmounts(0, 'USD', 1, 'IDR')).toThrow();
    expect(() => rateFromAmounts(1, 'USD', 0, 'IDR')).toThrow();
  });
});

describe('tradeCashMinor', () => {
  it('is what tradePostings moves through the cash account', () => {
    expect(tradeCashMinor('buy', 1_000, 15, 3)).toBe(1_018);
    expect(tradeCashMinor('sell', 1_000, 15, 3)).toBe(982);
    expect(tradeCashMinor('income', 1_000, 15, 3)).toBe(997); // an income carries no fee
    expect(tradeCashMinor('unit_change', 1_000, 0, 0)).toBe(0);
  });
});

describe('perUnitInBase', () => {
  it('is one major unit in base minor units', () => {
    expect(perUnitInBase(15_800, 'USD', 'IDR')).toBe(15_800);
    expect(perUnitInBase(16_199.97, 'USD', 'IDR')).toBe(16_200);
  });
});

describe('taxHoldingName', () => {
  const bbca = { ticker: 'BBCA', name: 'Bank Central Asia Tbk.', kind: 'share' as const };
  it('names a share by ticker and the broker', () => {
    expect(taxHoldingName(bbca, 'Stockbit', 'BBCA · Stockbit')).toBe('Saham BBCA — Stockbit');
    expect(taxHoldingName(bbca, null, 'BBCA')).toBe('Saham BBCA');
  });
  it('names anything else by its name', () => {
    expect(taxHoldingName({ ticker: 'VOO', name: 'Vanguard S&P 500 ETF', kind: 'etf' }, 'Interactive Brokers', 'x')).toBe('Vanguard S&P 500 ETF — Interactive Brokers');
    expect(taxHoldingName({ ticker: null, name: 'Private fund', kind: 'other' }, null, 'x')).toBe('Private fund');
  });
  it('keeps the account’s name when there is no security', () => {
    expect(taxHoldingName(null, 'Stockbit', 'Antam gold bars')).toBe('Antam gold bars');
  });
});
```

```ts
// packages/core/test/coretax-foreign-note.test.ts
import { describe, expect, it } from 'vitest';
import { type CoretaxInputs, coretaxRows, formatMinor } from '../src/index';

const settings = { propertyBasis: 'cost' as const, repeatRows: 'year' as const, kmkRateBps: { USD: 165_000_000 } };
const inputs = (purchases: { occurredOn: string; nativeMinor: number; baseMinor: number }[]): CoretaxInputs => ({
  cash: [], estimated: [], receivables: [], debts: [],
  holdings: [{
    accountId: 'aapl', name: 'Saham AAPL — Interactive Brokers', code: '0303', currency: 'USD', priceMicro: 21_430_000_000,
    byYear: { '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } }, fields: {}, purchases,
  }],
});

describe('a foreign holding’s row', () => {
  it('files the base cost it is handed and says how it was reached', () => {
    const [row] = coretaxRows(2025, inputs([{ occurredOn: '2025-03-08', nativeMinor: 182_500, baseMinor: 28_835_000 }]), settings);
    expect(row!.costMinor).toBe(28_835_000);
    expect(row!.note).toBe(`${formatMinor(182_500, 'USD')} at ${formatMinor(15_800, 'IDR')} · 8 Mar 2025`);
  });
  it('counts several purchases rather than inventing one rate for them', () => {
    const [row] = coretaxRows(2025, inputs([
      { occurredOn: '2025-03-08', nativeMinor: 100_000, baseMinor: 15_800_000 },
      { occurredOn: '2025-05-02', nativeMinor: 82_500, baseMinor: 13_035_000 },
    ]), settings);
    expect(row!.note).toBe('2 purchases, each at its own day’s rate');
  });
});
```

- [ ] **Step 2: Run to see both fail.**

- [ ] **Step 3: Implement** — append to `securities.ts`:

```ts
import { currencyInfo } from '../money/currencies';
import type { TradeKind } from './position';

export interface TradeRateNeeds {
  /** The form asks what left or reached the cash account, in its own currency. */
  charged: boolean;
  /** The currency whose rate is worked out from the two amounts, when one side is the base. */
  derived: string | null;
  /** Currencies that need the day's rate from `resolveRates` (or typed when it has none). */
  dayRates: string[];
}

export function tradeRateNeeds(holding: string, cash: string, base: string): TradeRateNeeds {
  if (holding === cash) return { charged: false, derived: null, dayRates: holding === base ? [] : [holding] };
  if (cash === base) return { charged: true, derived: holding, dayRates: [] };
  if (holding === base) return { charged: true, derived: cash, dayRates: [] };
  return { charged: true, derived: null, dayRates: [holding, cash].sort() };
}

/** Base per one major unit of `currency`, from what the same money was in each. Used for that trade only. */
export function rateFromAmounts(amountMinor: number, currency: string, baseMinor: number, base: string): number {
  if (!(amountMinor > 0) || !(baseMinor > 0)) throw new Error('Both amounts must be more than zero to work out a rate');
  return baseMinor / 10 ** currencyInfo(base).exponent / (amountMinor / 10 ** currencyInfo(currency).exponent);
}

/** What moves through the cash account, in the holding's currency, exactly as `tradePostings` moves it. */
export function tradeCashMinor(kind: TradeKind, grossMinor: number, feeMinor: number, taxMinor: number): number {
  if (kind === 'buy') return grossMinor + feeMinor + taxMinor;
  if (kind === 'sell') return grossMinor - feeMinor - taxMinor;
  if (kind === 'income') return grossMinor - taxMinor;
  return 0;
}

/** One major unit of `currency` in base minor units — "Rp 15.800" per dollar. */
export function perUnitInBase(rate: number, currency: string, base: string): number {
  return convertMinor(10 ** currencyInfo(currency).exponent, currency, base, rate);
}

/** The daftar harta's name for a holding (C2). The tax report is the one Indonesian screen, so "Saham" is its word. */
export function taxHoldingName(
  security: { ticker: string | null; name: string; kind: SecurityKind } | null,
  brokerName: string | null,
  accountName: string,
): string {
  if (!security) return accountName;
  const what = security.kind === 'share' && security.ticker ? `Saham ${security.ticker}` : security.name;
  return brokerName ? `${what} — ${brokerName}` : what;
}
```

In `packages/core/src/coretax/rows.ts`:

```ts
import { currencyInfo } from '../money/currencies';
import { formatMinor } from '../money/money';
import { perUnitInBase, rateFromAmounts } from '../assets/securities';

/** One buy of a foreign holding: what it cost in its currency and the base amount the ledger pinned that day. */
export interface HoldingPurchase {
  occurredOn: string;
  nativeMinor: number;
  baseMinor: number;
}
```

Add to `HoldingInput`: `/** Foreign holdings only: each buy up to 31 December, for the note under the row. */ purchases?: HoldingPurchase[];`

Add beside `holdingRows`:

```ts
const dayLabel = (isoDay: string) =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** How a foreign row's cost was reached. Null for a base-currency holding. */
function purchaseNote(holding: HoldingInput, year: string | null): string | null {
  if (!holding.purchases || holding.currency === BASE) return null;
  const list = holding.purchases.filter((p) => year === null || p.occurredOn.startsWith(year));
  if (list.length === 0) return null;
  if (list.length > 1) return `${list.length} purchases, each at its own day’s rate`;
  const only = list[0]!;
  const rate = rateFromAmounts(only.nativeMinor, holding.currency, only.baseMinor, BASE);
  return `${formatMinor(only.nativeMinor, holding.currency)} at ${formatMinor(perUnitInBase(rate, holding.currency, BASE), BASE)} · ${dayLabel(only.occurredOn)}`;
}

const joinNotes = (...notes: (string | null)[]): string | null => notes.filter((note): note is string => Boolean(note)).join(' · ') || null;
```

and in `holdingRows` change the two `note: value.note` to `note: joinNotes(purchaseNote(holding, year), value.note)` (per-year branch) and `note: joinNotes(purchaseNote(holding, null), value.note)` (one-row branch). Remove the unused `currencyInfo` import if the compiler says so. Export the new names from `index.ts` (`perUnitInBase`, `rateFromAmounts`, `taxHoldingName`, `tradeCashMinor`, `type TradeRateNeeds`, `tradeRateNeeds` from `./assets/securities`; `type HoldingPurchase` from `./coretax/rows`).

- [ ] **Step 4: Run both test files → PASS; root gate.**
- [ ] **Step 5: Commit** `feat(core): how a trade gets its rates, and the daftar harta names the broker`

---

## Step 2 — The lists

### Task 3: The catalogue — IDX and US lists, markets, search

**Files:**
- Create: `packages/catalog/scripts/build-idx-list.mjs`, `packages/catalog/scripts/build-us-list.mjs`, `packages/catalog/securities/idx.json`, `packages/catalog/securities/us.json`, `packages/catalog/src/securities.ts`, `packages/catalog/test/securities.test.ts`
- Modify: `packages/catalog/src/index.ts`

**Interfaces:**
- Consumes: `SecurityKind` from `@expanses/core`.
- Produces: `interface ListedSecurity { ticker: string; name: string; market: string; currency: string; lotSize: number | null; kind: SecurityKind }`; `type SecurityList = 'idx' | 'us'`; `MARKETS: Readonly<Record<string, { currency: string; lotSize: number | null; list: SecurityList }>>`; `FREE_LISTS`; `type ListRow = [string, string, string, 's' | 'e']`; `interface ListFile { asOf: string; rows: ListRow[] }`; `validateSecurityList(file: unknown, list: SecurityList): string[]`; `expandList(file: ListFile): ListedSecurity[]`; `loadSecurityList(list: SecurityList): Promise<{ asOf: string; securities: ListedSecurity[] }>`; `searchSecurities<T extends { ticker: string | null; name: string; market: string }>(rows: readonly T[], query: string, limit?: number): T[]`.

- [ ] **Step 1: Get the source files.** Download (a) IDX's *Daftar Saham* (idx.co.id → Data Pasar → Data Saham → Daftar Saham), saved as CSV with the columns `Kode` and `Nama Perusahaan`; (b) `https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt` and `.../otherlisted.txt`. Keep them outside the repo. **If you cannot download them, stop and ask the owner for the three files. Never type or invent list rows.**

- [ ] **Step 2: Write the generators**

```js
// packages/catalog/scripts/build-idx-list.mjs — node build-idx-list.mjs <daftar-saham.csv> <asOf YYYY-MM-DD>
import { readFileSync, writeFileSync } from 'node:fs';

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const [, , file, asOf] = process.argv;
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('usage: build-idx-list.mjs <csv> <YYYY-MM-DD>');
const [header, ...body] = parseCsv(readFileSync(file, 'utf8'));
const code = header.findIndex((h) => h.trim() === 'Kode');
const name = header.findIndex((h) => h.trim() === 'Nama Perusahaan');
if (code < 0 || name < 0) throw new Error('The CSV needs the columns Kode and Nama Perusahaan');
const seen = new Set();
const rows = [];
for (const cells of body) {
  const ticker = (cells[code] ?? '').trim().toUpperCase();
  const title = (cells[name] ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Z]{4}$/.test(ticker) || !title || seen.has(ticker)) continue;
  seen.add(ticker);
  rows.push([ticker, title, 'IDX', 's']);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(new URL('../securities/idx.json', import.meta.url), `${JSON.stringify({ asOf, rows })}\n`);
console.log(`idx.json: ${rows.length} rows as of ${asOf}`);
```

```js
// packages/catalog/scripts/build-us-list.mjs — node build-us-list.mjs <nasdaqlisted.txt> <otherlisted.txt> <asOf>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , nasdaqFile, otherFile, asOf] = process.argv;
if (!nasdaqFile || !otherFile || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('usage: build-us-list.mjs <nasdaqlisted> <otherlisted> <YYYY-MM-DD>');
const EXCHANGES = { N: 'NYSE', A: 'NYSE AMERICAN', P: 'NYSE ARCA', Z: 'CBOE BZX', V: 'IEX' };
const LEFT_OUT = /\b(warrants?|rights?|units?|subordinated|notes? due|depositary shares? representing .*preferred)\b/i;
const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

function table(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('File Creation Time'));
  const [head, ...body] = lines;
  const keys = head.split('|');
  return body.map((line) => Object.fromEntries(line.split('|').map((value, i) => [keys[i], value])));
}
const clean = (title) => title.split(' - ')[0].replace(/\s+(Common Stock|Ordinary Shares|Common Shares)$/i, '').trim();

const rows = [];
const seen = new Set();
const add = (ticker, title, market, etf) => {
  const key = `${market}:${ticker}`;
  if (!TICKER.test(ticker) || !title || LEFT_OUT.test(title) || seen.has(key)) return;
  seen.add(key);
  rows.push([ticker, clean(title), market, etf === 'Y' ? 'e' : 's']);
};
for (const r of table(nasdaqFile)) if (r['Test Issue'] === 'N') add(r.Symbol, r['Security Name'], 'NASDAQ', r.ETF);
for (const r of table(otherFile)) if (r['Test Issue'] === 'N' && EXCHANGES[r.Exchange]) add(r['ACT Symbol'], r['Security Name'], EXCHANGES[r.Exchange], r.ETF);
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
writeFileSync(new URL('../securities/us.json', import.meta.url), `${JSON.stringify({ asOf, rows })}\n`);
console.log(`us.json: ${rows.length} rows as of ${asOf}`);
```

Run both with the downloaded files and today's date. Commit the two JSON files they write.

- [ ] **Step 3: Failing tests**

```ts
// packages/catalog/test/securities.test.ts
import { describe, expect, it } from 'vitest';
import idxFile from '../securities/idx.json';
import usFile from '../securities/us.json';
import { expandList, type ListFile, loadSecurityList, MARKETS, searchSecurities, validateSecurityList } from '../src/index';

describe('the bundled lists', () => {
  it('are valid, with no duplicate ticker on a market', () => {
    expect(validateSecurityList(idxFile, 'idx')).toEqual([]);
    expect(validateSecurityList(usFile, 'us')).toEqual([]);
  });
  it('are the size the exchanges publish', () => {
    expect((idxFile as ListFile).rows.length).toBeGreaterThan(850);
    expect((idxFile as ListFile).rows.length).toBeLessThan(1_100);
    expect((usFile as ListFile).rows.length).toBeGreaterThan(3_000);
    expect((usFile as ListFile).rows.length).toBeLessThan(13_000);
  });
  it('carry the names the owner holds, on the right market', async () => {
    const idx = (await loadSecurityList('idx')).securities;
    const us = (await loadSecurityList('us')).securities;
    for (const ticker of ['BBCA', 'TLKM', 'BBRI']) expect(idx.find((s) => s.ticker === ticker)).toMatchObject({ market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' });
    expect(us.find((s) => s.ticker === 'AAPL')).toMatchObject({ market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share' });
    expect(us.find((s) => s.ticker === 'VOO')).toMatchObject({ market: 'NYSE ARCA', currency: 'USD', lotSize: null, kind: 'etf' });
  });
});

describe('validateSecurityList', () => {
  it('names each problem', () => {
    const bad = { asOf: '2026-09-21', rows: [['BBCA', 'A', 'IDX', 's'], ['BBCA', 'B', 'IDX', 's'], ['bbri', 'C', 'IDX', 's'], ['TLKM', '', 'MARS', 'x']] };
    expect(validateSecurityList(bad, 'idx')).toEqual([
      'IDX:BBCA is listed twice',
      'Row 3: "bbri" is not a IDX ticker',
      'Row 4: "TLKM" is not a IDX ticker',
      'Row 4: no name',
      'Row 4: unknown market "MARS"',
      'Row 4: kind must be s or e',
    ]);
    expect(validateSecurityList({ rows: [] }, 'idx')).toEqual(['asOf must be YYYY-MM-DD']);
  });
});

describe('expandList', () => {
  it('fills currency and lot size from the market', () => {
    expect(expandList({ asOf: '2026-09-21', rows: [['BBCA', 'x', 'IDX', 's'], ['VOO', 'y', 'NYSE ARCA', 'e']] })).toEqual([
      { ticker: 'BBCA', name: 'x', market: 'IDX', currency: MARKETS.IDX!.currency, lotSize: 100, kind: 'share' },
      { ticker: 'VOO', name: 'y', market: 'NYSE ARCA', currency: 'USD', lotSize: null, kind: 'etf' },
    ]);
  });
});

describe('searchSecurities', () => {
  const rows = [
    { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ' },
    { ticker: 'APPF', name: 'AppFolio', market: 'NASDAQ' },
    { ticker: 'AMAT', name: 'Applied Materials', market: 'NASDAQ' },
    { ticker: 'PAPL', name: 'Pineapple Holdings', market: 'NYSE' },
    { ticker: 'AAP', name: 'Advance Auto Parts', market: 'NYSE' },
    { ticker: null, name: 'Private fund', market: '' },
  ];
  it('ranks exact ticker, ticker prefix, a word of the name, then the name containing it', () => {
    expect(searchSecurities(rows, 'app').map((r) => r.ticker)).toEqual(['APPF', 'AAPL', 'AMAT', 'PAPL']);
    expect(searchSecurities(rows, ' aap ').map((r) => r.ticker)).toEqual(['AAP', 'AAPL']);
  });
  it('finds a security with no ticker by name, and nothing for an empty query', () => {
    expect(searchSecurities(rows, 'private').map((r) => r.name)).toEqual(['Private fund']);
    expect(searchSecurities(rows, '  ')).toEqual([]);
  });
  it('stops at the limit', () => {
    expect(searchSecurities(rows, 'a', 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Implement**

```ts
// packages/catalog/src/securities.ts
import type { SecurityKind } from '@expanses/core';

export interface ListedSecurity {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  /** Shares in one lot, or null where the market trades single shares. */
  lotSize: number | null;
  kind: SecurityKind;
}

export type SecurityList = 'idx' | 'us';

/** Every market a bundled list may name. A new exchange is a new list file and new rows here — nothing else. */
export const MARKETS: Readonly<Record<string, { currency: string; lotSize: number | null; list: SecurityList }>> = {
  IDX: { currency: 'IDR', lotSize: 100, list: 'idx' },
  NASDAQ: { currency: 'USD', lotSize: null, list: 'us' },
  NYSE: { currency: 'USD', lotSize: null, list: 'us' },
  'NYSE ARCA': { currency: 'USD', lotSize: null, list: 'us' },
  'NYSE AMERICAN': { currency: 'USD', lotSize: null, list: 'us' },
  'CBOE BZX': { currency: 'USD', lotSize: null, list: 'us' },
  IEX: { currency: 'USD', lotSize: null, list: 'us' },
};

/** Lists every user searches. The rest are the paid convenience (spec §6.5). */
export const FREE_LISTS: readonly SecurityList[] = ['idx'];

export type ListRow = [ticker: string, name: string, market: string, kind: 's' | 'e'];
export interface ListFile {
  asOf: string;
  rows: ListRow[];
}

const TICKER: Record<SecurityList, RegExp> = { idx: /^[A-Z]{4}$/, us: /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/ };

export function validateSecurityList(file: unknown, list: SecurityList): string[] {
  const problems: string[] = [];
  const f = file as Partial<ListFile>;
  if (typeof f?.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f.asOf)) problems.push('asOf must be YYYY-MM-DD');
  const seen = new Set<string>();
  (Array.isArray(f?.rows) ? f.rows : []).forEach((row, i) => {
    const [ticker, name, market, kind] = row as unknown[];
    const at = `Row ${i + 1}`;
    if (typeof ticker !== 'string' || !TICKER[list].test(ticker)) problems.push(`${at}: "${String(ticker)}" is not a ${list.toUpperCase()} ticker`);
    if (typeof name !== 'string' || name.trim() === '') problems.push(`${at}: no name`);
    if (typeof market !== 'string' || !MARKETS[market] || MARKETS[market]!.list !== list) problems.push(`${at}: unknown market "${String(market)}"`);
    if (kind !== 's' && kind !== 'e') problems.push(`${at}: kind must be s or e`);
    const key = `${String(market)}:${String(ticker)}`;
    if (seen.has(key)) problems.push(`${key} is listed twice`);
    seen.add(key);
  });
  return problems;
}

export function expandList(file: ListFile): ListedSecurity[] {
  return file.rows.map(([ticker, name, market, kind]) => {
    const info = MARKETS[market];
    if (!info) throw new Error(`Unknown market "${market}"`);
    return { ticker, name, market, currency: info.currency, lotSize: info.lotSize, kind: kind === 'e' ? 'etf' : 'share' };
  });
}

/**
 * A dynamic import each, so the bundler gives each list a chunk of its own: the entry chunk carries neither, and
 * the US list is never parsed on a device that never searches it. `check-bundle.mjs` holds the build to this.
 */
export async function loadSecurityList(list: SecurityList): Promise<{ asOf: string; securities: ListedSecurity[] }> {
  const file = (list === 'idx' ? (await import('../securities/idx.json')).default : (await import('../securities/us.json')).default) as unknown as ListFile;
  return { asOf: file.asOf, securities: expandList(file) };
}

export function searchSecurities<T extends { ticker: string | null; name: string; market: string }>(rows: readonly T[], query: string, limit = 30): T[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const rank = (row: T): number => {
    const ticker = (row.ticker ?? '').toUpperCase();
    const name = row.name.toUpperCase();
    if (ticker === q) return 0;
    if (ticker.startsWith(q)) return 1;
    if (name.split(/[\s.,&()/-]+/).some((word) => word.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return rows
    .map((row) => ({ row, r: rank(row) }))
    .filter((hit) => hit.r >= 0)
    .sort((a, b) => a.r - b.r || (a.row.ticker ?? a.row.name).localeCompare(b.row.ticker ?? b.row.name) || a.row.market.localeCompare(b.row.market))
    .slice(0, limit)
    .map((hit) => hit.row);
}
```

Add to `packages/catalog/src/index.ts`: `export * from './securities';` — and **no** static import of either JSON file anywhere in `src`.

- [ ] **Step 5: Run** `cd packages/catalog && npx vitest run test/securities.test.ts` → PASS; root gate.
- [ ] **Step 6: Commit** `feat(catalog): the IDX and US lists, their markets, and search`

---

## Step 3 — What is stored

### Task 4: Migration 0051, the guard, securities and links

**Files:**
- Create: `packages/db/migrations/0051_securities.sql`, `packages/db/src/schema-securities.ts`, `packages/db/src/repos/securities.ts`, `packages/db/test/securities-migration.test.ts`, `packages/db/test/securities.test.ts`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Consumes: `AssetError`, `assertAccountInWorkspace` (`repos/assets.ts`); `SPENDABLE_SUBTYPES` (`repos/accounts.ts`); `isSupportedCurrency`, `uuidv7`, `SecurityKind`, `PriceRow` (core); `prices`, `assetProfiles` (`schema-assets.ts`).
- Produces: `securityTablesExist(db: Db): Promise<boolean>`; `interface SecurityRow { id; ticker: string | null; name; market; currency; lotSize: number | null; kind: SecurityKind; source: 'catalogue' | 'owner' }`; `interface NewSecurity { ticker: string | null; name; market; currency; lotSize: number | null; kind: SecurityKind; source: 'catalogue' | 'owner' }`; `interface HoldingLinkRow { accountId; securityId: string | null; brokerAccountId: string | null }`; `ensureSecurityTx(tx, ws, input: NewSecurity): Promise<SecurityRow>`; `securityByIdTx(tx, ws, id): Promise<SecurityRow>`; `listSecurities(database, ws)`; `listHoldingLinks(database, ws)`; `linkHoldingTx(tx, ws, input: { accountId: string; securityId?: string | null; brokerAccountId?: string | null })`; `linkHolding(database, ws, input: { accountId: string; security?: { id: string } | NewSecurity | null; brokerAccountId?: string | null }): Promise<void>`; `upsertSecurityPriceTx(tx, ws, input: { securityId; onDate; priceMicro })`; `upsertSecurityPrice(database, ws, input)`; `listSecurityPrices(database, ws, securityId): Promise<PriceRow[]>`; `allSecurityPrices(database, ws): Promise<{ securityId; onDate; priceMicro }[]>`; `securityOfHolding(db: Db, ws, accountId): Promise<string | null>`.

- [ ] **Step 1: The migration**

```sql
/* 0051 — securities. A holding points at a security (ticker, market, currency, lot size) and names the broker it
   is kept at; a price belongs to the security, so one price values every broker that holds it.

   Three tables of their own and nothing else: no column on accounts, asset_profiles or prices, because the ORM
   names every column it knows on every insert (see 0028). Nothing is backfilled — a holding with no link reads
   exactly as it did. Pure CREATE statements, so it lands in any order beside 0050, 0052, 0053 and 0054. */
CREATE TABLE securities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  ticker TEXT,
  name TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  lot_size INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('share', 'etf', 'other')),
  source TEXT NOT NULL CHECK (source IN ('catalogue', 'owner')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX securities_ticker ON securities (workspace_id, market, ticker) WHERE ticker IS NOT NULL;

CREATE TABLE holding_links (
  account_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  security_id TEXT,
  broker_account_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX holding_links_security ON holding_links (workspace_id, security_id);

CREATE TABLE security_prices (
  security_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  on_date TEXT NOT NULL,
  price_micro INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (security_id, on_date)
);
```

Register: `import securitiesTables from '../migrations/0051_securities.sql?raw';` and `{ version: 51, name: 'securities', sql: securitiesTables },` in `MIGRATIONS`, in version order.

- [ ] **Step 2: Schema**

```ts
// packages/db/src/schema-securities.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const securities = sqliteTable('securities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  ticker: text('ticker'),
  name: text('name').notNull(),
  market: text('market').notNull(),
  currency: text('currency').notNull(),
  lotSize: integer('lot_size'),
  kind: text('kind', { enum: ['share', 'etf', 'other'] }).notNull(),
  source: text('source', { enum: ['catalogue', 'owner'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const holdingLinks = sqliteTable('holding_links', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  securityId: text('security_id'),
  brokerAccountId: text('broker_account_id'),
  createdAt: text('created_at').notNull(),
});

export const securityPrices = sqliteTable('security_prices', {
  securityId: text('security_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  onDate: text('on_date').notNull(),
  priceMicro: integer('price_micro').notNull(),
  source: text('source', { enum: ['manual'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 3: Failing tests**

```ts
// packages/db/test/securities-migration.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, createWorkspace, listHoldingLinks, listSecurities, migrate, MIGRATIONS, securityTablesExist } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
afterEach(() => { executor?.close(); executor = undefined; });

describe('migration 0051', () => {
  it('is version 51 and named securities', () => {
    expect(MIGRATIONS.find((m) => m.version === 51)).toMatchObject({ name: 'securities' });
  });

  it('adds three tables to a database without them, and the guard answers only once they exist', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version !== 51));
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    expect(await securityTablesExist(older.db)).toBe(false);
    expect(await listSecurities(older, ws)).toEqual([]);
    expect(await listHoldingLinks(older, ws)).toEqual([]);

    expect(await migrate(older)).toEqual([51]);
    // A "no" was not remembered, so the same handle now says yes.
    expect(await securityTablesExist(older.db)).toBe(true);
    const columns = async (table: string) => (await older.db.values<unknown[]>(sql.raw(`PRAGMA table_info(${table})`))).map((row) => String(row[1]));
    expect(await columns('securities')).toEqual(['id', 'workspace_id', 'ticker', 'name', 'market', 'currency', 'lot_size', 'kind', 'source', 'created_at']);
    expect(await columns('holding_links')).toEqual(['account_id', 'workspace_id', 'security_id', 'broker_account_id', 'created_at']);
    expect(await columns('security_prices')).toEqual(['security_id', 'workspace_id', 'on_date', 'price_micro', 'source', 'created_at']);
  });
});
```

```ts
// packages/db/test/securities.test.ts
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, createAccount, createWorkspace, type Database, getAssetProfile, linkHolding, listHoldingLinks, listSecurities,
  listSecurityPrices, type NewSecurity, saveAssetProfile, upsertPrice, upsertSecurityPrice, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let stockbit: AccountRow;
let card: AccountRow;
const bbca: NewSecurity = { ticker: 'bbca ', name: 'BBCA name', market: 'idx', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' };
const aapl: NewSecurity = { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: 1, kind: 'share', source: 'owner' };

async function holding(name: string, currency = 'IDR') {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: 'stock' });
  return account;
}

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  stockbit = await createAccount(database, ws, { name: 'Stockbit', kind: 'asset', subtype: 'fund', currency: 'IDR' });
  card = await createAccount(database, ws, { name: 'BCA Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
});

describe('securities', () => {
  it('is one row per market and ticker, however it is typed', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: b.id, security: { ...bbca, ticker: 'BBCA', market: 'IDX', source: 'owner' } });
    const rows = await listSecurities(database, ws);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: 'BBCA', market: 'IDX', lotSize: 100, source: 'catalogue' });
    const links = await listHoldingLinks(database, ws);
    expect(new Set(links.map((l) => l.securityId))).toEqual(new Set([rows[0]!.id]));
  });

  it('keeps two things with no ticker apart, and reads a lot of one as no lots', async () => {
    const a = await holding('A', 'USD');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: aapl });
    await linkHolding(database, ws, { accountId: b.id, security: { ticker: null, name: 'Private fund', market: '', currency: 'IDR', lotSize: null, kind: 'other', source: 'owner' } });
    const rows = await listSecurities(database, ws);
    expect(rows.find((r) => r.ticker === 'AAPL')!.lotSize).toBeNull();
    expect(rows).toHaveLength(2);
  });
});

describe('linkHolding', () => {
  it('refuses a security in another currency than the holding', async () => {
    const idr = await holding('IDR holding');
    await expect(linkHolding(database, ws, { accountId: idr.id, security: aapl })).rejects.toThrow(/USD/);
    expect(await listHoldingLinks(database, ws)).toEqual([]);
  });

  it('refuses a broker that is not a money account, and an account from another workspace', async () => {
    const a = await holding('A');
    await expect(linkHolding(database, ws, { accountId: a.id, brokerAccountId: card.id })).rejects.toThrow(/money account/);
    const other = await createWorkspace(database, { name: 'Shared', type: 'shared', baseCurrency: 'IDR' });
    await expect(linkHolding(database, other, { accountId: a.id, brokerAccountId: stockbit.id })).rejects.toThrow(/not found/);
  });

  it('refuses a second holding for the same security at the same broker', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await linkHolding(database, ws, { accountId: a.id, security: bbca, brokerAccountId: stockbit.id });
    await expect(linkHolding(database, ws, { accountId: b.id, security: bbca, brokerAccountId: stockbit.id })).rejects.toThrow(/already/);
  });

  it('carries the holding’s own prices to the security without overwriting one it has, and sets its lot size', async () => {
    const a = await holding('A');
    const b = await holding('B');
    await upsertPrice(database, ws, { accountId: a.id, onDate: '2026-09-12', priceMicro: 9_550_000_000 });
    await upsertPrice(database, ws, { accountId: b.id, onDate: '2026-09-12', priceMicro: 9_600_000_000 });
    await upsertPrice(database, ws, { accountId: b.id, onDate: '2026-09-05', priceMicro: 9_400_000_000 });
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    await linkHolding(database, ws, { accountId: b.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    expect(await listSecurityPrices(database, ws, security!.id)).toEqual([
      { onDate: '2026-09-12', priceMicro: 9_550_000_000 }, // A's stood; B's 9.600 on the same day did not replace it
      { onDate: '2026-09-05', priceMicro: 9_400_000_000 },
    ]);
    expect((await getAssetProfile(database, ws, b.id))!.lotSize).toBe(100);
    // The holding's own rows are left where they were.
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${b.id}`)).toEqual([[2]]);
  });

  it('refuses a negative security price', async () => {
    const a = await holding('A');
    await linkHolding(database, ws, { accountId: a.id, security: bbca });
    const [security] = await listSecurities(database, ws);
    await expect(upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: -1 })).rejects.toThrow();
  });
});
```

(`upsertPrice` still writes `prices` for these holdings before they are linked — the routing is Task 5, and these tests hold either way.)

- [ ] **Step 4: Implement `packages/db/src/repos/securities.ts` (this task's half)**

```ts
import { isSupportedCurrency, type PriceRow, type SecurityKind, uuidv7 } from '@expanses/core';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles, prices } from '../schema-assets';
import { holdingLinks, securities, securityPrices } from '../schema-securities';
import { SPENDABLE_SUBTYPES } from './accounts';
import { AssetError } from './assets';

/**
 * Whether migration 0051 has run. Every read and write of the three tables asks first, so a database stopped at an
 * older version behaves exactly as it does today. Only a positive answer is remembered: migrate() may still run on
 * the same handle.
 */
const tablesSeen = new WeakMap<Db, boolean>();

export async function securityTablesExist(db: Db): Promise<boolean> {
  if (tablesSeen.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'securities'`);
  if (rows.length > 0) tablesSeen.set(db, true);
  return rows.length > 0;
}

async function requireTables(db: Db): Promise<void> {
  if (!(await securityTablesExist(db))) throw new AssetError('This data has not been updated for tickers yet. Reopen the app and try again.');
}

export interface SecurityRow {
  id: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  lotSize: number | null;
  kind: SecurityKind;
  source: 'catalogue' | 'owner';
}
export type NewSecurity = Omit<SecurityRow, 'id'>;

export interface HoldingLinkRow {
  accountId: string;
  securityId: string | null;
  brokerAccountId: string | null;
}

const toSecurity = (row: typeof securities.$inferSelect): SecurityRow => ({
  id: row.id, ticker: row.ticker, name: row.name, market: row.market, currency: row.currency, lotSize: row.lotSize, kind: row.kind, source: row.source,
});

const labelOf = (security: SecurityRow) => security.ticker ?? security.name;

/** The security for a market and ticker, recorded now if it is not yet. A ticker's facts are never rewritten. */
export async function ensureSecurityTx(tx: Db, ws: WorkspaceContext, input: NewSecurity): Promise<SecurityRow> {
  await requireTables(tx);
  const ticker = input.ticker?.trim().toUpperCase() || null;
  const market = input.market.trim().toUpperCase();
  const name = input.name.trim();
  if (!name) throw new AssetError('Give it a name');
  if (!isSupportedCurrency(input.currency)) throw new AssetError(`"${input.currency}" is not a currency this app knows`);
  if (input.lotSize !== null && (!Number.isInteger(input.lotSize) || input.lotSize < 1)) throw new AssetError('A lot is a whole number of shares, one or more');
  if (ticker && !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)) throw new AssetError('A ticker is letters and digits, up to twelve');
  if (ticker) {
    const [found] = await tx
      .select()
      .from(securities)
      .where(and(eq(securities.workspaceId, ws.workspaceId), eq(securities.market, market), eq(securities.ticker, ticker)));
    if (found) return toSecurity(found);
  }
  const row = {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    ticker,
    name,
    market,
    currency: input.currency,
    // A lot of one share is no lots at all.
    lotSize: input.lotSize === 1 ? null : input.lotSize,
    kind: input.kind,
    source: input.source,
    createdAt: new Date().toISOString(),
  };
  await tx.insert(securities).values(row);
  return toSecurity(row);
}

export async function securityByIdTx(tx: Db, ws: WorkspaceContext, id: string): Promise<SecurityRow> {
  await requireTables(tx);
  const [row] = await tx.select().from(securities).where(and(eq(securities.id, id), eq(securities.workspaceId, ws.workspaceId)));
  if (!row) throw new AssetError('That security is not in this workspace');
  return toSecurity(row);
}

export async function listSecurities(database: Database, ws: WorkspaceContext): Promise<SecurityRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  const rows = await database.db.select().from(securities).where(eq(securities.workspaceId, ws.workspaceId));
  return rows.map(toSecurity).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
}

export async function listHoldingLinks(database: Database, ws: WorkspaceContext): Promise<HoldingLinkRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ accountId: holdingLinks.accountId, securityId: holdingLinks.securityId, brokerAccountId: holdingLinks.brokerAccountId })
    .from(holdingLinks)
    .where(eq(holdingLinks.workspaceId, ws.workspaceId));
}

/** The security a holding points at, or null — including on a database without the tables. */
export async function securityOfHolding(db: Db, ws: WorkspaceContext, accountId: string): Promise<string | null> {
  if (!(await securityTablesExist(db))) return null;
  const [row] = await db
    .select({ securityId: holdingLinks.securityId })
    .from(holdingLinks)
    .where(and(eq(holdingLinks.accountId, accountId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  return row?.securityId ?? null;
}

/**
 * Points a holding at a security, a broker, or both. An argument left undefined keeps what the link had; null
 * clears it. Linking a security carries the holding's own prices to it (the security's own price on a date stands)
 * and sets the holding's lot size to the security's.
 */
export async function linkHoldingTx(
  tx: Db,
  ws: WorkspaceContext,
  input: { accountId: string; securityId?: string | null; brokerAccountId?: string | null },
): Promise<void> {
  await requireTables(tx);
  const [holding] = await tx
    .select({ id: accounts.id, kind: accounts.kind, subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!holding) throw new AssetError('Asset not found in this workspace');
  if (holding.kind !== 'asset' || holding.subtype !== 'investment') throw new AssetError('Only a holding can have a ticker or a broker');
  const [existing] = await tx
    .select()
    .from(holdingLinks)
    .where(and(eq(holdingLinks.accountId, input.accountId), eq(holdingLinks.workspaceId, ws.workspaceId)));
  const securityId = input.securityId === undefined ? (existing?.securityId ?? null) : input.securityId;
  const brokerAccountId = input.brokerAccountId === undefined ? (existing?.brokerAccountId ?? null) : input.brokerAccountId;

  const security = securityId ? await securityByIdTx(tx, ws, securityId) : null;
  const holdingCurrency = holding.currency ?? ws.baseCurrency;
  if (security && security.currency !== holdingCurrency) {
    throw new AssetError(`${labelOf(security)} is in ${security.currency}; this holding is in ${holdingCurrency}`);
  }
  if (brokerAccountId) {
    const [broker] = await tx
      .select({ kind: accounts.kind, subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, brokerAccountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!broker) throw new AssetError('Broker account not found in this workspace');
    if (broker.kind !== 'asset' || !SPENDABLE_SUBTYPES.includes(broker.subtype)) {
      throw new AssetError('A broker is the money account you keep there — choose a bank, cash or fund account');
    }
  }
  if (security && brokerAccountId) {
    const [clash] = await tx
      .select({ accountId: holdingLinks.accountId })
      .from(holdingLinks)
      .where(and(
        eq(holdingLinks.workspaceId, ws.workspaceId),
        eq(holdingLinks.securityId, security.id),
        eq(holdingLinks.brokerAccountId, brokerAccountId),
        ne(holdingLinks.accountId, input.accountId),
      ));
    if (clash) throw new AssetError(`${labelOf(security)} at that broker is already another holding; record the buy on it instead`);
  }

  const now = new Date().toISOString();
  await tx
    .insert(holdingLinks)
    .values({ accountId: input.accountId, workspaceId: ws.workspaceId, securityId, brokerAccountId, createdAt: now })
    .onConflictDoUpdate({ target: holdingLinks.accountId, set: { securityId, brokerAccountId } });

  if (security && security.id !== existing?.securityId) {
    const own = await tx.select().from(prices).where(and(eq(prices.accountId, input.accountId), eq(prices.workspaceId, ws.workspaceId)));
    for (const row of own) {
      await tx
        .insert(securityPrices)
        .values({ securityId: security.id, workspaceId: ws.workspaceId, onDate: row.onDate, priceMicro: row.priceMicro, source: 'manual', createdAt: now })
        .onConflictDoNothing();
    }
    await tx
      .update(assetProfiles)
      .set({ lotSize: security.lotSize, updatedAt: now })
      .where(and(eq(assetProfiles.accountId, input.accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  }
}

/** The same, recording the security first when it is handed as a new one. One database transaction. */
export function linkHolding(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; security?: { id: string } | NewSecurity | null; brokerAccountId?: string | null },
): Promise<void> {
  return database.transaction(async (tx) => {
    let securityId: string | null | undefined;
    if (input.security === null) securityId = null;
    else if (input.security) securityId = 'id' in input.security ? input.security.id : (await ensureSecurityTx(tx, ws, input.security)).id;
    await linkHoldingTx(tx, ws, { accountId: input.accountId, securityId, brokerAccountId: input.brokerAccountId });
  });
}

export async function upsertSecurityPriceTx(tx: Db, ws: WorkspaceContext, input: { securityId: string; onDate: string; priceMicro: number }): Promise<void> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro < 0) throw new AssetError('A price cannot be negative');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new AssetError('Choose a date');
  await securityByIdTx(tx, ws, input.securityId);
  const row = { securityId: input.securityId, workspaceId: ws.workspaceId, onDate: input.onDate, priceMicro: input.priceMicro, source: 'manual' as const, createdAt: new Date().toISOString() };
  await tx.insert(securityPrices).values(row).onConflictDoUpdate({ target: [securityPrices.securityId, securityPrices.onDate], set: row });
}

/** One price for a security on a date; typing again replaces it. It values every holding of the security. */
export function upsertSecurityPrice(database: Database, ws: WorkspaceContext, input: { securityId: string; onDate: string; priceMicro: number }): Promise<void> {
  return database.transaction((tx) => upsertSecurityPriceTx(tx, ws, input));
}

/** Newest first. */
export async function listSecurityPrices(database: Database, ws: WorkspaceContext, securityId: string): Promise<PriceRow[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro })
    .from(securityPrices)
    .where(and(eq(securityPrices.securityId, securityId), eq(securityPrices.workspaceId, ws.workspaceId)))
    .orderBy(desc(securityPrices.onDate));
}

export async function allSecurityPrices(database: Database, ws: WorkspaceContext): Promise<{ securityId: string; onDate: string; priceMicro: number }[]> {
  if (!(await securityTablesExist(database.db))) return [];
  return database.db
    .select({ securityId: securityPrices.securityId, onDate: securityPrices.onDate, priceMicro: securityPrices.priceMicro })
    .from(securityPrices)
    .where(eq(securityPrices.workspaceId, ws.workspaceId));
}
```

(`isNull` is used by Task 6's `holdingAtTx`; if the compiler flags it unused now, add it in Task 6 instead.)

`packages/db/src/index.ts`: `export * from './repos/securities';` and `export * as securitiesSchema from './schema-securities';`. In `database.test.ts`, add `51` to the applied list in order.

- [ ] **Step 5: Run** `cd packages/db && npx vitest run test/securities-migration.test.ts test/securities.test.ts test/database.test.ts` → PASS; root gate.
- [ ] **Step 6: Commit** `feat(db): securities, holding links and security prices (migration 0051)`

### Task 5: One price per security — the choke points

**Files:**
- Modify: `packages/db/src/repos/prices.ts`, `packages/db/src/repos/asset-values.ts`
- Create: `packages/db/test/security-prices.test.ts`

**Interfaces:**
- Consumes: `securityOfHolding`, `upsertSecurityPriceTx`, `listSecurityPrices`, `listHoldingLinks`, `allSecurityPrices` (Task 4); `recordTrade`, `assetValuesAt` (existing).
- Produces: unchanged signatures `upsertPrice`, `listPrices`, `assetValuesAt` — routed for linked holdings.

- [ ] **Step 1: Failing test**

```ts
// packages/db/test/security-prices.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, assetValuesAt, createAccount, createDatabase, createWorkspace, type Database, linkHolding, listPrices, listSecurities,
  migrate, MIGRATIONS, recordTrade, saveAssetProfile, upsertPrice, upsertSecurityPrice, type WorkspaceContext,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

const shares = (n: number) => n * 1_000_000;
const idr = (rupiah: number) => rupiah * 1_000_000; // a price per share, in millionths of a rupiah

let database: Database;
let ws: WorkspaceContext;
let stockbitBbca: AccountRow;
let mandiriBbca: AccountRow;
let gold: AccountRow;

async function holdingWith(name: string, units: number, costMinor: number, kind: 'stock' | 'gold' = 'stock') {
  const account = await createAccount(database, ws, { name, kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: account.id, assetKind: kind });
  await recordTrade(database, ws, { accountId: account.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: units, grossMinor: costMinor, feeMinor: 0, taxMinor: 0, cashAccountId: null });
  return account;
}
const valueOn = async (date: string, id: string) => (await assetValuesAt(database, ws, date)).find((row) => row.accountId === id)!.valueMinor;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  stockbitBbca = await holdingWith('BBCA · Stockbit', shares(1_000), 8_750_000);
  mandiriBbca = await holdingWith('BBCA · Mandiri', shares(500), 4_700_000);
  gold = await holdingWith('Antam gold bars', shares(10), 18_600_000, 'gold');
  const bbca = { ticker: 'BBCA', name: 'BBCA', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const, source: 'catalogue' as const };
  await linkHolding(database, ws, { accountId: stockbitBbca.id, security: bbca });
  await linkHolding(database, ws, { accountId: mandiriBbca.id, security: bbca });
});

describe('one price per security', () => {
  it('values every holding of the security from one entry', async () => {
    const [security] = await listSecurities(database, ws);
    await upsertSecurityPrice(database, ws, { securityId: security!.id, onDate: '2026-09-19', priceMicro: idr(9_775) });
    expect(await valueOn('2026-09-19', stockbitBbca.id)).toBe(9_775_000);
    expect(await valueOn('2026-09-19', mandiriBbca.id)).toBe(4_887_500);
  });

  it('routes a price typed on either holding to the security, so no screen types a price nothing reads', async () => {
    await upsertPrice(database, ws, { accountId: mandiriBbca.id, onDate: '2026-09-20', priceMicro: idr(9_800) });
    expect(await valueOn('2026-09-20', stockbitBbca.id)).toBe(9_800_000);
    expect(await database.db.values(sql`SELECT count(*) FROM prices WHERE account_id = ${mandiriBbca.id}`)).toEqual([[0]]);
    expect(await listPrices(database, ws, stockbitBbca.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(9_800) }]);
  });

  it('leaves a holding with no security exactly as it was', async () => {
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-09-20', priceMicro: idr(1_900_000) });
    expect(await listPrices(database, ws, gold.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(1_900_000) }]);
    expect(await valueOn('2026-09-20', gold.id)).toBe(19_000_000);
  });
});

describe('on a database without 0051', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => { executor?.close(); executor = undefined; });

  it('prices and values holdings exactly as before', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(older, MIGRATIONS.filter((m) => m.version !== 51));
    const ows = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const bar = await createAccount(older, ows, { name: 'Gold', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(older, ows, { accountId: bar.id, assetKind: 'gold' });
    await recordTrade(older, ows, { accountId: bar.id, kind: 'buy', occurredOn: '2026-01-05', unitsMicro: shares(10), grossMinor: 18_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    await upsertPrice(older, ows, { accountId: bar.id, onDate: '2026-09-20', priceMicro: idr(1_900_000) });
    expect(await listPrices(older, ows, bar.id)).toEqual([{ onDate: '2026-09-20', priceMicro: idr(1_900_000) }]);
    expect((await assetValuesAt(older, ows, '2026-09-20'))[0]!.valueMinor).toBe(19_000_000);
  });
});
```

- [ ] **Step 2: Run → FAIL** (second test: the `prices` count is 1 and Stockbit reads its own series).

- [ ] **Step 3: Implement**

In `prices.ts`:

```ts
import { listSecurityPrices, securityOfHolding, upsertSecurityPriceTx } from './securities';

export async function upsertPrice(database: Database, ws: WorkspaceContext, input: { accountId: string; onDate: string; priceMicro: number }): Promise<void> {
  if (!Number.isSafeInteger(input.priceMicro) || input.priceMicro < 0) throw new AssetError('A price cannot be negative');
  const row = { accountId: input.accountId, workspaceId: ws.workspaceId, onDate: input.onDate, priceMicro: input.priceMicro, source: 'manual' as const, createdAt: new Date().toISOString() };
  await database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');
    // A linked holding's price is its security's: one entry values every broker that holds it (spec §3.2).
    const securityId = await securityOfHolding(tx, ws, input.accountId);
    if (securityId) {
      await upsertSecurityPriceTx(tx, ws, { securityId, onDate: input.onDate, priceMicro: input.priceMicro });
      return;
    }
    await tx.insert(prices).values(row).onConflictDoUpdate({ target: [prices.accountId, prices.onDate], set: row });
  });
}

export async function listPrices(database: Database, ws: WorkspaceContext, accountId: string): Promise<PriceRow[]> {
  const securityId = await securityOfHolding(database.db, ws, accountId);
  if (securityId) return listSecurityPrices(database, ws, securityId);
  return database.db
    .select({ onDate: prices.onDate, priceMicro: prices.priceMicro })
    .from(prices)
    .where(and(eq(prices.accountId, accountId), eq(prices.workspaceId, ws.workspaceId)))
    .orderBy(desc(prices.onDate));
}
```

In `asset-values.ts`, after `priceRows` is read:

```ts
  // A holding with a security is valued from the security's prices alone (spec §3.1); the rest from its own.
  const securityOf = new Map((await listHoldingLinks(database, ws)).filter((link) => link.securityId).map((link) => [link.accountId, link.securityId!]));
  const securityPriceRows = securityOf.size > 0 ? await allSecurityPrices(database, ws) : [];
```

and replace the `accountPrices` line with:

```ts
    const securityId = securityOf.get(account.id);
    const accountPrices: PriceRow[] = securityId
      ? securityPriceRows.filter((row) => row.securityId === securityId).map((row) => ({ onDate: row.onDate, priceMicro: row.priceMicro }))
      : priceRows.filter((row) => row.accountId === account.id).map((row) => ({ onDate: row.onDate, priceMicro: row.priceMicro }));
```

with `import { allSecurityPrices, listHoldingLinks } from './securities';`.

- [ ] **Step 4: Run** the new file plus `test/prices.test.ts test/asset-values.test.ts test/net-worth-series.test.ts` → PASS; root gate.
- [ ] **Step 5: Commit** `feat(db): a linked holding is priced by its security, from every way in`

### Task 6: `addHolding` — one database transaction

**Files:**
- Modify: `packages/db/src/repos/securities.ts`
- Create: `packages/db/test/add-holding.test.ts`

**Interfaces:**
- Consumes: `createAccountTx(tx, ws, CreateAccountInput)`, `saveAssetProfileTx(tx, ws, SaveAssetProfileInput)`, `writeTradeTx(tx, ws, RecordTradeInput, replacesTradeId)`, `assetItem('stock')`, Task 4's functions.
- Produces: `interface AddHoldingInput { security: { id: string } | NewSecurity; broker: { accountId: string } | { name: string; currency: string } | null; buy: Omit<RecordTradeInput, 'accountId' | 'kind'> }`; `interface AddHoldingResult { accountId: string; securityId: string; brokerAccountId: string | null; created: boolean; trade: TradeResult }`; `addHolding(database, ws, input): Promise<AddHoldingResult>`.

- [ ] **Step 1: Failing tests**

```ts
// packages/db/test/add-holding.test.ts
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { rateFromAmounts } from '@expanses/core';
import {
  type AccountRow, addHolding, checkLedgerIntegrity, createAccount, type Database, getAssetProfile, listAccounts, listHoldingLinks, listSecurities,
  nativeBalances, positionsFor, schema, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
const bbca = { ticker: 'BBCA', name: 'BBCA name', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const, source: 'catalogue' as const };
const aapl = { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share' as const, source: 'owner' as const };
const shares = (n: number) => n * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
});

describe('addHolding', () => {
  it('opens the broker, the holding and its profile, links them and records the buy', async () => {
    const result = await addHolding(database, ws, {
      security: bbca,
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: bca.id },
    });
    expect(result.created).toBe(true);
    const accounts = await listAccounts(database, ws);
    expect(accounts.find((a) => a.id === result.accountId)).toMatchObject({ name: 'BBCA · Stockbit', subtype: 'investment', currency: 'IDR' });
    expect(accounts.find((a) => a.id === result.brokerAccountId)).toMatchObject({ name: 'Stockbit', subtype: 'fund', currency: 'IDR' });
    expect(await getAssetProfile(database, ws, result.accountId)).toMatchObject({ assetKind: 'stock', lotSize: 100, coretaxCode: '0303', unitKind: 'shares' });
    const balances = await nativeBalances(database, ws);
    expect(balances[result.accountId]).toBe(8_763_125);
    expect(balances[bca.id]).toBe(41_236_875);
    expect(await listHoldingLinks(database, ws)).toEqual([{ accountId: result.accountId, securityId: result.securityId, brokerAccountId: result.brokerAccountId }]);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('records a second buy at the same broker on the same holding', async () => {
    const first = await addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 8_750_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    const second = await addHolding(database, ws, { security: { id: first.securityId }, broker: { accountId: first.brokerAccountId! }, buy: { occurredOn: '2026-04-02', unitsMicro: shares(500), grossMinor: 4_700_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } });
    expect(second).toMatchObject({ created: false, accountId: first.accountId });
    expect((await positionsFor(database, ws))[first.accountId]!.unitsMicro).toBe(shares(1_500));
  });

  it('pins a foreign buy paid in rupiah at exactly what left the account', async () => {
    const cashMinor = 20_000_001; // non-round on purpose
    const result = await addHolding(database, ws, {
      security: aapl,
      broker: { name: 'Interactive Brokers', currency: 'USD' },
      buy: { occurredOn: '2026-03-08', unitsMicro: shares(10), grossMinor: 123_457, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id, cashMinor, ratesToBase: { USD: rateFromAmounts(123_457, 'USD', cashMinor, 'IDR') } },
    });
    const lines = await database.db.select().from(schema.entries).where(and(eq(schema.entries.transactionId, result.trade.transactionId!), eq(schema.entries.accountId, result.accountId)));
    expect(lines.map((l) => [l.amountMinor, l.currency, l.amountBaseMinor])).toEqual([[123_457, 'USD', 20_000_001]]);
    expect((await nativeBalances(database, ws))[bca.id]).toBe(50_000_000 - 20_000_001);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('leaves nothing behind when the buy is refused', async () => {
    const before = (await listAccounts(database, ws)).length;
    await expect(addHolding(database, ws, { security: bbca, broker: { name: 'Stockbit', currency: 'IDR' }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(1_000), grossMinor: 0, feeMinor: 0, taxMinor: 0, cashAccountId: bca.id } })).rejects.toThrow();
    expect((await listAccounts(database, ws)).length).toBe(before);
    expect(await listSecurities(database, ws)).toEqual([]);
  });

  it('refuses a broker that is a card', async () => {
    const card = await createAccount(database, ws, { name: 'Card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(addHolding(database, ws, { security: bbca, broker: { accountId: card.id }, buy: { occurredOn: '2026-03-02', unitsMicro: shares(100), grossMinor: 875_000, feeMinor: 0, taxMinor: 0, cashAccountId: null } })).rejects.toThrow(/money account/);
    expect(await listSecurities(database, ws)).toEqual([]);
  });
});
```

(`schema.entries` is the existing `export * as schema from './schema'`.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — append to `securities.ts`:

```ts
import { assetItem } from '@expanses/core';
import { createAccountTx } from './accounts';
import { saveAssetProfileTx } from './assets';
import { type RecordTradeInput, type TradeResult, writeTradeTx } from './trades';

export interface AddHoldingInput {
  /** A security already recorded, or one to record now — from a bundled list, or named by the owner. */
  security: { id: string } | NewSecurity;
  /** Where it is kept: a money account already open, a broker account to open now, or no broker. */
  broker: { accountId: string } | { name: string; currency: string } | null;
  /** The buy, with the rates and the charged amount `tradeMoneyForSave` worked out. */
  buy: Omit<RecordTradeInput, 'accountId' | 'kind'>;
}

export interface AddHoldingResult {
  accountId: string;
  securityId: string;
  brokerAccountId: string | null;
  /** False when the buy went on a holding of this security at this broker that already existed. */
  created: boolean;
  trade: TradeResult;
}

/** The live holding of a security at a broker (or at no broker), if there is one. */
async function holdingAtTx(tx: Db, ws: WorkspaceContext, securityId: string, brokerAccountId: string | null): Promise<string | null> {
  const [row] = await tx
    .select({ accountId: holdingLinks.accountId })
    .from(holdingLinks)
    .innerJoin(accounts, eq(accounts.id, holdingLinks.accountId))
    .where(and(
      eq(holdingLinks.workspaceId, ws.workspaceId),
      eq(holdingLinks.securityId, securityId),
      brokerAccountId ? eq(holdingLinks.brokerAccountId, brokerAccountId) : isNull(holdingLinks.brokerAccountId),
      isNull(accounts.archivedAt),
    ));
  return row?.accountId ?? null;
}

/** Record the security, open the broker, open and link the holding, record the buy — all or nothing (spec §7.5). */
export function addHolding(database: Database, ws: WorkspaceContext, input: AddHoldingInput): Promise<AddHoldingResult> {
  return database.transaction(async (tx) => {
    await requireTables(tx);
    const security = 'id' in input.security ? await securityByIdTx(tx, ws, input.security.id) : await ensureSecurityTx(tx, ws, input.security);

    let brokerAccountId: string | null = null;
    let brokerName: string | null = null;
    if (input.broker && 'accountId' in input.broker) {
      const [broker] = await tx
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.id, input.broker.accountId), eq(accounts.workspaceId, ws.workspaceId)));
      if (!broker) throw new AssetError('Broker account not found in this workspace');
      brokerAccountId = broker.id;
      brokerName = broker.name;
    } else if (input.broker) {
      const opened = await createAccountTx(tx, ws, { name: input.broker.name, kind: 'asset', subtype: 'fund', currency: input.broker.currency });
      brokerAccountId = opened.id;
      brokerName = opened.name;
    }

    const existing = await holdingAtTx(tx, ws, security.id, brokerAccountId);
    let accountId = existing;
    if (!accountId) {
      const holding = await createAccountTx(tx, ws, {
        name: brokerName ? `${labelOf(security)} · ${brokerName}` : labelOf(security),
        kind: 'asset',
        subtype: 'investment',
        currency: security.currency,
      });
      const item = assetItem('stock');
      await saveAssetProfileTx(tx, ws, {
        accountId: holding.id,
        assetKind: 'stock',
        unitKind: 'shares',
        lotSize: security.lotSize,
        coretaxSection: item.section,
        coretaxCode: item.code,
      });
      // Validates the broker (a money account in this workspace) before anything is bought.
      await linkHoldingTx(tx, ws, { accountId: holding.id, securityId: security.id, brokerAccountId });
      accountId = holding.id;
    }
    const trade = await writeTradeTx(tx, ws, { ...input.buy, accountId, kind: 'buy' }, null);
    return { accountId, securityId: security.id, brokerAccountId, created: existing === null, trade };
  });
}
```

(If `existing` is found the broker was already validated when that holding was linked.)

- [ ] **Step 4: Run → PASS; root gate.**
- [ ] **Step 5: Commit** `feat(db): add a holding — security, broker, holding and buy in one transaction`

### Task 7: Base-currency cost and the tax report (C2, §8.2)

**Files:**
- Create: `packages/db/src/repos/base-costs.ts`, `packages/db/test/tax-foreign-cost.test.ts`
- Modify: `packages/db/src/repos/tax-inputs.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `listTrades`, `positionAfter`, `positionInBase`, `taxHoldingName`, `listHoldingLinks`, `listSecurities`, `entries`, `accounts`.
- Produces: `interface BaseCosts { positions: Record<string, Position>; buyBaseMinor: Record<string, number> }`; `baseCosts(database, ws, upTo?: string): Promise<BaseCosts>`; `coretaxInputsFor` gives foreign holdings base `byYear`, the C2 name and `purchases`.

- [ ] **Step 1: Failing test**

```ts
// packages/db/test/tax-foreign-cost.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow, addHolding, baseCosts, coretaxInputsFor, createAccount, type Database, recordTrade, saveAssetProfile, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let ibkr: AccountRow;
let aaplId: string;
const shares = (n: number) => n * 1_000_000;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  ibkr = await createAccount(database, ws, { name: 'Interactive Brokers', kind: 'asset', subtype: 'fund', currency: 'USD' });
  const first = await addHolding(database, ws, {
    security: { ticker: 'AAPL', name: 'AAPL name', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' },
    broker: { accountId: ibkr.id },
    buy: { occurredOn: '2025-03-08', unitsMicro: shares(10), grossMinor: 182_500, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 15_800 } },
  });
  aaplId = first.accountId;
  await recordTrade(database, ws, { accountId: aaplId, kind: 'buy', occurredOn: '2026-01-21', unitsMicro: shares(5), grossMinor: 107_035, feeMinor: 0, taxMinor: 0, cashAccountId: null, ratesToBase: { USD: 16_100 } });
  await recordTrade(database, ws, { accountId: aaplId, kind: 'sell', occurredOn: '2026-06-01', unitsMicro: shares(4), grossMinor: 90_000, feeMinor: 0, taxMinor: 0, cashAccountId: ibkr.id, ratesToBase: { USD: 16_300 } });
});

describe('a foreign holding’s cost in the tax report', () => {
  it('is the base amount each buy pinned on its own day, shared out after a sell', async () => {
    const costs = await baseCosts(database, ws, '2026-12-31');
    expect(Object.values(costs.buyBaseMinor).sort((a, b) => a - b)).toEqual([17_232_635, 28_835_000]);
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const aapl = inputs.holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.byYear).toEqual({
      '2025': { unitsMicro: 7_333_333, costMinor: 21_145_666 },
      '2026': { unitsMicro: 3_666_667, costMinor: 12_637_266 },
    });
    expect(aapl.name).toBe('Saham AAPL — Interactive Brokers');
    expect(aapl.purchases).toEqual([
      { occurredOn: '2025-03-08', nativeMinor: 182_500, baseMinor: 28_835_000 },
      { occurredOn: '2026-01-21', nativeMinor: 107_035, baseMinor: 17_232_635 },
    ]);
  });

  it('reads a year before the second buy on its own', async () => {
    const aapl = (await coretaxInputsFor(database, ws, 2025)).holdings.find((row) => row.accountId === aaplId)!;
    expect(aapl.byYear).toEqual({ '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } });
  });

  it('leaves a base-currency holding with no security exactly as it was', async () => {
    const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: '2026-02-01', unitsMicro: shares(10), grossMinor: 18_600_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
    const row = (await coretaxInputsFor(database, ws, 2026)).holdings.find((h) => h.accountId === gold.id)!;
    expect(row).toMatchObject({ name: 'Antam gold bars', byYear: { '2026': { unitsMicro: 10_000_000, costMinor: 18_600_000 } } });
    expect(row.purchases).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`byYear` holds cents, 146_000 / 85_628 shaped figures).

- [ ] **Step 3: Implement**

```ts
// packages/db/src/repos/base-costs.ts
import { type Position, positionAfter, positionInBase } from '@expanses/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries } from '../schema';
import { listTrades, type TradeRow } from './trades';

export interface BaseCosts {
  /** Per holding, cost in the base currency: each buy at its own day's rate (spec §4.2). */
  positions: Record<string, Position>;
  /** Per buy, what the ledger pinned on the holding's line, in base. */
  buyBaseMinor: Record<string, number>;
}

export async function baseCosts(database: Database, ws: WorkspaceContext, upTo?: string): Promise<BaseCosts> {
  const trades = await listTrades(database, ws);
  const rows = await database.db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.workspaceId, ws.workspaceId));
  const currencyOf = new Map(rows.map((row) => [row.id, row.currency ?? ws.baseCurrency]));
  const foreign = (trade: TradeRow) => currencyOf.get(trade.accountId) !== ws.baseCurrency;

  const buyBaseMinor: Record<string, number> = {};
  const foreignBuys = trades.filter((trade) => trade.kind === 'buy' && trade.transactionId && foreign(trade));
  if (foreignBuys.length > 0) {
    const lines = await database.db
      .select({ transactionId: entries.transactionId, accountId: entries.accountId, amountBaseMinor: entries.amountBaseMinor })
      .from(entries)
      .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, foreignBuys.map((trade) => trade.transactionId!))));
    for (const trade of foreignBuys) {
      buyBaseMinor[trade.id] = lines
        .filter((line) => line.transactionId === trade.transactionId && line.accountId === trade.accountId)
        .reduce((sum, line) => sum + line.amountBaseMinor, 0);
    }
  }
  for (const trade of trades) if (trade.kind === 'buy' && !foreign(trade)) buyBaseMinor[trade.id] = trade.grossMinor + trade.feeMinor + trade.taxMinor;

  const byAccount = new Map<string, TradeRow[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  const positions: Record<string, Position> = {};
  for (const [accountId, list] of byAccount) {
    positions[accountId] = currencyOf.get(accountId) === ws.baseCurrency ? positionAfter(list, upTo) : positionInBase(list, buyBaseMinor, upTo);
  }
  return { positions, buyBaseMinor };
}
```

In `tax-inputs.ts`: import `taxHoldingName` from core, `baseCosts` from `./base-costs`, `listHoldingLinks`, `listSecurities` from `./securities`, `listTrades` from `./trades`. After `accountRows` is read:

```ts
  const costs = await baseCosts(database, ws, onDate);
  const linkOf = new Map((await listHoldingLinks(database, ws)).map((link) => [link.accountId, link]));
  const securityOf = new Map((await listSecurities(database, ws)).map((security) => [security.id, security]));
  const nameOf = new Map(accountRows.map((account) => [account.id, account.name]));
  const trades = await listTrades(database, ws);
```

and replace the `inputs.holdings.push(…)` in the `market` branch with:

```ts
      const foreign = value.currency !== ws.baseCurrency;
      const link = linkOf.get(value.accountId);
      const security = link?.securityId ? (securityOf.get(link.securityId) ?? null) : null;
      const brokerName = link?.brokerAccountId ? (nameOf.get(link.brokerAccountId) ?? null) : null;
      inputs.holdings.push({
        accountId: value.accountId,
        name: taxHoldingName(security, brokerName, value.name),
        code: code ?? '0399',
        currency: value.currency,
        priceMicro,
        // Harga perolehan is historical rupiah (Pasal 10): a foreign holding's buys at their own days' rates, never today's.
        byYear: foreign ? (costs.positions[value.accountId]?.byYear ?? {}) : position.byYear,
        fields,
        ...(foreign
          ? {
              purchases: trades
                .filter((trade) => trade.accountId === value.accountId && trade.kind === 'buy' && trade.occurredOn <= onDate)
                .map((trade) => ({ occurredOn: trade.occurredOn, nativeMinor: trade.grossMinor + trade.feeMinor + trade.taxMinor, baseMinor: costs.buyBaseMinor[trade.id] ?? 0 })),
            }
          : {}),
      });
```

Export `baseCosts` / `BaseCosts` from `index.ts`.

- [ ] **Step 4: Run** the new file with `test/tax-inputs.test.ts test/tax-reports.test.ts test/tax-freeze.test.ts` → PASS; root gate.
- [ ] **Step 5: Commit** `fix(tax-report): a foreign holding's cost is the rupiah it cost on the day, and the row names the broker`

---

## Step 4 — Trades that cross a currency

### Task 8: `tradeMoneyForSave`, and the two existing trade forms

**Files:**
- Create: `apps/web/src/features/networth/trade-money.ts`, `apps/web/src/features/networth/trade-money.test.ts`, `apps/web/e2e/foreign-trades.spec.ts`
- Modify: `apps/web/src/features/networth/TradeForm.tsx`, `apps/web/src/features/transactions/buy-in-form.ts`, `apps/web/src/features/transactions/TransactionCard.tsx`

**Interfaces:**
- Consumes: `tradeRateNeeds`, `rateFromAmounts`, `tradeCashMinor`, `parseMajor`, `parseRate`, `convertMinor`, `isoDate` (core); `upsertRate`, `RecordTradeInput`, `Database` (db); `checkManualRate` (`apps/web/src/lib/rates.ts`); `useResolveRates`, `useStoredRates` (`lib/queries.ts`).
- Produces: `tradeMoneyForSave(p: { database: Database; baseCurrency: string; input: RecordTradeInput; holdingCurrency: string; cashCurrency: string; charged: string; needsRate: string | null; manualRate: string; resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number>; missing: string[] }>; onMissing: (currency: string) => void; where: string }): Promise<{ cashMinor?: number; ratesToBase: Record<string, number> }>`; `baseCostPreview(p: { amountMinor: number; holdingCurrency: string; cashCurrency: string; baseCurrency: string; charged: string; storedRates: Readonly<Record<string, number>> }): { rate: number | null; baseMinor: number | null }`; `PurchaseDraft.charged: string`.

- [ ] **Step 1: Failing unit tests**

```ts
// apps/web/src/features/networth/trade-money.test.ts
import { convertMinor } from '@expanses/core';
import type { Database, RecordTradeInput } from '@expanses/db';
import { describe, expect, it, vi } from 'vitest';
import { baseCostPreview, tradeMoneyForSave } from './trade-money';

const buy = (grossMinor: number, extra: Partial<RecordTradeInput> = {}): RecordTradeInput => ({
  accountId: 'aapl', kind: 'buy', occurredOn: '2026-03-08', unitsMicro: 10_000_000, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: 'bca', ...extra,
});
const common = { database: {} as Database, baseCurrency: 'IDR', needsRate: null, manualRate: '', where: 'Rate that day' };

describe('tradeMoneyForSave', () => {
  it('reads Charged in with parseMajor and works the rate out, never asking for a day rate', async () => {
    const resolveRates = vi.fn();
    const money = await tradeMoneyForSave({ ...common, input: buy(123_457), holdingCurrency: 'USD', cashCurrency: 'IDR', charged: '20.000.001', resolveRates, onMissing: vi.fn() });
    expect(money.cashMinor).toBe(20_000_001);
    expect(convertMinor(123_457, 'USD', 'IDR', money.ratesToBase.USD!)).toBe(20_000_001);
    expect(resolveRates).not.toHaveBeenCalled();
  });

  it('works a sell’s rate out from the net proceeds', async () => {
    const sell = buy(90_000, { kind: 'sell', feeMinor: 500, unitsMicro: 4_000_000 });
    const money = await tradeMoneyForSave({ ...common, input: sell, holdingCurrency: 'USD', cashCurrency: 'IDR', charged: '1.458.850', resolveRates: vi.fn(), onMissing: vi.fn() });
    expect(convertMinor(89_500, 'USD', 'IDR', money.ratesToBase.USD!)).toBe(1_458_850);
  });

  it('asks for Charged in when the currencies differ and it is empty', async () => {
    await expect(tradeMoneyForSave({ ...common, input: buy(123_457), holdingCurrency: 'USD', cashCurrency: 'IDR', charged: ' ', resolveRates: vi.fn(), onMissing: vi.fn() })).rejects.toThrow(/IDR/);
  });

  it('takes the day’s rate for a foreign holding paid in its own currency', async () => {
    const resolveRates = vi.fn().mockResolvedValue({ rates: { USD: 16_250 }, missing: [] });
    const money = await tradeMoneyForSave({ ...common, input: buy(182_500, { cashAccountId: 'ibkr' }), holdingCurrency: 'USD', cashCurrency: 'USD', charged: '', resolveRates, onMissing: vi.fn() });
    expect(resolveRates).toHaveBeenCalledWith(['USD'], '2026-03-08');
    expect(money).toEqual({ ratesToBase: { USD: 16_250 } });
  });

  it('says which rate is missing and where to type it', async () => {
    const onMissing = vi.fn();
    const resolveRates = vi.fn().mockResolvedValue({ rates: {}, missing: ['USD'] });
    await expect(tradeMoneyForSave({ ...common, input: buy(182_500), holdingCurrency: 'USD', cashCurrency: 'USD', charged: '', resolveRates, onMissing })).rejects.toThrow(/Rate that day/);
    expect(onMissing).toHaveBeenCalledWith('USD');
  });

  it('needs nothing when all of it is base, and nothing for a unit change', async () => {
    const resolveRates = vi.fn();
    expect(await tradeMoneyForSave({ ...common, input: buy(8_750_000), holdingCurrency: 'IDR', cashCurrency: 'IDR', charged: '', resolveRates, onMissing: vi.fn() })).toEqual({ ratesToBase: {} });
    expect(await tradeMoneyForSave({ ...common, input: buy(0, { kind: 'unit_change' }), holdingCurrency: 'USD', cashCurrency: 'IDR', charged: '', resolveRates, onMissing: vi.fn() })).toEqual({ ratesToBase: {} });
    expect(resolveRates).not.toHaveBeenCalled();
  });
});

describe('baseCostPreview', () => {
  const p = { holdingCurrency: 'USD', baseCurrency: 'IDR', storedRates: { USD: 16_250 } };
  it('is what left the account when paid in base', () => {
    expect(baseCostPreview({ ...p, amountMinor: 182_500, cashCurrency: 'IDR', charged: '28.835.000' })).toEqual({ rate: 15_800, baseMinor: 28_835_000 });
  });
  it('converts at the stored day rate when paid in the holding’s currency', () => {
    expect(baseCostPreview({ ...p, amountMinor: 182_500, cashCurrency: 'USD', charged: '' })).toEqual({ rate: 16_250, baseMinor: 29_656_250 });
  });
  it('is nothing rather than a guess when it cannot be known', () => {
    expect(baseCostPreview({ ...p, storedRates: {}, amountMinor: 182_500, cashCurrency: 'USD', charged: '' })).toEqual({ rate: null, baseMinor: null });
    expect(baseCostPreview({ ...p, amountMinor: 182_500, cashCurrency: 'IDR', charged: 'abc' })).toEqual({ rate: null, baseMinor: null });
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// apps/web/src/features/networth/trade-money.ts
import { convertMinor, isoDate, parseMajor, parseRate, rateFromAmounts, tradeCashMinor, tradeRateNeeds } from '@expanses/core';
import { type Database, type RecordTradeInput, upsertRate } from '@expanses/db';
import { checkManualRate } from '../../lib/rates';

/**
 * The rates and the charged amount a trade posts with (spec §5.2) — the one place all three trade forms get them.
 * One side in base: the rate is the ratio of the two amounts, used for this trade only. Otherwise: the day's rate,
 * and a rate typed under `where` when the day has none, checked and stored exactly as the Add Transaction rate row.
 */
export async function tradeMoneyForSave(p: {
  database: Database;
  baseCurrency: string;
  input: RecordTradeInput;
  holdingCurrency: string;
  /** The paying or receiving account's currency; the holding's own for an opening position. */
  cashCurrency: string;
  charged: string;
  needsRate: string | null;
  manualRate: string;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number>; missing: string[] }>;
  onMissing: (currency: string) => void;
  where: string;
}): Promise<{ cashMinor?: number; ratesToBase: Record<string, number> }> {
  if (p.input.kind === 'unit_change') return { ratesToBase: {} };
  const needs = tradeRateNeeds(p.holdingCurrency, p.cashCurrency, p.baseCurrency);
  const moved = tradeCashMinor(p.input.kind, p.input.grossMinor, p.input.feeMinor, p.input.taxMinor);
  const ratesToBase: Record<string, number> = {};
  let cashMinor: number | undefined;

  if (needs.charged) {
    if (p.charged.trim() === '') throw new Error(`Enter the amount in ${p.cashCurrency} under “Charged in ${p.cashCurrency}”`);
    try {
      cashMinor = parseMajor(p.charged, p.cashCurrency);
    } catch {
      throw new Error(`Charged in ${p.cashCurrency} must be a number`);
    }
    if (!(cashMinor > 0)) throw new Error(`Charged in ${p.cashCurrency} must be more than zero`);
    if (needs.derived === p.holdingCurrency) ratesToBase[p.holdingCurrency] = rateFromAmounts(moved, p.holdingCurrency, cashMinor, p.baseCurrency);
    if (needs.derived === p.cashCurrency) ratesToBase[p.cashCurrency] = rateFromAmounts(cashMinor, p.cashCurrency, moved, p.baseCurrency);
  }

  if (needs.dayRates.length > 0) {
    const rateDate = p.input.occurredOn > isoDate() ? isoDate() : p.input.occurredOn;
    if (p.needsRate && p.manualRate.trim()) {
      const rate = parseRate(p.manualRate);
      await checkManualRate(p.database, p.needsRate, p.baseCurrency, rateDate, rate);
      await upsertRate(p.database, { fromCurrency: p.needsRate, toCurrency: p.baseCurrency, onDate: rateDate, rate, source: 'manual', sourceDate: rateDate });
    }
    const resolved = await p.resolveRates(needs.dayRates, p.input.occurredOn);
    if (resolved.missing.length > 0) {
      p.onMissing(resolved.missing[0]!);
      throw new Error(`No ${resolved.missing[0]}→${p.baseCurrency} rate for ${rateDate}. Type it under “${p.where}”.`);
    }
    for (const currency of needs.dayRates) ratesToBase[currency] = resolved.rates[currency]!;
  }
  return cashMinor === undefined ? { ratesToBase } : { cashMinor, ratesToBase };
}

/** The read-only "Rate that day" and "Cost in {base}" rows, from what is typed and what is stored. Null when unknown. */
export function baseCostPreview(p: {
  amountMinor: number;
  holdingCurrency: string;
  cashCurrency: string;
  baseCurrency: string;
  charged: string;
  storedRates: Readonly<Record<string, number>>;
}): { rate: number | null; baseMinor: number | null } {
  if (p.holdingCurrency === p.baseCurrency) return { rate: null, baseMinor: p.amountMinor };
  if (!(p.amountMinor > 0)) return { rate: null, baseMinor: null };
  const needs = tradeRateNeeds(p.holdingCurrency, p.cashCurrency, p.baseCurrency);
  if (needs.derived === p.holdingCurrency) {
    try {
      const cashMinor = parseMajor(p.charged, p.cashCurrency);
      if (!(cashMinor > 0)) return { rate: null, baseMinor: null };
      return { rate: rateFromAmounts(p.amountMinor, p.holdingCurrency, cashMinor, p.baseCurrency), baseMinor: cashMinor };
    } catch {
      return { rate: null, baseMinor: null };
    }
  }
  const rate = p.storedRates[p.holdingCurrency];
  if (rate === undefined) return { rate: null, baseMinor: null };
  return { rate, baseMinor: convertMinor(p.amountMinor, p.holdingCurrency, p.baseCurrency, rate) };
}
```

**`TradeForm.tsx`** — add state and rows, and route the save through it:

```tsx
  const resolveRates = useResolveRates();
  const [charged, setCharged] = useState('');
  const [manualRate, setManualRate] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const cashAccount = cashAccounts.find((account) => account.id === draft.cashAccountId);
  // An opening position pays from Opening Balances, which moves in the holding's own currency.
  const cashCurrency = cashAccount ? (cashAccount.currency ?? ws.baseCurrency) : currency;
  const needs = tradeRateNeeds(currency, cashCurrency, ws.baseCurrency);
```

In `submit`, replace the two lines building `input` and calling the repo with:

```tsx
      const typed = draftToInput(draft, currency, today);
      const money = await tradeMoneyForSave({
        database, baseCurrency: ws.baseCurrency, input: typed, holdingCurrency: currency, cashCurrency,
        charged, needsRate, manualRate, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
      });
      const input = { ...typed, ...money, templateId: templateId ?? null };
      const result = editing ? await replaceTrade(database, ws, editing.id, input) : await recordTrade(database, ws, input);
```

and after the Tax withheld field, inside the grid:

```tsx
        {needs.charged && draft.kind !== 'unit_change' && (
          <Field label={`Charged in ${cashCurrency}`} hint={draft.kind === 'buy' ? `What left ${cashAccount?.name ?? 'the account'}, in ${cashCurrency}.` : `What reached ${cashAccount?.name ?? 'the account'}, in ${cashCurrency}.`}>
            <Input value={charged} onChange={(e) => setCharged(e.target.value)} inputMode="decimal" />
          </Field>
        )}
        {needsRate && (
          <Field label="Rate that day" hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? `${ws.baseCurrency} per 1 ${needsRate}`}>
            <Input value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" />
          </Field>
        )}
```

(imports: `tradeRateNeeds` from core, `useResolveRates` from `../../lib/queries`, `ratePreview` from `../../lib/rates`, `tradeMoneyForSave` from `./trade-money`.) Reset `charged` with the draft after a save.

**`buy-in-form.ts`** — `PurchaseDraft` gains `/** What left or reached the paying account in its own currency, when it differs from the holding's. */ charged: string;` and `emptyPurchaseDraft` sets `charged: ''`.

**`TransactionCard.tsx`** —
1. Replace `const rateDate = draft.occurredOn > isoDate() ? isoDate() : draft.occurredOn;` with
   ```tsx
   const onDate = draft.mode === 'trade' ? draft.purchase.occurredOn : draft.occurredOn;
   const rateDate = onDate > isoDate() ? isoDate() : onDate;
   ```
2. Beside `purchaseCurrency`:
   ```tsx
   const purchaseCashCurrency = purchaseMoney ? (purchaseMoney.currency ?? ws.baseCurrency) : purchaseCurrency;
   const purchaseNeeds = tradeRateNeeds(purchaseCurrency, purchaseCashCurrency, ws.baseCurrency);
   ```
3. Replace `await recordTrade(database, ws, post.input);` with
   ```tsx
        const money = await tradeMoneyForSave({
          database, baseCurrency: ws.baseCurrency, input: post.input, holdingCurrency: purchaseCurrency, cashCurrency: purchaseCashCurrency,
          charged: draft.purchase.charged, needsRate, manualRate: draft.manualRate, resolveRates, onMissing: setNeedsRate, where: 'Add more details',
        });
        await recordTrade(database, ws, { ...post.input, ...money });
   ```
4. Under the Paid with / Proceeds into `SelectRow`:
   ```tsx
            {purchaseNeeds.charged && (
              <InputRow
                label={`Charged in ${purchaseCashCurrency}`}
                value={purchase.charged}
                inputMode="decimal"
                onChange={(e) => setPurchase({ charged: e.target.value })}
              />
            )}
   ```
   The rate row is the existing Add more details `rate` row, which `needsRate` already draws.

- [ ] **Step 4: E2E for the two existing forms** (combinations 7 and 8, by keystroke)

```ts
// apps/web/e2e/foreign-trades.spec.ts
import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

async function addAccount(page: Page, name: string, balance: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** A USD stock owned before the app, through the inline Add asset form that exists today. */
async function addUsdStock(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).fill('AAPL');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Opening rate').fill('15800');
  await page.getByLabel('Bought on').fill('2025-03-08');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (USD)').fill('1825');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /AAPL/ })).toBeVisible();
}

test('Buy & sell sells a USD holding into a rupiah account at exactly the rupiah that arrived', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', '1000000');
  await addUsdStock(page);
  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Holding').selectOption({ label: 'AAPL' });
  await page.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Units, shares or grams').pressSequentially('3');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('642.90');
  await page.getByLabel('Charged in IDR').pressSequentially('10.447.125');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('trade-notice')).toContainText('Recorded');
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true }).locator('..')).toContainText('11.447.125');
});

test('the Buy / sell tab asks what the rupiah account was charged for a USD buy', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', '50000000');
  await addUsdStock(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy / sell' }).click();
  await form.getByLabel('What you bought or sold').selectOption({ label: 'Investments › AAPL' });
  await form.getByLabel(/What it cost, before fees \(USD\)/).pressSequentially('214.30');
  await form.getByLabel('Shares').pressSequentially('1');
  await form.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan' });
  await form.getByLabel('Charged in IDR').pressSequentially('3.482.375');
  await form.getByRole('button', { name: 'Save' }).click();
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true }).locator('..')).toContainText('46.517.625');
});
```

Labels in this spec are the forms' real labels as of 2026-09-21; if one differs, read the component and use its label — never loosen the balance assertion.

- [ ] **Step 5: Run** unit tests, then `npx playwright test foreign-trades.spec.ts buy-flow.spec.ts add-transaction.spec.ts --workers=2`; root gate.
- [ ] **Step 6: Commit** `fix(trades): a trade in another currency asks what was charged, and posts with its rates`

---

## Step 5 — The paid seam, the lists in the app, and the size gate

### Task 9: Entitlements, list queries, `check-bundle.mjs`

**Files:**
- Create: `apps/web/src/lib/entitlements.ts`, `apps/web/src/lib/entitlements.test.ts`, `apps/web/src/features/investments/queries.ts`, `apps/web/scripts/check-bundle.mjs`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `loadSecurityList`, `SecurityList` (catalog); `listSecurities`, `listHoldingLinks`, `listSecurityPrices`, `baseCosts` (db); `useResolveRates`.
- Produces: `type Entitlement = 'foreign_securities'`; `ENTITLEMENTS_KEY`; `grantedEntitlements(storage?)`; `hasEntitlement(e, storage?)`; `useEntitlement(e)`; hooks `useSecurities`, `useHoldingLinks`, `useSecurityPrices(securityId)`, `useBaseCosts()`, `useSecurityList(list, enabled)`, `useTodayRates(currencies)`.

- [ ] **Step 1: Failing test**

```ts
// apps/web/src/lib/entitlements.test.ts
import { describe, expect, it } from 'vitest';
import { hasEntitlement } from './entitlements';

const storage = (value: string | null) => ({ getItem: () => value });

describe('hasEntitlement', () => {
  it('is granted only when the list names it', () => {
    expect(hasEntitlement('foreign_securities', storage('["foreign_securities"]'))).toBe(true);
    expect(hasEntitlement('foreign_securities', storage('[]'))).toBe(false);
    expect(hasEntitlement('foreign_securities', storage(null))).toBe(false);
  });
  it('is not granted by anything it cannot read', () => {
    expect(hasEntitlement('foreign_securities', storage('{not json'))).toBe(false);
    expect(hasEntitlement('foreign_securities', storage('"foreign_securities"'))).toBe(false);
    expect(hasEntitlement('foreign_securities', null)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// apps/web/src/lib/entitlements.ts
import { useMemo } from 'react';

/** What the paid tier unlocks. Never the ability to record something owned — only the convenience (spec §6.5). */
export type Entitlement = 'foreign_securities';
const KNOWN: readonly Entitlement[] = ['foreign_securities'];

/**
 * The one place that says what is granted. Today its source is a device-local list, which is what the end-to-end
 * tests set; when store purchases exist, this function reads them instead and nothing else changes.
 */
export const ENTITLEMENTS_KEY = 'expanses.entitlements';

function deviceStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function grantedEntitlements(storage: Pick<Storage, 'getItem'> | null = deviceStorage()): ReadonlySet<Entitlement> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ENTITLEMENTS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? KNOWN.filter((known) => parsed.includes(known)) : []);
  } catch {
    return new Set();
  }
}

export const hasEntitlement = (entitlement: Entitlement, storage?: Pick<Storage, 'getItem'> | null): boolean =>
  grantedEntitlements(storage === undefined ? deviceStorage() : storage).has(entitlement);

export function useEntitlement(entitlement: Entitlement): boolean {
  return useMemo(() => hasEntitlement(entitlement), [entitlement]);
}
```

```ts
// apps/web/src/features/investments/queries.ts
import { isoDate } from '@expanses/core';
import { loadSecurityList, type SecurityList } from '@expanses/catalog';
import { baseCosts, listHoldingLinks, listSecurities, listSecurityPrices } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useResolveRates } from '../../lib/queries';

export function useSecurities() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['securities', ws.workspaceId], queryFn: () => listSecurities(database, ws) });
}

export function useHoldingLinks() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['holding-links', ws.workspaceId], queryFn: () => listHoldingLinks(database, ws) });
}

export function useSecurityPrices(securityId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['security-prices', ws.workspaceId, securityId], queryFn: () => listSecurityPrices(database, ws, securityId) });
}

export function useBaseCosts() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['base-costs', ws.workspaceId], queryFn: () => baseCosts(database, ws) });
}

/** A bundled list, read once per session and only when asked for — the US one only for an entitled owner. */
export function useSecurityList(list: SecurityList, enabled: boolean) {
  return useQuery({ queryKey: ['security-list', list], queryFn: () => loadSecurityList(list), enabled, staleTime: Infinity, gcTime: Infinity, retry: false });
}

/** Today's rate for each currency the portfolio holds, as the net worth pages resolve them. */
export function useTodayRates(currencies: string[]) {
  const { ws } = useApp();
  const resolveRates = useResolveRates();
  const today = isoDate();
  return useQuery({ queryKey: ['today-rates', ws.workspaceId, today, [...currencies].sort().join(',')], queryFn: () => resolveRates(currencies, today) });
}
```

```js
// apps/web/scripts/check-bundle.mjs — run by `npm run build`. The ticker lists must never reach the entry chunk.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('../dist/assets/', import.meta.url);
const js = readdirSync(dir).filter((file) => file.endsWith('.js'));
const read = (file) => readFileSync(new URL(file, dir));
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} KB`;
// Sentinels: a name each list carries and no line of the app's own code may contain.
const LISTS = [
  { name: 'IDX list', sentinel: 'Bank Central Asia', budget: 25_000 },
  { name: 'US list', sentinel: 'Apple Inc', budget: 150_000 },
];
const problems = [];
const entry = js.filter((file) => file.startsWith('index-'));
if (entry.length !== 1) problems.push(`expected one entry chunk, found ${entry.join(', ') || 'none'}`);
for (const file of entry) console.log(`entry ${file}: ${kb(read(file).length)} (${kb(gzipSync(read(file)).length)} gzipped)`);
for (const list of LISTS) {
  const holders = js.filter((file) => read(file).includes(list.sentinel));
  if (holders.length !== 1) problems.push(`${list.name}: expected in exactly one chunk of its own, found in ${holders.join(', ') || 'none'}`);
  for (const file of holders) {
    if (entry.includes(file)) problems.push(`${list.name} is inside the entry chunk ${file}`);
    const size = gzipSync(read(file)).length;
    console.log(`${list.name} ${file}: ${kb(size)} gzipped (budget ${kb(list.budget)})`);
    if (size > list.budget) problems.push(`${list.name} is ${kb(size)} gzipped, over its ${kb(list.budget)} budget`);
  }
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
```

`apps/web/package.json`: `"build": "vite build && node scripts/check-bundle.mjs"`. Until Task 12 imports `loadSecurityList` from a screen, the lists are not in the build at all, so the script would fail with "found in none": land this task's `package.json` change **in Task 12's commit**, and in this task only run the script by hand after a build to see it report.

- [ ] **Step 3: Run** `cd apps/web && npx vitest run src/lib/entitlements.test.ts` → PASS; root gate.
- [ ] **Step 4: Commit** `feat(web): the paid seam, the list and portfolio queries, and the bundle check`

---

## Step 6 — The screens

### Task 10: The portfolio view and the Investments page

**Files:**
- Create: `apps/web/src/features/investments/portfolio-view.ts`, `portfolio-view.test.ts`, `InvestmentsPage.tsx`
- Modify: `apps/web/src/features/investments/queries.ts` (add `usePortfolio`), `apps/web/src/app/router.tsx`, `apps/web/src/features/networth/TradesPage.tsx`, `apps/web/src/features/networth/AssetsPage.tsx`

**Interfaces:**
- Consumes: `portfolioSummary`, `percentShares`, `gainBps`, `convertMinor`, `unitsValueMinor`, `perUnitInBase`, `formatMinor`, `currencyInfo` (core); `AssetValueRow`, `AssetProfileRow`, `AccountRow`, `HoldingLinkRow`, `SecurityRow` (db).
- Produces: `NO_BROKER = 'none'`; `interface HoldingLine`; `interface StockRow`; `interface BrokerRow`; `interface PortfolioView { summary; stocks; brokers }`; `portfolioView(p: PortfolioInputs): PortfolioView`; `priceChangeLines(holdings, lastPriceMicro: number | null, newPriceMicro: number)`; `rateLabel(rate, currency, base): string`; `usePortfolio()`.

- [ ] **Step 1: Failing test** (the mockup's portfolio)

```ts
// apps/web/src/features/investments/portfolio-view.test.ts
import type { AccountRow, AssetProfileRow, AssetValueRow, HoldingLinkRow, SecurityRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { NO_BROKER, portfolioView, priceChangeLines, rateLabel } from './portfolio-view';

const value = (accountId: string, currency: string, units: number, valueMinor: number, costMinor: number): AssetValueRow =>
  ({ accountId, name: accountId, currency, planGroup: 'invest', mode: 'market', unitsMicro: units * 1_000_000, stale: false, valueMinor, costMinor, source: 'price', asOf: '2026-09-19' }) as AssetValueRow;
const profile = (accountId: string, assetKind: AssetProfileRow['assetKind']) => ({ accountId, assetKind }) as AssetProfileRow;
const account = (id: string, name: string, currency: string) => ({ id, name, currency, archivedAt: null }) as AccountRow;
const security = (id: string, ticker: string, currency: string, lotSize: number | null): SecurityRow => ({ id, ticker, name: ticker, market: currency === 'IDR' ? 'IDX' : 'NASDAQ', currency, lotSize, kind: 'share', source: 'catalogue' });
const link = (accountId: string, securityId: string | null, brokerAccountId: string | null): HoldingLinkRow => ({ accountId, securityId, brokerAccountId });
const position = (costMinor: number) => ({ unitsMicro: 0, costMinor, realizedMinor: 0, incomeMinor: 0, byYear: {} });

const inputs = {
  values: [
    value('aapl-ib', 'USD', 10, 214_300, 182_500), value('voo-ib', 'USD', 3, 156_480, 149_460),
    value('bbca-sb', 'IDR', 1_000, 9_775_000, 8_750_000), value('bbca-ms', 'IDR', 500, 4_887_500, 4_700_000),
    value('tlkm-sb', 'IDR', 2_000, 5_740_000, 6_200_000), value('bbri-ms', 'IDR', 1_200, 5_028_000, 5_460_000),
    value('gold', 'IDR', 10, 19_000_000, 18_600_000), value('fund', 'IDR', 100, 1_000_000, 900_000), value('sold', 'IDR', 0, 0, 0),
  ],
  profiles: [profile('gold', 'gold'), profile('fund', 'fund'), profile('sold', 'stock')],
  links: [
    link('aapl-ib', 'aapl', 'ib'), link('voo-ib', 'voo', 'ib'), link('bbca-sb', 'bbca', 'sb'),
    link('bbca-ms', 'bbca', 'ms'), link('tlkm-sb', 'tlkm', 'sb'), link('bbri-ms', 'bbri', 'ms'),
  ],
  securities: [security('aapl', 'AAPL', 'USD', null), security('voo', 'VOO', 'USD', null), security('bbca', 'BBCA', 'IDR', 100), security('tlkm', 'TLKM', 'IDR', 100), security('bbri', 'BBRI', 'IDR', 100)],
  accounts: [account('ib', 'Interactive Brokers', 'USD'), account('sb', 'Stockbit', 'IDR'), account('ms', 'Mandiri Sekuritas', 'IDR')],
  baseCosts: { 'aapl-ib': position(28_835_000), 'voo-ib': position(24_063_060) },
  baseCurrency: 'IDR',
  ratesToBase: { USD: 16_250 },
};

describe('portfolioView', () => {
  it('reads by stock, largest first, a stock at two brokers once', () => {
    const view = portfolioView({ ...inputs, values: inputs.values.filter((v) => v.accountId !== 'fund') });
    expect(view.stocks.map((s) => s.title)).toEqual(['AAPL', 'VOO', 'BBCA', 'TLKM', 'BBRI']);
    const bbca = view.stocks.find((s) => s.title === 'BBCA')!;
    expect(bbca).toMatchObject({ unitsMicro: 1_500_000_000, valueMinor: 14_662_500, costMinor: 13_450_000, gainBps: 901, lotSize: 100 });
    expect(bbca.holdings.map((h) => h.brokerName)).toEqual(['Stockbit', 'Mandiri Sekuritas']);
    expect(view.stocks.find((s) => s.title === 'AAPL')).toMatchObject({ currency: 'USD', valueMinor: 214_300, valueBaseMinor: 34_823_750, costBaseMinor: 28_835_000 });
  });

  it('sums the whole portfolio in base and names the exchange-rate part', () => {
    const view = portfolioView({ ...inputs, values: inputs.values.filter((v) => v.accountId !== 'fund') });
    expect(view.summary).toMatchObject({ valueBaseMinor: 85_682_250, costBaseMinor: 78_008_060, gainBps: 984, currencyMoveMinor: 1_199_070, converted: true });
  });

  it('lists each broker with its own-currency total and a share that adds to 100', () => {
    const view = portfolioView({ ...inputs, values: inputs.values.filter((v) => v.accountId !== 'fund') });
    expect(view.brokers.map((b) => [b.name, b.leadCurrency, b.leadMinor, b.converted, b.sharePercent])).toEqual([
      ['Interactive Brokers', 'USD', 370_780, false, 71],
      ['Stockbit', 'IDR', 15_515_000, false, 18],
      ['Mandiri Sekuritas', 'IDR', 9_915_500, false, 11],
    ]);
  });

  it('keeps an unlinked fund as its own row under No broker named, and leaves gold and sold holdings out', () => {
    const view = portfolioView(inputs);
    expect(view.stocks.find((s) => s.accountId === 'fund')).toMatchObject({ securityId: null, title: 'fund' });
    expect(view.stocks.some((s) => s.accountId === 'gold' || s.accountId === 'sold')).toBe(false);
    expect(view.brokers.find((b) => b.key === NO_BROKER)).toMatchObject({ name: 'No broker named', leadMinor: 1_000_000 });
  });

  it('leads a broker holding two currencies in base, converted', () => {
    const view = portfolioView({ ...inputs, links: inputs.links.map((l) => (l.accountId === 'aapl-ib' ? { ...l, brokerAccountId: 'sb' } : l)) });
    expect(view.brokers.find((b) => b.name === 'Stockbit')).toMatchObject({ leadCurrency: 'IDR', leadMinor: 34_823_750 + 15_515_000, converted: true });
  });
});

describe('priceChangeLines', () => {
  it('is each holding’s value at the new price and its move from the last', () => {
    const view = portfolioView(inputs);
    const bbca = view.stocks.find((s) => s.title === 'BBCA')!;
    expect(priceChangeLines(bbca.holdings, 9_550_000_000, 9_775_000_000).map((l) => [l.valueMinor, l.changeMinor])).toEqual([[9_775_000, 225_000], [4_887_500, 112_500]]);
    expect(priceChangeLines(bbca.holdings, null, 9_775_000_000)[0]!.changeMinor).toBeNull();
  });
});

describe('rateLabel', () => {
  it('is one unit of the currency in base', () => {
    expect(rateLabel(16_250, 'USD', 'IDR')).toBe('Rp 16.250 / $'.replace(' ', ' '));
  });
});
```

(`formatMinor` puts a no-break space after `Rp`; if its output differs, assert `\`${formatMinor(16_250, 'IDR')} / $\`` — the figure is what matters.)

- [ ] **Step 2: Implement**

```ts
// apps/web/src/features/investments/portfolio-view.ts
import {
  type AssetKind, convertMinor, currencyInfo, formatMinor, gainBps, percentShares, perUnitInBase, portfolioSummary, type PortfolioSummary,
  type Position, unitsValueMinor,
} from '@expanses/core';
import type { AccountRow, AssetProfileRow, AssetValueRow, HoldingLinkRow, SecurityRow } from '@expanses/db';

export const NO_BROKER = 'none';
/** Unlinked holdings that belong on Investments. Gold and bonds stay on the Assets page (spec §7.1). */
const LISTED_KINDS: readonly AssetKind[] = ['stock', 'fund'];

export interface HoldingLine {
  accountId: string;
  name: string;
  brokerAccountId: string | null;
  brokerName: string;
  currency: string;
  unitsMicro: number;
  valueMinor: number;
  costMinor: number;
  costBaseMinor: number;
}

export interface StockRow {
  key: string;
  securityId: string | null;
  /** Set for an unlinked holding: its row opens the asset page. */
  accountId: string | null;
  title: string;
  name: string;
  market: string | null;
  currency: string;
  lotSize: number | null;
  unitsMicro: number;
  valueMinor: number;
  costMinor: number;
  costBaseMinor: number;
  /** Null when there is no rate today for its currency. */
  valueBaseMinor: number | null;
  gainBps: number | null;
  holdings: HoldingLine[];
}

export interface BrokerRow {
  key: string;
  accountId: string | null;
  name: string;
  holdings: HoldingLine[];
  /** Its own currency when every holding there shares one, else base. */
  leadCurrency: string;
  leadMinor: number;
  converted: boolean;
  valueBaseMinor: number | null;
  costBaseMinor: number;
  sharePercent: number | null;
}

export interface PortfolioView {
  summary: PortfolioSummary;
  stocks: StockRow[];
  brokers: BrokerRow[];
}

export interface PortfolioInputs {
  values: readonly AssetValueRow[];
  profiles: readonly AssetProfileRow[];
  links: readonly HoldingLinkRow[];
  securities: readonly SecurityRow[];
  accounts: readonly AccountRow[];
  baseCosts: Readonly<Record<string, Position>>;
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}

const byBaseValue = <T extends { valueBaseMinor: number | null }>(a: T, b: T) => (b.valueBaseMinor ?? -1) - (a.valueBaseMinor ?? -1);

export function portfolioView(p: PortfolioInputs): PortfolioView {
  const linkOf = new Map(p.links.map((l) => [l.accountId, l]));
  const securityOf = new Map(p.securities.map((s) => [s.id, s]));
  const kindOf = new Map(p.profiles.map((profile) => [profile.accountId, profile.assetKind]));
  const accountOf = new Map(p.accounts.map((a) => [a.id, a]));
  const toBase = (minor: number, currency: string): number | null => {
    if (currency === p.baseCurrency) return minor;
    const rate = p.ratesToBase[currency];
    return rate === undefined ? null : convertMinor(minor, currency, p.baseCurrency, rate);
  };

  const lines: (HoldingLine & { securityId: string | null })[] = [];
  for (const value of p.values) {
    if (value.mode !== 'market' || (value.unitsMicro ?? 0) <= 0) continue;
    const link = linkOf.get(value.accountId);
    if (!link?.securityId && !LISTED_KINDS.includes(kindOf.get(value.accountId) ?? 'other')) continue;
    const brokerAccountId = link?.brokerAccountId ?? null;
    lines.push({
      accountId: value.accountId,
      name: value.name,
      securityId: link?.securityId ?? null,
      brokerAccountId,
      brokerName: brokerAccountId ? (accountOf.get(brokerAccountId)?.name ?? 'Broker') : 'No broker named',
      currency: value.currency,
      unitsMicro: value.unitsMicro ?? 0,
      valueMinor: value.valueMinor,
      costMinor: value.costMinor,
      costBaseMinor: value.currency === p.baseCurrency ? value.costMinor : (p.baseCosts[value.accountId]?.costMinor ?? 0),
    });
  }

  const stocksByKey = new Map<string, StockRow>();
  for (const line of lines) {
    const key = line.securityId ?? `account:${line.accountId}`;
    const security = line.securityId ? securityOf.get(line.securityId) : undefined;
    const row = stocksByKey.get(key) ?? {
      key, securityId: line.securityId, accountId: line.securityId ? null : line.accountId,
      title: security ? (security.ticker ?? security.name) : line.name, name: security?.name ?? line.name, market: security?.market || null,
      currency: line.currency, lotSize: security?.lotSize ?? null, unitsMicro: 0, valueMinor: 0, costMinor: 0, costBaseMinor: 0,
      valueBaseMinor: 0, gainBps: null, holdings: [],
    };
    row.unitsMicro += line.unitsMicro;
    row.valueMinor += line.valueMinor;
    row.costMinor += line.costMinor;
    row.costBaseMinor += line.costBaseMinor;
    row.holdings.push(line);
    stocksByKey.set(key, row);
  }
  const stocks = [...stocksByKey.values()].map((row) => ({ ...row, valueBaseMinor: toBase(row.valueMinor, row.currency), gainBps: gainBps(row.valueMinor, row.costMinor) }));
  stocks.sort((a, b) => byBaseValue(a, b) || a.title.localeCompare(b.title));

  const brokersByKey = new Map<string, HoldingLine[]>();
  for (const line of lines) {
    const key = line.brokerAccountId ?? NO_BROKER;
    brokersByKey.set(key, [...(brokersByKey.get(key) ?? []), line]);
  }
  const brokers: BrokerRow[] = [...brokersByKey].map(([key, holdings]) => {
    const currencies = new Set(holdings.map((h) => h.currency));
    const single = currencies.size === 1 ? [...currencies][0]! : null;
    const bases = holdings.map((h) => toBase(h.valueMinor, h.currency));
    const valueBaseMinor = bases.some((b) => b === null) ? null : bases.reduce<number>((sum, b) => sum + b!, 0);
    return {
      key,
      accountId: key === NO_BROKER ? null : key,
      name: holdings[0]!.brokerName,
      holdings,
      leadCurrency: single ?? p.baseCurrency,
      leadMinor: single ? holdings.reduce((sum, h) => sum + h.valueMinor, 0) : bases.reduce<number>((sum, b) => sum + (b ?? 0), 0),
      converted: single === null,
      valueBaseMinor,
      costBaseMinor: holdings.reduce((sum, h) => sum + h.costBaseMinor, 0),
      sharePercent: null,
    };
  });
  brokers.sort((a, b) => byBaseValue(a, b) || a.name.localeCompare(b.name));
  const known = brokers.filter((b) => b.valueBaseMinor !== null);
  percentShares(known.map((b) => b.valueBaseMinor!)).forEach((share, i) => {
    known[i]!.sharePercent = share;
  });

  return {
    summary: portfolioSummary(lines.map((l) => ({ currency: l.currency, valueMinor: l.valueMinor, costMinor: l.costMinor, costBaseMinor: l.costBaseMinor })), p.baseCurrency, p.ratesToBase),
    stocks,
    brokers,
  };
}

/** The price page's "This changes": each holding at the new price, and its move from the last one. */
export function priceChangeLines(holdings: readonly HoldingLine[], lastPriceMicro: number | null, newPriceMicro: number) {
  return holdings.map((holding) => {
    const valueMinor = unitsValueMinor(holding.unitsMicro, newPriceMicro);
    return { holding, valueMinor, changeMinor: lastPriceMicro === null ? null : valueMinor - unitsValueMinor(holding.unitsMicro, lastPriceMicro) };
  });
}

/** "Rp 16.250 / $" */
export const rateLabel = (rate: number, currency: string, base: string): string =>
  `${formatMinor(perUnitInBase(rate, currency, base), base)} / ${currencyInfo(currency).symbol}`;

/** "8 Mar 2025" */
export const dayLabel = (isoDay: string): string =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
```

Add to `queries.ts`:

```ts
import { useAccounts } from '../../lib/queries';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { portfolioView } from './portfolio-view';

/** Everything the Investments screens read, put together once. `view` is null until every part has loaded. */
export function usePortfolio() {
  const { ws } = useApp();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const links = useHoldingLinks();
  const securities = useSecurities();
  const accounts = useAccounts();
  const costs = useBaseCosts();
  const currencies = [...new Set((values.data ?? []).filter((v) => v.mode === 'market').map((v) => v.currency))].filter((c) => c !== ws.baseCurrency);
  const rates = useTodayRates(currencies);
  const parts = [values, profiles, links, securities, accounts, costs, rates];
  const ready = parts.every((part) => part.data !== undefined);
  const view = ready
    ? portfolioView({
        values: values.data!, profiles: profiles.data!, links: links.data!, securities: securities.data!, accounts: accounts.data!,
        baseCosts: costs.data!.positions, baseCurrency: ws.baseCurrency, ratesToBase: rates.data!.rates,
      })
    : null;
  return { view, rates: rates.data?.rates ?? {}, costs: costs.data ?? null, securities: securities.data ?? [], isPending: !ready, error: parts.find((part) => part.error)?.error ?? null };
}
```

```tsx
// apps/web/src/features/investments/InvestmentsPage.tsx
import { formatBps, formatMinor, formatUnits, lotsOf } from '@expanses/core';
import { Plus } from 'lucide-react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { NetWorthTabs } from '../networth/NetWorthTabs';
import { type BrokerRow, type StockRow } from './portfolio-view';
import { usePortfolio } from './queries';

function stockSubtitle(row: StockRow, base: string): string {
  const units =
    row.lotSize && row.lotSize > 1
      ? `${formatUnits(row.unitsMicro)} shares · ${formatUnits(Math.round(lotsOf(row.unitsMicro, row.lotSize) * 1_000_000))} lots`
      : `${formatUnits(row.unitsMicro)} shares`;
  const where = row.holdings.length > 1 ? `${row.holdings.length} brokers` : row.holdings[0]!.brokerName;
  const gain = row.gainBps === null ? null : formatBps(row.gainBps);
  const converted = row.currency !== base && row.valueBaseMinor !== null ? `≈ ${formatMinor(row.valueBaseMinor, base)}` : null;
  return [units, where, gain, converted].filter(Boolean).join(' · ');
}

function brokerSubtitle(row: BrokerRow): string {
  const count = `${row.holdings.length} ${row.holdings.length === 1 ? 'holding' : 'holdings'}`;
  return [count, row.converted ? null : row.leadCurrency, row.sharePercent === null ? null : `${row.sharePercent}%`].filter(Boolean).join(' · ');
}

export function InvestmentsPage() {
  const { ws } = useApp();
  const { view, isPending, error } = usePortfolio();
  const base = ws.baseCurrency;
  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Investments"
        back="Buy & sell"
        backTo="/net-worth/trades"
        actions={[{ key: 'add', label: 'Add a holding', glyph: <Plus size={20} aria-hidden />, to: '/net-worth/investments/new' }]}
      />
      <NetWorthTabs />
      <ErrorBox error={error} />
      {view && view.stocks.length === 0 && <Empty>No shares or funds yet. Add a holding to see it here.</Empty>}
      {view && view.stocks.length > 0 && (
        <>
          <Hero
            minor={view.summary.valueBaseMinor}
            currency={base}
            caption={
              <span data-testid="portfolio-caption">
                {view.summary.converted ? '≈ ' : ''}
                {formatMinor(view.summary.gainBaseMinor, base)}
                {view.summary.gainBps === null ? '' : ` · ${formatBps(view.summary.gainBps)} in ${base}`}
                {view.summary.converted && view.summary.currencyMoveMinor !== 0 && (
                  <span className="block">{formatMinor(view.summary.currencyMoveMinor, base)} of that is exchange-rate movement</span>
                )}
                {view.summary.missingRates.length > 0 && (
                  <span className="block text-[var(--ph-warn)]">Not counted: no rate today for {view.summary.missingRates.join(', ')}</span>
                )}
              </span>
            }
          />
          <InsetGroup>
            <ReadOnlyRow label="Put in" value={formatMinor(view.summary.costBaseMinor, base)} />
            <ReadOnlyRow label="Holdings" value={`${view.stocks.length} stocks · ${view.brokers.filter((b) => b.accountId).length} brokers`} />
          </InsetGroup>
          <InsetGroup header="By stock">
            {view.stocks.map((row) => (
              <InsetRow
                key={row.key}
                testId="stock-row"
                title={row.title}
                subtitle={stockSubtitle(row, base)}
                value={<Money minor={row.valueMinor} currency={row.currency} />}
                valueTone="ink"
                {...(row.securityId
                  ? { to: '/net-worth/investments/security/$securityId', params: { securityId: row.securityId } }
                  : { to: '/net-worth/assets/$accountId', params: { accountId: row.accountId! } })}
              />
            ))}
          </InsetGroup>
          <InsetGroup header="Where they are kept">
            {view.brokers.map((row) => (
              <InsetRow
                key={row.key}
                testId="broker-row"
                title={row.name}
                subtitle={brokerSubtitle(row)}
                value={<>{row.converted ? '≈ ' : ''}<Money minor={row.leadMinor} currency={row.leadCurrency} /></>}
                valueTone="ink"
                to={row.accountId ? '/net-worth/investments/broker/$accountId' : '/net-worth/investments/broker/none'}
                params={row.accountId ? { accountId: row.accountId } : undefined}
              />
            ))}
          </InsetGroup>
        </>
      )}
      {isPending && !error && <Empty>Loading…</Empty>}
    </div>
  );
}
```


Router: import the page and add
`createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments', component: InvestmentsPage }),`

Entry rows: in `TradesPage.tsx` directly after `<NetWorthTabs />`:
```tsx
      <InsetGroup>
        <InsetRow title="Investments" subtitle="By stock and by broker" to="/net-worth/investments" />
      </InsetGroup>
```
In `AssetsPage.tsx`'s `Group`, after the rows: `{group.group === 'invest' && <InsetRow title="By stock and broker" to="/net-worth/investments" />}`.

- [ ] **Step 3: Run** `npx vitest run src/features/investments/portfolio-view.test.ts` → PASS; root gate; `npx playwright test net-worth.spec.ts assets.spec.ts buy-flow.spec.ts --workers=2`.
- [ ] **Step 4: Commit** `feat(investments): the portfolio read by stock and by broker`

### Task 11: The stock, price and broker pages

**Files:**
- Create: `apps/web/src/features/investments/SecurityPage.tsx`, `SecurityPricePage.tsx`, `BrokerPage.tsx`
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: `usePortfolio`, `useSecurityPrices`, `useTrades` (`networth/queries.ts`), `priceChangeLines`, `rateLabel`, `dayLabel`, `upsertSecurityPrice`, `parsePriceMicro`, `formatPriceMicro`, `priceMicroFrom`, `rateFromAmounts`, `formatUnits`, `useBalances`.
- Produces: routes `/net-worth/investments/security/$securityId`, `/…/price`, `/net-worth/investments/broker/$accountId`, `/net-worth/investments/broker/none`.

- [ ] **Step 1: SecurityPage**

```tsx
// apps/web/src/features/investments/SecurityPage.tsx
import { convertMinor, formatBps, formatMinor, formatPriceMicro, formatUnits, gainBps, priceMicroFrom, rateFromAmounts } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { useTrades } from '../networth/queries';
import { dayLabel, rateLabel } from './portfolio-view';
import { usePortfolio, useSecurityPrices } from './queries';

const KIND = { buy: 'Bought', sell: 'Sold', income: 'Income from', unit_change: 'Units changed on' } as const;

export function SecurityPage() {
  const { ws } = useApp();
  const { securityId = '' } = useParams({ strict: false }) as { securityId?: string };
  const { view, rates, costs, securities, error, isPending } = usePortfolio();
  const prices = useSecurityPrices(securityId);
  const trades = useTrades();
  const base = ws.baseCurrency;
  const security = securities.find((s) => s.id === securityId);
  const stock = view?.stocks.find((s) => s.securityId === securityId);
  const title = security ? (security.ticker ?? security.name) : 'Stock';
  if (!isPending && (!security || !stock)) return <div className={SCREEN}><LargeTitle title={title} back="Investments" backTo="/net-worth/investments" /><Empty>Nothing of this is held now.</Empty></div>;
  if (!stock || !security) return <div className={SCREEN}><LargeTitle title={title} back="Investments" backTo="/net-worth/investments" /><ErrorBox error={error} /></div>;

  const foreign = stock.currency !== base;
  const rate = rates[stock.currency];
  const gain = stock.valueMinor - stock.costMinor;
  const baseGain = stock.valueBaseMinor === null ? null : stock.valueBaseMinor - stock.costBaseMinor;
  const latest = prices.data?.[0];
  const accountIds = new Set(stock.holdings.map((h) => h.accountId));
  const brokerOf = new Map(stock.holdings.map((h) => [h.accountId, h.brokerName]));
  const recent = (trades.data ?? []).filter((t) => accountIds.has(t.accountId)).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  return (
    <div className={SCREEN}>
      <LargeTitle title={title} back="Investments" backTo="/net-worth/investments" subtitle={`${formatUnits(stock.unitsMicro)} shares${security.market ? ` · ${security.market}` : ''}`} />
      <ErrorBox error={error} />
      <Hero
        minor={stock.valueMinor}
        currency={stock.currency}
        caption={
          <>
            {formatMinor(gain, stock.currency)}
            {stock.gainBps === null ? '' : ` · ${formatBps(stock.gainBps)}`}
            {foreign && stock.valueBaseMinor !== null && rate !== undefined && <span className="block">≈ {formatMinor(stock.valueBaseMinor, base)} · at {rateLabel(rate, stock.currency, base)}</span>}
          </>
        }
      />
      {foreign && (
        <InsetGroup header={`In ${base}`} footer="Both are true: the figure above is what the stock did; this one includes the exchange rate moving.">
          {baseGain !== null && <ReadOnlyRow label={`Gain in ${base}`} value={`${formatMinor(baseGain, base)} · ${formatBps(gainBps(stock.valueBaseMinor!, stock.costBaseMinor) ?? 0)}`} />}
          {stock.costMinor > 0 && stock.costBaseMinor > 0 && <ReadOnlyRow label="Bought at" value={rateLabel(rateFromAmounts(stock.costMinor, stock.currency, stock.costBaseMinor, base), stock.currency, base)} />}
        </InsetGroup>
      )}
      <InsetGroup>
        {stock.unitsMicro > 0 && <ReadOnlyRow label="Avg price" value={formatPriceMicro(priceMicroFrom(stock.costMinor, stock.unitsMicro), stock.currency)} />}
        <InsetRow
          title="Price today"
          subtitle={latest ? `Set by you · ${dayLabel(latest.onDate)}` : 'Not set yet'}
          value={latest ? formatPriceMicro(latest.priceMicro, stock.currency) : undefined}
          to="/net-worth/investments/security/$securityId/price"
          params={{ securityId }}
        />
      </InsetGroup>
      <InsetGroup header="Held at" footer="Each broker keeps its own average price and its own cost basis.">
        {stock.holdings.map((h) => (
          <InsetRow
            key={h.accountId}
            title={h.brokerName}
            subtitle={`${formatUnits(h.unitsMicro)} shares · avg ${formatPriceMicro(priceMicroFrom(h.costMinor, h.unitsMicro), h.currency)}`}
            value={<Money minor={h.valueMinor} currency={h.currency} />}
            valueTone="ink"
            to="/net-worth/assets/$accountId"
            params={{ accountId: h.accountId }}
          />
        ))}
      </InsetGroup>
      {recent.length > 0 && (
        <InsetGroup header="Recent" footer={foreign ? `The ${base} cost of a buy is fixed at the rate on its day, and it never moves again.` : undefined}>
          {recent.map((trade) => {
            const pinned = trade.kind === 'buy' && foreign ? costs?.buyBaseMinor[trade.id] : undefined;
            const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
            const at = pinned && cost > 0 ? ` · at ${rateLabel(rateFromAmounts(cost, stock.currency, pinned, base), stock.currency, base)}` : '';
            return (
              // Read-only on purpose: a trade is changed only on Buy & sell, which works later sells out again (spec §9).
              <InsetRow
                key={trade.id}
                title={`${KIND[trade.kind]} ${trade.kind === 'income' ? title : `${formatUnits(trade.unitsMicro)} shares`}`}
                subtitle={`${brokerOf.get(trade.accountId) ?? ''} · ${dayLabel(trade.occurredOn)}${at}${pinned ? ` · ${formatMinor(pinned, base)}` : ''}`}
                value={<Money minor={trade.grossMinor} currency={stock.currency} />}
                valueTone="ink"
              />
            );
          })}
        </InsetGroup>
      )}
    </div>
  );
}
```

(`convertMinor` is unused here if the compiler says so — remove it from the import.)

- [ ] **Step 2: SecurityPricePage**

```tsx
// apps/web/src/features/investments/SecurityPricePage.tsx
import { formatMinor, formatPriceMicro, isoDate, parsePriceMicro } from '@expanses/core';
import { upsertSecurityPrice } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, TextRow } from '../../ui/native';
import { dayLabel, priceChangeLines } from './portfolio-view';
import { usePortfolio, useSecurityPrices } from './queries';

export function SecurityPricePage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { securityId = '' } = useParams({ strict: false }) as { securityId?: string };
  const { view, securities } = usePortfolio();
  const prices = useSecurityPrices(securityId);
  const security = securities.find((s) => s.id === securityId);
  const stock = view?.stocks.find((s) => s.securityId === securityId);
  const [price, setPrice] = useState('');
  const [onDate, setOnDate] = useState(isoDate());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const currency = security?.currency ?? ws.baseCurrency;
  const label = security ? (security.ticker ?? security.name) : 'Price';
  const last = (prices.data ?? []).find((row) => row.onDate <= onDate) ?? null;
  let typed: number | null = null;
  try {
    typed = price.trim() ? parsePriceMicro(price, currency) : null;
  } catch {
    typed = null;
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (onDate > isoDate()) throw new Error('A price cannot be dated after today');
      await upsertSecurityPrice(database, ws, { securityId, onDate, priceMicro: parsePriceMicro(price, currency) });
      await invalidate();
      await navigate({ to: '/net-worth/investments/security/$securityId', params: { securityId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={SCREEN} onSubmit={save}>
      <LargeTitle title={`${label} · price per share`} back={label} backTo="/net-worth/investments/security/$securityId" backParams={{ securityId }} />
      <InsetGroup footer={last ? `Last set ${dayLabel(last.onDate)} at ${formatPriceMicro(last.priceMicro, currency)}.` : undefined}>
        <TextRow label={`Price (${currency})`} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
        <TextRow label="As of" type="date" value={onDate} max={isoDate()} onChange={(e) => setOnDate(e.target.value)} required />
      </InsetGroup>
      {stock && typed !== null && (
        <InsetGroup header="This changes" footer={`One price values every broker that holds ${label}. A price in ${currency} is converted at the day’s rate; you never type a converted price.`}>
          {priceChangeLines(stock.holdings, last?.priceMicro ?? null, typed).map((line) => (
            <InsetRow
              key={line.holding.accountId}
              title={line.holding.brokerName}
              subtitle={line.changeMinor === null ? undefined : `${line.changeMinor >= 0 ? '+' : ''}${formatMinor(line.changeMinor, currency)}`}
              value={<Money minor={line.valueMinor} currency={currency} />}
              valueTone="ink"
            />
          ))}
        </InsetGroup>
      )}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Save price" onClick={() => void save()} chevron={false} disabled={busy || typed === null} />
      </InsetGroup>
    </form>
  );
}
```

(The Save row is the row itself, per the kit; Enter in either box also submits the form.)

- [ ] **Step 3: BrokerPage**

```tsx
// apps/web/src/features/investments/BrokerPage.tsx
import { formatBps, formatMinor, formatUnits, gainBps } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useBalances } from '../../lib/queries';
import { Empty, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { NO_BROKER } from './portfolio-view';
import { usePortfolio } from './queries';

export function BrokerPage({ none = false }: { none?: boolean }) {
  const { ws } = useApp();
  const { accountId } = useParams({ strict: false }) as { accountId?: string };
  const { view, isPending } = usePortfolio();
  const balances = useBalances();
  const key = none ? NO_BROKER : (accountId ?? '');
  const broker = view?.brokers.find((b) => b.key === key);
  if (!broker) return <div className={SCREEN}><LargeTitle title="Broker" back="Investments" backTo="/net-worth/investments" />{!isPending && <Empty>Nothing is held here now.</Empty>}</div>;
  const base = ws.baseCurrency;
  const cashIdle = broker.accountId ? balances.data?.[broker.accountId] : undefined;
  return (
    <div className={SCREEN}>
      <LargeTitle title={broker.converted ? broker.name : `${broker.name} · ${broker.leadCurrency}`} back="Investments" backTo="/net-worth/investments" />
      <Hero
        minor={broker.leadMinor}
        currency={broker.leadCurrency}
        caption={broker.converted ? 'Converted at today’s rates' : broker.leadCurrency !== base && broker.valueBaseMinor !== null ? `≈ ${formatMinor(broker.valueBaseMinor, base)}` : undefined}
      />
      <InsetGroup footer="A broker in one currency shows its own totals in that currency. Nothing is converted twice.">
        <ReadOnlyRow label="Put in" value={formatMinor(broker.costBaseMinor, base)} />
        {cashIdle !== undefined && broker.holdings[0] && <ReadOnlyRow label="Cash idle" value={formatMinor(cashIdle, broker.leadCurrency)} />}
      </InsetGroup>
      <InsetGroup header="Holdings here">
        {broker.holdings.map((h) => {
          const bps = gainBps(h.valueMinor, h.costMinor);
          const stock = view!.stocks.find((s) => s.holdings.some((line) => line.accountId === h.accountId))!;
          return (
            <InsetRow
              key={h.accountId}
              title={stock.title}
              subtitle={`${formatUnits(h.unitsMicro)} shares${bps === null ? '' : ` · ${formatBps(bps)}`}`}
              value={<Money minor={h.valueMinor} currency={h.currency} />}
              valueTone="ink"
              {...(stock.securityId ? { to: '/net-worth/investments/security/$securityId', params: { securityId: stock.securityId } } : { to: '/net-worth/assets/$accountId', params: { accountId: h.accountId } })}
            />
          );
        })}
      </InsetGroup>
    </div>
  );
}
```

"Cash idle" uses the broker account's own currency: read it from `useAccounts()` rather than `leadCurrency` when the broker is converted — `formatMinor(cashIdle, accounts.find(a => a.id === broker.accountId)!.currency!)`. Write it that way.

Router (static `none` outranks `$accountId`):
```tsx
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId', component: SecurityPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/security/$securityId/price', component: SecurityPricePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/none', component: () => <BrokerPage none /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/net-worth/investments/broker/$accountId', component: () => <BrokerPage /> }),
```

- [ ] **Step 4: Root gate** (screens are walked end to end in Tasks 14–15).
- [ ] **Step 5: Commit** `feat(investments): a stock, its one price, and a broker`

### Task 12: Add a holding — search, Name it myself, the form

**Files:**
- Create: `apps/web/src/features/investments/add-holding.ts`, `add-holding.test.ts`, `SecuritySearch.tsx`, `NameItForm.tsx`, `AddHoldingForm.tsx`, `AddHoldingPage.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/features/ownables/AddAssetPage.tsx`, `apps/web/src/features/networth/AddAssetForm.tsx`, `apps/web/package.json` (the build script from Task 9)

**Interfaces:**
- Consumes: `searchSecurities`, `loadSecurityList` via `useSecurityList`, `ListedSecurity`; `addHolding`, `linkHolding`, `NewSecurity`, `SecurityRow`, `AddHoldingInput`; `parseUnits`, `parsePriceMicro`, `parseMajor`, `unitsFromLots`, `unitsValueMinor`, `formatMinor`; `tradeMoneyForSave`, `baseCostPreview`; `useEntitlement`; `useStoredRates`, `useResolveRates`.
- Produces: `type Picked = { kind: 'held'; security: SecurityRow } | { kind: 'listed'; security: ListedSecurity } | { kind: 'named'; security: NewSecurity }`; `interface NameDraft`; `namedSecurity(d: NameDraft): NewSecurity`; `interface HoldingDraft`; `NEW_BROKER`, `NO_BROKER_CHOICE`, `OPENING`; `unitsOf(quantity: string, lotSize: number | null): number`; `totalOf(draft, lotSize, currency): number | null`; `planAddHolding(picked, draft, today): AddHoldingInput`; route `/net-worth/investments/new` with search `{ link?: string }`.

- [ ] **Step 1: Failing tests**

```ts
// apps/web/src/features/investments/add-holding.test.ts
import { describe, expect, it } from 'vitest';
import { emptyHoldingDraft, NEW_BROKER, namedSecurity, OPENING, planAddHolding, totalOf, unitsOf } from './add-holding';

const bbca = { ticker: 'BBCA', name: 'BBCA name', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share' as const };

describe('unitsOf', () => {
  it('reads lots on a lot-sized security and shares otherwise', () => {
    expect(unitsOf('15', 100)).toBe(1_500_000_000);
    expect(unitsOf('2,5', null)).toBe(2_500_000);
  });
  it('refuses part of a lot, and nothing', () => {
    expect(() => unitsOf('1,5', 100)).toThrow(/whole lots/);
    expect(() => unitsOf('0', null)).toThrow();
    expect(() => unitsOf('', null)).toThrow();
  });
});

describe('totalOf', () => {
  it('is shares × price, exact, through parsePriceMicro', () => {
    expect(totalOf({ quantity: '10', price: '182.50' }, null, 'USD')).toBe(182_500);
    expect(totalOf({ quantity: '7', price: '9.775' }, null, 'IDR')).toBe(68_425); // "9.775" is nine thousand rupiah
    expect(totalOf({ quantity: '3', price: '312,5' }, null, 'IDR')).toBe(938); // 937,5 rounds half away from zero
    expect(totalOf({ quantity: '15', price: '8.750' }, 100, 'IDR')).toBe(13_125_000);
    expect(totalOf({ quantity: 'x', price: '1' }, null, 'IDR')).toBeNull();
  });
});

describe('namedSecurity', () => {
  it('is what the owner typed, tidied, and a share only when it has a ticker', () => {
    expect(namedSecurity({ ticker: ' aapl ', name: 'Apple', market: 'nasdaq', currency: 'USD', lotSize: '' })).toEqual({ ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD', lotSize: null, kind: 'share', source: 'owner' });
    expect(namedSecurity({ ticker: '', name: 'Private fund', market: '', currency: 'IDR', lotSize: '' })).toMatchObject({ ticker: null, kind: 'other' });
    expect(() => namedSecurity({ ticker: 'X', name: ' ', market: '', currency: 'IDR', lotSize: '' })).toThrow(/name/);
    expect(() => namedSecurity({ ticker: 'X', name: 'X', market: '', currency: 'IDR', lotSize: '2,5' })).toThrow(/whole/);
  });
});

describe('planAddHolding', () => {
  it('builds the security, the new broker and an opening buy', () => {
    const draft = { ...emptyHoldingDraft('2026-09-21', 'IDR'), brokerChoice: NEW_BROKER, brokerName: 'Stockbit', quantity: '10', price: '8.750', fee: '13.125', paidFrom: OPENING };
    expect(planAddHolding({ kind: 'listed', security: bbca }, draft, '2026-09-21')).toEqual({
      security: { ...bbca, source: 'catalogue' },
      broker: { name: 'Stockbit', currency: 'IDR' },
      buy: { occurredOn: '2026-09-21', unitsMicro: 1_000_000_000, grossMinor: 8_750_000, feeMinor: 13_125, taxMinor: 0, cashAccountId: null },
    });
  });
  it('refuses a date after today and a nameless new broker', () => {
    const draft = { ...emptyHoldingDraft('2026-09-21', 'IDR'), quantity: '1', price: '1', paidFrom: OPENING };
    expect(() => planAddHolding({ kind: 'listed', security: bbca }, { ...draft, occurredOn: '2026-09-22' }, '2026-09-21')).toThrow(/after today/);
    expect(() => planAddHolding({ kind: 'listed', security: bbca }, { ...draft, brokerChoice: NEW_BROKER, brokerName: ' ' }, '2026-09-21')).toThrow(/broker/);
  });
});
```

- [ ] **Step 2: Implement the planner**

```ts
// apps/web/src/features/investments/add-holding.ts
import { parseMajor, parsePriceMicro, parseUnits, unitsFromLots, unitsValueMinor, UNITS_SCALE } from '@expanses/core';
import type { ListedSecurity } from '@expanses/catalog';
import type { AddHoldingInput, NewSecurity, SecurityRow } from '@expanses/db';

export type Picked = { kind: 'held'; security: SecurityRow } | { kind: 'listed'; security: ListedSecurity } | { kind: 'named'; security: NewSecurity };

export interface NameDraft {
  ticker: string;
  name: string;
  market: string;
  currency: string;
  lotSize: string;
}

export const NEW_BROKER = 'new';
export const NO_BROKER_CHOICE = 'none';
/** "Owned before this app": paid from Opening Balances, so no bank balance moves. */
export const OPENING = 'opening';

export interface HoldingDraft {
  /** A broker account id, NEW_BROKER or NO_BROKER_CHOICE. */
  brokerChoice: string;
  brokerName: string;
  brokerCurrency: string;
  /** Lots on a lot-sized security, shares otherwise. */
  quantity: string;
  price: string;
  fee: string;
  occurredOn: string;
  /** A money account id, or OPENING. */
  paidFrom: string;
  charged: string;
}

export const emptyHoldingDraft = (today: string, currency: string): HoldingDraft => ({
  brokerChoice: NO_BROKER_CHOICE, brokerName: '', brokerCurrency: currency, quantity: '', price: '', fee: '', occurredOn: today, paidFrom: OPENING, charged: '',
});

export function namedSecurity(d: NameDraft): NewSecurity {
  const name = d.name.trim();
  if (!name) throw new Error('Give it a name');
  const ticker = d.ticker.trim().toUpperCase() || null;
  let lotSize: number | null = null;
  if (d.lotSize.trim()) {
    const size = Number(d.lotSize.trim());
    if (!Number.isInteger(size) || size < 1) throw new Error('A lot is a whole number of shares');
    lotSize = size;
  }
  return { ticker, name, market: d.market.trim().toUpperCase(), currency: d.currency, lotSize: lotSize === 1 ? null : lotSize, kind: ticker ? 'share' : 'other', source: 'owner' };
}

export function unitsOf(quantity: string, lotSize: number | null): number {
  if (quantity.trim() === '') throw new Error(lotSize && lotSize > 1 ? 'Enter how many lots' : 'Enter how many shares');
  const micro = parseUnits(quantity);
  if (micro <= 0) throw new Error('Enter more than zero');
  if (lotSize && lotSize > 1) {
    if (micro % UNITS_SCALE !== 0) throw new Error('Enter whole lots');
    return unitsFromLots(micro / UNITS_SCALE, lotSize);
  }
  return micro;
}

export function totalOf(draft: Pick<HoldingDraft, 'quantity' | 'price'>, lotSize: number | null, currency: string): number | null {
  try {
    return unitsValueMinor(unitsOf(draft.quantity, lotSize), parsePriceMicro(draft.price, currency));
  } catch {
    return null;
  }
}

const listedToNew = (s: ListedSecurity): NewSecurity => ({ ...s, source: 'catalogue' });
export const securityOf = (picked: Picked) => (picked.kind === 'held' ? picked.security : picked.kind === 'listed' ? listedToNew(picked.security) : picked.security);

/** What `addHolding` is handed, before `tradeMoneyForSave` adds the rates. Throws with words meant for the screen. */
export function planAddHolding(picked: Picked, draft: HoldingDraft, today: string): AddHoldingInput {
  const security = securityOf(picked);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A purchase cannot be dated after today');
  const unitsMicro = unitsOf(draft.quantity, security.lotSize);
  if (draft.price.trim() === '') throw new Error('Enter the price per share');
  const grossMinor = unitsValueMinor(unitsMicro, parsePriceMicro(draft.price, security.currency));
  if (!(grossMinor > 0)) throw new Error('Enter a price greater than zero');
  const feeMinor = draft.fee.trim() === '' ? 0 : parseMajor(draft.fee, security.currency);
  if (feeMinor < 0) throw new Error('A fee cannot be negative');
  let broker: AddHoldingInput['broker'] = null;
  if (draft.brokerChoice === NEW_BROKER) {
    if (!draft.brokerName.trim()) throw new Error('Name the broker');
    broker = { name: draft.brokerName.trim(), currency: draft.brokerCurrency };
  } else if (draft.brokerChoice !== NO_BROKER_CHOICE) broker = { accountId: draft.brokerChoice };
  return {
    security: picked.kind === 'held' ? { id: picked.security.id } : security,
    broker,
    buy: { occurredOn: draft.occurredOn, unitsMicro, grossMinor, feeMinor, taxMinor: 0, cashAccountId: draft.paidFrom === OPENING ? null : draft.paidFrom },
  };
}
```

(`UNITS_SCALE`: if not exported from core's index today, export it beside `unitsFromLots` — it is the existing constant, not a new one.)

- [ ] **Step 3: The three components and the page**

```tsx
// apps/web/src/features/investments/SecuritySearch.tsx
import { searchSecurities } from '@expanses/catalog';
import type { SecurityRow } from '@expanses/db';
import { formatUnits } from '@expanses/core';
import { useEntitlement } from '../../lib/entitlements';
import { Input } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import type { Picked } from './add-holding';
import { useSecurityList } from './queries';

export function SecuritySearch({ query, onQuery, held, heldUnits, onPick, onNameIt }: {
  query: string;
  onQuery: (q: string) => void;
  held: readonly SecurityRow[];
  /** Units held per security id, for "you hold 10". */
  heldUnits: Readonly<Record<string, number>>;
  onPick: (picked: Picked) => void;
  onNameIt: () => void;
}) {
  const foreign = useEntitlement('foreign_securities');
  const idx = useSecurityList('idx', true);
  const us = useSecurityList('us', foreign);
  const mine = searchSecurities(held, query);
  const mineKeys = new Set(mine.map((s) => `${s.market}:${s.ticker}`));
  const listed = searchSecurities([...(idx.data?.securities ?? []), ...(foreign ? (us.data?.securities ?? []) : [])], query).filter((s) => !mineKeys.has(`${s.market}:${s.ticker}`));
  const searching = query.trim() !== '';
  const failed = idx.isError || (foreign && us.isError);
  return (
    <>
      <Input aria-label="Ticker or name" placeholder="Ticker or name" value={query} onChange={(e) => onQuery(e.target.value)} autoFocus />
      {mine.length > 0 && (
        <InsetGroup header="You hold">
          {mine.map((s) => (
            <InsetRow key={s.id} title={s.ticker ?? s.name} subtitle={[s.name, s.market, s.currency, heldUnits[s.id] ? `you hold ${formatUnits(heldUnits[s.id]!)}` : null].filter(Boolean).join(' · ')} onClick={() => onPick({ kind: 'held', security: s })} />
          ))}
        </InsetGroup>
      )}
      {searching && (
        <InsetGroup header="Shares & funds">
          {listed.length === 0 && mine.length === 0 ? (
            <InsetRow title={`Nothing on ${foreign ? 'the lists' : 'IDX'} matches ${query.trim().toUpperCase()}`} chevron={false} />
          ) : (
            listed.map((s) => (
              <InsetRow key={`${s.market}:${s.ticker}`} title={s.ticker} subtitle={[s.name, s.market, s.currency, s.lotSize ? null : 'no lot size'].filter(Boolean).join(' · ')} onClick={() => onPick({ kind: 'listed', security: s })} />
            ))
          )}
        </InsetGroup>
      )}
      {failed && <p className="px-[4px] text-[12.5px] text-[var(--ph-warn)]">The ticker list could not be read. Name it yourself instead.</p>}
      <InsetGroup header="Not listed?">
        <InsetRow title="Name it myself" subtitle="Unlisted shares, a private fund, anything else" onClick={onNameIt} />
      </InsetGroup>
    </>
  );
}
```

```tsx
// apps/web/src/features/investments/NameItForm.tsx
import { CURRENCIES } from '@expanses/core';
import { type FormEvent, useState } from 'react';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { type NameDraft, namedSecurity, type Picked } from './add-holding';

export function NameItForm({ base, onDone }: { base: string; onDone: (picked: Picked) => void }) {
  const [draft, setDraft] = useState<NameDraft>({ ticker: '', name: '', market: '', currency: base, lotSize: '' });
  const [error, setError] = useState<unknown>(null);
  const change = (patch: Partial<NameDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const next = (event?: FormEvent) => {
    event?.preventDefault();
    try {
      onDone({ kind: 'named', security: namedSecurity(draft) });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <form onSubmit={next}>
      <InsetGroup header="Name it myself" footer="Typed once. From then on it behaves like every other holding.">
        <TextRow label="Ticker" value={draft.ticker} onChange={(e) => change({ ticker: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <TextRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Company or fund" required />
        <TextRow label="Market" value={draft.market} onChange={(e) => change({ market: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <SelectRow label="Currency" value={draft.currency} onChange={(e) => change({ currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </SelectRow>
        <TextRow label="Shares in a lot" value={draft.lotSize} onChange={(e) => change({ lotSize: e.target.value })} inputMode="numeric" placeholder="None" />
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Continue" onClick={() => next()} chevron={false} />
      </InsetGroup>
    </form>
  );
}
```

```tsx
// apps/web/src/features/investments/AddHoldingForm.tsx
import { CURRENCIES, formatMinor, formatUnits, isoDate } from '@expanses/core';
import { type AccountRow, addHolding } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useInvalidateAll, useResolveRates, useStoredRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { baseCostPreview, tradeMoneyForSave } from '../networth/trade-money';
import { emptyHoldingDraft, type HoldingDraft, NEW_BROKER, NO_BROKER_CHOICE, OPENING, type Picked, planAddHolding, securityOf, totalOf } from './add-holding';
import { rateLabel } from './portfolio-view';

export function AddHoldingForm({ picked, accounts, brokers, heldAt }: {
  picked: Picked;
  accounts: readonly AccountRow[];
  /** Money accounts offered as a broker: fund accounts and any account already named as one. */
  brokers: readonly AccountRow[];
  /** Units of this security already held at each broker account id. */
  heldAt: Readonly<Record<string, number>>;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const resolveRates = useResolveRates();
  const storedRates = useStoredRates();
  const today = isoDate();
  const security = securityOf(picked);
  const [draft, setDraft] = useState<HoldingDraft>(() => ({ ...emptyHoldingDraft(today, security.currency), brokerChoice: brokers[0]?.id ?? NEW_BROKER }));
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [stored, setStored] = useState<Record<string, number>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<HoldingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const money = accounts.filter((a) => a.kind === 'asset' && SPENDABLE_SUBTYPES.includes(a.subtype) && a.archivedAt === null);
  const cash = money.find((a) => a.id === draft.paidFrom);
  const cashCurrency = cash ? (cash.currency ?? ws.baseCurrency) : security.currency;
  const total = totalOf(draft, security.lotSize, security.currency);
  const lotted = (security.lotSize ?? 1) > 1;

  useEffect(() => {
    if (security.currency === ws.baseCurrency) return;
    void storedRates([security.currency], draft.occurredOn).then((r) => setStored(r.rates));
  }, [storedRates, security.currency, draft.occurredOn, ws.baseCurrency]);
  const preview = total === null ? { rate: null, baseMinor: null } : baseCostPreview({ amountMinor: total, holdingCurrency: security.currency, cashCurrency, baseCurrency: ws.baseCurrency, charged: draft.charged, storedRates: stored });

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planAddHolding(picked, draft, today);
      const moneyFor = await tradeMoneyForSave({
        database, baseCurrency: ws.baseCurrency, input: { ...plan.buy, accountId: '', kind: 'buy' }, holdingCurrency: security.currency, cashCurrency,
        charged: draft.charged, needsRate, manualRate, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
      });
      const result = await addHolding(database, ws, { ...plan, buy: { ...plan.buy, ...moneyFor } });
      await invalidate();
      await navigate({ to: '/net-worth/investments/security/$securityId', params: { securityId: result.securityId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const label = security.ticker ?? security.name;
  return (
    <form onSubmit={submit}>
      <InsetGroup header={`Adding ${label}`} footer={[security.name, security.market || null, `trades in ${security.currency}`].filter(Boolean).join(' · ')}>
        <SelectRow label="Where is it kept" value={draft.brokerChoice} onChange={(e) => change({ brokerChoice: e.target.value })}>
          {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}{heldAt[b.id] ? ` · you hold ${formatUnits(heldAt[b.id]!)}` : ''}</option>)}
          <option value={NEW_BROKER}>Another broker…</option>
          <option value={NO_BROKER_CHOICE}>No broker</option>
        </SelectRow>
        {draft.brokerChoice === NEW_BROKER && (
          <>
            <TextRow label="Broker name" value={draft.brokerName} onChange={(e) => change({ brokerName: e.target.value })} required />
            <SelectRow label="Its currency" value={draft.brokerCurrency} onChange={(e) => change({ brokerCurrency: e.target.value })}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </SelectRow>
          </>
        )}
      </InsetGroup>
      <InsetGroup header="What you bought" footer={lotted ? `${security.lotSize} shares a lot.` : `${security.market || 'This'} has no lot size.`}>
        <TextRow label={lotted ? 'Lots' : 'Shares'} value={draft.quantity} onChange={(e) => change({ quantity: e.target.value })} inputMode="decimal" />
        <TextRow label={`Price per share (${security.currency})`} value={draft.price} onChange={(e) => change({ price: e.target.value })} inputMode="decimal" />
        <ReadOnlyRow label="Total" value={total === null ? '—' : formatMinor(total, security.currency)} />
        <TextRow label={`Fee (${security.currency})`} value={draft.fee} onChange={(e) => change({ fee: e.target.value })} inputMode="decimal" placeholder="0" />
        <TextRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => change({ occurredOn: e.target.value })} />
      </InsetGroup>
      <InsetGroup header="Paid from">
        <SelectRow label="Paid from" value={draft.paidFrom} onChange={(e) => change({ paidFrom: e.target.value, charged: '' })}>
          {money.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          <option value={OPENING}>Owned before this app</option>
        </SelectRow>
        {cashCurrency !== security.currency && (
          <TextRow label={`Charged in ${cashCurrency}`} value={draft.charged} onChange={(e) => change({ charged: e.target.value })} inputMode="decimal" />
        )}
        {needsRate ? (
          <TextRow label="Rate that day" value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? undefined} />
        ) : (
          security.currency !== ws.baseCurrency && <ReadOnlyRow label="Rate that day" value={preview.rate === null ? '—' : rateLabel(preview.rate, security.currency, ws.baseCurrency)} />
        )}
        {security.currency !== ws.baseCurrency && <ReadOnlyRow label={`Cost in ${ws.baseCurrency}`} value={preview.baseMinor === null ? '—' : formatMinor(preview.baseMinor, ws.baseCurrency)} />}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Add holding" onClick={() => void submit()} chevron={false} disabled={busy} />
      </InsetGroup>
    </form>
  );
}
```

The fee is read only by `planAddHolding`. Cost in base previews the price total only; the posted cost includes the fee, which `planAddHolding` carries.

```tsx
// apps/web/src/features/investments/AddHoldingPage.tsx
import { linkHolding } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { LargeTitle, SCREEN } from '../../ui/native';
import { usePositions } from '../networth/queries';
import { type Picked, securityOf } from './add-holding';
import { AddHoldingForm } from './AddHoldingForm';
import { NameItForm } from './NameItForm';
import { useHoldingLinks, useSecurities } from './queries';
import { SecuritySearch } from './SecuritySearch';

export function AddHoldingPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { link } = useSearch({ strict: false }) as { link?: string };
  const accounts = useAccounts().data ?? [];
  const securities = useSecurities().data ?? [];
  const links = useHoldingLinks().data ?? [];
  const positions = usePositions().data ?? {};
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<'search' | 'name' | 'form'>('search');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<unknown>(null);

  const heldUnits: Record<string, number> = {};
  for (const l of links) if (l.securityId) heldUnits[l.securityId] = (heldUnits[l.securityId] ?? 0) + (positions[l.accountId]?.unitsMicro ?? 0);
  const brokerIds = new Set(links.map((l) => l.brokerAccountId).filter(Boolean));
  const brokers = accounts.filter((a) => a.archivedAt === null && (a.subtype === 'fund' || brokerIds.has(a.id)));
  const heldAt: Record<string, number> = {};
  if (picked?.kind === 'held') for (const l of links) if (l.securityId === picked.security.id && l.brokerAccountId) heldAt[l.brokerAccountId] = positions[l.accountId]?.unitsMicro ?? 0;

  async function choose(next: Picked) {
    if (!link) {
      setPicked(next);
      setStep('form');
      return;
    }
    // Linking a holding recorded before this build (spec §7.6): the same search, a different last step.
    try {
      await linkHolding(database, ws, { accountId: link, security: next.kind === 'held' ? { id: next.security.id } : securityOf(next) });
      await invalidate();
      await navigate({ to: '/net-worth/assets/$accountId', params: { accountId: link } });
    } catch (e) {
      setError(e);
    }
  }

  const back = () => (step === 'search' ? void navigate({ to: link ? '/net-worth/assets/$accountId' : '/net-worth/investments', params: link ? { accountId: link } : undefined }) : setStep('search'));
  return (
    <div className={SCREEN}>
      <LargeTitle title={link ? 'Which ticker is it?' : 'Add a holding'} back={step === 'search' ? (link ? 'Asset' : 'Investments') : 'Search'} onBack={back} />
      <ErrorBox error={error} />
      {step === 'search' && <SecuritySearch query={query} onQuery={setQuery} held={securities} heldUnits={heldUnits} onPick={(p) => void choose(p)} onNameIt={() => setStep('name')} />}
      {step === 'name' && <NameItForm base={ws.baseCurrency} onDone={(p) => void choose(p)} />}
      {step === 'form' && picked && <AddHoldingForm picked={picked} accounts={accounts} brokers={brokers} heldAt={heldAt} />}
    </div>
  );
}
```

Router:
```tsx
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/net-worth/investments/new',
    component: AddHoldingPage,
    validateSearch: (search: Record<string, unknown>): { link?: string } => ({ link: typeof search.link === 'string' ? search.link : undefined }),
  }),
```

`AddAssetPage.tsx`: `onChoose={(id) => (id === 'stock' ? void navigate({ to: '/net-worth/investments/new' }) : setChosen(id))}`.

`AddAssetForm.tsx`: directly after the first `InsetGroup` closes, add
```tsx
      {draft.itemId === 'stock' && itemId === undefined && (
        <InsetGroup footer="Or type it in below, as before.">
          <InsetRow title="Find it by ticker" to="/net-worth/investments/new" />
        </InsetGroup>
      )}
```
Every existing field stays.

`apps/web/package.json`: `"build": "vite build && node scripts/check-bundle.mjs"` (from Task 9) — now both lists are reachable from a screen.

- [ ] **Step 4: Run** unit tests; `npm run build` from the root and read the bundle check's output (entry chunk unchanged in content, each list in one chunk under budget); root gate; `npx playwright test assets.spec.ts buy-flow.spec.ts income-treatment.spec.ts --workers=2`.
- [ ] **Step 5: Commit** `feat(investments): add a holding from a ticker, or name it yourself`

### Task 13: Linking a holding recorded before this build

**Files:**
- Create: `apps/web/src/features/networth/StockAndBroker.tsx`
- Modify: `apps/web/src/features/networth/AssetDetailPage.tsx`, `apps/web/src/features/networth/PriceForm.tsx`

**Interfaces:**
- Consumes: `useHoldingLinks`, `useSecurities`, `linkHolding`, `useAccounts`.
- Produces: `StockAndBroker({ accountId }: { accountId: string })`.

- [ ] **Step 1: Component**

```tsx
// apps/web/src/features/networth/StockAndBroker.tsx
import { linkHolding } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { useHoldingLinks, useSecurities } from '../investments/queries';

/** Which ticker a holding is and where it is kept (spec §7.6). */
export function StockAndBroker({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const link = (useHoldingLinks().data ?? []).find((l) => l.accountId === accountId);
  const security = (useSecurities().data ?? []).find((s) => s.id === link?.securityId);
  const accounts = useAccounts().data ?? [];
  const brokers = accounts.filter((a) => a.archivedAt === null && (a.subtype === 'fund' || a.id === link?.brokerAccountId));
  const [error, setError] = useState<unknown>(null);

  async function keptAt(brokerAccountId: string) {
    setError(null);
    try {
      await linkHolding(database, ws, { accountId, brokerAccountId: brokerAccountId || null });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <InsetGroup header="Stock and broker" footer={security ? `The price is ${security.ticker ?? security.name}’s, and values every broker that holds it.` : 'Give it a ticker so one price values it wherever it is kept.'}>
      <InsetRow title="Ticker" value={security ? (security.ticker ?? security.name) : 'Not set'} to="/net-worth/investments/new" search={{ link: accountId }} />
      <SelectRow label="Kept at" value={link?.brokerAccountId ?? ''} onChange={(e) => void keptAt(e.target.value)}>
        <option value="">No broker</option>
        {brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </SelectRow>
      <ErrorBox error={error} />
    </InsetGroup>
  );
}
```

- [ ] **Step 2: Place it.** In `AssetDetailPage.tsx`, for a holding valued by units × price (`value.mode === 'market'`) and `account?.subtype === 'investment'`, render `<StockAndBroker accountId={accountId} />` above the "Buys, sells and income" group. Where `AssetSettings` is rendered, pass `showLotSize={existingCondition && !linkedToSecurity}` with `const linkedToSecurity = Boolean((useHoldingLinks().data ?? []).find((l) => l.accountId === accountId)?.securityId);`. In `PriceForm.tsx`, accept an optional `note?: string` prop and show it as the form's hint; AssetDetailPage passes `"This price is {TICKER}'s, and values every broker that holds it."` for a linked holding. `upsertPrice` already routes the write (Task 5).
- [ ] **Step 3: Root gate; `npx playwright test assets.spec.ts net-worth.spec.ts --workers=2`.**
- [ ] **Step 4: Commit** `feat(assets): a holding from before can be given its ticker and its broker`

---

## Step 7 — Walk every combination

### Task 14: End to end — the combination table, on a desktop and on a phone

**Files:**
- Create: `apps/web/e2e/securities.ts`, `apps/web/e2e/securities.spec.ts`, `apps/web/e2e/phone-securities.spec.ts`

Every money figure the test enters is typed with `pressSequentially`, never `fill()` — setup rows that are not under test (account names, opening balances) may use `fill`. Every assertion is a figure, never a label alone.

- [ ] **Step 1: Helpers**

```ts
// apps/web/e2e/securities.ts
import { expect, type Page } from '@playwright/test';

export async function grantForeignList(page: Page) {
  await page.addInitScript(() => localStorage.setItem('expanses.entitlements', JSON.stringify(['foreign_securities'])));
}

export async function addBank(page: Page, name: string, balance: string, type = 'bank', currency = 'IDR') {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  if (currency !== 'IDR') await page.getByLabel('Currency').selectOption(currency);
  await page.getByLabel('Current balance').fill(balance);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

/** Search, pick, and fill the Add a holding form by keystroke. */
export async function addHoldingFlow(page: Page, o: {
  search: string; pick?: string; nameIt?: { ticker: string; name: string; market: string; currency: string };
  broker: string | { new: string; currency?: string }; quantity: string; price: string; fee?: string; paidFrom: string; charged?: string; rate?: string;
}) {
  await page.goto('/net-worth/investments/new');
  await page.getByLabel('Ticker or name').pressSequentially(o.search);
  if (o.nameIt) {
    await page.getByRole('button', { name: /Name it myself/ }).click();
    await page.getByLabel('Ticker').pressSequentially(o.nameIt.ticker);
    await page.getByLabel('Name', { exact: true }).pressSequentially(o.nameIt.name);
    await page.getByLabel('Market').pressSequentially(o.nameIt.market);
    await page.getByLabel('Currency').selectOption(o.nameIt.currency);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.getByRole('button', { name: new RegExp(`^${o.pick ?? o.search}\\b`) }).first().click();
  }
  if (typeof o.broker === 'string') await page.getByLabel('Where is it kept').selectOption({ label: new RegExp(`^${o.broker}`) as unknown as string });
  else {
    await page.getByLabel('Where is it kept').selectOption({ label: 'Another broker…' });
    await page.getByLabel('Broker name').pressSequentially(o.broker.new);
    if (o.broker.currency) await page.getByLabel('Its currency').selectOption(o.broker.currency);
  }
  await page.getByLabel(/^(Lots|Shares)$/).pressSequentially(o.quantity);
  await page.getByLabel(/^Price per share/).pressSequentially(o.price);
  if (o.fee) await page.getByLabel(/^Fee/).pressSequentially(o.fee);
  await page.getByLabel('Paid from').selectOption({ label: o.paidFrom });
  if (o.charged) await page.getByLabel(/^Charged in/).pressSequentially(o.charged);
  if (o.rate) await page.getByLabel('Rate that day').pressSequentially(o.rate);
}
```

(If a `selectOption` with a regex label is refused by the Playwright version, select by the option's exact text read from the page — the broker option text is its name, plus " · you hold N" when held.)

- [ ] **Step 2: The walk** — one `test` per row of spec §10, in this file:

```ts
// apps/web/e2e/securities.spec.ts
import { expect, test } from '@playwright/test';
import { addBank, addHoldingFlow, grantForeignList } from './securities';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

const balanceOf = async (page: import('@playwright/test').Page, name: string) => {
  await page.goto('/accounts');
  return page.getByRole('link', { name, exact: true }).locator('..');
};

test('1–4: BBCA at two brokers is one stock, one price values both, and the bank moved by exactly what was paid', async ({ page }) => {
  await addBank(page, 'BCA Tahapan', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', fee: '13.125', paidFrom: 'BCA Tahapan' });
  await expect(page.getByText('Rp 8.750.000')).toBeVisible(); // Total: 10 lots × 100 × 8.750
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expect(await balanceOf(page, 'BCA Tahapan')).toContainText('41.236.875');

  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Mandiri Sekuritas' }, quantity: '5', price: '9.400', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(await balanceOf(page, 'BCA Tahapan')).toContainText('41.236.875');

  await addHoldingFlow(page, { search: 'BBCA', broker: 'Stockbit', quantity: '5', price: '9.000', paidFrom: 'BCA Tahapan' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(await balanceOf(page, 'BCA Tahapan')).toContainText('36.736.875');

  await page.goto('/net-worth/investments');
  const bbca = page.getByTestId('stock-row').filter({ hasText: 'BBCA' });
  await expect(bbca).toHaveCount(1);
  await expect(bbca).toContainText('2.000 shares');
  await expect(bbca).toContainText('2 brokers');

  await bbca.click();
  await page.getByRole('link', { name: /Price today/ }).click();
  await page.getByLabel('Price (IDR)').pressSequentially('9.775');
  await expect(page.getByText('Rp 14.662.500')).toBeVisible(); // Stockbit 1.500 × 9.775
  await expect(page.getByText('Rp 4.887.500')).toBeVisible(); // Mandiri 500 × 9.775
  await page.getByRole('button', { name: 'Save price' }).click();
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'BBCA' })).toContainText('19.550.000'); // 2.000 × 9.775
});

test('5: a free user names AAPL, pays in rupiah, and the rupiah cost is exactly what left', async ({ page }) => {
  await addBank(page, 'BCA Tahapan', '50000000');
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182.50', paidFrom: 'BCA Tahapan', charged: '28.835.000',
  });
  await expect(page.getByText('Rp 15.800 / $')).toBeVisible();
  await expect(page.getByText('Rp 28.835.000')).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(await balanceOf(page, 'BCA Tahapan')).toContainText('21.165.000');
});

test('9: a free user’s search for AAPL finds nothing on IDX and offers Name it myself', async ({ page }) => {
  await page.goto('/net-worth/investments/new');
  await page.getByLabel('Ticker or name').pressSequentially('AAPL');
  await expect(page.getByText('Nothing on IDX matches AAPL')).toBeVisible();
  await expect(page.getByRole('button', { name: /Name it myself/ })).toBeVisible();
});

test('6 & 10: the paid list fills AAPL in; a missing day rate is asked for and read back; after a lapse AAPL still counts', async ({ page }) => {
  await grantForeignList(page);
  await addHoldingFlow(page, { search: 'AAPL', pick: 'AAPL', broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182.50', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  // No USD rate is stored and the rate server is unreachable: the form asks, and keeps everything typed.
  await expect(page.getByRole('alert')).toContainText('Rate that day');
  await page.getByLabel('Rate that day').pressSequentially('16250');
  await expect(page.getByText('Reads as 1 USD = 16.250 IDR')).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  // No price yet, so the value is the cost: $1.825,00 at 16.250.
  await expect(page.getByText(/29\.656\.250/).first()).toBeVisible();

  await page.evaluate(() => localStorage.removeItem('expanses.entitlements'));
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'AAPL' })).toContainText('10 shares');
  await page.goto('/net-worth/investments/new');
  await page.getByLabel('Ticker or name').pressSequentially('AAP');
  await expect(page.getByText('You hold')).toBeVisible();
});

test('11: a holding recorded before is given its ticker and broker, and its price moves to the security', async ({ page }) => {
  await addBank(page, 'Stockbit', '0', 'fund');
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).fill('BBCA old');
  await page.getByLabel('Bought on').fill('2026-01-05');
  await page.getByLabel('How much').pressSequentially('100');
  await page.getByLabel('Total cost (IDR)').pressSequentially('875.000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await page.getByRole('link', { name: /BBCA old/ }).click();
  await page.getByRole('link', { name: /Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  await page.getByRole('button', { name: /^BBCA\b/ }).first().click();
  await page.getByLabel('Kept at').selectOption({ label: 'Stockbit' });
  await expect(page.getByText(/The price is BBCA’s/)).toBeVisible();
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('broker-row').filter({ hasText: 'Stockbit' })).toContainText('Rp 875.000');
});

test('12: the tax report names the broker and files AAPL at the rupiah it cost', async ({ page }) => {
  await addBank(page, 'BCA Tahapan', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182.50', paidFrom: 'BCA Tahapan', charged: '28.835.000',
  });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await page.goto('/tax-report');
  await expect(page.getByText('Saham BBCA — Stockbit')).toBeVisible();
  const aapl = page.getByRole('row').filter({ hasText: 'Saham AAPL — Interactive Brokers' });
  await expect(aapl).toContainText('28.835.000');
  await expect(aapl).not.toContainText('182.500');
});
```

Rows 7 and 8 are `foreign-trades.spec.ts` (Task 8). The tax report opens on the current year's draft; if it needs a year chosen or a report started, follow `coretax.spec.ts`'s own steps to get there.

- [ ] **Step 3: The phone** (row 13)

```ts
// apps/web/e2e/phone-securities.spec.ts
import { expect, test } from '@playwright/test';
import { addBank, addHoldingFlow } from './securities';

/** `tokenColour` is moved (not copied) out of phone-dark-shell.spec.ts into ./securities.ts, exported, and imported by both specs. */
import { tokenColour } from './securities';

const noSideScroll = async (page: import('@playwright/test').Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('every securities screen fits a 390 px phone and is reached by thumb', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addBank(page, 'BCA Tahapan', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'BCA Tahapan' });
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await noSideScroll(page);
  await page.getByRole('link', { name: /Price today/ }).tap();
  await noSideScroll(page);
  await page.goto('/net-worth/investments');
  await noSideScroll(page);
  await page.getByTestId('broker-row').filter({ hasText: 'Stockbit' }).tap();
  await expect(page.getByText('Rp 8.750.000').first()).toBeVisible();
  await noSideScroll(page);
});

test('the investments screens follow dark mode through the kit’s tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/net-worth/investments', '/net-worth/investments/new']) {
    await page.goto(path);
    // The same comparison phone-dark-shell.spec.ts makes: the page ground is the dark token's colour, resolved.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
  }
});
```

- [ ] **Step 4: Run** `npx playwright test securities.spec.ts phone-securities.spec.ts foreign-trades.spec.ts --workers=2` → every test passes. A test that fails is fixed in the code, never by loosening a figure.
- [ ] **Step 5: Commit** `test(securities): walk every combination by keystroke, on a desktop and a phone`

### Task 15: The full gate, and the spec walked section by section

- [ ] **Step 1:** From the root: `npm run typecheck`, `npm test`, `npm run build` (read the bundle check's lines: the entry chunk contains neither list; IDX and US each in one chunk under budget). Then `cd apps/web && npx playwright test --workers=2` — the **whole** suite, both projects.
- [ ] **Step 2:** Walk the spec with the mapping below; for each line, open the file named and confirm it is there. Anything missing is a new commit before this task closes.
- [ ] **Step 3: Commit** anything the walk found (`fix(securities): …`). Do not merge or push.

---

## Spec → task mapping

| Spec section | Requirement | Task |
|---|---|---|
| Rulings | `market` field; lists ship with the app; concentration deferred; KMK per trade deferred | 3, 4 (market column, MARKETS); none built for the deferred two |
| §1 | security, price on the security, broker; per-holding basis unchanged | 4, 5, 6 |
| §2.1 | three side tables, unique ticker index, owner-level, migration 0051 | 4 |
| §2.2 | the guard; older databases behave as today | 4, 5 (older-db tests) |
| §2.3 | a security's facts; copied rows survive a lapse | 4, 12, 14 (row 10) |
| §2.4 | a broker is a money account; Another broker opens a `fund` account; one holding per security per broker | 4, 6 |
| §3.1–3.4 | one price per security; routing; carrying prices; price in the security's currency | 4, 5, 11 |
| §4.1–4.2 | cost pinned at the day's rate; `baseCosts` | 1, 6, 7 |
| §4.3 | portfolio total in base, exchange-rate movement, missing rates | 1, 10 |
| §4.4 | broker shares floor + remainder to the largest | 1, 10 |
| §5.1 | holding currency = security currency | 4 |
| §5.2 | the three cases; derived rate; typed day rate checked and stored | 2, 8, 12 |
| §5.3 | `TradeForm` and the Buy / sell tab gain the rows | 8 |
| §6.1–6.2 | two lists, MARKETS, generators, search ranking | 3, 12 |
| §6.3 | lists in chunks of their own; `check-bundle.mjs` in `npm run build`; offline behaviour | 3, 9, 12 |
| §6.4 | a new list never rewrites an owner's security | 4 (`ensureSecurityTx` returns the existing row) |
| §6.5 | free: Name it myself; paid: the US list; lapse; the entitlement seam | 9, 12, 14 |
| §7.1 | Investments: summary, By stock, Where they are kept, Add, entry rows | 10 |
| §7.2 | stock page, R1, read-only Recent | 11 |
| §7.3 | price page, This changes | 10 (`priceChangeLines`), 11 |
| §7.4 | broker page, Put in, Cash idle | 11 |
| §7.5 | Add a holding: search, Name it myself, the form, Fee, reuse of an existing holding, one transaction, Add asset route | 6, 12 |
| §7.6 | linking an old holding; lot size hidden; the price note | 4, 13 |
| §8.1 | C2 names | 2, 7, 14 (row 12) |
| §8.2 | foreign cost at the day's rate; the purchase note; frozen reports show a difference | 2, 7 |
| §9 | no new surface edits or deletes a trade; workspace checks; opening positions; oversell; cards | 4, 6, 11 (read-only rows), 8 |
| §10 | combinations 1–13 | 8 (7, 8), 14 (the rest) |
| §11 | the three readings that differ from the mockup | 1, 10 |
| §12 | open questions | not built; for the owner |
| §13 | findings | reported; 7 and 8 fix findings 3 and 4 |
---
