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
  /** Days the purchase must fall on, 0 for Sunday through 6 for Saturday, which is how a weekend offer is written. */
  daysOfWeek?: number[];
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
  /** Spend the cycle must reach, net of refunds, before this rule earns at all. */
  minCycleSpendMinor?: number | null;
  /**
   * Caps this rule's spend at the card's own credit limit, which the catalogue cannot know. Combined with
   * capSpendMinor the smaller of the two wins, the way an issuer writes "one times your limit, at most Rp X".
   */
  capSpendAtCreditLimit?: boolean;
  /** Levels this rule earns at. Absent means every level, which is how an untiered card is written. */
  memberLevels?: string[];
  /**
   * Key of the program's category choice. The rule earns only on the option the holder is running, and the
   * option's match is merged into this rule's own. Absent means the rule does not depend on a choice.
   */
  categoryChoice?: string;
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

/** A ceiling on how much converts in one window, and the ratio past it. */
export interface CatalogRedemptionCap {
  /** The window the ceiling resets on. */
  window: 'month' | 'year';
  /** The ceiling in program points. Set exactly one of this and capPartnerUnits. */
  capPoints?: number;
  /** The ceiling in partner units, for issuers that publish it that way. */
  capPartnerUnits?: number;
  /** True when one ceiling covers every partner together rather than each partner on its own. */
  shared?: boolean;
  /** The reduced ratio past the ceiling. Absent means nothing converts past it. */
  beyondPoints?: number;
  beyondPartnerUnits?: number;
}

export interface CatalogTransferPartner {
  key: string;
  program: string;
  points: number;
  partnerUnits: number;
  incrementPoints: number;
  /**
   * Set when the issuer publishes the step in partner units instead of points, as Danamon does with
   * its 500-mile blocks. incrementPoints must then be the same step read through the ratio, which
   * validation checks, so the entry records what the bank says as well as what the engine needs.
   */
  incrementPartnerUnits?: number;
  /** Set when the issuer takes a first transfer larger than the step it moves in afterwards. */
  minimumPoints?: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Levels this ratio is offered at. Absent means every level. */
  memberLevels?: string[];
  /** Set when the issuer limits how much converts in a window. */
  cap?: CatalogRedemptionCap;
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

/**
 * A category the holder picks from a menu the bank publishes, which then earns at a better rate — Jenius lets
 * one of four run at a time, changeable once a billing cycle. Which one is running is the holder's, not the
 * card's, and it is dated: a cycle that closed keeps the category that was running while it ran.
 */
export interface CatalogCategoryChoice {
  key: string;
  name: string;
  /** How often it may be changed, in words, for the screen to repeat. */
  changeable: string;
  options: { key: string; name: string; match: CatalogMatch }[];
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
  /** Set when the holder picks one category from a published menu to earn at a better rate. */
  categoryChoice?: CatalogCategoryChoice;
}

/**
 * How to draw the front of the card: redrawn from the bank's official picture, never the artwork itself.
 * Cosmetic only, so a change here is not a catalogue update to announce.
 */
/** The illustrations a card face can be drawn with, each in the manner of a real card's artwork. */
export const CARD_MOTIFS = ['batik-floral', 'big-letter', 'rosette-tile', 'chrome-curves', 'ikat-diamonds', 'engraved-frame', 'portrait-oval', 'split-waves', 'colour-blocks', 'halftone-vortex', 'centre-ring', 'wing-bars', 'stadium', 'skyline', 'faceted-ribbon', 'horizon', 'swirl-edges', 'flight-line', 'sparse-diagonals', 'contour-lines', 'meridians', 'fine-contours', 'guilloche-crest', 'garuda-contrails', 'outline-u', 'hologram-disc', 'foil-sheen', 'low-poly-facets', 'sakura-branch', 'octo-rings', 'copper-ribbon', 'lotus-watermark', 'light-streaks', 'torn-ribbons'] as const;
export type CardMotif = (typeof CARD_MOTIFS)[number];

export interface CatalogCardLook {
  orientation: 'landscape' | 'portrait';
  /** One to three background colours, in order across the face. */
  colours: string[];
  /** Direction of the gradient in degrees, when there is more than one colour. */
  angle?: number;
  finish: 'matte' | 'glossy' | 'metallic';
  /** A simple repeating texture, for a card whose artwork is mostly colour. */
  pattern: 'none' | 'diagonal-lines' | 'waves' | 'arcs' | 'dots' | 'grid' | 'stripe' | 'glow';
  patternColour?: string;
  /** A drawn illustration in the manner of the card's own artwork, used instead of the pattern when set. */
  motif?: CardMotif;
  motifColour?: string;
  /** Whether the printing on the card is light or dark. */
  ink: 'light' | 'dark';
  /** The card's name as printed, such as KrisFlyer, top right; null to print the catalogue name. */
  wordmark: string | null;
  /** The bank's name as printed, top left, when it differs from the catalogue's; null when the front carries none. */
  bankMark?: string | null;
  chip: 'gold' | 'silver' | 'none';
}

export interface CatalogEntry {
  id: string;
  entryVersion: number;
  bank: string;
  name: string;
  network: string;
  currency: string;
  /**
   * A debit card spends the account's own money, so it has no statement, no credit limit and nothing
   * to pay off. It is applied to a bank or savings account rather than a credit card, and its cycle is
   * the calendar month. Absent means a credit card, which is what nearly every entry is.
   */
  cardType?: 'credit' | 'debit';
  program: CatalogProgram;
  fees: CatalogFeePeriod[];
  terms: CatalogTermsPeriod[];
  transferPartners: CatalogTransferPartner[];
  cashValue: { valueMinor: number; perPoints: number; currency: string } | null;
  welcomeBonus: string | null;
  notes: string[];
  sources: { title: string; url: string }[];
  verifiedOn: string;
  look?: CatalogCardLook;
}
