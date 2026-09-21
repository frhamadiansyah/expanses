import { balanceSheet, type CarryStatus, CORETAX_SECTIONS, type CoretaxRow, type ReadinessIssue, reconciliation, type Reconciliation, type ReportSection, type SheetAsset, type SheetLiability } from '@expanses/core';

export interface ScreenSection {
  section: ReportSection;
  /** What the form calls this table. */
  label: string;
  rows: CoretaxRow[];
  costMinor: number;
  valueMinor: number;
}

/** The order the form reads its tables in, with Bagian B last. */
const SECTION_ORDER: ReportSection[] = ['kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya', 'utang'];

const labelOf = (section: ReportSection): string => (section === 'utang' ? 'Utang' : CORETAX_SECTIONS[section].label);

/** The rows grouped into the tables the form asks for. An empty table is left out. */
export function screenSections(rows: CoretaxRow[]): ScreenSection[] {
  const bySection = new Map<ReportSection, ScreenSection>();
  for (const row of rows) {
    const running = bySection.get(row.section) ?? { section: row.section, label: labelOf(row.section), rows: [], costMinor: 0, valueMinor: 0 };
    running.rows.push(row);
    running.costMinor += row.costMinor;
    running.valueMinor += row.valueMinor;
    bySection.set(row.section, running);
  }
  return SECTION_ORDER.filter((section) => bySection.has(section)).map((section) => bySection.get(section)!);
}

export type ReadinessDestination = '/net-worth/assets' | '/net-worth/lend-borrow' | '/net-worth/loans' | '/tax-report';

export interface ReadinessLink {
  issue: ReadinessIssue;
  to: ReadinessDestination;
  /** What the link says, which names the thing that needs attention. */
  label: string;
}

/**
 * Each thing to put right, with where to go and do it. A row the owner typed into the report is
 * fixed on the report; everything else is fixed where it lives.
 */
export function readinessLinks(issues: ReadinessIssue[], rows: CoretaxRow[]): ReadinessLink[] {
  const rowByKey = new Map(rows.map((row) => [row.key, row]));

  return issues.map((issue) => {
    const row = issue.rowKey ? rowByKey.get(issue.rowKey) : undefined;
    let to: ReadinessDestination = '/tax-report';
    if (row && row.source !== 'manual') {
      if (row.section === 'utang') to = row.code === '101' ? '/net-worth/loans' : '/net-worth/lend-borrow';
      else if (row.section === 'piutang') to = '/net-worth/lend-borrow';
      else to = '/net-worth/assets';
    }
    return { issue, to, label: row ? `${row.name}: ${issue.message}` : issue.message };
  });
}

const CARRY_LABELS: Record<CarryStatus, string> = {
  new: 'New this year',
  removed: 'Gone since last year',
  changed: 'Changed',
  same: 'Unchanged',
};

export function carryPillLabel(status: CarryStatus): string {
  return CARRY_LABELS[status];
}

/**
 * The report against the balance sheet on 31 December — or, while a currency held that day has no rate, no
 * comparison at all and the currencies named. `sheetInputsAt` gives such a row 0, so the balance sheet's net worth
 * would be short by exactly that money and the gap shown would be wrong. The report's own harta and utang stand.
 */
export function reportCheck(
  harta: CoretaxRow[],
  utang: CoretaxRow[],
  inputs: { assets: SheetAsset[]; liabilities: SheetLiability[]; missing: readonly string[] } | undefined,
): { report: Pick<Reconciliation, 'hartaMinor' | 'utangMinor' | 'reportNetMinor'>; check: Reconciliation | null; missing: string[] } {
  const missing = [...(inputs?.missing ?? [])];
  const sheet = balanceSheet(inputs?.assets ?? [], inputs?.liabilities ?? []);
  const full = reconciliation(harta, utang, sheet.netWorthMinor);
  const report = { hartaMinor: full.hartaMinor, utangMinor: full.utangMinor, reportNetMinor: full.reportNetMinor };
  return missing.length > 0 ? { report, check: null, missing } : { report, check: full, missing: [] };
}
