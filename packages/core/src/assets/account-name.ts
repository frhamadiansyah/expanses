import { INDONESIAN_BANKS } from '../coretax/banks';

/**
 * How an account is called on screen: "Mandiri Xpresi", not just "Xpresi" — the bank and the name the owner typed.
 *
 * The name is stored as typed and the bank where it is kept — a money account's in the tax report's Nama institusi, a
 * credit card's as its issuer — and neither changes. Only what a screen prints puts the two together, and only for
 * what is held at a bank: a current or saving account, a time deposit, and a credit card (saved since the new card
 * form as issuer "BCA" and name "UnionPay"). Everything else is called by its own name alone:
 *  - a digital wallet or an electronic money card is called by its product (GoPay, Flazz), which already says whose
 *    it is; its institution, when one is typed, is the company behind it, not a word anyone calls it by;
 *  - a fund's or a bond's Held at is a name only, never a bank account's;
 *  - cash has no bank.
 * A broker's cash (an RDN) is the one that goes by its bank alone: see `CUSTODIAN_NAMED_SUBTYPES`.
 */
export const BANK_NAMED_SUBTYPES: readonly string[] = ['bank', 'savings', 'time_deposit', 'credit_card'];

/**
 * A broker's cash account (an RDN) has two names (owner, 25 Nov): its name is the broker's ("Mirae Sekuritas"), and its
 * Nama institusi is the custodian bank the money sits at ("CIMB Niaga"). Where money is listed it is called by that
 * bank alone; where a broker is meant — a stock's Broker, Investments, a holding's tax line — by its name.
 */
export const CUSTODIAN_NAMED_SUBTYPES: readonly string[] = ['fund'];

/**
 * The entry on the bank list a stored bank is, however it was written: its full name or a short one ("Bank Central
 * Asia", "BCA"), either with "Bank" in front ("Bank BNI", "Bank OCBC NISP", as the card catalogue writes some).
 */
function knownBank(bank: string) {
  const lower = bank.trim().toLowerCase().replace(/\s+/g, ' ');
  const find = (text: string) => INDONESIAN_BANKS.find((entry) => entry.name.toLowerCase() === text || entry.also.some((short) => short.toLowerCase() === text));
  return find(lower) ?? (lower.startsWith('bank ') ? find(lower.slice(5)) : undefined);
}

/**
 * The word a bank is called by: the short name people use for a bank on the list typing offers ("Bank Mandiri" is
 * "Mandiri", "Bank Central Asia" "BCA", the catalogue's "Bank DBS Indonesia" "DBS"), and anything else as stored.
 */
export function shortBankName(bank: string): string {
  const typed = bank.trim();
  const known = knownBank(typed);
  return known ? (known.also[0] ?? known.name) : typed;
}

/**
 * Every name a bank may already be written as at the front of an account's name: the stored one, the list's full
 * name and every short one — so "Jenius Visa Platinum" at Bank SMBC Indonesia, whose short names include Jenius, is
 * already named by its bank.
 */
export function bankNameWords(bank: string): string[] {
  const typed = bank.trim();
  const known = knownBank(typed);
  return [typed, ...(known ? [known.name, ...known.also] : [])].filter((word) => word !== '');
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `name` opens with `word` as a whole word: "Mandiri Xpresi" opens with "mandiri", "Mandirian" does not. */
function opensWith(name: string, word: string): boolean {
  return new RegExp(`^${escape(word)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(name);
}

/**
 * Whether a name opens with a name `bank` goes by: "MANDIRI RANI KUSUMA" with Bank Mandiri, "BCA RANI" with Bank Central
 * Asia — the way a wallet names the bank account it sent money to.
 */
export function opensWithBankName(name: string, bank: string): boolean {
  const trimmed = name.trim();
  return bankNameWords(bank).some((word) => opensWith(trimmed, word));
}

/**
 * The name an account is shown by. `bank` is the account's bank as stored (null or empty for none). A name that
 * already starts with its bank — "Mandiri Xpresi", "mandiri xpresi", "BCA Tahapan" at Bank Central Asia, an older
 * card saved whole as "BCA KrisFlyer" — is shown as typed, so the bank is never said twice.
 *
 * A broker's cash with its custodian bank named is shown as that bank, as written ("CIMB Niaga"), and a pocket of it as
 * the bank and the pocket's currency ("CIMB Niaga · USD"); with none named, as its broker.
 */
export function accountDisplayName(account: { name: string; subtype: string; bank?: string | null; parentId?: string | null; currency?: string | null }): string {
  const bank = account.bank?.trim();
  if (bank && CUSTODIAN_NAMED_SUBTYPES.includes(account.subtype)) return account.parentId && account.currency ? `${bank} · ${account.currency}` : bank;
  if (!bank || !BANK_NAMED_SUBTYPES.includes(account.subtype)) return account.name;
  const name = account.name.trim();
  if (bankNameWords(bank).some((word) => opensWith(name, word))) return account.name;
  return `${shortBankName(bank)} ${name}`;
}
