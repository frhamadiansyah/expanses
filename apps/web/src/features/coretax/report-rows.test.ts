import type { CoretaxRow, ReadinessIssue } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { carryPillLabel, readinessLinks, screenSections } from './report-rows';

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

    expect(links[0]!.to).toBe('/net-worth/debts');
  });

  it('sends an issue about a loan to Loans', () => {
    const links = readinessLinks([issue({ key: 'kpr:missing:x', rowKey: 'kpr' })], rows);

    expect(links[0]!.to).toBe('/net-worth/loans');
  });

  it('keeps an issue about a row typed in by hand on the report itself', () => {
    const manual = row({ key: 'manual-1', source: 'manual', name: 'Lukisan' });
    const links = readinessLinks([issue({ key: 'manual-1:missing:info', rowKey: 'manual-1' })], [manual]);

    expect(links[0]!.to).toBe('/net-worth/coretax');
  });

  it('keeps an issue that belongs to no row on the report', () => {
    const links = readinessLinks([issue({ key: 'report:npwp', rowKey: null, message: 'The report needs your NPWP' })], rows);

    expect(links[0]!.to).toBe('/net-worth/coretax');
  });

  it('carries the level through, so a warning still reads as one', () => {
    const links = readinessLinks([issue({ key: 'gold:undated', rowKey: 'gold', level: 'warning', message: 'Antam gold bars has no year of purchase' })], rows);

    expect(links[0]!.issue.level).toBe('warning');
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
