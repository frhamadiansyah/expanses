import type { AssetKind } from '../assets/presets';
import type { CoretaxSection } from '../assets/coretax-fields';

/**
 * The kode harta and kode utang of SPT Tahunan Orang Pribadi. Every code is three digits, and each
 * family runs in its own hundred. Researched against three independent sources for harta and two
 * for utang, because the codes first written into this project were placeholders and were wrong in
 * both shape and value.
 */
export type HartaFamily = 'kas' | 'piutang' | 'investasi' | 'transportasi' | 'bergerak' | 'tidak_bergerak';

export interface CoretaxCode {
  /** Three digits, always. */
  code: string;
  /** What the form calls it. */
  label: string;
  family: HartaFamily;
}

/**
 * Two sources give `015` for "setara kas lainnya"; a third gives `019`. The owner confirms against
 * the official form before the export ships. It lives here so confirming it is a one-line change.
 */
export const CASH_EQUIVALENT_CODE = '015';

const harta = (code: string, label: string, family: HartaFamily): CoretaxCode => ({ code, label, family });

export const KODE_HARTA: readonly CoretaxCode[] = [
  harta('011', 'Uang tunai', 'kas'),
  harta('012', 'Tabungan', 'kas'),
  harta('013', 'Giro', 'kas'),
  harta('014', 'Deposito', 'kas'),
  harta(CASH_EQUIVALENT_CODE, 'Setara kas lainnya', 'kas'),
  harta('021', 'Piutang', 'piutang'),
  harta('022', 'Piutang afiliasi', 'piutang'),
  harta('029', 'Piutang lainnya', 'piutang'),
  harta('031', 'Saham yang dibeli untuk dijual kembali', 'investasi'),
  harta('032', 'Saham', 'investasi'),
  harta('033', 'Obligasi perusahaan', 'investasi'),
  harta('034', 'Obligasi pemerintah (ORI, SBSN)', 'investasi'),
  harta('035', 'Surat utang lainnya', 'investasi'),
  harta('036', 'Reksadana', 'investasi'),
  harta('037', 'Instrumen derivatif', 'investasi'),
  harta('038', 'Penyertaan modal pada perusahaan lain', 'investasi'),
  harta('039', 'Investasi lainnya', 'investasi'),
  harta('041', 'Sepeda', 'transportasi'),
  harta('042', 'Sepeda motor', 'transportasi'),
  harta('043', 'Mobil', 'transportasi'),
  harta('049', 'Alat transportasi lainnya', 'transportasi'),
  harta('051', 'Logam mulia', 'bergerak'),
  harta('052', 'Batu mulia', 'bergerak'),
  harta('053', 'Barang seni dan antik', 'bergerak'),
  harta('054', 'Kapal pesiar, pesawat terbang, helikopter, peralatan olahraga khusus', 'bergerak'),
  harta('055', 'Peralatan elektronik dan furnitur', 'bergerak'),
  harta('059', 'Harta bergerak lainnya', 'bergerak'),
  harta('061', 'Tanah atau bangunan tempat tinggal', 'tidak_bergerak'),
  harta('062', 'Tanah atau bangunan usaha', 'tidak_bergerak'),
  harta('063', 'Tanah atau lahan untuk usaha', 'tidak_bergerak'),
  harta('069', 'Harta tidak bergerak lainnya', 'tidak_bergerak'),
];

export const KODE_UTANG: readonly { code: string; label: string }[] = [
  { code: '101', label: 'Utang bank atau lembaga keuangan bukan bank (KPR, leasing kendaraan)' },
  { code: '102', label: 'Kartu kredit' },
  { code: '103', label: 'Utang afiliasi' },
  { code: '104', label: 'Utang lainnya' },
];

/**
 * Which Lampiran table a code is reported in. Alat transportasi and harta bergerak lainnya are
 * separate families of codes, but the form asks them under Harta Bergerak and Harta Lainnya.
 */
const SECTION_BY_FAMILY: Record<HartaFamily, CoretaxSection> = {
  kas: 'kas',
  piutang: 'piutang',
  investasi: 'investasi',
  transportasi: 'bergerak',
  bergerak: 'lainnya',
  tidak_bergerak: 'tidak_bergerak',
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
  cash: '012',
  fund: '036',
  stock: '032',
  // Retail bonds here are ORI and SBSN; a corporate bond is 033, changed per asset.
  bond: '034',
  gold: '051',
  property: '061',
  vehicle: '043',
  other: '059',
};

export function coretaxCodeFor(kind: AssetKind): string {
  return CODE_BY_KIND[kind];
}
