import type { CatalogEntry } from '@expanses/catalog';
import { type BonusTier, type CycleBonus, nextBonusTier } from '@expanses/core';

export interface Dated {
  validFrom: string | null;
  validTo: string | null;
}

/** True when a dated rule, bonus, or partner applies on any day from start to end. */
export const activeDuring = (item: Dated, start: string, end: string) => (!item.validFrom || item.validFrom <= end) && (!item.validTo || item.validTo >= start);

export interface CatalogLink {
  status: 'linked' | 'customised' | null;
  entryVersion: number | null;
  dismissedVersion: number | null;
  entry: CatalogEntry | undefined;
}

/** The bundled entry when a customised program has neither applied nor skipped its version. Linked programs update on open. */
export function pendingUpdate(link: CatalogLink): CatalogEntry | null {
  if (link.status !== 'customised' || !link.entry) return null;
  return link.entry.entryVersion > Math.max(link.entryVersion ?? 0, link.dismissedVersion ?? 0) ? link.entry : null;
}

export interface BonusStanding {
  awarded: number;
  eligibleSpendMinor: number;
  next: BonusTier | null;
  remainingMinor: number;
  /** Progress toward the next tier, or 1 once the top tier is reached. */
  fraction: number;
}

export function bonusStanding(bonus: CycleBonus, eligibleSpendMinor: number, awarded: number): BonusStanding {
  const next = nextBonusTier(bonus, eligibleSpendMinor);
  return {
    awarded,
    eligibleSpendMinor,
    next,
    remainingMinor: next ? next.minSpendMinor - eligibleSpendMinor : 0,
    fraction: next ? Math.min(1, eligibleSpendMinor / next.minSpendMinor) : 1,
  };
}
