# Adding what you own, Coretax-shaped Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three different ways of saying what a thing is with one two-level picker per flow — Add account (cash and cash equivalents only), Add asset (five families plus "Something else"), Add debt — where the choice fixes both the Coretax code and the behaviour from one table in `packages/core`, the code is never shown while choosing, and everything already in a database keeps working and keeps its code.

**Architecture:** One catalogue, `packages/core/src/assets/catalogue.ts`, as the single source of truth: a discriminated union per item saying what it opens (`money`, `holding`, `person`, `loan`, `card`), which code it carries, which Coretax table it files under, and how it is valued. `packages/db` gains two account subtypes (`time_deposit`, `other_cash`) through migration 0047, which widens the `accounts` CHECK by rebuilding the table exactly as 0045 did, and one side table `deposit_terms` for a deposit's maturity and rate — no new column on any existing table. Three repository additions write what the pickers choose: `openCashAccount` (account + `asset_profiles` row + terms), `openDebtBalance` (a person's receivable or payable opened at a balance), `saveDepositTerms`. The web gains `apps/web/src/features/ownables/` with one `OwnablePicker` component behind three routes, `/accounts/new`, `/net-worth/assets/new` and `/debts/new`; today's inline forms stay where they are, now reading the same catalogue.

**Tech Stack:** TypeScript monorepo — `packages/core` (pure), `packages/db` (Drizzle over sqlite-proxy, SQL migrations as `?raw` imports registered in `src/migrations.ts`), `apps/web` (React 19, TanStack Router/Query, Tailwind 4); Vitest; Playwright (`chromium` and `phone` projects).

**Spec:** `docs/superpowers/specs/2026-09-18-coretax-pickers-design.md` (approved 2026-09-18)

## Global Constraints

- Branch `feat/coretax-pickers`, off `main`. Commit per task; merge and push only when the user asks. Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **No new columns on existing tables.** The ORM names every column it knows on every insert, so a column added to `accounts`, `asset_profiles`, `debt_profiles`, `loan_terms`, `transactions` or `entries` breaks any database still stopped at an older version (migration 0028's comment). The deposit's maturity and rate go in the new `deposit_terms` table.
- **Widen the `accounts` CHECK by rebuilding the table exactly as 0045 did**: `PRAGMA defer_foreign_keys = ON`, rows aside into a plain table, `DROP TABLE accounts`, recreate under the name `accounts` with every column, default, foreign key and other CHECK written as 0001 wrote them, rows back, then both of 0001's indexes — `accounts_workspace_kind` and `accounts_system_key` in the narrowed form 0043 left it in. The migration test snapshots the table's own DDL before and after with only the subtype list blanked out, and compares rows, columns, indexes, balances and `PRAGMA foreign_key_check`.
- Migration **0047** is additive apart from that CHECK. It rewrites no data. Another branch (`feat/workspace-switching`) is being built in parallel; if it lands a migration first, renumber this one and rename it — `migrate()` drops a version recorded under a different name and reruns it, so a renumber is safe but must be deliberate.
- **Older databases:** every read and write of `deposit_terms` goes through `depositTablesExist(db)`, memoised per handle exactly as `billTablesExist` is. Migration tests seed an older database either through guarded repositories or with raw SQL naming only the columns that version had.
- **Keep every existing field and flow.** The inline `AddAccountForm` on `/accounts` keeps its `Type` select and every option value it has today; `AddAssetForm` keeps its "What is it?" select and every field; `/net-worth/loans`, `/net-worth/debts` and the card form keep every path into them. The pickers are added in front, never instead. 33 Playwright specs drive `getByLabel('Type')` and 12 drive `getByLabel('What is it?')` — none of them may need editing.
- **Desktop is never weaker than phone:** the picker is a full screen on a phone and the same list inside a `Card` with the form below it on a wider screen, so a wide screen sees the list and the form at once. Every code a phone can change, a desktop can change.
- Country-neutral everywhere but the codes themselves; no banks, products or presets by country.
- Avoid files `feat/workspace-switching` is rewriting: `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/workspaces/*`, `apps/web/src/app/context.ts`, `packages/db/src/repos/books.ts`, `packages/db/src/repos/categories.ts`. Nothing in this plan touches them.
- Inside `database.transaction((tx) => …)` use `tx` only — `database.db` there deadlocks on the mutex.
- Test snippets name real functions and match the signatures read on 2026-09-18 (`createAccount`, `createAccountTx`, `saveAssetProfile`, `saveDebtProfile`, `saveLoanTerms`, `assetValuesAt`, `coretaxInputsFor`, `nativeBalances`, `createWorkspace`); re-read the type if the compiler disagrees and match it.
- Gate before every commit: `npm run typecheck` (root), `npm test` (root), and `npx playwright test --workers=2` (in `apps/web`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/assets/catalogue.ts` | the catalogue: cash items, five asset families, debt items, `somethingElse`, `elseItem`, `cashCodeForSubtype`, `searchOwnables` |
| `packages/core/src/index.ts` | export the above |
| `packages/core/test/assets-catalogue.test.ts` | the table tested as a table |
| `packages/db/migrations/0047_cash_equivalents.sql` | rebuild `accounts` with two more subtypes; create `deposit_terms` |
| `packages/db/src/migrations.ts` | register 0047 |
| `packages/db/src/schema.ts` | `accounts.subtype` enum gains `time_deposit`, `other_cash` |
| `packages/db/src/schema-assets.ts` | Drizzle `depositTerms` |
| `packages/db/src/repos/accounts.ts` | `BALANCE_SUBTYPES.asset`, `SPENDABLE_SUBTYPES` |
| `packages/db/src/repos/asset-values.ts` | `GROUP_BY_SUBTYPE` gains both as `liquid` |
| `packages/db/src/repos/flows.ts` | `SAVINGS_SUBTYPES` gains `time_deposit`; `SPENDING_SUBTYPES` gains `other_cash` |
| `packages/db/src/repos/deposit-terms.ts` | `depositTablesExist`, `saveDepositTerms`, `listDepositTerms`, `getDepositTerms` |
| `packages/db/src/repos/cash-accounts.ts` | `openCashAccount` — account, profile, terms, in one transaction |
| `packages/db/src/repos/debts.ts` | `openDebtBalance` — a person's receivable or payable opened at a balance |
| `packages/db/src/repos/tax-inputs.ts` | the cash fallback becomes `cashCodeForSubtype(subtype)` |
| `packages/db/src/index.ts` | export the new repos |
| `packages/db/test/cash-equivalents-migration.test.ts` | 0047 on a version-46 database, DDL snapshotted |
| `packages/db/test/deposits.test.ts` | opening, spendability, transfers, net worth |
| `packages/db/test/tax-inputs.test.ts` | the subtype-aware fallback, and a profile code winning over it |
| `packages/db/test/debts.test.ts` | `openDebtBalance` both ways |
| `packages/db/test/database.test.ts` | applied versions gains 47 |
| `apps/web/src/lib/account-types.ts` | `ACCOUNT_TYPES`, `SUBTYPE_LABELS`, `SPENDABLE_SUBTYPES` gain both |
| `apps/web/src/features/ownables/catalogue-view.ts` (+ `.test.ts`) | picker rows, search rows, which fields an item asks for |
| `apps/web/src/features/ownables/OwnablePicker.tsx` | the two-level list: rows, search, back, hand-over rows |
| `apps/web/src/features/ownables/AddAccountPage.tsx` | `/accounts/new` |
| `apps/web/src/features/ownables/CashAccountForm.tsx` | the form behind a cash item, deposit fields included |
| `apps/web/src/features/ownables/AddAssetPage.tsx` | `/net-worth/assets/new` — families, items, Something else |
| `apps/web/src/features/ownables/AddDebtPage.tsx` | `/debts/new` |
| `apps/web/src/features/ownables/debt-form.ts` (+ `.test.ts`) | the three debt shapes as pure plans |
| `apps/web/src/features/ownables/CodePicker.tsx` | choose a code in the catalogue's words, four-digit box beneath |
| `apps/web/src/features/networth/add-asset.ts` (+ `.test.ts`) | drafts keyed by catalogue item id, not `AssetKind` |
| `apps/web/src/features/networth/AddAssetForm.tsx` | takes an item id; select lists every item by family |
| `apps/web/src/features/networth/AssetSettings.tsx` | `CodePicker` above the four-digit box |
| `apps/web/src/features/accounts/AccountsPage.tsx` | "Add account" button to the picker; type select from the catalogue; code beside the type |
| `apps/web/src/features/loans/LoanDetailPage.tsx` | kode utang select |
| `apps/web/src/features/debts/PersonCard.tsx` | kode harta / kode utang select |
| `apps/web/src/features/transactions/TransactionForm.tsx` | `MoneyAccountOptions` gains `spendableOnly` |
| `apps/web/src/app/router.tsx` | the three new routes |
| `apps/web/src/app/nav.ts` | `/debts/new` reachable from the account sheet |
| `apps/web/e2e/coretax-pickers.spec.ts` | chromium: the three flows and the report |
| `apps/web/e2e/phone-coretax-pickers.spec.ts` | phone: the three flows by thumb |

---

## Step 1 — The catalogue

### Task 1: The catalogue, pure

**Files:**
- Create: `packages/core/src/assets/catalogue.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/assets-catalogue.test.ts`

**Interfaces:**
- Produces: types `OwnableFlow`, `OwnableFamily`, `MoneyAccountSubtype`, `OwnableBehaviour`, `OwnableItem`, `OwnableFamilyRow`; constants `CASH_ITEMS`, `ASSET_FAMILIES`, `ASSET_ITEMS`, `DEBT_ITEMS`, `HARTA_ENGLISH`; functions `cashItem`, `assetItem`, `debtItem`, `assetFamily`, `somethingElse`, `elseItem`, `cashCodeForSubtype`, `searchOwnables`.
- Consumes: `AssetKind`, `AssetSubtype`, `PlanGroup`, `UnitKind` from `./presets`; `CoretaxSection` from `./coretax-fields`; `KODE_HARTA`, `KODE_UTANG`, `HartaFamily`, `CoretaxCode`, `sectionOfCode`, `hartaLabel` from `../coretax/codes`; `searchTokens` from `../entry/quick-entry`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/assets-catalogue.test.ts
import { describe, expect, it } from 'vitest';
import {
  ASSET_FAMILIES,
  ASSET_ITEMS,
  assetFamily,
  assetItem,
  CASH_ITEMS,
  cashCodeForSubtype,
  cashItem,
  DEBT_ITEMS,
  debtItem,
  elseItem,
  KODE_HARTA,
  KODE_UTANG,
  type MoneyAccountSubtype,
  searchOwnables,
  sectionOfCode,
  somethingElse,
} from '../src/index';

const HARTA_CODES = new Set(KODE_HARTA.map((entry) => entry.code));
const UTANG_CODES = new Set(KODE_UTANG.map((entry) => entry.code));

describe('the catalogue is a table the tax form recognises', () => {
  it('gives every cash and asset item a code the harta table has', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS]) expect(HARTA_CODES).toContain(item.code);
  });

  it('gives every debt item a code the utang table has', () => {
    for (const item of DEBT_ITEMS) expect(UTANG_CODES).toContain(item.code);
  });

  it('files every item in the table its code belongs to', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS]) expect(item.section).toBe(sectionOfCode(item.code));
    for (const item of DEBT_ITEMS) expect(item.section).toBeNull();
  });

  it('names each thing once per flow', () => {
    for (const items of [CASH_ITEMS, ASSET_ITEMS, DEBT_ITEMS]) {
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });

  it('gives every item words for the picker and never the code itself', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS, ...DEBT_ITEMS]) {
      expect(item.label.length).toBeGreaterThan(2);
      expect(item.label).not.toContain(item.code);
    }
  });
});

describe('cash and cash equivalents', () => {
  const SUBTYPES: MoneyAccountSubtype[] = ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash'];

  it('offers the seven kinds of account that hold money, in the order the screen lists them', () => {
    expect(CASH_ITEMS.map((item) => item.id)).toEqual(SUBTYPES);
    expect(CASH_ITEMS.map((item) => item.code)).toEqual(['0101', '0102', '0102', '0104', '0105', '0109', '0109']);
  });

  it('opens an account of its own subtype, and only the deposit cannot be paid from', () => {
    for (const subtype of SUBTYPES) {
      const item = cashItem(subtype);
      expect(item.behaviour).toMatchObject({ opens: 'money', subtype, spendable: subtype !== 'time_deposit' });
    }
    expect(cashItem('time_deposit').behaviour).toMatchObject({ valuedBy: 'deposit' });
    expect(cashItem('bank').behaviour).toMatchObject({ valuedBy: 'balance' });
  });

  it('answers with a default code for any subtype, and falls back to tabungan', () => {
    expect(cashCodeForSubtype('cash')).toBe('0101');
    expect(cashCodeForSubtype('bank')).toBe('0102');
    expect(cashCodeForSubtype('savings')).toBe('0102');
    expect(cashCodeForSubtype('time_deposit')).toBe('0104');
    expect(cashCodeForSubtype('ewallet')).toBe('0105');
    expect(cashCodeForSubtype('fund')).toBe('0109');
    expect(cashCodeForSubtype('other_cash')).toBe('0109');
    expect(cashCodeForSubtype('investment')).toBe('0102');
  });

  it('refuses a subtype it has never heard of', () => {
    expect(() => cashItem('crypto_wallet' as MoneyAccountSubtype)).toThrow(/crypto_wallet/);
  });
});

describe('the five families', () => {
  it('lists them in the order the screen lists them, each naming its table', () => {
    expect(ASSET_FAMILIES.map((family) => family.id)).toEqual(['receivable', 'invest', 'movable', 'immovable', 'other']);
    expect(ASSET_FAMILIES.map((family) => family.section)).toEqual(['piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya']);
  });

  it('keeps the eight kinds the app already had as ids, so nothing already written has to move', () => {
    expect(assetItem('gold')).toMatchObject({ code: '0701', behaviour: { assetKind: 'gold', valuedBy: 'grams', unitKind: 'grams' } });
    expect(assetItem('stock')).toMatchObject({ code: '0303', behaviour: { assetKind: 'stock', valuedBy: 'units', unitKind: 'shares', lotSize: 100 } });
    expect(assetItem('fund')).toMatchObject({ code: '0307', behaviour: { assetKind: 'fund', valuedBy: 'units', unitKind: 'units' } });
    expect(assetItem('bond')).toMatchObject({ code: '0305', behaviour: { assetKind: 'bond', valuedBy: 'face', unitKind: 'face' } });
    expect(assetItem('property')).toMatchObject({ code: '0502', behaviour: { assetKind: 'property', valuedBy: 'value' } });
    expect(assetItem('vehicle')).toMatchObject({ code: '0403', behaviour: { assetKind: 'vehicle', valuedBy: 'value' } });
    expect(assetItem('other')).toMatchObject({ code: '0799', behaviour: { assetKind: 'other', valuedBy: 'value' } });
    // Money added as an asset: kept for what is already there, never offered in the picker.
    expect(assetItem('cash')).toMatchObject({ code: '0102', behaviour: { assetKind: 'cash', valuedBy: 'balance' } });
    expect(ASSET_FAMILIES.flatMap((family) => family.items).map((item) => item.id)).not.toContain('cash');
  });

  it('values investments the way each is actually priced', () => {
    expect(assetFamily('invest').items.map((item) => item.code)).toEqual(['0303', '0302', '0307', '0304', '0305', '0308', '0310', '0311']);
    expect(assetItem('unlisted_stock').behaviour).toMatchObject({ assetKind: 'other', valuedBy: 'value', planGroup: 'invest' });
    expect(assetItem('corporate_bond').behaviour).toMatchObject({ assetKind: 'bond', valuedBy: 'face' });
    expect(assetItem('unit_link').behaviour).toMatchObject({ assetKind: 'other', valuedBy: 'value', planGroup: 'invest' });
  });

  it('lets a receivable take its value from the ledger, never from a number typed', () => {
    expect(assetFamily('receivable').items.map((item) => item.code)).toEqual(['0201', '0202', '0209']);
    for (const item of assetFamily('receivable').items) {
      expect(item.behaviour).toMatchObject({ opens: 'person', direction: 'lent', valuedBy: 'ledger' });
    }
  });

  it('puts things you live with under personal use and things that grow under investments', () => {
    expect(assetItem('apartment').behaviour).toMatchObject({ assetKind: 'property', planGroup: 'use', valuedBy: 'value' });
    expect(assetItem('motorcycle').behaviour).toMatchObject({ assetKind: 'vehicle', planGroup: 'use' });
    expect(assetItem('gold_jewellery').behaviour).toMatchObject({ assetKind: 'gold', planGroup: 'invest', valuedBy: 'grams', orTyped: true });
    expect(assetItem('patent').behaviour).toMatchObject({ assetKind: 'other', planGroup: 'use' });
  });
});

describe('something else', () => {
  it('offers exactly what the family has not spent, in the order the form lists it', () => {
    expect(somethingElse('receivable')).toEqual([]);
    expect(somethingElse('invest').map((code) => code.code)).toEqual(['0301', '0306', '0309', '0399']);
    expect(somethingElse('movable').map((code) => code.code)).toEqual(['0401', '0404', '0405', '0406', '0407', '0408', '0409', '0410', '0411', '0412']);
    expect(somethingElse('immovable').map((code) => code.code)).toEqual(['0504', '0505']);
    expect(somethingElse('other').map((code) => code.code)).toEqual(['0699', '0707', '0711', '0712']);
  });

  it('accounts for every harta code once: an item of a family, or something else in it', () => {
    const named = new Set([...CASH_ITEMS, ...ASSET_ITEMS].map((item) => item.code));
    const spare = new Set(ASSET_FAMILIES.flatMap((family) => somethingElse(family.id)).map((code) => code.code));
    for (const code of spare) expect(named.has(code)).toBe(false);
    // Only the four kas codes the account screen deliberately leaves out are unreachable.
    const unreachable = KODE_HARTA.filter((entry) => !named.has(entry.code) && !spare.has(entry.code));
    expect(unreachable.map((entry) => entry.code)).toEqual(['0103', '0106', '0107', '0108']);
  });

  it('records anything else as a thing you give a value to, filed under its family', () => {
    const bus = elseItem('movable', '0404');
    expect(bus).toMatchObject({ id: 'else:0404', label: 'Bus', code: '0404', section: 'bergerak' });
    expect(bus.behaviour).toMatchObject({ opens: 'holding', assetKind: 'vehicle', planGroup: 'use', valuedBy: 'value' });
    expect(bus.sub).toBe('Bus');
    expect(elseItem('other', '0711')).toMatchObject({ label: 'Jet ski', sub: 'Jet ski', section: 'lainnya' });
    expect(elseItem('invest', '0399').behaviour).toMatchObject({ assetKind: 'other', planGroup: 'invest' });
    expect(assetItem('else:0404')).toEqual(bus);
  });

  it('refuses a code the family does not hold', () => {
    expect(() => elseItem('movable', '0502')).toThrow(/0502/);
  });
});

describe('debts', () => {
  it('lists them the way someone would say them, with the code behind each', () => {
    expect(DEBT_ITEMS.map((item) => item.code)).toEqual(['101', '101', '101', '102', '101', '101', '101', '103', '109']);
    expect(debtItem('home_mortgage').behaviour).toMatchObject({ opens: 'loan', asksRate: true });
    expect(debtItem('online_loan').behaviour).toMatchObject({ opens: 'loan', asksRate: false });
    expect(debtItem('credit_card').behaviour).toMatchObject({ opens: 'card' });
    expect(debtItem('affiliate_debt').behaviour).toMatchObject({ opens: 'person', direction: 'borrowed' });
    expect(debtItem('other_debt')).toMatchObject({ code: '109', behaviour: { opens: 'person', direction: 'borrowed' } });
  });
});

describe('searching', () => {
  it('finds a thing by its name, by its quieter line, and by its code', () => {
    expect(searchOwnables('gopay', 'account').map((item) => item.id)).toEqual(['ewallet']);
    expect(searchOwnables('reksadana', 'asset').map((item) => item.id)).toEqual(['fund']);
    expect(searchOwnables('0503', 'asset').map((item) => item.id)).toEqual(['apartment']);
    expect(searchOwnables('paylater', 'debt').map((item) => item.id)).toEqual(['online_loan']);
  });

  it('needs every word to match, and answers nothing rather than everything', () => {
    expect(searchOwnables('gold jewellery', 'asset').map((item) => item.id)).toEqual(['gold_jewellery']);
    expect(searchOwnables('helicopter', 'asset')).toEqual([]);
    expect(searchOwnables('', 'asset').length).toBe(ASSET_ITEMS.length);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/core && npx vitest run test/assets-catalogue.test.ts`
Expected: FAIL — `CASH_ITEMS` is not exported from `../src/index`.

- [ ] **Step 3: Implement**

Write `packages/core/src/assets/catalogue.ts` with the types of the spec §2.2, then the four tables of §2.3, §2.4 and §2.6 as plain `const` arrays in the order the spec's tables give. Shape and key mechanics:

```ts
const money = (
  subtype: MoneyAccountSubtype,
  label: string,
  sub: string,
  code: string,
  opts: { valuedBy?: 'balance' | 'deposit'; spendable?: boolean } = {},
): OwnableItem => ({
  id: subtype,
  label,
  sub,
  code,
  section: 'kas',
  behaviour: { opens: 'money', subtype, valuedBy: opts.valuedBy ?? 'balance', spendable: opts.spendable ?? true },
});

const holding = (
  id: string,
  label: string,
  code: string,
  behaviour: Omit<Extract<OwnableBehaviour, { opens: 'holding' }>, 'opens'>,
  sub?: string,
): OwnableItem => ({ id, label, sub: sub ?? VALUED_BY_WORDS[behaviour.valuedBy], code, section: sectionOfCode(code), behaviour: { opens: 'holding', ...behaviour } });

/** The quiet line under an item, naming how it is valued — the mockup's own words. */
const VALUED_BY_WORDS: Record<string, string> = {
  units: 'units × price',
  face: 'face value × price',
  grams: 'grams × gold price',
  value: 'a value you type',
  ledger: 'from what people owe you',
  balance: 'the balance you hold',
};
```

`somethingElse` is computed, never typed:

```ts
export function somethingElse(id: OwnableFamily): CoretaxCode[] {
  const family = assetFamily(id);
  const spent = new Set(family.items.map((item) => item.code));
  return KODE_HARTA.filter((entry) => entry.family === family.hartaFamily && !spent.has(entry.code));
}
```

`elseItem(id, code)` throws unless `somethingElse(id)` holds the code, then builds a typed-value holding using the family's own `assetKind`, `subtype` and `planGroup` — `vehicle`/`vehicle`/`use` for `movable`, `property`/`property`/`use` for `immovable`, `other`/`investment`/`invest` for `invest`, `other`/`investment`/`use` for `other` — with `label: HARTA_ENGLISH[code]` and `sub: HARTA_ENGLISH[code]`. `assetItem` recognises an `else:NNNN` id by parsing the code and finding the family that holds it.

`searchOwnables(query, flow)` uses `searchTokens(query)` and requires every token to appear in `` `${label} ${sub} ${code}`.toLowerCase() ``; an empty query returns the flow's whole list.

Export everything named in **Interfaces** from `packages/core/src/index.ts`, beside the existing
`export { … } from './assets/presets';` line.

- [ ] **Step 4: Run and see it pass**

Run: `cd packages/core && npx vitest run test/assets-catalogue.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

`npm run typecheck`, `npm test` (root). Commit: `feat(core): one table for everything a person can own`.

---

## Step 2 — Two more kinds of account

### Task 2: Migration 0047, and the shape of the table it leaves behind

**Files:**
- Create: `packages/db/migrations/0047_cash_equivalents.sql`
- Modify: `packages/db/src/migrations.ts`, `packages/db/src/schema.ts`, `packages/db/src/schema-assets.ts`
- Test: `packages/db/test/cash-equivalents-migration.test.ts`, `packages/db/test/database.test.ts`

**Interfaces:**
- Produces: migration 47 `cash_equivalents`; `accounts.subtype` accepting `time_deposit` and `other_cash`; table `deposit_terms`; Drizzle `depositTerms`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/cash-equivalents-migration.test.ts
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccount, createDatabase, createWorkspace, type Database, migrate, MIGRATIONS, nativeBalances, type WorkspaceContext } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

let executor: NodeExecutor | undefined;
let database: Database;
let ws: WorkspaceContext;

afterEach(() => {
  executor?.close();
  executor = undefined;
});

/** A version 46 database with money in it, written the way a version 46 build would have written it. */
async function atVersion46() {
  executor = createNodeExecutor();
  database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version <= 46));
  ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });

  const w = ws.workspaceId;
  const account = (id: string, kind: string, subtype: string, name: string, currency: string | null) =>
    database.execScript(
      `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
       VALUES ('${id}', '${w}', NULL, '${kind}', '${subtype}', '${name}', NULL,
         ${currency === null ? 'NULL' : `'${currency}'`}, 'derived', NULL, 3, NULL, '2026-01-01T00:00:00Z')`,
    );
  await account('acc-bca', 'asset', 'bank', 'BCA Tahapan', 'IDR');
  await account('acc-gopay', 'asset', 'ewallet', 'GoPay', 'IDR');
  await account('acc-rdn', 'asset', 'fund', 'RDN Mandiri', 'IDR');
  await account('acc-visa', 'liability', 'credit_card', 'BCA Visa', 'IDR');
  await account('acc-groceries', 'expense', 'category', 'Belanja harian', null);

  await database.execScript(
    `INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
     VALUES ('tx-open', '${w}', '2026-01-01', 'Opening balance', 'manual', 'posted', '2026-01-01T00:00:00Z')`,
  );
  for (const [n, [accountId, amountMinor]] of [['acc-bca', 20_000_000], ['acc-gopay', 500_000]].entries()) {
    await database.execScript(
      `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
       VALUES ('tx-open-e${n}', '${w}', 'tx-open', '${accountId}', ${amountMinor}, 'IDR', 1, ${amountMinor})`,
    );
  }
}

/** Line breaks and runs of spaces differ between the migration that wrote a statement and the one that
    rewrites it; nothing about the constraint does. Compared on one line, the texts have to match. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const SUBTYPE_CHECK = /CHECK \(subtype IN \([^)]*\)\)/;
const allowedSubtypes = (ddl: string) => [...ddl.match(SUBTYPE_CHECK)![0].matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort();
const shapeApartFromSubtypes = (ddl: string) => flat(ddl).replace(SUBTYPE_CHECK, 'CHECK (subtype IN (...))');

async function accountsSchema() {
  const [[ddl]] = (await database.db.values<[string]>(
    sql`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`,
  )) as [[string]];
  const indexes = await database.db.values<[string, string | null]>(
    sql`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts' ORDER BY name`,
  );
  return {
    rows: await database.db.values(sql`SELECT * FROM accounts ORDER BY id`),
    columns: await database.db.values(sql`PRAGMA table_info(accounts)`),
    ddl,
    indexes: indexes.map(([name, indexSql]) => [name, indexSql === null ? null : flat(indexSql)]),
  };
}

describe('migration 0047', () => {
  beforeEach(atVersion46);

  it('is version 47 and named cash_equivalents', () => {
    expect(MIGRATIONS.find((m) => m.version === 47)).toMatchObject({ name: 'cash_equivalents' });
  });

  it('leaves every account, every index and every balance exactly as it found them', async () => {
    const before = await accountsSchema();
    const balancesBefore = await nativeBalances(database, ws);
    expect(before.rows.length).toBeGreaterThan(4);

    expect(await migrate(database)).toEqual([47]);

    const after = await accountsSchema();
    expect(after.rows).toEqual(before.rows);
    expect(after.columns).toEqual(before.columns);
    expect(after.indexes).toEqual(before.indexes);
    expect(after.indexes.map(([name]) => name)).toEqual([
      'accounts_system_key',
      'accounts_workspace_kind',
      // The primary key's own index, proof the table was rebuilt with the same key and not merely emptied.
      'sqlite_autoindex_accounts_1',
    ]);
    expect(await nativeBalances(database, ws)).toEqual(balancesBefore);
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });

  it('rewrites nothing in the table but the list of subtypes', async () => {
    const before = await accountsSchema();

    await migrate(database);

    const after = await accountsSchema();
    expect(shapeApartFromSubtypes(after.ddl)).toBe(shapeApartFromSubtypes(before.ddl));
    expect(allowedSubtypes(before.ddl)).not.toContain('time_deposit');
    expect(allowedSubtypes(after.ddl)).toEqual([...allowedSubtypes(before.ddl), 'other_cash', 'time_deposit'].sort());
    for (const clause of ['REFERENCES workspaces(id)', 'REFERENCES accounts(id)', 'id TEXT PRIMARY KEY']) {
      expect(flat(after.ddl)).toContain(clause);
    }
  });

  it('still refuses an asset with no currency, a workspace that does not exist, and a second system key', async () => {
    await migrate(database);
    const w = ws.workspaceId;
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-no-currency', '${w}', 'asset', 'time_deposit', 'Deposito with no currency', NULL, 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nowhere', 'no-such-workspace', 'asset', 'other_cash', 'Cheque', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, system_key, sort_order, created_at)
         VALUES ('acc-dup', '${w}', 'equity', 'equity', 'Opening balances again', NULL, 'derived', 'opening_balance', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('takes a time deposit and other cash equivalents, and still refuses a subtype it has never heard of', async () => {
    await migrate(database);

    const deposito = await createAccount(database, ws, { name: 'Deposito BCA 6 bulan', kind: 'asset', subtype: 'time_deposit', currency: 'IDR', openingBalanceMinor: 100_000_000 });
    const cheque = await createAccount(database, ws, { name: 'Cek BNI', kind: 'asset', subtype: 'other_cash', currency: 'IDR', openingBalanceMinor: 7_500_000 });

    const balances = await nativeBalances(database, ws);
    expect(balances[deposito.id]).toBe(100_000_000);
    expect(balances[cheque.id]).toBe(7_500_000);

    await expect(
      database.execScript(
        `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
         VALUES ('acc-nonsense', '${ws.workspaceId}', 'asset', 'crypto_wallet', 'Nonsense', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toThrow();
  });

  it('was refusing both before it ran', async () => {
    for (const subtype of ['time_deposit', 'other_cash']) {
      await expect(
        database.execScript(
          `INSERT INTO accounts (id, workspace_id, kind, subtype, name, currency, valuation_mode, sort_order, created_at)
           VALUES ('acc-${subtype}', '${ws.workspaceId}', 'asset', '${subtype}', 'Too early', 'IDR', 'derived', 0, '2026-01-01T00:00:00Z')`,
        ),
      ).rejects.toThrow();
    }
  });

  it('adds deposit_terms, which nothing had before, keyed to the account and refusing a negative rate', async () => {
    expect(await database.db.values(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deposit_terms'`)).toEqual([]);

    await migrate(database);

    const columns = (await database.db.values<unknown[]>(sql`PRAGMA table_info(deposit_terms)`)).map((row) => String(row[1]));
    expect(columns).toEqual(['account_id', 'workspace_id', 'matures_on', 'rate_bps', 'created_at']);
    const deposito = await createAccount(database, ws, { name: 'Deposito BCA', kind: 'asset', subtype: 'time_deposit', currency: 'IDR' });
    await database.execScript(
      `INSERT INTO deposit_terms (account_id, workspace_id, matures_on, rate_bps, created_at)
       VALUES ('${deposito.id}', '${ws.workspaceId}', '2027-03-01', 625, '2026-09-18T00:00:00Z')`,
    );
    await expect(
      database.execScript(
        `INSERT INTO deposit_terms (account_id, workspace_id, matures_on, rate_bps, created_at)
         VALUES ('acc-bca', '${ws.workspaceId}', '2027-03-01', -1, '2026-09-18T00:00:00Z')`,
      ),
    ).rejects.toThrow();
    expect(await database.db.values(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });
});
```

In `packages/db/test/database.test.ts`, extend the applied-versions list on line 20 with `47`.

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/db && npx vitest run test/cash-equivalents-migration.test.ts`
Expected: FAIL — no migration is version 47.

- [ ] **Step 3: Implement**

`packages/db/migrations/0047_cash_equivalents.sql`, opening with the comment that explains the rebuild (copy 0045's reasoning; say that a time deposit holds money it cannot be paid from, and that other cash equivalents are cheque, wesel and commercial paper):

```sql
PRAGMA defer_foreign_keys = ON;

CREATE TABLE accounts_rebuild_0047 AS SELECT * FROM accounts;

DROP TABLE accounts;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'income', 'expense', 'equity')),
  subtype TEXT NOT NULL CHECK (subtype IN ('cash', 'bank', 'credit_card', 'savings', 'fund', 'ewallet', 'time_deposit',
    'other_cash', 'investment', 'property', 'vehicle', 'receivable', 'payable', 'loan', 'category', 'equity')),
  name TEXT NOT NULL,
  icon TEXT,
  currency TEXT,
  valuation_mode TEXT NOT NULL DEFAULT 'derived' CHECK (valuation_mode IN ('derived', 'snapshot', 'market')),
  system_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (kind IN ('income', 'expense', 'equity') OR currency IS NOT NULL)
);

INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at)
SELECT id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode,
  system_key, sort_order, archived_at, created_at FROM accounts_rebuild_0047;

DROP TABLE accounts_rebuild_0047;

CREATE INDEX accounts_workspace_kind ON accounts (workspace_id, kind);
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');

-- After the rebuild, so its foreign key never points at a table that is about to be dropped.
CREATE TABLE deposit_terms (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  matures_on TEXT NOT NULL,
  rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (rate_bps >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX deposit_terms_workspace ON deposit_terms (workspace_id, matures_on);
```

Register it in `migrations.ts` (`import cashEquivalents from '../migrations/0047_cash_equivalents.sql?raw';` and `{ version: 47, name: 'cash_equivalents', sql: cashEquivalents }`). Add both subtypes to the `accounts.subtype` enum in `schema.ts`, in the same order as the SQL. Add `depositTerms` to `schema-assets.ts`:

```ts
export const depositTerms = sqliteTable('deposit_terms', {
  accountId: text('account_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** The day the money comes back. Nothing is automated off it: the owner moves it with a transfer. */
  maturesOn: text('matures_on').notNull(),
  rateBps: integer('rate_bps').notNull(),
  createdAt: text('created_at').notNull(),
});
```

- [ ] **Step 4: Run and see it pass**

Run: `cd packages/db && npx vitest run test/cash-equivalents-migration.test.ts test/database.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

`npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2`. Commit: `feat(db): a deposit and a cheque are accounts too`.

---

### Task 3: What the ledger does with them

**Files:**
- Create: `packages/db/src/repos/deposit-terms.ts`, `packages/db/src/repos/cash-accounts.ts`
- Modify: `packages/db/src/repos/accounts.ts`, `asset-values.ts`, `flows.ts`, `tax-inputs.ts`, `debts.ts`, `packages/db/src/index.ts`, `apps/web/src/lib/account-types.ts`
- Test: `packages/db/test/deposits.test.ts`, `packages/db/test/tax-inputs.test.ts`, `packages/db/test/debts.test.ts`

**Interfaces:**
- Produces: `depositTablesExist`, `saveDepositTerms`, `getDepositTerms`, `listDepositTerms`, `openCashAccount`, `openDebtBalance`.
- Consumes: `cashCodeForSubtype`, `cashItem` from `@expanses/core`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/deposits.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { MoneyAccountSubtype } from '@expanses/core';
import {
  assetValuesAt,
  type Database,
  getAssetProfile,
  getDebtProfile,
  getDepositTerms,
  nativeBalances,
  netWorthAt,
  openCashAccount,
  openDebtBalance,
  postTransaction,
  SPENDABLE_SUBTYPES,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
beforeEach(async () => {
  ({ database, ws } = await setupDb());
});

describe('opening an account from the catalogue', () => {
  it('writes the account, its tax code and its group in one go', async () => {
    const gopay = await openCashAccount(database, ws, { item: 'ewallet', name: 'GoPay', currency: 'IDR', openingBalanceMinor: 500_000, openedOn: '2026-09-01' });

    const profile = await getAssetProfile(database, ws, gopay.id);
    expect(profile).toMatchObject({ assetKind: 'cash', planGroup: 'liquid', coretaxSection: 'kas', coretaxCode: '0105' });
    expect((await assetValuesAt(database, ws, '2026-09-18')).find((row) => row.accountId === gopay.id)).toMatchObject({
      valueMinor: 500_000,
      mode: 'derived',
      planGroup: 'liquid',
    });
  });

  it('gives each kind of money account the code the form expects', async () => {
    const codes: [MoneyAccountSubtype, string][] = [
      ['cash', '0101'],
      ['bank', '0102'],
      ['savings', '0102'],
      ['time_deposit', '0104'],
      ['ewallet', '0105'],
      ['fund', '0109'],
      ['other_cash', '0109'],
    ];
    for (const [item, code] of codes) {
      // Only the deposit reads maturesOn; the others ignore it, which is what lets one loop cover all seven.
      const account = await openCashAccount(database, ws, { item, name: `A ${item}`, currency: 'IDR', maturesOn: '2027-03-01' });
      expect((await getAssetProfile(database, ws, account.id))?.coretaxCode).toBe(code);
    }
  });
});

describe('a time deposit', () => {
  it('holds money it cannot be paid from', async () => {
    expect(SPENDABLE_SUBTYPES).not.toContain('time_deposit');
    expect(SPENDABLE_SUBTYPES).toContain('other_cash');
  });

  it('keeps its maturity and its rate beside it', async () => {
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Deposito BCA 6 bulan',
      currency: 'IDR',
      openingBalanceMinor: 100_000_000,
      openedOn: '2026-09-01',
      maturesOn: '2027-03-01',
      rateBps: 625,
    });
    expect(await getDepositTerms(database, ws, deposito.id)).toMatchObject({ maturesOn: '2027-03-01', rateBps: 625 });
  });

  it('counts as cash you hold, and the money leaves by a transfer when it matures', async () => {
    const bca = await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-09-01' });
    const deposito = await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'Deposito BCA 6 bulan',
      currency: 'IDR',
      openingBalanceMinor: 100_000_000,
      openedOn: '2026-09-01',
      maturesOn: '2027-03-01',
      rateBps: 625,
    });

    expect((await netWorthAt(database, ws, '2026-09-18', {})).assetsMinor).toBe(120_000_000);
    const values = await assetValuesAt(database, ws, '2026-09-18');
    expect(values.find((row) => row.accountId === deposito.id)).toMatchObject({ planGroup: 'liquid', valueMinor: 100_000_000 });

    await postTransaction(database, ws, {
      occurredOn: '2027-03-01',
      description: 'Deposito matured',
      lines: [
        { accountId: deposito.id, amountMinor: -100_000_000, currency: 'IDR' },
        { accountId: bca.id, amountMinor: 100_000_000, currency: 'IDR' },
      ],
    });
    const after = await assetValuesAt(database, ws, '2027-03-01');
    expect(after.find((row) => row.accountId === deposito.id)?.valueMinor).toBe(0);
    expect(after.find((row) => row.accountId === bca.id)?.valueMinor).toBe(120_000_000);
  });
});

describe('a debt or a receivable opened at a balance', () => {
  it('opens a person account with what is owed and the code that was chosen', async () => {
    const owed = await openDebtBalance(database, ws, {
      direction: 'lent',
      personName: 'PT Sejahtera',
      currency: 'IDR',
      balanceMinor: 25_000_000,
      openedOn: '2026-09-01',
      coretaxCode: '0202',
    });
    expect(await getDebtProfile(database, ws, owed.id)).toMatchObject({ direction: 'lent', personName: 'PT Sejahtera', coretaxCode: '0202' });
    expect((await nativeBalances(database, ws))[owed.id]).toBe(25_000_000);

    const oweThem = await openDebtBalance(database, ws, {
      direction: 'borrowed',
      personName: 'Ibu',
      currency: 'IDR',
      balanceMinor: 10_000_000,
      openedOn: '2026-09-01',
      coretaxCode: '103',
    });
    expect(await getDebtProfile(database, ws, oweThem.id)).toMatchObject({ direction: 'borrowed', coretaxCode: '103' });
    expect((await nativeBalances(database, ws))[oweThem.id]).toBe(-10_000_000);
  });
});
```

And, appended to `packages/db/test/tax-inputs.test.ts`:

```ts
describe('the code a money account files under', () => {
  // The file's own beforeEach already opened BCA, gold, the house, the card and the KPR through setupDb;
  // these two tests add to that workspace rather than making another.
  it('follows its kind of account when the owner has never chosen one', async () => {
    const opened: Record<string, string> = {};
    for (const subtype of ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash'] as const) {
      const account = await createAccount(database, ws, { name: `A ${subtype}`, kind: 'asset', subtype, currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01' });
      opened[subtype] = account.id;
    }
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const codeOf = (subtype: string) => inputs.cash.find((row) => row.accountId === opened[subtype])!.code;
    expect(codeOf('cash')).toBe('0101');
    expect(codeOf('bank')).toBe('0102');
    expect(codeOf('savings')).toBe('0102');
    expect(codeOf('time_deposit')).toBe('0104');
    expect(codeOf('ewallet')).toBe('0105');
    expect(codeOf('fund')).toBe('0109');
    expect(codeOf('other_cash')).toBe('0109');
  });

  it('never overrules a code the owner did choose', async () => {
    const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 500_000, openedOn: '2026-01-01' });
    await saveAssetProfile(database, ws, { accountId: wallet.id, assetKind: 'cash', coretaxSection: 'kas', coretaxCode: '0109' });
    const inputs = await coretaxInputsFor(database, ws, 2026);
    expect(inputs.cash.find((row) => row.accountId === wallet.id)!.code).toBe('0109');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd packages/db && npx vitest run test/deposits.test.ts test/tax-inputs.test.ts`
Expected: FAIL — `openCashAccount` is not exported.

- [ ] **Step 3: Implement**

List changes first, each one line:

- `repos/accounts.ts`: `BALANCE_SUBTYPES.asset` gains `'time_deposit'` and `'other_cash'`; `SPENDABLE_SUBTYPES` gains `'other_cash'` only, with a comment saying a deposit holds money it cannot be paid from and leaves by a transfer.
- `repos/asset-values.ts`: `GROUP_BY_SUBTYPE` gains `time_deposit: 'liquid'` and `other_cash: 'liquid'`.
- `repos/flows.ts`: `SAVINGS_SUBTYPES` gains `'time_deposit'`; `SPENDING_SUBTYPES` gains `'other_cash'`.
- `apps/web/src/lib/account-types.ts`: `ACCOUNT_TYPES` gains both as assets (after `fund`); `SUBTYPE_LABELS` gains `time_deposit: 'Time deposit'` and `other_cash: 'Other cash equivalents'`; `SPENDABLE_SUBTYPES` gains `'other_cash'`. `lib/account-types.test.ts` already asserts the web and ledger lists match, so it holds them in step for free.

`repos/deposit-terms.ts` follows `bill-months.ts` exactly for the guard:

```ts
const depositTables = new WeakMap<Db, boolean>();

/** Whether migration 0047 has run. A database stopped before it simply has no deposits. */
export async function depositTablesExist(db: Db): Promise<boolean> {
  if (depositTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deposit_terms'`);
  const exists = rows.length > 0;
  if (exists) depositTables.set(db, true);
  return exists;
}
```

with `saveDepositTermsTx(tx, ws, { accountId, maturesOn, rateBps })` (guarded, upsert on `accountId`), `getDepositTerms` and `listDepositTerms` (guarded, returning `undefined` / `[]` without the table).

`repos/cash-accounts.ts`:

```ts
export interface OpenCashAccountInput {
  /** A `MoneyAccountSubtype` from the catalogue: which of the seven kinds of money account this is. */
  item: MoneyAccountSubtype;
  name: string;
  currency: string;
  openingBalanceMinor?: number;
  openedOn?: string;
  openingRateToBase?: number;
  /** Time deposit only. */
  maturesOn?: string;
  rateBps?: number;
}

/** Opens a money account with the code and the behaviour its catalogue item fixes. */
export async function openCashAccount(database: Database, ws: WorkspaceContext, input: OpenCashAccountInput): Promise<AccountRow> {
  const item = cashItem(input.item);
  if (item.behaviour.valuedBy === 'deposit' && !input.maturesOn) throw new AccountError('Say when the deposit matures');
  return database.transaction(async (tx) => {
    const account = await createAccountTx(tx, ws, {
      name: input.name,
      kind: 'asset',
      subtype: item.behaviour.subtype,
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
    });
    await saveAssetProfileTx(tx, ws, {
      accountId: account.id,
      assetKind: 'cash',
      planGroup: 'liquid',
      coretaxSection: 'kas',
      coretaxCode: item.code,
    });
    if (item.behaviour.valuedBy === 'deposit') {
      await saveDepositTermsTx(tx, ws, { accountId: account.id, maturesOn: input.maturesOn!, rateBps: input.rateBps ?? 0 });
    }
    return account;
  });
}
```

`saveAssetProfile` is currently only exposed with its own transaction; extract its body into `saveAssetProfileTx(tx, ws, input)` in `repos/assets.ts` and have `saveAssetProfile` call it inside `database.transaction`. No behaviour change, and nothing else in `assets.ts` moves.

`repos/debts.ts` gains, beside `openPersonTx`:

```ts
export interface OpenDebtBalanceInput {
  direction: DebtDirection;
  personName: string;
  currency: string;
  /** What is owed now, as a positive amount whichever way the debt runs. */
  balanceMinor: number;
  openedOn?: string;
  personIdNumber?: string | null;
  reason?: string | null;
  dueOn?: string | null;
  coretaxCode?: string;
  openingRateToBase?: number;
}

/**
 * A debt or a receivable that already existed, opened at what is owed today. `recordLoan` is for money
 * moving now and needs an account to move it from; this one posts against Opening Balances, the way
 * every other balance brought in from before the app does.
 */
export async function openDebtBalance(database: Database, ws: WorkspaceContext, input: OpenDebtBalanceInput): Promise<{ id: string }>;
```

It calls `createAccountTx` with `kind`/`subtype` from the direction and `openingBalanceMinor: input.balanceMinor` (natural sign: `openingBalanceLines` already turns a liability's amount owed the right way round), then `writeProfileTx` with the person and `input.coretaxCode`.

`repos/tax-inputs.ts`: one line, in the `value.mode === 'derived'` branch — read the account's subtype from the `liabilities` query, which already selects every account of the workspace, and rename it `accountRows`; then

```ts
inputs.cash.push({ …, code: code ?? cashCodeForSubtype(subtypeOf.get(value.accountId) ?? 'bank'), … });
```

Export the two new repos from `packages/db/src/index.ts` (`export * from './repos/cash-accounts';`, `export * from './repos/deposit-terms';`).

- [ ] **Step 4: Run and see it pass**

Run: `cd packages/db && npx vitest run` then `cd ../../apps/web && npx vitest run src/lib/account-types.test.ts`
Expected: PASS, including every existing db test.

- [ ] **Step 5: Gate and commit**

`npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2`. Commit: `feat(db): money that is locked away, and the code each account files under`.

---

## Step 3 — The three pickers

### Task 4: The picker, and Add account

**Files:**
- Create: `apps/web/src/features/ownables/catalogue-view.ts`, `catalogue-view.test.ts`, `OwnablePicker.tsx`, `AddAccountPage.tsx`, `CashAccountForm.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/features/accounts/AccountsPage.tsx`, `apps/web/src/features/transactions/TransactionForm.tsx`

**Interfaces:**
- Produces: route `/accounts/new`; `OwnablePicker`; `pickerRows`, `fieldsFor`, `handOverRows` in `catalogue-view.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/features/ownables/catalogue-view.test.ts
import { describe, expect, it } from 'vitest';
import { fieldsFor, pickerRows } from './catalogue-view';

describe('the rows a picker draws', () => {
  it('shows the seven money accounts under one kicker, and never a code', () => {
    const rows = pickerRows({ flow: 'account', query: '' });
    expect(rows.map((row) => row.label)).toEqual([
      'Cash',
      'Bank account',
      'Saving account',
      'Time deposit',
      'Electronic money',
      'Fund account',
      'Other cash equivalents',
    ]);
    expect(rows.map((row) => row.sub)).toContain('locked until it matures');
    // A row carries no code at all, so no screen built on one can leak it into the picker.
    for (const row of rows) expect(Object.keys(row)).not.toContain('code');
    expect(JSON.stringify(rows)).not.toMatch(/\b0\d{3}\b/);
  });

  it('shows the five families first, then the things in one of them, then what is left of its table', () => {
    expect(pickerRows({ flow: 'asset', query: '' }).map((row) => row.id)).toEqual(['receivable', 'invest', 'movable', 'immovable', 'other']);
    const invest = pickerRows({ flow: 'asset', query: '', family: 'invest' });
    expect(invest.map((row) => row.label)).toContain('Mutual fund (reksadana)');
    expect(invest.at(-1)).toMatchObject({ id: 'more', label: 'Something else', sub: '4 more kinds the form knows' });
    expect(pickerRows({ flow: 'asset', query: '', family: 'invest', more: true }).map((row) => row.label)).toEqual([
      'Shares bought to resell',
      'Other debt securities',
      'Equity not in share form',
      'Other investments',
    ]);
  });

  it('searches across families, so a thing is found without knowing its family', () => {
    expect(pickerRows({ flow: 'asset', query: 'apartment' }).map((row) => row.id)).toEqual(['apartment']);
    expect(pickerRows({ flow: 'asset', query: 'emas' }).length).toBe(0);
    expect(pickerRows({ flow: 'debt', query: 'kartu' }).length).toBe(0);
    expect(pickerRows({ flow: 'debt', query: 'card' }).map((row) => row.id)).toEqual(['credit_card']);
  });
});

describe('what a form asks for', () => {
  it('asks a deposit when it matures and at what rate, and asks a wallet nothing extra', () => {
    expect(fieldsFor('account', 'time_deposit')).toEqual(['balance', 'bank', 'matures', 'rate']);
    expect(fieldsFor('account', 'ewallet')).toEqual(['balance']);
    expect(fieldsFor('account', 'bank')).toEqual(['balance', 'bank', 'currency']);
  });

  it('asks a holding for units and a price, and anything else for a value', () => {
    expect(fieldsFor('asset', 'stock')).toEqual(['units', 'price']);
    expect(fieldsFor('asset', 'bond')).toEqual(['face', 'price']);
    expect(fieldsFor('asset', 'gold')).toEqual(['grams']);
    expect(fieldsFor('asset', 'apartment')).toEqual(['value']);
    expect(fieldsFor('asset', 'trade_receivable')).toEqual(['person', 'owed']);
  });

  it('asks a mortgage for terms, a paylater for no rate, and a person for a name', () => {
    expect(fieldsFor('debt', 'home_mortgage')).toEqual(['owed', 'lender', 'rate', 'term']);
    expect(fieldsFor('debt', 'online_loan')).toEqual(['owed', 'lender', 'term']);
    expect(fieldsFor('debt', 'credit_card')).toEqual(['card']);
    expect(fieldsFor('debt', 'affiliate_debt')).toEqual(['owed', 'person']);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx vitest run src/features/ownables/catalogue-view.test.ts`
Expected: FAIL — `./catalogue-view` does not exist.

- [ ] **Step 3: Implement**

`catalogue-view.ts` is pure: `pickerRows({ flow, query, family, more })` returns `{ id, label, sub, icon, tint }[]` — families when `flow === 'asset'` and no `family`, that family's items plus a `more` row when it has one, `somethingElse` glosses when `more`, and `searchOwnables(query, flow)` across everything when a query is typed. `fieldsFor(flow, id)` returns the field keys of the mockup's `HOW_FIELDS` and `CASH[].fields`, derived from the item's behaviour, never a second table. The row type carries no `code` — the picker cannot show one it does not have.

`OwnablePicker.tsx` draws those rows: a search `Input`, a list of `<button>`s each with an icon tile, a bold label, a quiet sub-line and a chevron, a back button when a family or "Something else" is open, and any hand-over rows passed in. On a phone (`usePhone()`) it fills the page; on a wider screen it is the same list inside a `Card` and the chosen item's form renders beside/below it rather than replacing it.

`AddAccountPage.tsx` at `/accounts/new`: the picker over `CASH_ITEMS` under the kicker *Cash and cash equivalents*, the mockup's hint, and the two hand-over rows linking to `/net-worth/assets/new` and `/debts/new`. Choosing an item renders `CashAccountForm`.

`CashAccountForm.tsx`: Name, then `fieldsFor('account', item)` — Balance now, Bank, Currency, Matures on, Interest rate — plus Balance as of, plus the foreign-currency rate field and `checkManualRate` / `upsertRate` logic lifted from `AddAccountForm` unchanged. Saves through `openCashAccount`, then `invalidate()` and `router.navigate({ to: '/accounts' })`. The deposit's form ends with *"When it matures, move the money to an account with a transfer."*

`AccountsPage.tsx`: the `PageHeader` action gains a `Link` to `/accounts/new` labelled **Add account**; the inline `AddAccountForm` stays exactly where it is, with its `Type` select now built from `CASH_ITEMS` (labels from the catalogue, values unchanged) followed by today's non-cash entries, and routed through `openCashAccount` when a cash type is chosen. Each account row's type line gains the code and its name — `0105 · Uang elektronik` — read from `useAssetProfiles()`, and links to `/net-worth/assets/$accountId`.

`TransactionForm.tsx`: `MoneyAccountOptions` gains `spendableOnly?: boolean`; expense and income pass `spendableOnly` so a time deposit is never a way to pay, a transfer passes nothing so both sides may be any money account.

`router.tsx`: `createRoute({ getParentRoute: () => rootRoute, path: '/accounts/new', component: AddAccountPage })`, placed before the `/accounts` route for readability (ranking is by specificity, not order).

- [ ] **Step 4: Run and see it pass**

Run: `cd apps/web && npx vitest run && npx playwright test --workers=2 e2e/account-types.spec.ts e2e/critical-path.spec.ts`
Expected: PASS, with both existing specs untouched.

- [ ] **Step 5: Gate and commit**

Full gate. Commit: `feat(web): a picker for the accounts that hold money`.

---

### Task 5: Add asset, with families and Something else

**Files:**
- Create: `apps/web/src/features/ownables/AddAssetPage.tsx`
- Modify: `apps/web/src/features/networth/add-asset.ts`, `AddAssetForm.tsx`, `AssetsPage.tsx`, `apps/web/src/app/router.tsx`
- Test: `apps/web/src/features/networth/add-asset.test.ts`

**Interfaces:**
- Produces: route `/net-worth/assets/new`; `NewAssetDraft.itemId` in place of `.kind`; `planNewAsset` returning the item's code, section, group, unit kind and lot size.

- [ ] **Step 1: Write the failing tests**

Rewrite `add-asset.test.ts`'s fixtures around `itemId` and add:

```ts
describe('the item chosen decides the profile written', () => {
  it('keeps what the eight old kinds always did', () => {
    const plan = planNewAsset({ ...emptyDraft('gold', 'IDR', '2026-09-18'), name: 'Antam gold bars', purchases: [{ occurredOn: '2024-02-03', units: '10', cost: '13100000' }] }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'gold', coretaxSection: 'lainnya', coretaxCode: '0701', planGroup: 'invest', unitKind: 'grams', acquiredYear: 2024 });
    expect(plan.account.subtype).toBe('investment');
  });

  it('files an apartment under land and buildings, valued by what the owner says', () => {
    const plan = planNewAsset({ ...emptyDraft('apartment', 'IDR', '2026-09-18'), name: 'Apartemen Taman Anggrek', purchasedOn: '2021-06-01', cost: '1150000000', estimate: '1420000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'property', coretaxSection: 'tidak_bergerak', coretaxCode: '0503', planGroup: 'use', acquiredYear: 2021 });
    expect(plan.account.subtype).toBe('property');
    expect(plan.valuation).toMatchObject({ valueMinor: 1_420_000_000_00, basis: 'estimate' });
  });

  it('files unlisted shares under investments, valued by what the owner says', () => {
    const plan = planNewAsset({ ...emptyDraft('unlisted_stock', 'IDR', '2026-09-18'), name: 'PT Keluarga', purchasedOn: '2023-01-10', cost: '200000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'other', coretaxSection: 'investasi', coretaxCode: '0302', planGroup: 'invest' });
    expect(plan.account.subtype).toBe('investment');
  });

  it('records anything under Something else as a thing with a value, in the table its family files under', () => {
    const plan = planNewAsset({ ...emptyDraft('else:0409', 'IDR', '2026-09-18'), name: 'Kapal nelayan', purchasedOn: '2025-05-05', cost: '80000000' }, '2026-09-18');
    expect(plan.profile).toMatchObject({ assetKind: 'vehicle', coretaxSection: 'bergerak', coretaxCode: '0409', planGroup: 'use' });
  });

  it('weighs gold jewellery in grams, or takes a value when the owner would rather type one', () => {
    const grams = planNewAsset({ ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), name: 'Kalung', purchases: [{ occurredOn: '2025-01-01', units: '25', cost: '35000000' }] }, '2026-09-18');
    expect(grams.profile).toMatchObject({ assetKind: 'gold', coretaxCode: '0702', unitKind: 'grams' });
    expect(grams.trades).toHaveLength(1);

    const typed = planNewAsset({ ...emptyDraft('gold_jewellery', 'IDR', '2026-09-18'), name: 'Kalung', typedInstead: true, purchasedOn: '2025-01-01', cost: '35000000', estimate: '40000000' }, '2026-09-18');
    expect(typed.profile).toMatchObject({ assetKind: 'other', coretaxCode: '0702', coretaxSection: 'lainnya', unitKind: null });
    expect(typed.trades).toHaveLength(0);
    expect(typed.valuation).toMatchObject({ valueMinor: 40_000_000_00 });
  });

  it('sends a receivable to the ledger rather than giving it a profile of its own', () => {
    const plan = planNewAsset({ ...emptyDraft('trade_receivable', 'IDR', '2026-09-18'), name: 'PT Sejahtera', personName: 'PT Sejahtera', cost: '25000000' }, '2026-09-18');
    expect(plan.person).toMatchObject({ direction: 'lent', personName: 'PT Sejahtera', coretaxCode: '0201', balanceMinor: 25_000_000_00 });
    expect(plan.profile).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx vitest run src/features/networth/add-asset.test.ts`
Expected: FAIL — `emptyDraft` does not take an item id.

- [ ] **Step 3: Implement**

`add-asset.ts`: `NewAssetDraft.kind: AssetKind` becomes `itemId: string`; add `typedInstead: boolean` and `personName: string`. `needsPurchases` and `needsEstimate` read the item's `valuedBy` (`units`/`face`/`grams` and `value` respectively) rather than `presetFor(kind).valuationMode`. `NewAssetPlan.profile` becomes nullable and gains `planGroup`, `unitKind`, `lotSize`; a new `NewAssetPlan.person` carries `{ direction, personName, coretaxCode, balanceMinor }` for a receivable. `planNewAsset` reads `assetItem(draft.itemId)`, resolves the gold-jewellery `typedInstead` swap (`assetKind: 'other'`, `unitKind: null`, `valuedBy: 'value'`, code and section unchanged), and otherwise does exactly what it does today.

`AddAssetForm.tsx`: takes `itemId?: string`; its "What is it?" `Select` lists every `ASSET_ITEMS` entry grouped by family with the legacy `cash` entry in its own group labelled *Money — better added as an account*; a receivable shows **Who** and **Owed now**; gold jewellery shows the *"I'd rather type what it is worth"* checkbox. On submit it calls `openDebtBalance` when `plan.person` is set, and `createAccount` + `saveAssetProfile` (now also passing `planGroup`, `unitKind`, `lotSize`) otherwise; trades and the first valuation are unchanged.

`AddAssetPage.tsx` at `/net-worth/assets/new`: `OwnablePicker` over families → items → Something else, the mockup's hints, the hand-over row to `/accounts/new`, and `AddAssetForm` with the chosen `itemId` below.

`AssetsPage.tsx`: the header's **Add asset** button keeps opening the inline form exactly as it does today (12 specs depend on it) and a **What do you own?** link beside it goes to `/net-worth/assets/new`.

`router.tsx`: the `/net-worth/assets/new` route, with a comment that a static segment outranks `$accountId`.

- [ ] **Step 4: Run and see it pass**

Run: `cd apps/web && npx vitest run && npx playwright test --workers=2 e2e/assets.spec.ts e2e/coretax.spec.ts e2e/buy-flow.spec.ts e2e/asset-reporting.spec.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Full gate. Commit: `feat(web): five families, and everything else the form knows`.

---

### Task 6: Add debt

**Files:**
- Create: `apps/web/src/features/ownables/AddDebtPage.tsx`, `debt-form.ts`, `debt-form.test.ts`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/app/nav.ts`, `apps/web/src/features/debts/DebtsPage.tsx`, `apps/web/src/features/loans/LoansPage.tsx`

**Interfaces:**
- Produces: route `/debts/new`; `emptyDebtItemDraft`, `planNewDebt`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/features/ownables/debt-form.test.ts
import { describe, expect, it } from 'vitest';
import { emptyDebtItemDraft, planNewDebt } from './debt-form';

const draft = (id: string, patch: Record<string, string>) => ({ ...emptyDebtItemDraft(id, '2026-09-18'), ...patch });

describe('planning a debt from the picker', () => {
  it('opens a loan account for what is still owed, and terms when the months left are known', () => {
    const plan = planNewDebt(draft('home_mortgage', { owed: '650000000', lender: 'Bank BTN', rate: '9', term: '168' }), 'IDR', '2026-09-18');
    expect(plan.account).toMatchObject({ kind: 'liability', subtype: 'loan', name: 'Bank BTN', openingBalanceMinor: 650_000_000_00 });
    expect(plan.terms).toMatchObject({
      lenderName: 'Bank BTN',
      originalMinor: 650_000_000_00,
      tenorMonths: 168,
      method: 'annuity',
      rateBps: 900,
      paymentDay: 18,
      firstPaymentOn: '2026-10-18',
      coretaxCode: '101',
    });
  });

  it('clamps a first payment past the 28th, so every month has the day', () => {
    expect(planNewDebt(draft('personal_loan', { owed: '10000000', lender: 'Bank Jago', term: '12' }), 'IDR', '2026-09-30').terms).toMatchObject({
      paymentDay: 28,
      firstPaymentOn: '2026-10-28',
      method: 'zero',
      rateBps: 0,
    });
  });

  it('opens the account alone when the months left are not known', () => {
    const plan = planNewDebt(draft('vehicle_leasing', { owed: '45000000', lender: 'Adira' }), 'IDR', '2026-09-18');
    expect(plan.account).toMatchObject({ subtype: 'loan', openingBalanceMinor: 45_000_000_00 });
    expect(plan.terms).toBeNull();
  });

  it('files a paylater as a bank debt and never asks it for a rate', () => {
    expect(planNewDebt(draft('online_loan', { owed: '2400000', lender: 'SPayLater', term: '6' }), 'IDR', '2026-09-18').terms).toMatchObject({ coretaxCode: '101', method: 'zero' });
  });

  it('files family under 103 and anything else under 109, as a debt to a person', () => {
    expect(planNewDebt(draft('affiliate_debt', { owed: '10000000', person: 'Ibu' }), 'IDR', '2026-09-18').person).toMatchObject({
      direction: 'borrowed',
      personName: 'Ibu',
      balanceMinor: 10_000_000_00,
      coretaxCode: '103',
    });
    expect(planNewDebt(draft('other_debt', { owed: '500000', person: 'Arisan RT' }), 'IDR', '2026-09-18').person).toMatchObject({ coretaxCode: '109' });
  });

  it('hands a credit card over rather than opening one itself', () => {
    expect(planNewDebt(draft('credit_card', {}), 'IDR', '2026-09-18')).toMatchObject({ handOver: 'card' });
  });

  it('says what is missing, in words meant for the screen', () => {
    expect(() => planNewDebt(draft('home_mortgage', { owed: '650000000', term: '168' }), 'IDR', '2026-09-18')).toThrow('Say who lent the money');
    expect(() => planNewDebt(draft('home_mortgage', { lender: 'Bank BTN' }), 'IDR', '2026-09-18')).toThrow('Enter how much is still owed');
    expect(() => planNewDebt(draft('affiliate_debt', { owed: '10000000' }), 'IDR', '2026-09-18')).toThrow('Say who this is with');
    expect(() => planNewDebt(draft('personal_loan', { owed: '1000000', lender: 'Andi', term: '0' }), 'IDR', '2026-09-18')).toThrow('A loan runs for at least one month');
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx vitest run src/features/ownables/debt-form.test.ts`
Expected: FAIL — `./debt-form` does not exist.

- [ ] **Step 3: Implement**

`debt-form.ts` is pure, shaped like `debts-form.ts` and `loan-form.ts` beside it: a `DebtItemDraft` of strings, `emptyDebtItemDraft(itemId, today)`, and `planNewDebt(draft, currency, today)` returning `{ handOver: 'card' } | { account, terms, person }`. Rate to basis points reuses `loan-form.ts`'s rule (`"9,25"` → 925); the payment day is today's day-of-month clamped to 28 and `firstPaymentOn` is that day next month; `method` is `annuity` with a rate and `zero` without.

`AddDebtPage.tsx` at `/debts/new`: `OwnablePicker` over `DEBT_ITEMS` with the mockup's card hint, then the chosen item's form. Saving calls `createAccount` + `saveLoanTerms` for a loan, `openDebtBalance` for a person, and for `handOver: 'card'` renders the card form the Accounts page already uses (`createCardAccount`, with Bank and Last 4) under the note *"A card keeps its statement, bill, points and instalments."*

`router.tsx` gains `/debts/new`; `nav.ts` puts **Add a debt** in the *Money* group of `MORE_GROUPS` so the phone's account sheet reaches it and `REACHABLE` covers it; `DebtsPage` and `LoansPage` each gain a link to it beside their existing buttons, which are untouched.

- [ ] **Step 4: Run and see it pass**

Run: `cd apps/web && npx vitest run && npx playwright test --workers=2 e2e/loans.spec.ts e2e/lend-borrow.spec.ts e2e/navigation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Full gate. Commit: `feat(web): a debt named the way you would say it`.

---

### Task 7: Showing and changing the code afterwards

**Files:**
- Create: `apps/web/src/features/ownables/CodePicker.tsx`
- Modify: `apps/web/src/features/networth/AssetSettings.tsx`, `apps/web/src/features/loans/LoanDetailPage.tsx`, `apps/web/src/features/debts/PersonCard.tsx`

- [ ] **Step 1: Write the failing test**

This task has no pure logic of its own — `CodePicker` is a `Select` over catalogue data already covered by Task 1, and every write goes through a repository function already tested. It is proved end to end instead, by the specs in Task 8, which read the code back off the tax report after changing it here. Skip to Step 3; the gate is Task 8's.

- [ ] **Step 3: Implement**

`CodePicker.tsx`: given a code and a `flow`, a `Select` listing every item of that code's own family plus *Something else* plus *Type a code instead*, showing each as `label` with `hartaLabel`/`utangLabel` beneath. Choosing an item reports its code; *Type a code instead* reveals the four-digit `Input`.

- `AssetSettings.tsx`: `CodePicker` above today's **Tax report code** `Input`, which stays for a code the catalogue does not name — DJP itself tells people to pick a code to match their situation, so the free box may never go away. Saving is unchanged (`setAssetReporting`).
- `LoanDetailPage.tsx`: a **Tax report code** `Select` of the four kode utang on the loan's terms card, saved with `saveLoanTerms` and the loan's existing terms.
- `PersonCard.tsx`: the same `Select`, offering 0201/0202/0209 for money owed to you and 101/103/109 for money you owe, saved with `saveDebtProfile`.

- [ ] **Step 4: Run and see it pass**

Run: `cd apps/web && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Full gate. Commit: `feat(web): change what a thing files as, wherever it lives`.

---

## Step 4 — End to end

### Task 8: The three flows, by mouse and by thumb

**Files:**
- Create: `apps/web/e2e/coretax-pickers.spec.ts`, `apps/web/e2e/phone-coretax-pickers.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/e2e/coretax-pickers.spec.ts
import { expect, test } from '@playwright/test';

test('a time deposit holds money that cannot be spent until it is moved', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Bank account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Balance now').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();

  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Time deposit' }).click();
  await expect(page.getByText('When it matures, move the money to an account with a transfer.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Deposito BCA 6 bulan');
  await page.getByLabel('Balance now').fill('100000000');
  await page.getByLabel('Matures on').fill('2027-03-01');
  await page.getByLabel('Interest rate').fill('6,25');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Deposito BCA 6 bulan', exact: true })).toBeVisible();

  // Money you hold: net worth counts it, and the balance sheet calls it cash.
  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('120.000.000');

  // But nothing will let it pay for lunch.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const payer = page.getByLabel('Paid with');
  await expect(payer).toContainText('BCA Tahapan');
  await expect(payer).not.toContainText('Deposito BCA 6 bulan');

  // It comes back with a transfer, which is the only honest way out.
  await page.getByRole('button', { name: 'Transfer' }).click();
  await page.getByLabel('From').selectOption({ label: 'Deposito BCA 6 bulan (IDR)' });
  await page.getByLabel('To').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Amount', { exact: true }).fill('100000000');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/accounts');
  await expect(page.locator('li', { has: page.getByRole('link', { name: 'BCA Tahapan', exact: true }) })).toContainText('120.000.000');
});

test('a family, then the thing: an apartment and gold jewellery file under their own codes', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await page.getByRole('button', { name: 'Immovable property' }).click();
  await page.getByRole('button', { name: 'Apartment' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Apartemen Taman Anggrek');
  await page.getByLabel('Bought on').fill('2021-06-01');
  await page.getByLabel('What it cost (IDR)').fill('1150000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();

  await page.goto('/net-worth/assets/new');
  await page.getByPlaceholder('Search').fill('gold jewellery');
  await page.getByRole('button', { name: 'Gold jewellery' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kalung emas');
  await page.getByLabel('Bought on').fill('2025-01-01');
  await page.getByLabel('How much').fill('25');
  await page.getByLabel('Total cost (IDR)').fill('35000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();

  // Never a code while choosing; both codes afterwards, each in its own table.
  await page.goto('/net-worth/assets');
  await expect(page.getByText('0503 · Harta Tidak Bergerak')).toBeVisible();
  await expect(page.getByText('0702 · Harta Lainnya')).toBeVisible();
});

test('something else reaches a code the five families do not list', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await page.getByRole('button', { name: 'Movable property' }).click();
  await page.getByRole('button', { name: 'Something else' }).click();
  await page.getByRole('button', { name: 'Ship' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kapal nelayan');
  await page.getByLabel('Bought on').fill('2025-05-05');
  await page.getByLabel('What it cost (IDR)').fill('80000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await page.goto('/net-worth/assets');
  await expect(page.getByText('0409 · Harta Bergerak')).toBeVisible();
});

test('a mortgage, a wallet and a deposit reach the tax report under the right kode', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Electronic money' }).click();
  await page.getByLabel('Name', { exact: true }).fill('GoPay');
  await page.getByLabel('Balance now').fill('500000');
  await page.getByLabel('Balance as of').fill('2026-01-05');
  await page.getByRole('button', { name: 'Add account' }).click();

  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();
  await page.getByLabel('Owed now').fill('650000000');
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel('Interest rate').fill('9');
  await page.getByLabel('Months left').fill('168');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page.getByRole('heading', { name: 'Loans' })).toBeVisible();

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption('2026');
  await page.getByRole('button', { name: /Start the 2026 report/ }).click();
  await expect(page.getByText('0105')).toBeVisible();
  await expect(page.getByText('Uang elektronik')).toBeVisible();
  const utang = page.locator('table', { has: page.getByText('Kartu kredit').or(page.getByText('Utang bank')) });
  await expect(utang).toContainText('101');
  await expect(utang).toContainText('Bank BTN');
});

test('a code can be changed afterwards, in the words the form uses', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Fund account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RDN Mandiri Sekuritas');
  await page.getByLabel('Balance now').fill('8000000');
  await page.getByRole('button', { name: 'Add account' }).click();

  await page.goto('/accounts');
  await expect(page.getByText(/0109 · Setara kas lainnya/)).toBeVisible();
  await page.getByRole('link', { name: /Setara kas lainnya/ }).click();
  await page.getByLabel('What it is').selectOption({ label: 'Saving account' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.goto('/accounts');
  await expect(page.getByText(/0102 · Tabungan/)).toBeVisible();
});
```

```ts
// apps/web/e2e/phone-coretax-pickers.spec.ts
import { expect, test } from '@playwright/test';

test('two levels by thumb: a family, the thing, and the way back', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await expect(page.getByRole('heading', { name: 'What do you own?' })).toBeVisible();
  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('button', { name: 'Mutual fund (reksadana)' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Movable property' })).toBeVisible();

  // Money is an account, not an asset, and the screen says where to go instead.
  await page.getByRole('button', { name: 'Add an account instead' }).click();
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time deposit' })).toBeVisible();

  await page.getByRole('button', { name: 'Add a debt instead' }).click();
  await expect(page.getByRole('heading', { name: 'New debt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Online loan or paylater' })).toBeVisible();
});

test('a phone finds a thing by typing, without knowing its family', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await page.getByPlaceholder('Search everything you can own').fill('patent');
  await page.getByRole('button', { name: 'Patent' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Paten alat panen');
  await page.getByLabel('Bought on').fill('2024-08-08');
  await page.getByLabel('What it cost (IDR)').fill('15000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByText('0601 · Harta Lainnya')).toBeVisible();
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd apps/web && npx playwright test --workers=2 e2e/coretax-pickers.spec.ts e2e/phone-coretax-pickers.spec.ts`
Expected: FAIL on whatever labels Tasks 4–7 spelled differently.

- [ ] **Step 3: Implement**

No new behaviour: reconcile labels, placeholders and headings between the specs and the components, preferring the mockup's words in both. `Search` and `Search everything you can own` are the mockup's own placeholders; `What it is` is the `CodePicker` label.

- [ ] **Step 4: Run and see it pass**

Run: `cd apps/web && npx playwright test --workers=2`
Expected: PASS — the two new specs and all 39 existing ones.

- [ ] **Step 5: Gate and commit**

`npm run typecheck`, `npm test`, `cd apps/web && npx playwright test --workers=2`. Commit: `test(web): the three ways in, by mouse and by thumb`.

---

## Done when

- `npm run typecheck`, `npm test` and `npx playwright test --workers=2` are green, with no existing spec edited.
- A time deposit and other cash equivalents can be opened, count as cash you hold, and cannot pay for anything.
- Every code in the catalogue can be reached: in a family, behind "Something else", or by typing four digits.
- No picker shows a code, and every thing's own page can change the one it got.
- A database upgraded from version 46 has the same accounts, balances, indexes and asset codes it had before, and files a wallet as 0105 only because nobody had ever chosen 0102 for it.
