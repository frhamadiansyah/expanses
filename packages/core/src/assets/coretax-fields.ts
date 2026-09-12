/**
 * Fields the SPT Tahunan Lampiran 1 asks for, per table, following the DJP converter columns.
 * Missing values never block saving; they are reported so the tax report can chase them.
 */
export type CoretaxSection = 'kas' | 'piutang' | 'investasi' | 'bergerak' | 'tidak_bergerak' | 'lainnya';

export type CoretaxFieldKind = 'text' | 'npwp' | 'country' | 'number' | 'year';

export interface CoretaxField {
  key: string;
  label: string;
  kind: CoretaxFieldKind;
  required: boolean;
}

export interface CoretaxProblem {
  key: string;
  message: string;
}

const field = (key: string, label: string, kind: CoretaxFieldKind, required = false): CoretaxField => ({ key, label, kind, required });

export const CORETAX_SECTIONS: Record<CoretaxSection, { label: string; fields: readonly CoretaxField[] }> = {
  kas: {
    label: 'Kas dan Setara Kas',
    fields: [
      field('acct', 'Nomor akun', 'text', true),
      field('owner', 'Atas nama', 'text', true),
      field('inst', 'Nama bank/institusi', 'text', true),
      field('loc', 'Lokasi harta', 'country', true),
    ],
  },
  piutang: {
    label: 'Piutang',
    fields: [
      field('loc', 'Negara lokasi', 'country', true),
      field('idno', 'Nomor identitas penerima', 'text', true),
      field('name', 'Nama penerima pinjaman', 'text', true),
    ],
  },
  investasi: {
    label: 'Investasi/Sekuritas',
    fields: [
      field('loc', 'Lokasi harta', 'country', true),
      field('npwp', 'Nomor identitas penerima investasi', 'npwp', true),
      field('inst', 'Nama institusi', 'text', true),
      field('sid', 'Bukti kepemilikan / nomor akun', 'text', true),
    ],
  },
  bergerak: {
    label: 'Harta Bergerak',
    fields: [
      field('model', 'Merk/model', 'text', true),
      field('plate', 'Nomor polisi/registrasi', 'text', true),
      field('own', 'Kepemilikan', 'text', true),
      field('ownerNpwp', 'NPWP pemilik', 'npwp', true),
      field('ownerName', 'Nama pemilik', 'text', true),
    ],
  },
  tidak_bergerak: {
    label: 'Harta Tidak Bergerak',
    fields: [
      field('loc', 'Lokasi harta', 'text', true),
      field('land', 'Luas tanah (m²)', 'number', true),
      field('bldg', 'Luas bangunan (m²)', 'number', true),
      field('source', 'Sumber kepemilikan', 'text', true),
      field('cert', 'Nomor sertifikat', 'text', true),
    ],
  },
  lainnya: {
    label: 'Harta Lainnya',
    fields: [field('cert', 'Bukti kepemilikan / nomor akun', 'text', true), field('info', 'Informasi tambahan', 'text', true)],
  },
};

const digitsOf = (value: string) => value.replace(/[\s.-]/g, '');

function problemFor(field: CoretaxField, value: string): string | null {
  if (field.kind === 'npwp' && !/^\d{16}$/.test(digitsOf(value))) return 'NPWP and NIK are 16 digits';
  if (field.kind === 'country' && !/^[A-Z]{3}$/.test(value.trim())) return 'Use the three-letter country code, for example IDN';
  if (field.kind === 'number' && !/^\d+([.,]\d+)?$/.test(value.trim())) return 'Enter a number';
  if (field.kind === 'year' && !/^\d{4}$/.test(value.trim())) return 'Enter a four-digit year';
  return null;
}

/** Checks filled-in values. Empty values are never a problem here; use missingCoretaxFields for those. */
export function validateCoretaxFields(section: CoretaxSection, fields: Record<string, string>): CoretaxProblem[] {
  const definition = CORETAX_SECTIONS[section];
  const problems: CoretaxProblem[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const known = definition.fields.find((f) => f.key === key);
    if (!known) {
      problems.push({ key, message: `${definition.label} has no field "${key}"` });
      continue;
    }
    if (value.trim() === '') continue;
    const message = problemFor(known, value);
    if (message) problems.push({ key, message });
  }
  return problems;
}

/** Required keys that are empty or absent, in the order the section lists them. */
export function missingCoretaxFields(section: CoretaxSection, fields: Record<string, string>): string[] {
  return CORETAX_SECTIONS[section].fields.filter((f) => f.required && (fields[f.key] ?? '').trim() === '').map((f) => f.key);
}
