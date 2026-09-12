import { CORETAX_SECTIONS, type CoretaxSection, missingCoretaxFields, validateCoretaxFields } from '../assets/coretax-fields';
import type { CoretaxRow, ReportSection } from './rows';

export type CarryStatus = 'new' | 'removed' | 'changed' | 'same';

export interface CarryRow {
  key: string;
  name: string;
  status: CarryStatus;
  /** What it was worth on last year's return, or null when it was not on it. */
  fromValueMinor: number | null;
  /** What it is worth on this one, or null when it has gone. */
  toValueMinor: number | null;
}

/**
 * This year's rows against last year's return. Rows match on their key, which already carries the
 * account and — when rows are split by year of purchase — the year with it.
 */
export function carryOver(current: CoretaxRow[], previous: CoretaxRow[] | null): CarryRow[] {
  const before = new Map((previous ?? []).map((row) => [row.key, row]));
  const rows: CarryRow[] = current.map((row) => {
    const was = before.get(row.key);
    if (!was) return { key: row.key, name: row.name, status: 'new', fromValueMinor: null, toValueMinor: row.valueMinor };
    const status: CarryStatus = was.valueMinor === row.valueMinor ? 'same' : 'changed';
    return { key: row.key, name: row.name, status, fromValueMinor: was.valueMinor, toValueMinor: row.valueMinor };
  });

  const now = new Set(current.map((row) => row.key));
  for (const row of previous ?? []) {
    if (now.has(row.key)) continue;
    rows.push({ key: row.key, name: row.name, status: 'removed', fromValueMinor: row.valueMinor, toValueMinor: null });
  }
  return rows;
}

export type ReadinessLevel = 'blocking' | 'warning';

export interface ReadinessIssue {
  key: string;
  /** The row it belongs to, or null when it is about the report as a whole. */
  rowKey: string | null;
  level: ReadinessLevel;
  message: string;
}

/** Sections that ask when the asset was acquired. Cash and receivables never do. */
const DATED_SECTIONS: ReportSection[] = ['investasi', 'bergerak', 'tidak_bergerak', 'lainnya'];

const isHartaSection = (section: ReportSection): section is CoretaxSection => section !== 'utang';

/**
 * What the form would refuse or question. Blocking means it cannot be filed as it stands; a warning
 * is worth looking at but never stops the owner.
 */
export function readiness(rows: CoretaxRow[], year: number): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  for (const row of rows) {
    if (isHartaSection(row.section)) {
      const definition = CORETAX_SECTIONS[row.section];
      for (const key of missingCoretaxFields(row.section, row.fields)) {
        const label = definition.fields.find((field) => field.key === key)?.label ?? key;
        issues.push({ key: `${row.key}:missing:${key}`, rowKey: row.key, level: 'blocking', message: `${row.name} needs ${label}` });
      }
      for (const problem of validateCoretaxFields(row.section, row.fields)) {
        issues.push({ key: `${row.key}:field:${problem.key}`, rowKey: row.key, level: 'blocking', message: `${row.name}: ${problem.message}` });
      }
    }

    if (row.acquiredYear !== null && row.acquiredYear > year) {
      issues.push({
        key: `${row.key}:year`,
        rowKey: row.key,
        level: 'blocking',
        message: `${row.name} says it was acquired in ${row.acquiredYear}, which is after the ${year} tax year`,
      });
    }

    if (row.acquiredYear === null && DATED_SECTIONS.includes(row.section)) {
      issues.push({ key: `${row.key}:undated`, rowKey: row.key, level: 'warning', message: `${row.name} has no year of purchase, which the form asks for` });
    }

    if (row.valueMinor < 0 || row.costMinor < 0 || row.balanceMinor < 0) {
      issues.push({ key: `${row.key}:negative`, rowKey: row.key, level: 'blocking', message: `${row.name} reports a negative amount` });
    }
  }

  return issues;
}

export interface Reconciliation {
  hartaMinor: number;
  utangMinor: number;
  /** Harta less utang, which is the report's own idea of net worth. */
  reportNetMinor: number;
  netWorthMinor: number;
  differenceMinor: number;
  /** Why the two differ, in the owner's words. */
  reasons: string[];
}

/**
 * The report against the app's net worth. They are allowed to differ — the report values property
 * on the basis chosen and leaves out anything not declarable — so the gap is explained, not hidden.
 */
export function reconciliation(harta: CoretaxRow[], utang: CoretaxRow[], netWorthMinor: number): Reconciliation {
  const hartaMinor = harta.reduce((total, row) => total + row.valueMinor, 0);
  const utangMinor = utang.reduce((total, row) => total + row.valueMinor, 0);
  const reportNetMinor = hartaMinor - utangMinor;
  const differenceMinor = reportNetMinor - netWorthMinor;

  const reasons: string[] = [];
  if (differenceMinor !== 0) {
    reasons.push('The report values property on the basis you chose, which need not be what the balance sheet shows.');
    if (harta.some((row) => row.note?.startsWith('Reported at'))) reasons.push('Property and vehicles here follow the report basis, not their latest estimate.');
    if (harta.some((row) => row.note?.includes('KMK'))) reasons.push('Something held in another currency is waiting for its KMK rate, so it counts as nothing until you enter one.');
    reasons.push('Anything the form does not ask for is left out of the report but still counts towards net worth.');
  }

  return { hartaMinor, utangMinor, reportNetMinor, netWorthMinor, differenceMinor, reasons };
}
