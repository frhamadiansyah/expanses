import { namedMatches } from './banks';

/**
 * Securities firms in Indonesia, offered while a fund account's broker is typed, so the tax report's "Nama
 * Institusi" for the shares kept there reads the same way on every holding. Offered only in a workspace kept in
 * rupiah, as the banks are; anything not here can still be typed and is kept as typed.
 *
 * `name` is what is stored — the firm, as its app and its statements call it; `also` holds the shorter names people
 * use, which find it too.
 */
export type IndonesianBroker = { name: string; also: readonly string[] };

export const INDONESIAN_BROKERS: readonly IndonesianBroker[] = [
  { name: 'Stockbit Sekuritas', also: ['Stockbit', 'Bibit'] },
  { name: 'Ajaib Sekuritas', also: ['Ajaib'] },
  { name: 'Mirae Asset Sekuritas', also: ['Mirae', 'NH'] },
  { name: 'Mandiri Sekuritas', also: ['Mandiri', 'MOST'] },
  { name: 'BCA Sekuritas', also: ['BCA'] },
  { name: 'BNI Sekuritas', also: ['BNI'] },
  { name: 'BRI Danareksa Sekuritas', also: ['BRI', 'Danareksa', 'BRIDS'] },
  { name: 'Indo Premier Sekuritas', also: ['IPOT', 'Indo Premier'] },
  { name: 'Phillip Sekuritas Indonesia', also: ['Phillip', 'POEMS'] },
  { name: 'Samuel Sekuritas Indonesia', also: ['Samuel'] },
  { name: 'Trimegah Sekuritas Indonesia', also: ['Trimegah'] },
  { name: 'MNC Sekuritas', also: ['MNC'] },
  { name: 'Valbury Sekuritas Indonesia', also: ['Valbury'] },
  { name: 'Sucor Sekuritas', also: ['Sucor'] },
  { name: 'Henan Putihrai Sekuritas', also: ['Henan', 'HP'] },
  { name: 'Sinarmas Sekuritas', also: ['Sinarmas', 'Simas'] },
  { name: 'Panin Sekuritas', also: ['Panin'] },
  { name: 'CGS International Sekuritas Indonesia', also: ['CGS', 'CGS-CIMB'] },
  { name: 'Pluang', also: [] },
];

/** The brokers a typed broker field offers: matched as the banks are, at most `limit`. */
export function brokerMatches(typed: string, limit = 3): IndonesianBroker[] {
  return namedMatches(INDONESIAN_BROKERS, typed, limit);
}
