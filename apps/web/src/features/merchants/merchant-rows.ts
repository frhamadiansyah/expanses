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
