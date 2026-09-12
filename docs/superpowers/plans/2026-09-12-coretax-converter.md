# Coretax Codes and Converter (Slice 7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Format:** fast track, as chosen by the owner. Each task gives files, exact interfaces, and the named test cases that must be written first and fail before implementation. Code is written during execution, not in this document.

**Goal:** Put the real Coretax codes into the app — four digits, read from DJP's own guide — and write each harta table in the exact column order its Excel-to-XML converter expects, so the tax report stops being a table to copy by hand and becomes a file Coretax accepts.

**Architecture:** `packages/core` replaces the code lists wholesale and gains `toConverterTsv`, one column order per Lampiran 1 Bagian A table, with the vocabularies DJP fixes. `packages/db` gains migration `0013_coretax_codes`, which rebuilds `asset_profiles` back to a four-digit constraint and converts every stored code — while leaving frozen report rows exactly as filed. `apps/web` offers the converter file per table beside the CSV.

**Tech Stack:** unchanged (TypeScript 7, Vitest 5, Drizzle sqlite-proxy, better-sqlite3 in tests, Vite 8, React 19, TanStack Router/Query, Tailwind 4, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-11-net-worth-coretax-goals-design.md` §9.0 and §9.0.1, both rewritten from *Tata Cara Pembuatan XML SPT OP v20260310*.

## Global Constraints

- **Coretax codes are four digits.** The three-digit codes slice 6 installed are the old e-Form list and are wrong for this app; every one is converted.
- **A frozen or filed report is never rewritten.** `tax_year_rows` holds what was filed; the migration touches `asset_profiles` and `debt_profiles` only. A frozen row keeps the code it was frozen with, whatever the profile now says.
- Money stays 64-bit integer minor units; amounts in a converter file are positive whole rupiah with no separators.
- Biaya Perolehan is the Pasal 10 cost; Nilai Saat Ini is the value on 31 December. The ledger already holds both.
- DJP fixes three vocabularies: *Kepemilikan* is `Taxpayer` or `Other`; *Sumber Kepemilikan* is `Debt`, `Gift`, `Grant`, `Inheritance`, `Other sources` or `Own Income`; *Keterangan* is `01`, `02` or empty. A value outside them is a readiness issue, never silently sent.
- Utang is **not** importable: the guide has no Utang converter and no Utang code table. Its stored codes stay as they are, marked unverified.
- Every task ends green on `npm test` and `npm run typecheck` at the repo root; web tasks also run `npm run e2e`.
- Commits end with the project trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## How this slice came about, so nobody repeats it

The codes have now been wrong twice. They were invented in slice 1; slice 6 "verified" them against consultancy articles that describe the **e-Form** system, not Coretax, and migrated every stored code to that wrong list. The lists here are read from the PDF DJP publishes, rendered page by page. **A consultancy article is not a source for a code list.** Where this slice still guesses — a few one-to-many mappings below — it says so and leaves the choice to the owner.

## File Structure

```
packages/core/src/coretax/codes.ts        the four-digit lists, families, preset mapping
packages/core/src/coretax/converter.ts    toConverterTsv, converterColumns, the DJP vocabularies
packages/core/src/assets/coretax-fields.ts  fields the converter marks mandatory
packages/core/src/index.ts                + the converter exports
packages/core/test/coretax-codes.test.ts  coretax-converter.test.ts  assets-coretax-fields.test.ts

packages/db/migrations/0013_coretax_codes.sql
packages/db/src/migrations.ts             + version 13
packages/db/src/repos/assets.ts           the guard back to four digits
packages/db/src/repos/debts.ts            receivable defaults to 0201
packages/db/test/coretax-codes-migration.test.ts

apps/web/src/features/coretax/FreezePanel.tsx   the converter file per table
apps/web/src/features/coretax/report-rows.ts    unchanged shape, new labels flow through
apps/web/e2e/coretax.spec.ts                    downloading a converter file
```

---

### Task 1: Core — the four-digit codes

**Files:** Rewrite `packages/core/src/coretax/codes.ts`; modify `packages/core/src/assets/presets.ts`, `packages/core/test/coretax-codes.test.ts`.

**Interfaces — Produces:** the same names as today, with new contents and one addition:

```ts
export type HartaFamily = 'kas' | 'piutang' | 'investasi' | 'bergerak' | 'tidak_bergerak' | 'lainnya';
export const KODE_HARTA: readonly CoretaxCode[];   // 0101-0799, per §9.0
export const KODE_UTANG: readonly { code: string; label: string }[];  // unchanged, and unverified
/** Utang codes come from the e-Form petunjuk; the Coretax form has never been read. */
export const UTANG_CODES_UNVERIFIED = true;
export function coretaxCodeFor(kind: AssetKind): string;
export function sectionOfCode(code: string): CoretaxSection;
```

`CASH_EQUIVALENT_CODE` goes: it existed only for the `015`/`019` question, which belonged to the e-Form list. Cash equivalents are `0109`.

Preset codes become: `cash` → `0102` (tabungan), `fund` → `0307` (KIK, which is what a reksadana is), `stock` → `0303` (saham bursa), `bond` → `0305` (obligasi pemerintah — ORI and SBSN; a corporate bond is `0304`), `gold` → `0701` (emas batangan), `property` → `0502` (tanah dan/atau bangunan untuk tempat tinggal), `vehicle` → `0403` (mobil penumpang), `other` → `0799`.

Families map to sections one-to-one now — `0401`–`0499` is the Bergerak table and `0601`–`0799` the Lainnya table — so `SECTION_BY_FAMILY`'s old transposition of `transportasi`→`bergerak` and `bergerak`→`lainnya` disappears.

- [ ] Tests (fail first, `coretax-codes.test.ts`): `every code is four digits`; `no code appears twice`; `each family runs in its own hundred`; `a fund is a collective investment contract, not a bond`; `exchange-listed shares are 0303, not the non-listed 0302`; `gold is emas batangan under Harta Lainnya`; `a home is 0502 under Harta Tidak Bergerak`; `a car is 0403 under Harta Bergerak`; `every preset code is on the list`; `every preset sits in the section its code implies`; `an unknown code still falls to Harta Lainnya`; `the utang codes are marked unverified`.
- [ ] Implement; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): the Coretax four-digit codes, read from the DJP guide`.

---

### Task 2: Core — the fields the converter insists on

**Files:** Modify `packages/core/src/assets/coretax-fields.ts`, `packages/core/test/assets-coretax-fields.test.ts`, `packages/core/test/coretax-review.test.ts`.

Every starred column in §9.0.1 must exist as a field, or the file cannot be built. Two tables are short today:

- **piutang** gains `loc` ("Negara lokasi", country, required) and `idno` ("Nomor identitas penerima", text, required) beside its existing `name`.
- **bergerak** gains `ownerNpwp` ("NPWP pemilik", npwp, required) and `ownerName` ("Nama pemilik", text, required) beside `model`, `plate` and `own`.

Three fields become required because DJP stars them: `kas.acct` ("Nomor akun"), `investasi.npwp` ("Nomor identitas"), `investasi.sid` ("Bukti kepemilikan/nomor akun") and `lainnya.cert` ("Bukti kepemilikan/nomor akun").

**Interfaces — Produces:** unchanged signatures; `CORETAX_SECTIONS` gains the entries above.

- [ ] Tests (fail first, `assets-coretax-fields.test.ts`): `piutang asks for the country and the borrower identity number`; `bergerak asks who owns it, by name and NPWP`; `an account number is required for kas`; `a securities holding needs its ownership proof`; `every field DJP stars is required`; `no section lost a field it already had`.
- [ ] The readiness tests in `coretax-review.test.ts` now fail for rows that were complete under the old field sets: update those fixtures to carry the new fields, which is what the form actually demands.
- [ ] Implement; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): the fields each Coretax table marks mandatory`.

---

### Task 3: DB — migration `0013_coretax_codes`

**Files:** Create `packages/db/migrations/0013_coretax_codes.sql`, `packages/db/test/coretax-codes-migration.test.ts`; modify `packages/db/src/migrations.ts`, `packages/db/src/repos/assets.ts`, `packages/db/src/repos/debts.ts`, `packages/db/test/database.test.ts`.

`asset_profiles` is rebuilt again — SQLite still cannot alter a CHECK — back to `length = 4`, converting on the way across:

```
0101←011  0102←012  0103←013  0104←014  0109←015,019
0201←021  0202←022  0209←029
0301←031  0303←032  0304←033  0305←034  0306←035  0307←036  0308←037  0309←038  0399←039
0401←041  0402←042  0403←043  0499←049
0502←061  0506←062  0505←063  0509←069
0601←071  0602←072  0603←073  0699←079
0701←051  0705←052  0706←053  0708←055  0799←054,059
```

`debt_profiles` keeps payable codes (`101`–`104`, unverified) and converts receivables: `0201←021`, `0202←022`, `0209←029`.

**Three mappings are a judgement and the migration says so in a comment:** `052` batu mulia becomes `0705` permata; `053` barang seni dan antik becomes `0706`; `055` peralatan elektronik becomes `0708`, losing the furniture sense that `0709` carries. `054` covered kapal pesiar, pesawat and sports equipment, which Coretax splits across `0412`, `0408` and `0707` — it becomes `0799`, for the owner to correct per asset. Nobody's data is silently assigned a specific wrong thing.

`tax_year_rows` is **not** touched: a frozen row is what was filed.

`saveAssetProfile`'s guard returns to `/^\d{4}$/` with the message "A Coretax code is four digits", and `DEFAULT_CORETAX_CODE` in the debts repo becomes `{ lent: '0201', borrowed: '104' }`. The idempotency test expects `[1..13]`.

- [ ] Tests (fail first, `coretax-codes-migration.test.ts`): `a v12 database still opens`; `a savings account becomes 0102`; `a fund becomes 0307, not 0306`; `shares become 0303`; `gold becomes 0701`; `a home becomes 0502`; `a car becomes 0403`; `a receivable becomes 0201`; `a payable keeps its unverified code`; `a frozen report row keeps the code it was frozen with`; `a four-digit code the owner already set is left alone`; `the guard refuses a three-digit code again`.
- [ ] Implement; run `npm test -w @expanses/db` and `npm run typecheck`; commit `feat(db): migration 0013, the Coretax codes corrected`.

---

### Task 4: Core — the converter file

**Files:** Create `packages/core/src/coretax/converter.ts`, `packages/core/test/coretax-converter.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces — Consumes:** Task 1's codes, Task 2's fields, `CoretaxRow` from `coretax/rows.ts`.

**Interfaces — Produces:**
```ts
/** Ownership as DJP words it on the harta bergerak sheet. */
export type Kepemilikan = 'Taxpayer' | 'Other';
/** How a property came to be owned, as DJP words it. */
export type SumberKepemilikan = 'Debt' | 'Gift' | 'Grant' | 'Inheritance' | 'Other sources' | 'Own Income';
export const SUMBER_KEPEMILIKAN: readonly SumberKepemilikan[];
/** Voluntary-disclosure marker: 01, 02, or nothing at all. */
export type PpsKeterangan = '01' | '02' | '';

export interface ConverterHeader { npwp: string; taxYear: number }
/** The columns one table's sheet carries, in DJP's order. */
export function converterColumns(section: CoretaxSection): string[];
/**
 * One table as the converter expects it: TIN on the first line, TaxYear on the second, the header
 * row, then a line per row. Tab-separated, so it pastes into the sheet as columns.
 */
export function toConverterTsv(section: CoretaxSection, rows: CoretaxRow[], header: ConverterHeader): string;
/** Values that would be refused by the sheet: an unknown vocabulary word, a missing starred column. */
export function converterProblems(section: CoretaxSection, rows: CoretaxRow[]): ReadinessIssue[];
```

`utang` has no converter: `converterColumns('utang' as CoretaxSection)` is unreachable by type, and `toConverterTsv` throws if a caller contrives it.

- [ ] Tests (fail first, `coretax-converter.test.ts`): `the kas sheet carries TIN and TaxYear before the header`; `kas columns are the eight DJP names, in order`; `piutang columns are its own eight`; `investasi columns put Biaya Perolehan before Tahun Perolehan, as DJP does`; `bergerak asks for the owner NPWP and name`; `tidak bergerak carries both property sizes and the certificate`; `lainnya is the short one, with Informasi Tambahan`; `amounts are plain digits with no separators`; `a year is four digits, and empty when unknown`; `a tab inside a value is refused rather than breaking the column`; `Kepemilikan outside Taxpayer or Other is a problem`; `Sumber Kepemilikan outside the six words is a problem`; `Keterangan other than 01, 02 or empty is a problem`; `a missing starred column is a problem naming the row`; `an empty table still writes its two header lines and the column row`.
- [ ] Implement, export; run `npm test -w @expanses/core` and `npm run typecheck`; commit `feat(core): the Coretax converter file, one table at a time`.

---

### Task 5: Web — offering the converter file

**Files:** Modify `apps/web/src/features/coretax/FreezePanel.tsx`, `apps/web/src/features/coretax/CoretaxPage.tsx`, `apps/web/e2e/coretax.spec.ts`.

The export panel offers, per harta table, **Download converter file (.tsv)** beside the existing CSV, and says plainly which is which: the converter file pastes into DJP's Excel converter and becomes XML; the CSV is for reading. Utang offers CSV only, with one line saying Coretax has no import for it. The NPWP and tax year come from the report; when the NPWP is missing, the button is disabled and the readiness list says so, because the sheet's first line cannot be blank.

`converterProblems` joins the readiness list, so a value DJP would refuse is visible before the file is built rather than after Coretax rejects it.

- [ ] E2E (`coretax.spec.ts`, fail first): `a converter file is offered per harta table`; `utang offers the CSV and explains why there is no converter`; `without an NPWP the converter button is disabled and the reason is on the readiness list`; `with an NPWP the file downloads`.
- [ ] Implement; run `npm test`, `npm run typecheck`, `npm run e2e`; commit `feat(web): download the Coretax converter file per table`.
- [ ] Record execution notes at the end of this plan; commit `docs: record slice 7 execution status`.

---

## Self-review

**Spec coverage (§9.0, §9.0.1):** the six code tables (Task 1); the fields each converter stars (Task 2); the stored codes corrected without touching filed rows (Task 3); the six column orders, the three vocabularies and the TIN/TaxYear header (Task 4); offering the file and refusing to build a bad one (Task 5).

**What this slice knowingly leaves open:** the **Utang codes**, which the Coretax guide never lists — `KODE_UTANG` keeps the e-Form values behind `UTANG_CODES_UNVERIFIED`, and Bagian B stays a typing job because DJP publishes no import for it. The four ambiguous harta mappings are named in Task 3 rather than hidden.

**Type consistency:** `CoretaxSection`, `CoretaxRow` and `ReadinessIssue` are the existing types; `converterColumns` and `toConverterTsv` take the same `CoretaxSection` the rows already carry, and `csvColumns`/`toReportCsv` from slice 6 stay exactly as they are, so the CSV path is untouched by this work.
