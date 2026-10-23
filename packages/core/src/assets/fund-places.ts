import { INDONESIAN_BANKS, namedMatches } from '../coretax/banks';
import { INDONESIAN_BROKERS } from '../coretax/brokers';

/**
 * Where a mutual fund or a retail government bond is bought, offered while a fund's or a bond's Institution is typed:
 * the fund apps first, then the brokers and the banks that sell them. A name only — never a link to an account (owner,
 * 23 Oct) — and never an e-wallet. Indonesia's own only in a workspace kept in rupiah, as the banks and brokers are;
 * anything else typed is kept as typed.
 */
export type FundPlace = { name: string; also: readonly string[] };

export const INDONESIAN_FUND_APPS: readonly FundPlace[] = [
  { name: 'Bibit', also: [] },
  { name: 'Bareksa', also: [] },
  { name: 'Tanamduit', also: ['Tanam Duit'] },
  { name: 'Makmur', also: [] },
];

/**
 * The places a typed Institution offers, at most `limit`: the names already used in this workspace first, then — in
 * rupiah — the fund apps, the brokers and the banks, each group matched on its own so a broker known also by an app's
 * name (Stockbit Sekuritas, "Bibit") never comes before the app itself. One of each, whatever its case, and nothing
 * once what is typed is a name already.
 */
export function fundPlaceMatches(typed: string, used: readonly string[], local: boolean, limit = 4): FundPlace[] {
  const groups: (readonly FundPlace[])[] = [used.map((name) => ({ name, also: [] })), ...(local ? [INDONESIAN_FUND_APPS, INDONESIAN_BROKERS, INDONESIAN_BANKS] : [])];
  const want = typed.trim().toLowerCase();
  if (groups.some((group) => group.some((place) => place.name.toLowerCase() === want))) return [];
  const seen = new Set<string>();
  const out: FundPlace[] = [];
  for (const group of groups) {
    for (const place of namedMatches(group, typed, limit)) {
      const key = place.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(place);
    }
  }
  return out.slice(0, limit);
}
