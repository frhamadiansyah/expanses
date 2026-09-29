/**
 * Banks in Indonesia, offered while an account's bank is typed so the tax report's "Nama Bank/Institusi" reads the
 * same way on every account. Offered only in a workspace kept in rupiah: the list serves the Indonesian report and
 * nothing else. Anything not here can still be typed and is kept as typed.
 *
 * `name` is what is stored; `also` holds the other names people call a bank by, which find it too.
 */
export type IndonesianBank = { name: string; also: readonly string[] };

export const INDONESIAN_BANKS: readonly IndonesianBank[] = [
  { name: 'Bank Central Asia', also: ['BCA'] },
  { name: 'Bank Mandiri', also: ['Mandiri'] },
  { name: 'Bank Rakyat Indonesia', also: ['BRI'] },
  { name: 'Bank Negara Indonesia', also: ['BNI'] },
  { name: 'Bank Tabungan Negara', also: ['BTN'] },
  { name: 'Bank Syariah Indonesia', also: ['BSI'] },
  { name: 'CIMB Niaga', also: ['CIMB'] },
  { name: 'Bank Permata', also: ['Permata'] },
  { name: 'Bank Danamon', also: ['Danamon'] },
  { name: 'Maybank Indonesia', also: ['Maybank'] },
  { name: 'Bank OCBC Indonesia', also: ['OCBC', 'OCBC NISP', 'NISP'] },
  { name: 'Panin Bank', also: ['Panin'] },
  { name: 'Bank Mega', also: ['Mega'] },
  { name: 'Bank SMBC Indonesia', also: ['SMBC', 'BTPN', 'Jenius'] },
  { name: 'UOB Indonesia', also: ['UOB'] },
  { name: 'HSBC Indonesia', also: ['HSBC'] },
  { name: 'DBS Indonesia', also: ['DBS', 'digibank'] },
  { name: 'Standard Chartered Indonesia', also: ['Standard Chartered', 'StanChart'] },
  { name: 'Bank Sinarmas', also: ['Sinarmas'] },
  { name: 'Bank Muamalat', also: ['Muamalat'] },
  { name: 'BCA Syariah', also: [] },
  { name: 'BCA Digital', also: ['blu'] },
  { name: 'Bank Jago', also: ['Jago'] },
  { name: 'SeaBank', also: [] },
  { name: 'Allo Bank', also: ['Allo'] },
  { name: 'Bank Neo Commerce', also: ['Neo', 'BNC', 'neobank'] },
  { name: 'Superbank', also: [] },
  { name: 'Krom Bank', also: ['Krom'] },
  { name: 'Bank DKI', also: ['DKI'] },
  { name: 'Bank BJB', also: ['BJB'] },
  { name: 'Bank Jatim', also: ['Jatim'] },
  { name: 'Bank Jateng', also: ['Jateng'] },
];

/**
 * The banks a typed bank field offers: a short name or a word of the full name starting with what is typed, short
 * names first, at most `limit`. Nothing before a letter is typed, and nothing once the typed text is a bank's
 * name already — the field has it.
 */
export function bankMatches(typed: string, limit = 3): IndonesianBank[] {
  const want = typed.trim().toLowerCase();
  if (!want || INDONESIAN_BANKS.some((bank) => bank.name.toLowerCase() === want)) return [];
  const starts = (text: string) => text.toLowerCase().startsWith(want);
  const byShort = INDONESIAN_BANKS.filter((bank) => bank.also.some(starts));
  const byName = INDONESIAN_BANKS.filter((bank) => !byShort.includes(bank) && (starts(bank.name) || bank.name.split(/\s+/).some(starts)));
  return [...byShort, ...byName].slice(0, limit);
}
