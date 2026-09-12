import { describe, expect, it } from 'vitest';
import { type CoretaxRow, csvColumns, toReportCsv } from '../src/index';

const row = (partial: Partial<CoretaxRow> & Pick<CoretaxRow, 'key'>): CoretaxRow => ({
  section: 'kas',
  code: '012',
  name: 'BCA Tahapan',
  acquiredYear: null,
  costMinor: 50_000_000,
  valueMinor: 50_000_000,
  balanceMinor: 50_000_000,
  fields: { owner: 'Fandrian', inst: 'Bank Central Asia', loc: 'IDN' },
  source: 'auto',
  note: null,
  ...partial,
});

const lines = (csv: string) => csv.trim().split('\n');

describe('csvColumns', () => {
  it('names the columns a section asks for, after the ones every row has', () => {
    const columns = csvColumns('kas');

    expect(columns.slice(0, 4)).toEqual(['Kode Harta', 'Nama Harta', 'Tahun Perolehan', 'Harga Perolehan']);
    expect(columns).toEqual(expect.arrayContaining(['Atas nama', 'Nama bank/institusi', 'Lokasi harta']));
  });

  it('gives each section its own set', () => {
    expect(csvColumns('kas')).not.toEqual(csvColumns('tidak_bergerak'));
    expect(csvColumns('tidak_bergerak')).toEqual(expect.arrayContaining(['Luas tanah (m²)', 'Nomor sertifikat']));
  });

  it('names the utang columns, which are not harta columns at all', () => {
    const columns = csvColumns('utang');

    expect(columns).toEqual(['Kode Utang', 'Nama Pemberi Pinjaman', 'Tahun Peminjaman', 'Jumlah']);
  });
});

describe('toReportCsv', () => {
  it('writes the header, then a line per row', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca' }), row({ key: 'mandiri', name: 'Mandiri' })]);

    expect(lines(csv)).toHaveLength(3);
    expect(lines(csv)[0]).toBe(csvColumns('kas').join(','));
  });

  it('follows the header order, column for column', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca' })]);

    const [header, first] = lines(csv);
    const at = (column: string) => first!.split(',')[header!.split(',').indexOf(column)];
    expect(at('Kode Harta')).toBe('012');
    expect(at('Nama Harta')).toBe('BCA Tahapan');
    expect(at('Atas nama')).toBe('Fandrian');
  });

  it('writes amounts in plain digits, with nothing between the thousands', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca' })]);

    expect(lines(csv)[1]).toContain('50000000');
    expect(lines(csv)[1]).not.toContain('50.000.000');
  });

  it('leaves a year empty rather than writing a nought', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca', acquiredYear: null })]);
    const header = lines(csv)[0]!.split(',');
    const cells = lines(csv)[1]!.split(',');

    expect(cells[header.indexOf('Tahun Perolehan')]).toBe('');
  });

  it('quotes a value holding a comma', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca', name: 'BCA Tahapan, Jakarta' })]);

    expect(lines(csv)[1]).toContain('"BCA Tahapan, Jakarta"');
  });

  it('escapes a quote by doubling it, as CSV does', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca', name: 'The "main" account' })]);

    expect(lines(csv)[1]).toContain('"The ""main"" account"');
  });

  it('leaves an empty column for a field never filled in', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca', fields: { owner: 'Fandrian' } })]);
    const header = lines(csv)[0]!.split(',');
    const cells = lines(csv)[1]!.split(',');

    expect(cells).toHaveLength(header.length);
    expect(cells[header.indexOf('Nama bank/institusi')]).toBe('');
  });

  it('writes what is owed for an utang row, and no cost at all', () => {
    const kpr = row({ key: 'kpr', section: 'utang', code: '101', name: 'KPR Bintaro', costMinor: 0, valueMinor: 700_000_000, balanceMinor: 700_000_000 });

    const csv = toReportCsv('utang', [kpr]);
    const header = lines(csv)[0]!.split(',');
    const cells = lines(csv)[1]!.split(',');
    expect(cells[header.indexOf('Kode Utang')]).toBe('101');
    expect(cells[header.indexOf('Jumlah')]).toBe('700000000');
  });

  it('writes only the header when the section has no rows', () => {
    expect(lines(toReportCsv('kas', []))).toEqual([csvColumns('kas').join(',')]);
  });

  it('takes only the rows of the section asked for', () => {
    const csv = toReportCsv('kas', [row({ key: 'bca' }), row({ key: 'gold', section: 'lainnya', code: '051', name: 'Antam gold bars' })]);

    expect(lines(csv)).toHaveLength(2);
    expect(csv).not.toContain('Antam gold bars');
  });
});
