import type { CoretaxSection } from '../assets/coretax-fields';
import type { YearBucket } from '../assets/position';
import { unitsValueMinor } from '../assets/units';
import { convertMinor } from '../money/money';
import { sectionOfCode } from './codes';

/** Bagian A has a table per harta section; Bagian B is the one utang table beside them. */
export type ReportSection = CoretaxSection | 'utang';

export interface CoretaxRow {
  /** The account, plus the year when rows are split by year of purchase. */
  key: string;
  section: ReportSection;
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

export interface CashInput {
  accountId: string;
  name: string;
  code: string;
  balanceMinor: number;
  currency: string;
  fields: Record<string, string>;
}

export interface HoldingInput {
  accountId: string;
  name: string;
  code: string;
  currency: string;
  /** The 31 December price, as price × 1e6. */
  priceMicro: number;
  /** Units and cost still held, by the year each parcel was bought. Cost is already historical IDR. */
  byYear: Record<string, YearBucket>;
  fields: Record<string, string>;
}

export interface EstimatedInput {
  accountId: string;
  name: string;
  code: string;
  currency: string;
  costMinor: number;
  valueMinor: number;
  fields: Record<string, string>;
}

export interface ReceivableInput extends CashInput {}

export interface DebtInput {
  accountId: string;
  name: string;
  code: string;
  balanceMinor: number;
  currency: string;
  /** The lender, or whoever is owed. */
  note: string | null;
}

export interface CoretaxInputs {
  cash: CashInput[];
  holdings: HoldingInput[];
  estimated: EstimatedInput[];
  receivables: ReceivableInput[];
  debts: DebtInput[];
}

export interface ReportSettings {
  /** Which figure property and vehicles report. */
  propertyBasis: 'cost' | 'estimate' | 'njop' | 'appraisal';
  /** One row per holding, or one row per holding and year of purchase. */
  repeatRows: 'holding' | 'year';
  /** The KMK rate for 31 December per currency, as the rate times ten thousand. */
  kmkRateBps: Record<string, number>;
}

const BASE = 'IDR';
const BPS = 10_000;

/** Order the form reads its tables in. */
const SECTION_ORDER: ReportSection[] = ['kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya', 'utang'];

const MISSING_RATE = 'No KMK rate entered for 31 December, so this is reported as nothing until one is';

/**
 * An amount in the report's currency. A foreign amount needs the KMK rate the Ministry publishes
 * for 31 December: a market rate is not what the form asks for, so none is ever substituted.
 */
function inBase(amountMinor: number, currency: string, settings: ReportSettings): { amountMinor: number; note: string | null } {
  if (currency === BASE) return { amountMinor, note: null };
  const rateBps = settings.kmkRateBps[currency];
  if (!rateBps) return { amountMinor: 0, note: `${MISSING_RATE} (${currency})` };
  return { amountMinor: convertMinor(amountMinor, currency, BASE, rateBps / BPS), note: null };
}

const row = (partial: Omit<CoretaxRow, 'source'> & { source?: CoretaxRow['source'] }): CoretaxRow => ({ source: 'auto', ...partial });

/** Only parcels still held are reported; a year sold out during the year has nothing to declare. */
const liveYears = (byYear: Record<string, YearBucket>): [string, YearBucket][] =>
  Object.entries(byYear)
    .filter(([, bucket]) => bucket.unitsMicro > 0)
    .sort(([a], [b]) => a.localeCompare(b));

function cashRows(inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[] {
  const rows: CoretaxRow[] = [];
  for (const account of [...inputs.cash, ...inputs.receivables]) {
    if (account.balanceMinor <= 0) continue;
    const { amountMinor, note } = inBase(account.balanceMinor, account.currency, settings);
    rows.push(
      row({
        key: account.accountId,
        section: sectionOfCode(account.code),
        code: account.code,
        name: account.name,
        acquiredYear: null,
        costMinor: amountMinor,
        valueMinor: amountMinor,
        balanceMinor: amountMinor,
        fields: account.fields,
        note,
      }),
    );
  }
  return rows;
}

function holdingRows(inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[] {
  const rows: CoretaxRow[] = [];
  for (const holding of inputs.holdings) {
    const years = liveYears(holding.byYear);
    if (years.length === 0) continue;
    const section = sectionOfCode(holding.code);

    const valueOf = (unitsMicro: number) => inBase(unitsValueMinor(unitsMicro, holding.priceMicro), holding.currency, settings);

    if (settings.repeatRows === 'year') {
      for (const [year, bucket] of years) {
        const value = valueOf(bucket.unitsMicro);
        rows.push(
          row({
            key: `${holding.accountId}:${year}`,
            section,
            code: holding.code,
            name: holding.name,
            acquiredYear: Number(year),
            costMinor: bucket.costMinor,
            valueMinor: value.amountMinor,
            balanceMinor: 0,
            fields: holding.fields,
            note: value.note,
          }),
        );
      }
      continue;
    }

    const unitsMicro = years.reduce((total, [, bucket]) => total + bucket.unitsMicro, 0);
    const costMinor = years.reduce((total, [, bucket]) => total + bucket.costMinor, 0);
    const value = valueOf(unitsMicro);
    rows.push(
      row({
        key: holding.accountId,
        section,
        code: holding.code,
        name: holding.name,
        // Everything on one row carries the year the earliest parcel was bought.
        acquiredYear: Number(years[0]![0]),
        costMinor,
        valueMinor: value.amountMinor,
        balanceMinor: 0,
        fields: holding.fields,
        note: value.note,
      }),
    );
  }
  return rows;
}

function estimatedRows(inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[] {
  return inputs.estimated.map((asset) => {
    const chosen = settings.propertyBasis === 'cost' ? asset.costMinor : asset.valueMinor;
    const value = inBase(chosen, asset.currency, settings);
    const cost = inBase(asset.costMinor, asset.currency, settings);
    return row({
      key: asset.accountId,
      section: sectionOfCode(asset.code),
      code: asset.code,
      name: asset.name,
      acquiredYear: null,
      costMinor: cost.amountMinor,
      valueMinor: value.amountMinor,
      balanceMinor: 0,
      fields: asset.fields,
      // The basis is on the row, so the choice behind the figure is never hidden.
      note: value.note ?? `Reported at ${settings.propertyBasis}`,
    });
  });
}

/** The harta rows for a tax year, in the order the form reads its tables. */
export function coretaxRows(year: number, inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[] {
  const rows = [...cashRows(inputs, settings), ...holdingRows(inputs, settings), ...estimatedRows(inputs, settings)];
  return rows.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section));
}

/** The utang rows: everything still owed on 31 December, on their own table. */
export function utangRows(year: number, inputs: CoretaxInputs, settings: ReportSettings): CoretaxRow[] {
  const rows: CoretaxRow[] = [];
  for (const debt of inputs.debts) {
    if (debt.balanceMinor <= 0) continue;
    const { amountMinor, note } = inBase(debt.balanceMinor, debt.currency, settings);
    rows.push(
      row({
        key: debt.accountId,
        section: 'utang',
        code: debt.code,
        name: debt.name,
        acquiredYear: null,
        costMinor: 0,
        valueMinor: amountMinor,
        balanceMinor: amountMinor,
        fields: {},
        note: note ?? debt.note,
      }),
    );
  }
  return rows;
}

export interface SectionTotal {
  section: ReportSection;
  costMinor: number;
  valueMinor: number;
}

/** What each table comes to. A section with no rows is left out rather than shown as zero. */
export function sectionTotals(rows: CoretaxRow[]): SectionTotal[] {
  const totals = new Map<ReportSection, SectionTotal>();
  for (const entry of rows) {
    const running = totals.get(entry.section) ?? { section: entry.section, costMinor: 0, valueMinor: 0 };
    running.costMinor += entry.costMinor;
    running.valueMinor += entry.valueMinor;
    totals.set(entry.section, running);
  }
  return SECTION_ORDER.filter((section) => totals.has(section)).map((section) => totals.get(section)!);
}
