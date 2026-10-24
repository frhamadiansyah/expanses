import { namedMatches } from './banks';

/**
 * Digital wallets in Indonesia, offered while a wallet's name is typed, the way banks and brokers are: only in a
 * workspace kept in rupiah, and anything not here can still be typed and is kept as typed.
 *
 * `name` is what is stored — the wallet as its app calls it; `also` holds the names people find it by.
 */
export type IndonesianWallet = { name: string; also: readonly string[] };

export const INDONESIAN_WALLETS: readonly IndonesianWallet[] = [
  { name: 'GoPay', also: ['Gojek'] },
  { name: 'OVO', also: ['Grab'] },
  { name: 'DANA', also: [] },
  { name: 'ShopeePay', also: ['Shopee'] },
  { name: 'LinkAja', also: ['Telkomsel'] },
  { name: 'AstraPay', also: ['Astra'] },
  { name: 'i.saku', also: ['isaku', 'Indomaret'] },
  { name: 'Sakuku', also: ['BCA'] },
  { name: 'DOKU', also: [] },
  { name: 'Flip', also: [] },
];

/** The wallets a typed name offers: matched as the banks are, at most `limit`. */
export function walletMatches(typed: string, limit = 3): IndonesianWallet[] {
  return namedMatches(INDONESIAN_WALLETS, typed, limit);
}

/**
 * Electronic money cards in Indonesia — prepaid chip cards tapped at a gate or a till — offered while one's name is
 * typed, as the wallets are. `also` is the bank that issues it, which finds it too.
 */
export const INDONESIAN_EMONEY_CARDS: readonly IndonesianWallet[] = [
  { name: 'Flazz', also: ['BCA'] },
  { name: 'e-money', also: ['Mandiri'] },
  { name: 'Brizzi', also: ['BRI'] },
  { name: 'TapCash', also: ['BNI'] },
  { name: 'JakCard', also: ['Bank DKI'] },
];

/** The electronic money cards a typed name offers: matched as the wallets are, at most `limit`. */
export function emoneyMatches(typed: string, limit = 3): IndonesianWallet[] {
  return namedMatches(INDONESIAN_EMONEY_CARDS, typed, limit);
}
