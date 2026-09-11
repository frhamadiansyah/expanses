import type { BonusTier, Rounding } from '@expanses/core';

/** Like core RuleMatch, but categories are referenced by stable keys instead of account ids. */
export interface CatalogMatch {
  categoryKeys?: string[];
  excludeCategoryKeys?: string[];
  merchantPatterns?: string[];
  excludeMerchantPatterns?: string[];
  currencies?: string[];
  origin?: 'domestic' | 'foreign';
}

export interface CatalogRule {
  key: string;
  name: string;
  rateNum: number;
  rateDen: number;
  rounding: Rounding;
  priority: number;
  stackable: boolean;
  match: CatalogMatch;
  capSpendMinor?: number | null;
  capPoints?: number | null;
  minTransactionMinor?: number | null;
}

export interface CatalogCycleBonus {
  key: string;
  name: string;
  tiers: BonusTier[];
  match: CatalogMatch;
}

export interface CatalogTermsPeriod {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rules: CatalogRule[];
  cycleBonuses: CatalogCycleBonus[];
}

export interface CatalogFeePeriod {
  effectiveFrom: string | null;
  effectiveTo: string | null;
  annualFeeMinor: number;
  supplementaryFeeMinor: number | null;
  /** e.g. "while a Bank Mandiri Prioritas customer" */
  condition?: string;
}

export interface CatalogTransferPartner {
  key: string;
  program: string;
  points: number;
  partnerUnits: number;
  incrementPoints: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface CatalogProgram {
  unit: 'points' | 'miles' | 'cashback';
  name: string;
  cycleAnchor: 'statement' | 'calendar';
  /** Set when the issuer uses the same statement day for every cardholder. */
  fixedStatementDay?: number;
}

export interface CatalogEntry {
  id: string;
  entryVersion: number;
  bank: string;
  name: string;
  network: string;
  currency: string;
  program: CatalogProgram;
  fees: CatalogFeePeriod[];
  terms: CatalogTermsPeriod[];
  transferPartners: CatalogTransferPartner[];
  cashValue: { valueMinor: number; perPoints: number; currency: string } | null;
  welcomeBonus: string | null;
  notes: string[];
  sources: { title: string; url: string }[];
  verifiedOn: string;
}
