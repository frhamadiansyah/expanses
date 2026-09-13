import type { BonusTier, Rounding } from '@expanses/core';

/** Like core RuleMatch, but categories are referenced by stable keys instead of account ids. */
export interface CatalogMatch {
  categoryKeys?: string[];
  excludeCategoryKeys?: string[];
  merchantPatterns?: string[];
  excludeMerchantPatterns?: string[];
  currencies?: string[];
  origin?: 'domestic' | 'foreign';
  /** Merchant category codes or ranges such as 3000-3299. */
  mccs?: string[];
  excludeMccs?: string[];
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
  /** Levels this rule earns at. Absent means every level, which is how an untiered card is written. */
  memberLevels?: string[];
}

export interface CatalogCycleBonus {
  key: string;
  name: string;
  /** Spend thresholds within a cycle. Unrelated to memberLevels, which is the holder's standing with the bank. */
  tiers: BonusTier[];
  match: CatalogMatch;
  /** Levels this bonus is paid at. Absent means every level. */
  memberLevels?: string[];
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
  /** Levels this ratio is offered at. Absent means every level. */
  memberLevels?: string[];
}

/**
 * A standing with the bank that changes what the card earns or what a point converts to — Jenius Club levels,
 * a priority-banking tier. It belongs to the holder, not the card, so the entry publishes every level and the
 * card records which one applies.
 */
export interface CatalogMemberLevel {
  key: string;
  name: string;
  /** How the holder qualifies, in words: "average balance Rp 10.000.000 or more". */
  condition: string;
}

export interface CatalogProgram {
  unit: 'points' | 'miles' | 'cashback';
  name: string;
  cycleAnchor: 'statement' | 'calendar';
  /** Set when the issuer uses the same statement day for every cardholder. */
  fixedStatementDay?: number;
  /** How the issuer credits points; decides whether users check each purchase or the statement total. Defaults to per_statement. */
  crediting?: 'per_transaction' | 'per_statement';
  /** Set when earning or conversion depends on the holder's standing with the bank. */
  memberLevels?: CatalogMemberLevel[];
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
