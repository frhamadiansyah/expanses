import type { AssetKind } from '../assets/presets';
import type { CoretaxSection } from '../assets/coretax-fields';

/**
 * The kode harta of SPT Tahunan Orang Pribadi as Coretax uses them: four digits, six tables.
 *
 * Read from DJP's own *Tata Cara Pembuatan XML SPT OP v20260310*. The three-digit codes this project
 * carried before belong to the older e-Form system and are not what Coretax accepts — a distinction
 * that cost two rounds of wrong migrations, so nothing here comes from anywhere but that guide.
 */
export type HartaFamily = 'kas' | 'piutang' | 'investasi' | 'bergerak' | 'tidak_bergerak' | 'lainnya';

export interface CoretaxCode {
  /** Four digits, always. */
  code: string;
  /** What the form calls it. */
  label: string;
  family: HartaFamily;
}

const harta = (code: string, label: string, family: HartaFamily): CoretaxCode => ({ code, label, family });

export const KODE_HARTA: readonly CoretaxCode[] = [
  harta('0101', 'Uang tunai, bank note atau koin', 'kas'),
  harta('0102', 'Tabungan (bank atau lembaga keuangan)', 'kas'),
  harta('0103', 'Giro', 'kas'),
  harta('0104', 'Deposito', 'kas'),
  harta('0105', 'Uang elektronik', 'kas'),
  harta('0106', 'Cek', 'kas'),
  harta('0107', 'Wesel', 'kas'),
  harta('0108', 'Commercial paper', 'kas'),
  harta('0109', 'Setara kas lainnya', 'kas'),

  harta('0201', 'Piutang usaha', 'piutang'),
  harta('0202', 'Piutang afiliasi', 'piutang'),
  harta('0209', 'Piutang lainnya', 'piutang'),

  harta('0301', 'Saham yang dibeli untuk dijual kembali', 'investasi'),
  harta('0302', 'Saham non bursa', 'investasi'),
  harta('0303', 'Saham bursa', 'investasi'),
  harta('0304', 'Obligasi perusahaan', 'investasi'),
  harta('0305', 'Obligasi pemerintah Indonesia (ORI, SBSN)', 'investasi'),
  harta('0306', 'Surat utang lainnya', 'investasi'),
  harta('0307', 'Kontrak investasi kolektif (reksadana)', 'investasi'),
  harta('0308', 'Instrumen derivatif', 'investasi'),
  harta('0309', 'Penyertaan modal dalam perusahaan lain yang tidak atas saham', 'investasi'),
  harta('0310', 'Asuransi', 'investasi'),
  harta('0311', 'Unit link di asuransi', 'investasi'),
  harta('0399', 'Investasi lainnya', 'investasi'),

  harta('0401', 'Sepeda', 'bergerak'),
  harta('0402', 'Sepeda motor', 'bergerak'),
  harta('0403', 'Mobil penumpang', 'bergerak'),
  harta('0404', 'Bus', 'bergerak'),
  harta('0405', 'Kendaraan angkutan jalan', 'bergerak'),
  harta('0406', 'Kendaraan tujuan khusus', 'bergerak'),
  harta('0407', 'Kereta', 'bergerak'),
  harta('0408', 'Pesawat terbang', 'bergerak'),
  harta('0409', 'Kapal', 'bergerak'),
  harta('0410', 'Mesin', 'bergerak'),
  harta('0411', 'Gerobak', 'bergerak'),
  harta('0412', 'Kapal pesiar', 'bergerak'),
  harta('0499', 'Harta bergerak lainnya', 'bergerak'),

  harta('0501', 'Tanah kosong', 'tidak_bergerak'),
  harta('0502', 'Tanah dan/atau bangunan untuk tempat tinggal', 'tidak_bergerak'),
  harta('0503', 'Apartemen', 'tidak_bergerak'),
  harta('0504', 'Vessel', 'tidak_bergerak'),
  harta('0505', 'Tanah atau lahan untuk usaha', 'tidak_bergerak'),
  harta('0506', 'Tanah dan/atau bangunan untuk usaha', 'tidak_bergerak'),
  harta('0507', 'Tanah dan/atau bangunan yang disewakan', 'tidak_bergerak'),
  harta('0509', 'Harta tidak bergerak lainnya', 'tidak_bergerak'),

  harta('0601', 'Paten', 'lainnya'),
  harta('0602', 'Royalti', 'lainnya'),
  harta('0603', 'Merek dagang', 'lainnya'),
  harta('0699', 'Harta tidak berwujud lainnya', 'lainnya'),
  harta('0701', 'Emas batangan', 'lainnya'),
  harta('0702', 'Emas perhiasan', 'lainnya'),
  harta('0703', 'Batangan non emas', 'lainnya'),
  harta('0704', 'Perhiasan non emas', 'lainnya'),
  harta('0705', 'Permata', 'lainnya'),
  harta('0706', 'Barang-barang seni dan antik', 'lainnya'),
  harta('0707', 'Peralatan olahraga khusus', 'lainnya'),
  harta('0708', 'Peralatan elektronik', 'lainnya'),
  harta('0709', 'Perabot rumah tangga', 'lainnya'),
  harta('0710', 'Peralatan kantor', 'lainnya'),
  harta('0711', 'Jet ski', 'lainnya'),
  harta('0712', 'Persediaan usaha', 'lainnya'),
  harta('0799', 'Harta lainnya', 'lainnya'),
];

/**
 * Read from DJP's own *Petunjuk Pengisian Daftar Rincian Harta dan Utang*, which lists the kode
 * utang as 101, 102, 103 and 109. There is no 104: slice 6 invented it from a secondary source.
 * The Coretax guide still publishes no utang table and no converter, so Bagian B is typed by hand.
 */
export const UTANG_CODES_UNVERIFIED = false;

export const KODE_UTANG: readonly { code: string; label: string }[] = [
  { code: '101', label: 'Utang bank atau lembaga keuangan bukan bank (KPR, leasing kendaraan bermotor, dan sejenisnya)' },
  { code: '102', label: 'Kartu kredit' },
  { code: '103', label: 'Utang afiliasi (pinjaman dari pihak yang memiliki hubungan istimewa)' },
  { code: '109', label: 'Utang lainnya' },
];

/** Each family is its own table in Lampiran 1 Bagian A, one for one. */
const SECTION_BY_FAMILY: Record<HartaFamily, CoretaxSection> = {
  kas: 'kas',
  piutang: 'piutang',
  investasi: 'investasi',
  bergerak: 'bergerak',
  tidak_bergerak: 'tidak_bergerak',
  lainnya: 'lainnya',
};

const BY_CODE = new Map(KODE_HARTA.map((entry) => [entry.code, entry]));
const UTANG_BY_CODE = new Map(KODE_UTANG.map((entry) => [entry.code, entry]));

/** What the form calls this harta code. Empty when the code is not one the form knows. */
export function hartaLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? '';
}

/** What the form calls this utang code. Empty when the code is not one the form knows. */
export function utangLabel(code: string): string {
  return UTANG_BY_CODE.get(code)?.label ?? '';
}

/** The table a code belongs to. An unknown code falls to Harta Lainnya rather than being dropped. */
export function sectionOfCode(code: string): CoretaxSection {
  const family = BY_CODE.get(code)?.family;
  return family ? SECTION_BY_FAMILY[family] : 'lainnya';
}

/** The code an asset of this kind starts on. The owner can change it per asset. */
const CODE_BY_KIND: Record<AssetKind, string> = {
  cash: '0102',
  // A reksadana is a kontrak investasi kolektif, which is its own code.
  fund: '0307',
  // Shares held here are listed; unlisted holdings are 0302, changed per asset.
  stock: '0303',
  // Retail bonds here are ORI and SBSN; a corporate bond is 0304.
  bond: '0305',
  gold: '0701',
  property: '0502',
  vehicle: '0403',
  other: '0799',
};

export function coretaxCodeFor(kind: AssetKind): string {
  return CODE_BY_KIND[kind];
}
