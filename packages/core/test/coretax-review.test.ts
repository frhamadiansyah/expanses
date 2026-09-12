import { describe, expect, it } from 'vitest';
import { carryOver, type CoretaxRow, readiness, reconciliation } from '../src/index';

const YEAR = 2026;

const row = (partial: Partial<CoretaxRow> & Pick<CoretaxRow, 'key'>): CoretaxRow => ({
  section: 'kas',
  code: '012',
  name: 'BCA Tahapan',
  acquiredYear: null,
  costMinor: 50_000_000,
  valueMinor: 50_000_000,
  balanceMinor: 50_000_000,
  fields: { acct: '1234567890', owner: 'Fandrian', inst: 'Bank Central Asia', loc: 'IDN' },
  source: 'auto',
  note: null,
  ...partial,
});

const gold = (partial: Partial<CoretaxRow> = {}): CoretaxRow =>
  row({
    key: 'gold',
    section: 'lainnya',
    code: '051',
    name: 'Antam gold bars',
    acquiredYear: 2024,
    costMinor: 22_400_000,
    valueMinor: 28_500_000,
    balanceMinor: 0,
    fields: { cert: 'Sertifikat Antam 001', info: 'Emas batangan Antam' },
    ...partial,
  });

describe('carryOver', () => {
  it('marks every row new in the first year, when there is nothing to compare', () => {
    const rows = carryOver([row({ key: 'bca' }), gold()], null);

    expect(rows.map((entry) => entry.status)).toEqual(['new', 'new']);
    expect(rows[0]!.fromValueMinor).toBeNull();
  });

  it('marks a row that was not there last year as new', () => {
    const rows = carryOver([row({ key: 'bca' }), gold()], [row({ key: 'bca' })]);

    expect(rows.find((entry) => entry.key === 'gold')).toMatchObject({ status: 'new', fromValueMinor: null, toValueMinor: 28_500_000 });
  });

  it('marks a row that is gone as removed, keeping what it was worth', () => {
    const rows = carryOver([row({ key: 'bca' })], [row({ key: 'bca' }), gold()]);

    expect(rows.find((entry) => entry.key === 'gold')).toMatchObject({ status: 'removed', fromValueMinor: 28_500_000, toValueMinor: null });
  });

  it('marks a row whose value moved as changed, with both figures', () => {
    const rows = carryOver([row({ key: 'bca', valueMinor: 60_000_000 })], [row({ key: 'bca' })]);

    expect(rows[0]).toMatchObject({ status: 'changed', fromValueMinor: 50_000_000, toValueMinor: 60_000_000 });
  });

  it('marks an untouched row as same', () => {
    const rows = carryOver([row({ key: 'bca' })], [row({ key: 'bca' })]);

    expect(rows[0]!.status).toBe('same');
  });

  it('matches split rows on the account and the year together', () => {
    const current = [gold({ key: 'gold:2024', acquiredYear: 2024 }), gold({ key: 'gold:2026', acquiredYear: 2026, valueMinor: 9_500_000 })];
    const previous = [gold({ key: 'gold:2024', acquiredYear: 2024 })];

    const rows = carryOver(current, previous);
    expect(rows.find((entry) => entry.key === 'gold:2024')!.status).toBe('same');
    expect(rows.find((entry) => entry.key === 'gold:2026')!.status).toBe('new');
  });

  it('names each row, so the list reads without looking anything up', () => {
    expect(carryOver([gold()], null)[0]!.name).toBe('Antam gold bars');
  });
});

describe('readiness', () => {
  it('passes a row with everything the section asks for', () => {
    expect(readiness([row({ key: 'bca' })], YEAR)).toEqual([]);
  });

  it('refuses a row missing a field the form requires', () => {
    // Kas asks for the institution and the country as well as the owner.
    const issues = readiness([row({ key: 'bca', fields: { owner: 'Fandrian' } })], YEAR);

    expect(issues.some((issue) => issue.level === 'blocking')).toBe(true);
    expect(issues[0]!.rowKey).toBe('bca');
  });

  it('accepts a well-formed NPWP and refuses a malformed one', () => {
    const withNpwp = (npwp: string) =>
      row({ key: 'bbri', section: 'investasi', code: '032', name: 'BBRI shares', acquiredYear: 2024, fields: { loc: 'IDN', inst: 'Stockbit', sid: 'SID-001', npwp } });

    expect(readiness([withNpwp('0011223344556677')], YEAR)).toEqual([]);
    expect(readiness([withNpwp('12345')], YEAR).some((issue) => issue.level === 'blocking')).toBe(true);
  });

  it('refuses a year of purchase after the tax year', () => {
    const issues = readiness([gold({ acquiredYear: 2027 })], YEAR);

    expect(issues.some((issue) => issue.level === 'blocking' && /2027/.test(issue.message))).toBe(true);
  });

  it('accepts a year of purchase in the tax year itself', () => {
    expect(readiness([gold({ acquiredYear: YEAR })], YEAR)).toEqual([]);
  });

  it('refuses a negative amount', () => {
    const issues = readiness([gold({ valueMinor: -1 })], YEAR);

    expect(issues.some((issue) => issue.level === 'blocking')).toBe(true);
  });

  it('warns about a holding with no year of purchase, rather than refusing it', () => {
    const issues = readiness([gold({ acquiredYear: null })], YEAR);

    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe('warning');
  });

  it('says nothing about a cash row having no year, since it never has one', () => {
    expect(readiness([row({ key: 'bca' })], YEAR)).toEqual([]);
  });

  it('gives every issue its own key', () => {
    const issues = readiness([row({ key: 'bca', fields: {} }), gold({ acquiredYear: 2027 })], YEAR);

    expect(new Set(issues.map((issue) => issue.key)).size).toBe(issues.length);
  });
});

describe('reconciliation', () => {
  it('adds up the report and explains the gap against net worth', () => {
    const result = reconciliation([row({ key: 'bca' }), gold()], [row({ key: 'kpr', section: 'utang', code: '101', valueMinor: 700_000_000, balanceMinor: 700_000_000 })], 100_000_000);

    expect(result.hartaMinor).toBe(78_500_000);
    expect(result.utangMinor).toBe(700_000_000);
    expect(result.reportNetMinor).toBe(-621_500_000);
    expect(result.differenceMinor).toBe(-721_500_000);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('has nothing to explain when the two agree', () => {
    const result = reconciliation([row({ key: 'bca' })], [], 50_000_000);

    expect(result.differenceMinor).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('reports zero on both sides for a year with nothing in it', () => {
    expect(reconciliation([], [], 0)).toMatchObject({ hartaMinor: 0, utangMinor: 0, reportNetMinor: 0, differenceMinor: 0 });
  });
});
