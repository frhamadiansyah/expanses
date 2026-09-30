import type { CoretaxRow, ReadinessIssue } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { carryPillLabel, jointReportView, readinessLinks, reportCheck, screenSections } from './report-rows';

const row = (partial: Partial<CoretaxRow> & Pick<CoretaxRow, 'key'>): CoretaxRow => ({
  section: 'kas',
  code: '0102',
  name: 'BCA Tahapan',
  acquiredYear: null,
  costMinor: 50_000_000,
  valueMinor: 50_000_000,
  balanceMinor: 50_000_000,
  fields: {},
  source: 'auto',
  note: null,
  ...partial,
});

const gold = row({ key: 'gold', section: 'lainnya', code: '0701', name: 'Antam gold bars', costMinor: 22_400_000, valueMinor: 28_500_000, balanceMinor: 0, acquiredYear: 2024 });
const kpr = row({ key: 'kpr', section: 'utang', code: '101', name: 'KPR Bintaro', costMinor: 0, valueMinor: 700_000_000, balanceMinor: 700_000_000 });

const issue = (partial: Partial<ReadinessIssue> & Pick<ReadinessIssue, 'key'>): ReadinessIssue => ({
  rowKey: 'bca',
  level: 'blocking',
  message: 'BCA Tahapan needs Nama bank/institusi',
  ...partial,
});

describe('screenSections', () => {
  it('reads in the order the form does, with utang last', () => {
    const sections = screenSections([kpr, gold, row({ key: 'bca' })]);

    expect(sections.map((section) => section.section)).toEqual(['kas', 'lainnya', 'utang']);
  });

  it('leaves out a section with no rows, rather than showing it empty', () => {
    const sections = screenSections([row({ key: 'bca' })]);

    expect(sections.map((section) => section.section)).toEqual(['kas']);
  });

  it('adds up what each section holds', () => {
    const sections = screenSections([row({ key: 'bca' }), gold]);

    expect(sections.find((section) => section.section === 'lainnya')).toMatchObject({ costMinor: 22_400_000, valueMinor: 28_500_000 });
  });

  it('names each section as the form names it', () => {
    const sections = screenSections([row({ key: 'bca' }), kpr]);

    expect(sections[0]!.label).toBe('Kas dan Setara Kas');
    expect(sections[1]!.label).toBe('Utang');
  });

  it('keeps the rows inside their own section', () => {
    const sections = screenSections([row({ key: 'bca' }), gold, kpr]);

    expect(sections.find((section) => section.section === 'kas')!.rows.map((entry) => entry.key)).toEqual(['bca']);
  });

  it('has nothing to show for a year with no rows', () => {
    expect(screenSections([])).toEqual([]);
  });
});

describe('readinessLinks', () => {
  const rows = [row({ key: 'bca' }), gold, kpr];

  it('sends an issue about an asset to the Assets tab', () => {
    const links = readinessLinks([issue({ key: 'bca:missing:inst' })], rows);

    expect(links[0]).toMatchObject({ to: '/net-worth/assets' });
    expect(links[0]!.label).toContain('BCA Tahapan');
  });

  it('sends an issue about a debt to Lend & borrow', () => {
    const links = readinessLinks([issue({ key: 'andi:missing:name', rowKey: 'andi' })], [row({ key: 'andi', section: 'piutang', code: '0201', name: 'Andi' })]);

    expect(links[0]!.to).toBe('/net-worth/lend-borrow');
  });

  it('sends an issue about a loan to Loans', () => {
    const links = readinessLinks([issue({ key: 'kpr:missing:x', rowKey: 'kpr' })], rows);

    expect(links[0]!.to).toBe('/net-worth/loans');
  });

  it('keeps an issue about a row typed in by hand on the report itself', () => {
    const manual = row({ key: 'manual-1', source: 'manual', name: 'Lukisan' });
    const links = readinessLinks([issue({ key: 'manual-1:missing:info', rowKey: 'manual-1' })], [manual]);

    expect(links[0]!.to).toBe('/tax-report');
  });

  it('keeps an issue that belongs to no row on the report', () => {
    const links = readinessLinks([issue({ key: 'report:npwp', rowKey: null, message: 'The report needs your NPWP' })], rows);

    expect(links[0]!.to).toBe('/tax-report');
  });

  it('carries the level through, so a warning still reads as one', () => {
    const links = readinessLinks([issue({ key: 'gold:undated', rowKey: 'gold', level: 'warning', message: 'Antam gold bars has no year of purchase' })], rows);

    expect(links[0]!.issue.level).toBe('warning');
  });

  it('with one tax ID, an issue on a partner’s row names who fixes it and links nowhere of this phone’s', () => {
    const house = row({ key: 'item-house', section: 'tidak_bergerak', code: '0509', name: 'House in Bintaro' });
    const links = readinessLinks([issue({ key: 'item-house:missing:loc', rowKey: 'item-house' })], [house], new Map([['item-house', 'Andi']]));

    expect(links[0]).toMatchObject({ to: '/tax-report', owner: 'Andi' });
  });

  it('has nothing to link when the year is ready', () => {
    expect(readinessLinks([], rows)).toEqual([]);
  });
});

describe('carryPillLabel', () => {
  it('reads in plain words', () => {
    expect(carryPillLabel('new')).toBe('New this year');
    expect(carryPillLabel('removed')).toBe('Gone since last year');
    expect(carryPillLabel('changed')).toBe('Changed');
    expect(carryPillLabel('same')).toBe('Unchanged');
  });
});

describe('reportCheck', () => {
  const bca = row({ key: 'bca' });
  // The balance sheet on 31 December: BCA, plus a USD account whose row reads 0 because USD had no rate.
  const assets = [
    { accountId: 'bca', name: 'BCA Tahapan', planGroup: 'liquid' as const, subtype: 'bank', valueMinor: 50_000_000 },
    { accountId: 'usd', name: 'Dollar Saver', planGroup: 'liquid' as const, subtype: 'bank', valueMinor: 0 },
  ];

  it('compares the report with the balance sheet when every rate is there', () => {
    const got = reportCheck([bca], [], { assets, liabilities: [], missing: [] });
    expect(got.missing).toEqual([]);
    expect(got.check).toMatchObject({ reportNetMinor: 50_000_000, netWorthMinor: 50_000_000, differenceMinor: 0 });
  });

  it('makes no comparison while a currency has no rate: its row reads 0, so the gap would be wrong', () => {
    const got = reportCheck([bca], [kpr], { assets, liabilities: [], missing: ['USD'] });
    expect(got.check).toBeNull();
    expect(got.missing).toEqual(['USD']);
    // The report's own figures do not need the balance sheet, so they stand.
    expect(got.report).toEqual({ hartaMinor: 50_000_000, utangMinor: 700_000_000, reportNetMinor: -650_000_000 });
  });

  it('with one tax ID, makes no comparison: the balance sheet holds only this phone’s items, the report both people’s', () => {
    const house = row({ key: 'item-house', section: 'tidak_bergerak', code: '0509', costMinor: 900_000_000, valueMinor: 900_000_000, balanceMinor: 0 });
    const got = reportCheck([bca, house], [], { assets, liabilities: [], missing: [] }, { joint: true });
    expect(got.check).toBeNull();
    expect(got.missing).toEqual([]);
    expect(got.joint).toBe(true);
    expect(got.report.hartaMinor).toBe(950_000_000);
  });
});

describe('jointReportView', () => {
  const names: Record<string, string> = { rina: 'Rina', andi: 'Andi' };
  const nameOf = (id: string) => names[id] ?? 'Someone';
  const base = { members: ['rina', 'andi'], me: 'andi', waiting: [], pending: {} };

  it('separate tax IDs, or no group: nothing to say, the report is unchanged', () => {
    expect(jointReportView(null, nameOf)).toBeNull();
    expect(jointReportView(undefined, nameOf)).toBeNull();
  });

  it('names whose report it is, and is complete when nothing is missing', () => {
    expect(jointReportView(base, nameOf)).toEqual({ banner: 'Joint report · Rina and Andi', complete: true, lines: [] });
  });

  it('Rina has an item not yet shared: says so, and the report is not complete', () => {
    const view = jointReportView({ ...base, pending: { rina: 1 } }, nameOf)!;
    expect(view.complete).toBe(false);
    expect(view.lines).toEqual(["Rina hasn't added 1 item yet"]);
  });

  it('counts items, and speaks to this phone’s own person as you', () => {
    const view = jointReportView({ ...base, pending: { andi: 2, rina: 3 } }, nameOf)!;
    expect(view.lines).toEqual(["Rina hasn't added 3 items yet", "You haven't added 2 items yet"]);
  });

  it('an item whose year-end has not arrived: waiting for its owner’s phone, and not complete', () => {
    const view = jointReportView({ ...base, me: 'rina', waiting: [{ owner: 'andi', name: 'House in Bintaro' }, { owner: 'andi', name: 'Andi Bank' }] }, nameOf)!;
    expect(view.complete).toBe(false);
    expect(view.lines).toEqual(["Waiting for Andi's phone: House in Bintaro, Andi Bank"]);
  });
});
