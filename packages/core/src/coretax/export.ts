import { CORETAX_SECTIONS } from '../assets/coretax-fields';
import type { CoretaxRow, ReportSection } from './rows';

/**
 * The rows as CSV, for the owner to read from while filling the form in.
 *
 * The column order here is **ours**, set out below and nowhere else. DJP publishes Excel-to-XML
 * converters for Bupot, e-Faktur and SPT Badan, but none for Orang Pribadi harta or utang, and its
 * own Coretax pages describe filling those tables rather than importing them. Until that is settled
 * against the live converter, nothing here claims to match anyone's import columns — which is why
 * this is `toReportCsv` and not a converter format.
 */
const HARTA_COLUMNS = ['Kode Harta', 'Nama Harta', 'Tahun Perolehan', 'Harga Perolehan', 'Nilai'] as const;

const UTANG_COLUMNS = ['Kode Utang', 'Nama Pemberi Pinjaman', 'Tahun Peminjaman', 'Jumlah'] as const;

/** The columns a section's CSV carries, in order: the shared ones, then the fields it asks for. */
export function csvColumns(section: ReportSection): string[] {
  if (section === 'utang') return [...UTANG_COLUMNS];
  return [...HARTA_COLUMNS, ...CORETAX_SECTIONS[section].fields.map((field) => field.label)];
}

/** A value as CSV: quoted when it holds a comma, a quote or a line break; quotes doubled. */
function cell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Amounts go out in plain digits: a separator here would be read as another column. */
const amount = (minor: number): string => String(minor);

const year = (value: number | null): string => (value === null ? '' : String(value));

/** One section's rows as CSV, header first. Rows from other sections are left out. */
export function toReportCsv(section: ReportSection, rows: CoretaxRow[]): string {
  const columns = csvColumns(section);
  const mine = rows.filter((row) => row.section === section);

  const body = mine.map((row) => {
    const shared =
      section === 'utang'
        ? [row.code, row.name, year(row.acquiredYear), amount(row.balanceMinor || row.valueMinor)]
        : [row.code, row.name, year(row.acquiredYear), amount(row.costMinor), amount(row.valueMinor)];
    const fields = section === 'utang' ? [] : CORETAX_SECTIONS[section].fields.map((field) => row.fields[field.key] ?? '');
    return [...shared, ...fields].map(cell).join(',');
  });

  return [columns.join(','), ...body].join('\n');
}
