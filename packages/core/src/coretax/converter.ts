import { CORETAX_SECTIONS, type CoretaxSection } from '../assets/coretax-fields';
import type { ReadinessIssue } from './review';
import type { CoretaxRow } from './rows';

/**
 * The Excel-to-XML converter sheets of Lampiran 1 Bagian A, one per harta table.
 *
 * Column names and their order are DJP's, from *Tata Cara Pembuatan XML SPT OP v20260310*. Each
 * sheet carries the taxpayer's NPWP on the first line and the tax year on the second, then the
 * header row, then a line per asset. Bagian B has no converter at all: utang is typed into the form.
 */

/** How DJP words ownership on the harta bergerak sheet. */
export type Kepemilikan = 'Taxpayer' | 'Other';

/** How DJP words where a property came from, on the harta tidak bergerak sheet. */
export type SumberKepemilikan = 'Debt' | 'Gift' | 'Grant' | 'Inheritance' | 'Other sources' | 'Own Income';

export const KEPEMILIKAN: readonly Kepemilikan[] = ['Taxpayer', 'Other'];
export const SUMBER_KEPEMILIKAN: readonly SumberKepemilikan[] = ['Debt', 'Gift', 'Grant', 'Inheritance', 'Other sources', 'Own Income'];

/** The voluntary-disclosure marker: 01, 02, or nothing at all. */
export const PPS_KETERANGAN: readonly string[] = ['01', '02'];

export interface ConverterHeader {
  /** 16 digits, as the sheet's TIN row demands. */
  npwp: string;
  taxYear: number;
}

/** A section whose rows the converter can carry. Utang is not one of them. */
export type ConverterSection = Exclude<CoretaxSection, never>;

type ColumnOf = { label: string; value: (row: CoretaxRow) => string };

const year = (row: CoretaxRow): string => (row.acquiredYear === null ? '' : String(row.acquiredYear));
const amount = (minor: number): string => String(minor);
const fieldOf = (key: string) => (row: CoretaxRow) => row.fields[key] ?? '';
const pps = (row: CoretaxRow): string => (PPS_KETERANGAN.includes(row.fields.pps ?? '') ? row.fields.pps! : '');

/** Each sheet's columns, in DJP's order. */
const COLUMNS: Record<CoretaxSection, ColumnOf[]> = {
  kas: [
    { label: 'Kode', value: (row) => row.code },
    { label: 'Nomor Akun', value: fieldOf('acct') },
    { label: 'Atas Nama', value: fieldOf('owner') },
    { label: 'Nama Bank/Institusi', value: fieldOf('inst') },
    { label: 'Lokasi Harta', value: fieldOf('loc') },
    { label: 'Tahun Perolehan', value: year },
    { label: 'Saldo', value: (row) => amount(row.balanceMinor) },
    { label: 'Keterangan', value: pps },
  ],
  piutang: [
    { label: 'Kode Harta', value: (row) => row.code },
    { label: 'Negara Lokasi', value: fieldOf('loc') },
    { label: 'Nomor Identitas', value: fieldOf('idno') },
    { label: 'Nama Penerima Piutang', value: fieldOf('name') },
    { label: 'Nilai Piutang', value: (row) => amount(row.costMinor || row.balanceMinor) },
    { label: 'Tahun', value: year },
    { label: 'Saldo Piutang', value: (row) => amount(row.balanceMinor) },
    { label: 'Keterangan', value: pps },
  ],
  investasi: [
    { label: 'Kode', value: (row) => row.code },
    { label: 'Lokasi Harta', value: fieldOf('loc') },
    { label: 'Nomor Identitas', value: fieldOf('npwp') },
    { label: 'Nama Bank/Institusi/Penerima Investasi', value: fieldOf('inst') },
    { label: 'Bukti Kepemilikan/Nomor Akun', value: fieldOf('sid') },
    { label: 'Biaya Perolehan', value: (row) => amount(row.costMinor) },
    { label: 'Tahun Perolehan', value: year },
    { label: 'Nilai Saat Ini', value: (row) => amount(row.valueMinor) },
    { label: 'Keterangan', value: pps },
  ],
  bergerak: [
    { label: 'Kode', value: (row) => row.code },
    { label: 'Merk/Model', value: fieldOf('model') },
    { label: 'Nomor Polisi/Registrasi', value: fieldOf('plate') },
    { label: 'Kepemilikan', value: fieldOf('own') },
    { label: 'NPWP Pemilik', value: fieldOf('ownerNpwp') },
    { label: 'Nama Pemilik', value: fieldOf('ownerName') },
    { label: 'Tahun Perolehan', value: year },
    { label: 'Biaya Perolehan', value: (row) => amount(row.costMinor) },
    { label: 'Nilai Saat Ini', value: (row) => amount(row.valueMinor) },
    { label: 'Keterangan', value: pps },
  ],
  tidak_bergerak: [
    { label: 'Kode Harta', value: (row) => row.code },
    { label: 'Lokasi Harta', value: fieldOf('loc') },
    { label: 'Ukuran Properti - Tanah', value: fieldOf('land') },
    { label: 'Ukuran Properti - Bangunan', value: fieldOf('bldg') },
    { label: 'Sumber Kepemilikan', value: fieldOf('source') },
    { label: 'Nomor Sertifikat', value: fieldOf('cert') },
    { label: 'Tahun Perolehan', value: year },
    { label: 'Biaya Perolehan', value: (row) => amount(row.costMinor) },
    { label: 'Nilai Saat Ini', value: (row) => amount(row.valueMinor) },
    { label: 'Keterangan', value: pps },
  ],
  lainnya: [
    { label: 'Kode', value: (row) => row.code },
    { label: 'Tahun Perolehan', value: year },
    { label: 'Bukti Kepemilikan/Nomor Akun', value: fieldOf('cert') },
    { label: 'Informasi Tambahan', value: fieldOf('info') },
    { label: 'Biaya Perolehan', value: (row) => amount(row.costMinor) },
    { label: 'Nilai Saat Ini', value: (row) => amount(row.valueMinor) },
    { label: 'Keterangan', value: pps },
  ],
};

export class ConverterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConverterError';
  }
}

/** The columns one table's sheet carries, in DJP's order. */
export function converterColumns(section: CoretaxSection): string[] {
  const columns = COLUMNS[section];
  if (!columns) throw new ConverterError(`There is no converter for ${section}`);
  return columns.map((column) => column.label);
}

/**
 * One table as its converter expects it: TIN on the first line, TaxYear on the second, then the
 * header row and a line per asset. Tab-separated, so it pastes into the sheet as columns.
 */
export function toConverterTsv(section: CoretaxSection, rows: CoretaxRow[], header: ConverterHeader): string {
  const columns = COLUMNS[section];
  if (!columns) throw new ConverterError(`There is no converter for ${section}; Bagian B is typed into the form`);

  const cell = (value: string): string => {
    // A tab inside a value would silently become another column, so it is never written.
    if (/[\t\n]/.test(value)) throw new ConverterError(`"${value}" holds a tab or a line break, which the sheet cannot carry`);
    return value;
  };

  const lines = [`TIN\t${header.npwp}`, `TaxYear\t${header.taxYear}`, columns.map((column) => column.label).join('\t')];
  for (const row of rows.filter((row) => row.section === section)) {
    lines.push(columns.map((column) => cell(column.value(row))).join('\t'));
  }
  return lines.join('\n');
}

/** What the sheet would refuse: a missing starred column, or a word outside a fixed vocabulary. */
export function converterProblems(section: CoretaxSection, rows: CoretaxRow[]): ReadinessIssue[] {
  if (!COLUMNS[section]) return [];
  const definition = CORETAX_SECTIONS[section];
  const issues: ReadinessIssue[] = [];

  for (const row of rows.filter((row) => row.section === section)) {
    for (const field of definition.fields) {
      if (!field.required) continue;
      if ((row.fields[field.key] ?? '').trim() === '') {
        issues.push({ key: `${row.key}:converter:${field.key}`, rowKey: row.key, level: 'blocking', message: `${row.name} needs ${field.label} before the file can be built` });
      }
    }

    const own = row.fields.own ?? '';
    if (section === 'bergerak' && own !== '' && !KEPEMILIKAN.includes(own as Kepemilikan)) {
      issues.push({ key: `${row.key}:converter:own`, rowKey: row.key, level: 'blocking', message: `${row.name}: Kepemilikan must be Taxpayer or Other` });
    }

    const source = row.fields.source ?? '';
    if (section === 'tidak_bergerak' && source !== '' && !SUMBER_KEPEMILIKAN.includes(source as SumberKepemilikan)) {
      issues.push({ key: `${row.key}:converter:source`, rowKey: row.key, level: 'blocking', message: `${row.name}: Sumber Kepemilikan must be one of ${SUMBER_KEPEMILIKAN.join(', ')}` });
    }

    const keterangan = row.fields.pps ?? '';
    if (keterangan !== '' && !PPS_KETERANGAN.includes(keterangan)) {
      issues.push({ key: `${row.key}:converter:pps`, rowKey: row.key, level: 'blocking', message: `${row.name}: Keterangan is only 01 or 02, or left empty` });
    }
  }

  return issues;
}
