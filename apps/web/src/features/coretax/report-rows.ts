import { balanceSheet, type CarryStatus, CORETAX_SECTIONS, type CoretaxRow, type ReadinessIssue, reconciliation, type Reconciliation, type ReportSection, type SheetAsset, type SheetLiability } from '@expanses/core';
import type { JointReport } from '@expanses/db';
import { namesOf } from '../sharing/net-worth-state';

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
  /** With one tax ID, a partner's row: who fixes it, on their own phone. Nothing on this one changes it. */
  owner?: string;
}

/**
 * Each thing to put right, with where to go and do it. A row the owner typed into the report is
 * fixed on the report; everything else is fixed where it lives — and a partner's row (one tax ID, `received` maps its
 * key to the owner's name) on the partner's phone.
 */
export function readinessLinks(issues: ReadinessIssue[], rows: CoretaxRow[], received?: ReadonlyMap<string, string>): ReadinessLink[] {
  const rowByKey = new Map(rows.map((row) => [row.key, row]));

  return issues.map((issue) => {
    const row = issue.rowKey ? rowByKey.get(issue.rowKey) : undefined;
    let to: ReadinessDestination = '/tax-report';
    // A year-split holding's key is `item:year`; the item is what was received.
    const owner = row ? received?.get(row.key.split(':')[0] ?? '') : undefined;
    if (owner) return { issue, to, label: `${row!.name}: ${issue.message}`, owner };
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
  options: { joint?: boolean } = {},
): { report: Pick<Reconciliation, 'hartaMinor' | 'utangMinor' | 'reportNetMinor'>; check: Reconciliation | null; missing: string[]; joint: boolean } {
  const missing = [...(inputs?.missing ?? [])];
  const sheet = balanceSheet(inputs?.assets ?? [], inputs?.liabilities ?? []);
  const full = reconciliation(harta, utang, sheet.netWorthMinor);
  const report = { hartaMinor: full.hartaMinor, utangMinor: full.utangMinor, reportNetMinor: full.reportNetMinor };
  // One tax ID: the report holds both people's items and this phone's balance sheet only its own, so any gap is wrong.
  if (options.joint) return { report, check: null, missing: [], joint: true };
  return missing.length > 0 ? { report, check: null, missing, joint: false } : { report, check: full, missing: [], joint: false };
}

export interface JointReportView {
  /** "Joint report · Rina and Andi". */
  banner: string;
  /** Nothing is waiting: every member has shared every item, and every item's year-end is here. */
  complete: boolean;
  /** What it is still waiting for, one line each. */
  lines: string[];
  /** Said by the Freeze button while anything is missing: a frozen report keeps only what it held then. */
  freezeWarning: string | null;
}

const itemsWord = (count: number) => (count === 1 ? '1 item' : `${count} items`);

/**
 * The joint report's banner and what it still waits for (joint-net-worth §8.4, D8): each member with items not yet
 * shared ("Rina hasn't added 1 item yet"), then each owner whose items' year-end has not reached this phone. Null for
 * separate tax IDs or no group, where the report is unchanged.
 */
export function jointReportView(
  joint: Pick<JointReport, 'members' | 'me' | 'waiting' | 'pending'> | null | undefined,
  nameOfMember: (memberId: string) => string | undefined,
): JointReportView | null {
  if (!joint) return null;
  // Until every member's name is known, nothing: never "Joint report · Someone and Someone".
  if (joint.members.some((member) => !nameOfMember(member))) return null;
  const nameOf = (memberId: string) => nameOfMember(memberId) ?? 'Someone';
  const lines: string[] = [];
  const others = joint.members.filter((member) => member !== joint.me);
  for (const member of [...others, joint.me]) {
    const count = joint.pending[member] ?? 0;
    if (count <= 0) continue;
    lines.push(`${nameOf(member)} hasn't added ${itemsWord(count)} yet`);
  }
  const waitingBy = new Map<string, string[]>();
  for (const item of joint.waiting) waitingBy.set(item.owner, [...(waitingBy.get(item.owner) ?? []), item.name]);
  for (const [owner, names] of waitingBy) lines.push(`Waiting for ${nameOf(owner)}'s phone: ${names.join(', ')}`);
  const missingOthers = joint.members.filter((m) => m !== joint.me && ((joint.pending[m] ?? 0) > 0 || waitingBy.has(m)));
  const missingMine = (joint.pending[joint.me] ?? 0) > 0;
  const missingOwners = [...missingOthers, ...(missingMine ? [joint.me] : [])];
  const whose = namesOf(missingOwners.map(nameOf));
  const freezeWarning = missingOwners.length > 0 ? `${whose}'s items are still missing — freezing now leaves them out` : null;
  return { banner: `Joint report · ${namesOf(joint.members.map(nameOf))}`, complete: lines.length === 0, lines, freezeWarning };
}
