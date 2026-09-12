import { describe, expect, it } from 'vitest';
import { ConverterError, converterColumns, converterProblems, type ConverterHeader, type CoretaxRow, toConverterTsv } from '../src/index';

const header: ConverterHeader = { npwp: '0011223344556677', taxYear: 2026 };

const row = (partial: Partial<CoretaxRow> & Pick<CoretaxRow, 'key'>): CoretaxRow => ({
  section: 'kas',
  code: '0102',
  name: 'BCA Tahapan',
  acquiredYear: 2020,
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
    code: '0701',
    name: 'Antam gold bars',
    acquiredYear: 2024,
    costMinor: 22_400_000,
    valueMinor: 28_500_000,
    balanceMinor: 0,
    fields: { cert: 'Sertifikat 001', info: 'Emas batangan Antam' },
    ...partial,
  });

const lines = (tsv: string) => tsv.split('\n');
const cells = (tsv: string, index: number) => lines(tsv)[index]!.split('\t');

describe('converterColumns', () => {
  it('gives kas its eight columns, in DJP order', () => {
    expect(converterColumns('kas')).toEqual([
      'Kode',
      'Nomor Akun',
      'Atas Nama',
      'Nama Bank/Institusi',
      'Lokasi Harta',
      'Tahun Perolehan',
      'Saldo',
      'Keterangan',
    ]);
  });

  it('gives piutang its own eight, which name the borrower', () => {
    expect(converterColumns('piutang')).toEqual([
      'Kode Harta',
      'Negara Lokasi',
      'Nomor Identitas',
      'Nama Penerima Piutang',
      'Nilai Piutang',
      'Tahun',
      'Saldo Piutang',
      'Keterangan',
    ]);
  });

  it('puts Biaya Perolehan before Tahun Perolehan on investasi, as DJP does', () => {
    const columns = converterColumns('investasi');
    expect(columns.indexOf('Biaya Perolehan')).toBeLessThan(columns.indexOf('Tahun Perolehan'));
  });

  it('asks harta bergerak for the owner NPWP and name', () => {
    expect(converterColumns('bergerak')).toEqual(expect.arrayContaining(['NPWP Pemilik', 'Nama Pemilik', 'Nomor Polisi/Registrasi']));
  });

  it('asks tidak bergerak for both property sizes and the certificate', () => {
    expect(converterColumns('tidak_bergerak')).toEqual(
      expect.arrayContaining(['Ukuran Properti - Tanah', 'Ukuran Properti - Bangunan', 'Nomor Sertifikat', 'Sumber Kepemilikan']),
    );
  });

  it('keeps lainnya short, with its extra information column', () => {
    expect(converterColumns('lainnya')).toEqual([
      'Kode',
      'Tahun Perolehan',
      'Bukti Kepemilikan/Nomor Akun',
      'Informasi Tambahan',
      'Biaya Perolehan',
      'Nilai Saat Ini',
      'Keterangan',
    ]);
  });
});

describe('toConverterTsv', () => {
  it('carries TIN and TaxYear before the header row', () => {
    const tsv = toConverterTsv('kas', [row({ key: 'bca' })], header);

    expect(lines(tsv)[0]).toBe('TIN\t0011223344556677');
    expect(lines(tsv)[1]).toBe('TaxYear\t2026');
    expect(lines(tsv)[2]).toBe(converterColumns('kas').join('\t'));
  });

  it('writes a line per row, following the header order', () => {
    const tsv = toConverterTsv('kas', [row({ key: 'bca' })], header);
    const columns = cells(tsv, 2);
    const values = cells(tsv, 3);

    expect(values[columns.indexOf('Kode')]).toBe('0102');
    expect(values[columns.indexOf('Nomor Akun')]).toBe('1234567890');
    expect(values[columns.indexOf('Saldo')]).toBe('50000000');
  });

  it('writes amounts in plain digits, with nothing between the thousands', () => {
    const tsv = toConverterTsv('lainnya', [gold()], header);

    expect(tsv).toContain('22400000');
    expect(tsv).not.toContain('22.400.000');
  });

  it('leaves a year empty rather than writing a nought', () => {
    const tsv = toConverterTsv('lainnya', [gold({ acquiredYear: null })], header);
    const values = cells(tsv, 3);

    expect(values[converterColumns('lainnya').indexOf('Tahun Perolehan')]).toBe('');
  });

  it('refuses a value holding a tab, which would silently become another column', () => {
    expect(() => toConverterTsv('kas', [row({ key: 'bca', name: 'BCA', fields: { acct: 'A\tB', owner: 'F', inst: 'BCA', loc: 'IDN' } })], header)).toThrow(ConverterError);
  });

  it('takes only the rows of the table asked for', () => {
    const tsv = toConverterTsv('kas', [row({ key: 'bca' }), gold()], header);

    expect(lines(tsv)).toHaveLength(4);
    expect(tsv).not.toContain('Antam gold bars');
  });

  it('writes the two header lines and the columns even when the table is empty', () => {
    const tsv = toConverterTsv('kas', [], header);

    expect(lines(tsv)).toHaveLength(3);
  });

  it('refuses to build a sheet for utang, which has no converter', () => {
    expect(() => toConverterTsv('utang' as 'kas', [], header)).toThrow(/typed into the form/);
  });
});

describe('converterProblems', () => {
  it('says nothing when every starred column is filled', () => {
    expect(converterProblems('kas', [row({ key: 'bca' })])).toEqual([]);
  });

  it('names the row and the column when a starred one is missing', () => {
    const issues = converterProblems('kas', [row({ key: 'bca', fields: { owner: 'Fandrian', inst: 'BCA', loc: 'IDN' } })]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rowKey: 'bca', level: 'blocking' });
    expect(issues[0]!.message).toContain('Nomor akun');
  });

  it('refuses a Kepemilikan outside Taxpayer and Other', () => {
    const car = row({
      key: 'car',
      section: 'bergerak',
      code: '0403',
      name: 'Avanza',
      fields: { model: 'Toyota Avanza', plate: 'B 1234 XYZ', own: 'Mine', ownerNpwp: '0011223344556677', ownerName: 'Fandrian' },
    });

    expect(converterProblems('bergerak', [car]).some((issue) => /Taxpayer or Other/.test(issue.message))).toBe(true);
  });

  it('accepts Taxpayer, which is how DJP words it', () => {
    const car = row({
      key: 'car',
      section: 'bergerak',
      code: '0403',
      name: 'Avanza',
      fields: { model: 'Toyota Avanza', plate: 'B 1234 XYZ', own: 'Taxpayer', ownerNpwp: '0011223344556677', ownerName: 'Fandrian' },
    });

    expect(converterProblems('bergerak', [car])).toEqual([]);
  });

  it('refuses a Sumber Kepemilikan outside the six words', () => {
    const house = row({
      key: 'house',
      section: 'tidak_bergerak',
      code: '0502',
      name: 'House in Bintaro',
      fields: { loc: 'Bintaro', land: '120', bldg: '90', source: 'Pembelian', cert: 'SHM 1234' },
    });

    expect(converterProblems('tidak_bergerak', [house]).some((issue) => /Sumber Kepemilikan/.test(issue.message))).toBe(true);
  });

  it('accepts Own Income, which is one of the six', () => {
    const house = row({
      key: 'house',
      section: 'tidak_bergerak',
      code: '0502',
      name: 'House in Bintaro',
      fields: { loc: 'Bintaro', land: '120', bldg: '90', source: 'Own Income', cert: 'SHM 1234' },
    });

    expect(converterProblems('tidak_bergerak', [house])).toEqual([]);
  });

  it('refuses a Keterangan that is not 01 or 02', () => {
    expect(converterProblems('lainnya', [gold({ fields: { cert: 'S1', info: 'Emas', pps: '03' } })]).some((issue) => /Keterangan/.test(issue.message))).toBe(true);
  });

  it('accepts an empty Keterangan, which is the usual case', () => {
    expect(converterProblems('lainnya', [gold()])).toEqual([]);
  });
});
