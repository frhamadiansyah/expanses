import type { BundledMerchant } from '@expanses/catalog';

export interface BundledRow extends BundledMerchant {
  /** typical: used as bundled; yours: your memory gives another MCC; ignored: your memory switches it off. */
  status: 'typical' | 'yours' | 'ignored';
  yourMcc: string | null;
}

/** Bundled merchants matching every search word in their name, pattern, or MCC, with your overrides, sorted by name. */
export function bundledRows(bundled: readonly BundledMerchant[], memory: readonly { pattern: string; mcc: string | null }[], query: string): BundledRow[] {
  const mine = new Map(memory.map((entry) => [entry.pattern, entry]));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return bundled
    .filter((merchant) => words.every((word) => `${merchant.name} ${merchant.pattern} ${merchant.mcc}`.toLowerCase().includes(word)))
    .map((merchant): BundledRow => {
      const entry = mine.get(merchant.pattern);
      return { ...merchant, status: !entry ? 'typical' : entry.mcc === null ? 'ignored' : 'yours', yourMcc: entry?.mcc ?? null };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The text a purchase is matched on, as the repository keeps it: trimmed, lowercase, single spaces. */
export const normalisePattern = (pattern: string) => pattern.trim().toLowerCase().replace(/\s+/g, ' ');

/** A pattern is kept in lowercase to match on; shown as a name, each word starts with a capital: "kedai senja" → "Kedai Senja". */
export const patternAsName = (pattern: string) => pattern.replace(/(^|\s)(\S)/g, (_, gap: string, first: string) => gap + first.toUpperCase());

export interface MineRow<T extends { pattern: string; mcc: string | null }> {
  entry: T;
  /** The typical merchant's own name when one shares the text, else the text as kept. */
  name: string;
  /** The typical merchant sharing this text, if any: an entry with no code is then that merchant ignored. */
  typical: BundledMerchant | null;
}

/**
 * The owner's merchants, named and filtered by the same search as the typical list: every word found in the name,
 * the matched text or the code. Sorted by name.
 */
export function mineRows<T extends { pattern: string; mcc: string | null }>(memory: readonly T[], bundled: readonly BundledMerchant[], query: string): MineRow<T>[] {
  const typical = new Map(bundled.map((merchant) => [merchant.pattern, merchant]));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return memory
    .map((entry): MineRow<T> => {
      const match = typical.get(entry.pattern) ?? null;
      return { entry, name: match?.name ?? patternAsName(entry.pattern), typical: match };
    })
    .filter((row) => words.every((word) => `${row.name} ${row.entry.pattern} ${row.entry.mcc ?? ''}`.toLowerCase().includes(word)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What the merchant sheet holds when ✓ is pressed. */
export interface MerchantDraft {
  /** The owner's entry being changed, if any. */
  id?: string;
  pattern: string;
  /** Four digits, or empty. */
  mcc: string;
  /** The "Use typical code" switch; only read when a typical merchant shares the text. */
  useTypical: boolean;
}

/** What ✓ does with a draft: save an entry, forget one, or nothing at all. */
export type MerchantOutcome =
  | { kind: 'save'; entry: { id?: string; pattern: string; mcc: string | null } }
  | { kind: 'forget'; id: string }
  | { kind: 'none' };

/** The typical merchant matched on exactly this text, if there is one. */
export const typicalFor = (bundled: readonly BundledMerchant[], pattern: string) => bundled.find((merchant) => merchant.pattern === normalisePattern(pattern)) ?? null;

/**
 * The sheet's one decision. Where a typical merchant shares the text, the switch off ignores its code (an entry with
 * no code), and on with the typical code — or no code typed — needs no entry of the owner's at all, so one that
 * exists is forgotten; a different code makes it the owner's. Without a typical merchant a code is required.
 * Null while ✓ cannot save yet.
 */
export function merchantOutcome(draft: MerchantDraft, bundled: readonly BundledMerchant[]): MerchantOutcome | null {
  const pattern = normalisePattern(draft.pattern);
  if (pattern === '') return null;
  const mcc = draft.mcc.trim();
  if (mcc !== '' && !/^\d{4}$/.test(mcc)) return null;
  const typical = typicalFor(bundled, pattern);
  if (typical) {
    if (!draft.useTypical) return { kind: 'save', entry: { id: draft.id, pattern, mcc: null } };
    if (mcc === '' || mcc === typical.mcc) return draft.id ? { kind: 'forget', id: draft.id } : { kind: 'none' };
    return { kind: 'save', entry: { id: draft.id, pattern, mcc } };
  }
  if (mcc === '') return null;
  return { kind: 'save', entry: { id: draft.id, pattern, mcc } };
}
