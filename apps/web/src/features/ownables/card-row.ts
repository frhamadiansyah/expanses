import type { CatalogEntry } from '@expanses/catalog';
import { INDONESIAN_BANKS } from '@expanses/core';
import { splitCardName } from './debt-form';

/**
 * The one name a bank goes by, however it was written: "BCA", "Bank Central Asia" and "bank central asia" are one
 * bank, and so are the catalogue's "Bank BNI" and the bank list's "BNI". Known names and their short forms come from
 * the bank list the Bank field offers; a "Bank" in front is tried without it; anything else is its own name.
 */
export function canonicalBank(bank: string): string {
  const lower = bank.trim().toLowerCase().replace(/\s+/g, ' ');
  const known = (text: string) => INDONESIAN_BANKS.find((entry) => entry.name.toLowerCase() === text || entry.also.some((short) => short.toLowerCase() === text));
  const found = known(lower) ?? (lower.startsWith('bank ') ? known(lower.slice(5)) : undefined);
  return found ? found.name.toLowerCase() : lower;
}

/** Whether two ways of writing a bank name the same bank. */
export const sameBank = (a: string, b: string): boolean => canonicalBank(a) === canonicalBank(b);

/**
 * The catalogue's cards offered over the keyboard as the card's name is typed on the bank-and-name row: the chosen
 * bank's cards whose name holds every word typed, or — with no bank yet — any card whose bank and name together do,
 * so "krisflyer" finds BCA's and picking it fills the bank in too. Three at most, the strip's own limit, in the
 * catalogue's order. Nothing at all is offered before either half of the row says something.
 */
export function catalogueOffers(entries: readonly CatalogEntry[], bank: string, typed: string, limit = 3): CatalogEntry[] {
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const byBank = bank.trim() !== '';
  if (!byBank && words.length === 0) return [];
  return entries
    .filter((entry) => (!byBank || sameBank(entry.bank, bank)) && words.every((word) => `${entry.bank} ${entry.name}`.toLowerCase().includes(word)))
    .sort((a, b) => `${a.bank}|${a.name}`.localeCompare(`${b.bank}|${b.name}`))
    .slice(0, limit);
}

/**
 * A catalogue card on the bank-and-name row: its bank in the bank's place and its name without the bank's words —
 * "BCA UnionPay" is BCA, UnionPay — so the two compose again wherever the card is named. A product whose name does
 * not lead with its bank ("Jenius Visa Platinum", issued by Bank SMBC Indonesia) keeps its name whole.
 */
export function entryOnRow(entry: CatalogEntry): { bank: string; name: string } {
  return { bank: entry.bank, name: splitCardName(entry.name, [entry.bank]).name };
}
