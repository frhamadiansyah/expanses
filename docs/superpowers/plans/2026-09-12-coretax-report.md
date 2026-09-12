# Coretax Report (Slice 6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Turn a year of the ledger into the harta and utang tables of SPT Tahunan — every row, total and readiness check the owner needs to fill Lampiran 1 — frozen on 31 December so a later edit shows as a difference rather than quietly changing a filed return.

**Architecture:** `packages/core` gains a `coretax` module: the verified code lists, the rows each section asks for, carry-over against last year's return, and the readiness checks. `packages/db` gains migration `0012_tax_reports` with `tax_year_reports` and `tax_year_rows`, the KMK rate source, and the freeze that copies live rows into a report. `apps/web` gains the Coretax tab: year picker, readiness list, the Ikhtisar, a tab per section, the reconciliation line against net worth, and a CSV export in our own documented column order.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` §9, with the verified code lists in §9.0.

## Global Constraints

- Money stays 64-bit integer minor units; rates stay basis points. No floats in stored values.
- **Every Coretax code is three digits.** The four-digit codes written into earlier slices were placeholders and are wrong in shape and value; Task 1 replaces them and migrates what is stored.
- A draft report is live from the ledger. A frozen report is a copy: later ledger edits never change it, they show as per-row differences the owner can accept.
- A filed report is read-only and becomes next year's carry-over base.
- Cost basis is the historical IDR figure, per Pasal 10 — never today's value converted back.
- Values in another currency use the **KMK rate** (Kurs Menteri Keuangan) for 31 December, entered by hand. It is a rate source of its own, never a fetched market rate.
- Nothing in this slice sends anything anywhere. The report holds NPWP, NIK and account numbers; the export writes a local file and says so before it does.
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## What is verified, and what the export still waits for

Researched this slice, because the codes in the design were illustrative: **kode harta** `011`–`069` and **kode utang** `101`–`104`, corroborated across three independent sources for harta and two for utang (§9.0 lists them in full).

Two things remain unread, and the plan is shaped around them:

1. **`015` versus `019`** for "setara kas lainnya" — two sources say `015`, one says `019`. The build uses `015`, marks it in one place, and the owner confirms before the export ships.
2. **Whether harta and utang can be imported at all.** DJP publishes Excel-to-XML converters for Bupot, e-Faktur and SPT Badan — none for Orang Pribadi harta or utang — and DJP's own Coretax pages for OP describe filling the form, not importing it. The four DJP documents that would settle it are scans with no text layer, so nothing can be read from them yet.

**Therefore `toConverterTsv` is not built in this slice.** Task 7 ships `toReportCsv` instead, in our own column order, documented and labelled as ours. When the converter question is settled, the seam is one pure function beside it — no schema change, no screen change.

## File Structure

```
packages/core/src/coretax/codes.ts       KODE_HARTA, KODE_UTANG, coretaxCodeFor, CORETAX_CODE_LABELS
packages/core/src/coretax/rows.ts        coretaxRows, CoretaxRow, CoretaxInputs, ReportSettings
packages/core/src/coretax/review.ts      carryOver, readiness, reconciliation
packages/core/src/coretax/export.ts      toReportCsv  (the seam where toConverterTsv will sit)
packages/core/src/assets/presets.ts      three-digit codes on every preset
packages/core/src/index.ts               + the coretax exports
packages/core/test/coretax-codes.test.ts  coretax-rows.test.ts  coretax-review.test.ts  coretax-export.test.ts

packages/db/migrations/0012_tax_reports.sql
packages/db/src/migrations.ts            + version 12
packages/db/src/schema-tax.ts            taxYearReports, taxYearRows
packages/db/src/repos/tax-reports.ts     draftReport, reportFor, listReports, freezeReport,
                                         markFiled, rowDifferences, acceptLedgerValue
packages/db/src/repos/tax-inputs.ts      coretaxInputsFor: the year's harta and utang from the ledger
packages/db/src/index.ts                 + both repos and the schema
packages/db/test/tax-inputs.test.ts  tax-reports.test.ts  tax-freeze.test.ts

apps/web/src/features/coretax/
  report-rows.ts     pure: rows → screen sections, readiness → links
  CoretaxPage.tsx    the tab: year, status, readiness, Ikhtisar, section tabs
  SectionTable.tsx   one section's rows, with inline edits for manual rows
  FreezePanel.tsx    31 December prices, KMK rates, review, freeze
  queries.ts         useReport, useReports, useCoretaxInputs
  report-rows.test.ts
apps/web/src/features/networth/NetWorthTabs.tsx   + the Coretax tab
apps/web/src/app/router.tsx                       + /net-worth/coretax
apps/web/e2e/coretax.spec.ts
```

---

### Task 1: Core — the verified codes, replacing the placeholders

**Files:** Create `packages/core/src/coretax/codes.ts`; modify `packages/core/src/assets/presets.ts`, `packages/core/src/index.ts`; test `packages/core/test/coretax-codes.test.ts`.

**Interfaces — Produces:**
```ts
export type HartaFamily = 'kas' | 'piutang' | 'investasi' | 'transportasi' | 'bergerak' | 'tidak_bergerak';

export interface CoretaxCode {
  code: string;            // three digits, always
  label: string;           // Indonesian, as the form words it
  family: HartaFamily;
}
export const KODE_HARTA: readonly CoretaxCode[];
export const KODE_UTANG: readonly { code: string; label: string }[];

/** The code a preset starts on. The owner can change it per asset. */
export function coretaxCodeFor(kind: AssetKind): string;
export function hartaLabel(code: string): string;
export function utangLabel(code: string): string;
/** Which Lampiran section a code belongs to, for grouping rows. */
export function sectionOfCode(code: string): CoretaxSection;

/** Two sources give 015 for "setara kas lainnya", one gives 019. Confirm against the form. */
export const CASH_EQUIVALENT_CODE = '015';
```

Preset codes change from the four-digit placeholders to: `cash` → `012`, `fund` → `036`, `stock` → `032`, `bond` → `034`, `gold` → `051`, `property` → `061`, `vehicle` → `043`, `other` → `059`. Sections are unchanged; only the codes were wrong.

- [ ] Tests (fail first, `coretax-codes.test.ts`): `every code is three digits`; `no code appears twice`; `each family runs in its own hundred`; `a preset starts on the code its kind implies`; `gold is a movable asset, not an investment`; `a bank account is tabungan`; `the section of a code follows its family`; `a label is given in the form's own words`; `an unknown code has no label rather than a wrong one`.
- [ ] Implement, export, run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): the verified three-digit Coretax codes`.

---

### Task 2: Core — the rows each section asks for

**Files:** Create `packages/core/src/coretax/rows.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/coretax-rows.test.ts`.

**Interfaces — Consumes:** Task 1's codes; `CORETAX_SECTIONS` and `CoretaxSection` from `assets/coretax-fields.ts`; `YearBucket` from `assets/position.ts`.

**Interfaces — Produces:**
```ts
export interface CoretaxRow {
  key: string;                       // account, plus the acquired year when the rows are split
  section: CoretaxSection;
  code: string;
  name: string;
  acquiredYear: number | null;
  /** Historical cost in IDR, per Pasal 10. Never today's value converted back. */
  costMinor: number;
  /** What it was worth on 31 December, in IDR. */
  valueMinor: number;
  /** For kas, piutang and utang: the balance on 31 December, in IDR. */
  balanceMinor: number;
  fields: Record<string, string>;
  source: 'auto' | 'edited' | 'manual';
  note: string | null;
}

export interface CoretaxInputs {
  /** Cash, savings and deposits: balance on 31 December, with the currency it is held in. */
  cash: { accountId: string; name: string; code: string; balanceMinor: number; currency: string; fields: Record<string, string> }[];
  /** Holdings measured in units, with cost and units split by the year each parcel was bought. */
  holdings: { accountId: string; name: string; code: string; currency: string; priceMicro: number; byYear: Record<string, YearBucket>; fields: Record<string, string> }[];
  /** Property, vehicles and anything estimated. */
  estimated: { accountId: string; name: string; code: string; currency: string; costMinor: number; valueMinor: number; fields: Record<string, string> }[];
  /** Money people owe the owner, open on 31 December. */
  receivables: { accountId: string; name: string; code: string; balanceMinor: number; currency: string; fields: Record<string, string> }[];
  /** Everything owed: loans, cards, personal debts. */
  debts: { accountId: string; name: string; code: string; balanceMinor: number; currency: string; note: string | null }[];
}

export interface ReportSettings {
  /** Which figure property and vehicles report. */
  propertyBasis: 'cost' | 'estimate' | 'njop' | 'appraisal';
  /** One row per holding, or one row per holding and year of purchase. */
  repeatRows: 'holding' | 'year';
  /** KMK rate per currency for 31 December, as rate × 10 000. */
  kmkRateBps: Record<string, number>;
}

export function coretaxRows(year: number, inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[];
/** The utang rows, kept apart because Bagian B is its own table. */
export function utangRows(year: number, inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[];
export function sectionTotals(rows: CoretaxRow[]): { section: CoretaxSection; costMinor: number; valueMinor: number }[];
```

- [ ] Tests (fail first, `coretax-rows.test.ts`): `a bank account reports its balance on 31 December`; `a foreign account is converted at the KMK rate, not a market rate`; `a holding reports cost at what was paid and value at the 31 December price`; `splitting by year gives one row per year of purchase, and they add back to the whole`; `keeping one row per holding adds every year together`; `a sold holding reports nothing`; `property reports the basis chosen, and switching the basis changes only the value`; `a receivable reports its open balance`; `a debt reports what is still owed, and a card its balance`; `a debt paid off before 31 December reports nothing`; `every row carries the fields its section asks for`; `section totals add up to the rows they cover`.
- [ ] Implement, export, run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): the harta and utang rows for a tax year`.

---

### Task 3: Core — carry-over, readiness and the reconciliation

**Files:** Create `packages/core/src/coretax/review.ts`; modify `packages/core/src/index.ts`; test `packages/core/test/coretax-review.test.ts`.

**Interfaces — Consumes:** Task 2's `CoretaxRow`; `validateCoretaxFields` and `missingCoretaxFields` from `assets/coretax-fields.ts`.

**Interfaces — Produces:**
```ts
export type CarryStatus = 'new' | 'removed' | 'changed' | 'same';
export interface CarryRow { key: string; name: string; status: CarryStatus; fromValueMinor: number | null; toValueMinor: number | null }
/** Matches rows by account, and by acquired year as well when the rows are split. */
export function carryOver(current: CoretaxRow[], previous: CoretaxRow[] | null): CarryRow[];

export type ReadinessLevel = 'blocking' | 'warning';
export interface ReadinessIssue { key: string; rowKey: string | null; level: ReadinessLevel; message: string }
/** What would be refused or questioned: missing required fields, a malformed NPWP or NIK, a year after the tax year, a negative amount. */
export function readiness(rows: CoretaxRow[], year: number): ReadinessIssue[];

export interface Reconciliation {
  hartaMinor: number;
  utangMinor: number;
  reportNetMinor: number;
  netWorthMinor: number;
  differenceMinor: number;
  /** Why the two differ, in the owner's words. */
  reasons: string[];
}
export function reconciliation(rows: CoretaxRow[], utang: CoretaxRow[], netWorthMinor: number): Reconciliation;
```

- [ ] Tests (fail first, `coretax-review.test.ts`): `the first year marks every row new`; `a row that is gone is marked removed`; `a row whose value moved is marked changed, with both figures`; `an untouched row is marked same`; `split rows match on account and year together`; `a missing required field is blocking`; `a malformed NPWP is blocking, a well-formed one passes`; `an acquired year after the tax year is blocking`; `a negative amount is blocking`; `a row with no acquired year is a warning, not a refusal`; `the reconciliation explains the gap between the report and net worth`; `a report matching net worth exactly has no reasons`.
- [ ] Implement, export, run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): carry-over, readiness and the reconciliation against net worth`.

---

### Task 4: DB — migration `0012_tax_reports`, and the stored codes corrected

**Files:** Create `packages/db/migrations/0012_tax_reports.sql`, `packages/db/src/schema-tax.ts`, `packages/db/src/repos/tax-reports.ts` (draft half only); modify `packages/db/src/migrations.ts`, `packages/db/src/schema.ts`, `packages/db/src/index.ts`, `packages/db/test/database.test.ts`; test `packages/db/test/tax-reports.test.ts`.

The migration adds the two tables, admits `kmk` as a rate source — which takes a table rebuild, because `fx_rates.source` carries a SQL `CHECK` constraint and SQLite cannot alter one — and **rewrites the placeholder codes already stored** by earlier slices. `loan_terms.coretax_code` already defaults to `101`, which is a real code, so loans need no rewrite:

```sql
CREATE TABLE tax_year_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'frozen', 'filed')),
  frozen_at TEXT,
  filed_on TEXT,
  npwp TEXT,
  taxpayer_name TEXT,
  property_basis TEXT NOT NULL DEFAULT 'cost' CHECK (property_basis IN ('cost', 'estimate', 'njop', 'appraisal')),
  repeat_rows TEXT NOT NULL DEFAULT 'holding' CHECK (repeat_rows IN ('holding', 'year')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tax_year_reports_year ON tax_year_reports (workspace_id, tax_year);

CREATE TABLE tax_year_rows (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES tax_year_reports(id),
  workspace_id TEXT NOT NULL,
  section TEXT NOT NULL,
  code TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  name TEXT NOT NULL,
  acquired_year INTEGER,
  sort INTEGER NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '{}',
  cost_minor INTEGER NOT NULL DEFAULT 0,
  value_minor INTEGER NOT NULL DEFAULT 0,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'edited', 'manual')),
  already_filed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX tax_year_rows_report ON tax_year_rows (report_id, sort);

-- SQLite cannot alter a CHECK constraint, so the table is rebuilt to admit the KMK rate.
CREATE TABLE fx_rates_new (
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  on_date TEXT NOT NULL,
  rate REAL NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL CHECK (source IN ('frankfurter', 'manual', 'kmk')),
  source_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (from_currency, to_currency, on_date)
);
INSERT INTO fx_rates_new SELECT from_currency, to_currency, on_date, rate, source, source_date, fetched_at FROM fx_rates;
DROP TABLE fx_rates;
ALTER TABLE fx_rates_new RENAME TO fx_rates;

-- Placeholder codes written by slices 1 and 4, corrected to the verified three-digit ones.
UPDATE asset_profiles SET coretax_code = '012' WHERE coretax_code = '0102';
UPDATE asset_profiles SET coretax_code = '036' WHERE coretax_code = '0306';
UPDATE asset_profiles SET coretax_code = '032' WHERE coretax_code = '0302';
UPDATE asset_profiles SET coretax_code = '034' WHERE coretax_code = '0304';
UPDATE asset_profiles SET coretax_code = '051' WHERE coretax_code = '0701';
UPDATE asset_profiles SET coretax_code = '061' WHERE coretax_code = '0502';
UPDATE asset_profiles SET coretax_code = '043' WHERE coretax_code = '0403';
UPDATE asset_profiles SET coretax_code = '059' WHERE coretax_code = '0799';
UPDATE debt_profiles SET coretax_code = '021' WHERE coretax_code = '0201';
UPDATE debt_profiles SET coretax_code = '022' WHERE coretax_code = '0202';
UPDATE debt_profiles SET coretax_code = '104' WHERE coretax_code = '109';
```

**Interfaces — Produces:**
```ts
export interface TaxReportRow {
  id: string; workspaceId: string; taxYear: number;
  status: 'draft' | 'frozen' | 'filed';
  frozenAt: string | null; filedOn: string | null;
  npwp: string | null; taxpayerName: string | null;
  propertyBasis: ReportSettings['propertyBasis'];
  repeatRows: ReportSettings['repeatRows'];
  createdAt: string;
}
export interface SaveReportInput { taxYear: number; npwp?: string | null; taxpayerName?: string | null; propertyBasis?: ReportSettings['propertyBasis']; repeatRows?: ReportSettings['repeatRows'] }
export async function draftReport(database: Database, ws: WorkspaceContext, input: SaveReportInput): Promise<string>;
export async function reportFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<TaxReportRow | undefined>;
export async function listReports(database: Database, ws: WorkspaceContext): Promise<TaxReportRow[]>;
export class TaxDbError extends Error {}
```

`DEFAULT_CORETAX_CODE` in `packages/db/src/repos/debts.ts` still reads `{ lent: '0201', borrowed: '109' }`. Task 4 changes it to `{ lent: '021', borrowed: '104' }` in the same commit as the migration, so a debt opened after the upgrade cannot write a placeholder back.

The idempotency test in `database.test.ts` expects `[1..12]`.

- [ ] Tests (fail first, `tax-reports.test.ts`): `the migration adds both tables and a v11 database still opens`; `it rewrites the placeholder asset codes`; `it rewrites the placeholder debt codes`; `it leaves a code the owner already corrected alone`; `a draft is created for a year`; `a second draft for the same year updates the first`; `the settings round-trip`; `a report for a year with nothing recorded is still a draft`; `kmk is allowed as a rate source`; `rates already stored survive the rebuild`; `a rate with an unknown source is still refused`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): migration 0012, tax reports and the corrected codes`.

---

### Task 5: DB — the year's figures, the freeze, and what changed after it

**Files:** Create `packages/db/src/repos/tax-inputs.ts`; modify `packages/db/src/repos/tax-reports.ts`, `packages/db/src/index.ts`; test `packages/db/test/tax-inputs.test.ts`, `packages/db/test/tax-freeze.test.ts`.

**Interfaces — Consumes:** Task 2's `CoretaxInputs` and `coretaxRows`; `assetValuesAt`, `positionsFor`, `listDebtProfiles`, `listLoans`, `installmentTotals`, `nativeBalances`.

**Interfaces — Produces:**
```ts
/** Everything the rows need, read from the ledger on 31 December of that year. */
export async function coretaxInputsFor(database: Database, ws: WorkspaceContext, taxYear: number): Promise<CoretaxInputs>;

/** Copies the live rows into the report, which stops following the ledger from then on. */
export async function freezeReport(database: Database, ws: WorkspaceContext, taxYear: number): Promise<{ rows: number }>;
export async function markFiled(database: Database, ws: WorkspaceContext, taxYear: number, filedOn: string): Promise<void>;
export async function savedRows(database: Database, ws: WorkspaceContext, taxYear: number): Promise<CoretaxRow[]>;

export interface RowDifference { rowKey: string; name: string; field: 'costMinor' | 'valueMinor' | 'balanceMinor'; savedMinor: number; ledgerMinor: number }
/** What the ledger says now against what the frozen report holds. */
export async function rowDifferences(database: Database, ws: WorkspaceContext, taxYear: number): Promise<RowDifference[]>;
export async function acceptLedgerValue(database: Database, ws: WorkspaceContext, taxYear: number, rowKey: string): Promise<void>;
```

Rules the tests pin: a frozen report does not move when the ledger does; a filed report refuses every write; freezing twice is refused, naming the year; `acceptLedgerValue` marks the row `edited`.

- [ ] Tests (fail first, `tax-inputs.test.ts`): `a bank balance is read on 31 December, not today`; `a holding carries its cost split by year of purchase`; `a holding sold during the year is left out`; `a card reports what it owed on 31 December`; `a loan reports its balance, not its schedule`; `a personal debt settled in November is left out`; `a receivable still open is included`; `a foreign account keeps its currency for the KMK rate to convert`.
- [ ] Tests (fail first, `tax-freeze.test.ts`): `freezing copies the rows and stops following the ledger`; `a backdated trade shows as a difference, row by row`; `accepting a difference updates the row and marks it edited`; `freezing a year twice is refused, naming the year`; `a filed report refuses to be frozen again`; `a filed report refuses an accepted value`; `last year's filed rows are what carry-over reads`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): the tax year's figures, the freeze, and later differences`.

---

### Task 6: Web — the Coretax tab

**Files:** Create `apps/web/src/features/coretax/report-rows.ts`, `CoretaxPage.tsx`, `SectionTable.tsx`, `FreezePanel.tsx`, `queries.ts`, `report-rows.test.ts`; modify `apps/web/src/app/router.tsx`, `apps/web/src/features/networth/NetWorthTabs.tsx`.

**Interfaces — Produces:**
```ts
export interface ScreenSection { section: CoretaxSection; label: string; rows: CoretaxRow[]; costMinor: number; valueMinor: number }
export function screenSections(rows: CoretaxRow[]): ScreenSection[];
/** A readiness issue with where to go and fix it. */
export interface ReadinessLink { issue: ReadinessIssue; to: '/net-worth/assets' | '/net-worth/debts' | '/net-worth/loans' | '/net-worth/coretax'; label: string }
export function readinessLinks(issues: ReadinessIssue[], rows: CoretaxRow[]): ReadinessLink[];
export function carryPillLabel(status: CarryStatus): string;
```

The tab shows the year and its status, the readiness list with links, what changed since last year's return, the two settings (value basis, one row per holding or per year), the Ikhtisar with totals per section and the totals for harta and utang, a tab per section with its rows and carry-over pills, and the reconciliation line explaining the gap against net worth.

- [ ] Tests (fail first, `report-rows.test.ts`): `sections come in the order the form reads`; `an empty section is left out`; `totals per section match the rows shown`; `a blocking issue links to the asset that needs fixing`; `a warning links to the same place but is marked a warning`; `an issue about a debt links to Lend & borrow`; `an issue about a loan links to Loans`; `a manual row links to the report itself`; `carry-over pills read in plain words`.
- [ ] Implement; run `npm test -w @expanses/web` and `npm run typecheck`; commit `feat(web): the Coretax tab, readiness and the Ikhtisar`.

---

### Task 7: Web — freeze, export and end to end

**Files:** Create `packages/core/src/coretax/export.ts`, `packages/core/test/coretax-export.test.ts`, `apps/web/e2e/coretax.spec.ts`; modify `apps/web/src/features/coretax/FreezePanel.tsx`, `packages/core/src/index.ts`.

**Interfaces — Produces:**
```ts
/**
 * The rows as CSV, in our own column order — documented here, not taken from a DJP converter.
 * The converter's own column order is unverified, so nothing here claims to match it.
 */
export function toReportCsv(section: CoretaxSection, rows: CoretaxRow[]): string;
/** The column order used, so the screen can show it and a later mapping can be checked against it. */
export function csvColumns(section: CoretaxSection): string[];
```

The freeze panel walks the owner through it: 31 December prices that are missing, the KMK rate per currency held, a review of the rows, then Freeze. Export offers Copy and Download CSV per section, with a line saying the file holds NPWP, NIK and account numbers and stays on this device.

- [ ] Tests (fail first, `coretax-export.test.ts`): `the header names every column the section asks for`; `a row follows the header order`; `an amount is written in plain digits, with no thousands separator`; `a field holding a comma is quoted`; `a field holding a quote is escaped`; `an empty optional field is an empty column, not a gap`; `two sections have their own column sets`.
- [ ] E2E (`apps/web/e2e/coretax.spec.ts`, fail first): `a year with a bank account, gold and a card lists rows in every section it should`; `readiness names what is missing and links to it`; `filling the missing field clears the issue`; `freezing keeps the figures when a later trade is backdated into the year`; `the difference is listed, and accepting it updates the row`; `the reconciliation line explains the gap against net worth`; `the CSV downloads and says it holds personal data`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): freezing a tax year, and the CSV export`.
- [ ] Record execution notes at the end of this plan; commit `docs: record slice 6 execution status`.

---

## Self-review

**Spec coverage (§9):** both tables and the KMK source (Task 4); live draft rows per section, per-year splitting and the basis switch (Task 2); carry-over, readiness and the reconciliation (Task 3); the 31 December figures, the freeze, later differences and filed reports as next year's base (Task 5); the screens, Ikhtisar, section tabs and readiness links (Task 6); the freeze walk-through and the export (Task 7).

**Deliberately not built, and why:** `toConverterTsv` and any claim to match a DJP converter's column order. The converter for Orang Pribadi harta and utang may not exist at all, and the documents that would settle it are scans. `toReportCsv` ships in our own documented column order, and `csvColumns` exists so a verified mapping can be checked against it later without touching the schema or the screens.

**One code still open:** `015` against `019` for "setara kas lainnya". It lives in `CASH_EQUIVALENT_CODE`, in one place, so confirming it is a one-line change.
