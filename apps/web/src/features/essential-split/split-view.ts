import { type EssentialSplit, gradeSplit, guideLeft, isValidGuide, type NeedsPlanRow, type RatioStatus, type SpendingGuide } from '@expanses/core';
import { STATUS_LABELS } from '../networth/health-cards';

export type SplitKey = 'essential' | 'lifestyle' | 'debtsSavings';
export const SPLIT_KEYS: readonly SplitKey[] = ['essential', 'lifestyle', 'debtsSavings'];

export const SPLIT_LABELS: Record<SplitKey, string> = { essential: 'Essential', lifestyle: 'Lifestyle', debtsSavings: 'Debts & savings' };
/** The system blue, orange and green: one colour per part wherever the three are drawn. */
export const SPLIT_COLOURS: Record<SplitKey, string> = { essential: '#0a84ff', lifestyle: '#ff9f0a', debtsSavings: '#30b158' };
export const SPLIT_TITLE = 'Essential · Lifestyle · Debts & savings';

/** "50 / 30 / 20" on Cashflow, "50 · 30 · 20" on the health card. */
export const guideText = (guide: SpendingGuide, separator = ' / '): string => [guide.essential, guide.lifestyle, guide.debtsSavings].join(separator);

export interface SplitRowView {
  key: SplitKey;
  label: string;
  /** "52%", or null with no income to divide by. */
  percent: string | null;
  amountMinor: number;
  /** Debts & savings below nought. */
  warn: boolean;
  /**
   * Essential and Lifestyle filter the list; Debts & savings is what was not spent on either (spending marked Debts &
   * savings included), so it filters nothing.
   */
  filters: boolean;
}

export interface SplitView {
  incomeMinor: number;
  rows: SplitRowView[];
  /** The bar's three widths, 0 to 100, or null with no income. */
  bar: { key: SplitKey; width: number; colour: string }[] | null;
  /** Where the guide's two marks sit along the bar, 0 to 100. */
  marks: [number, number];
  /** What was spent past the income, or 0. */
  overspentMinor: number;
  guide: string;
}

/** Cashflow's Income page 2. */
export function splitView(split: EssentialSplit, guide: SpendingGuide): SplitView {
  const amounts: Record<SplitKey, number> = { essential: split.essentialMinor, lifestyle: split.lifestyleMinor, debtsSavings: split.debtsSavingsMinor };
  return {
    incomeMinor: split.incomeMinor,
    rows: SPLIT_KEYS.map((key) => ({
      key,
      label: SPLIT_LABELS[key],
      percent: split.percents ? `${split.percents[key]}%` : null,
      amountMinor: amounts[key],
      warn: key === 'debtsSavings' && split.debtsSavingsMinor < 0,
      filters: key !== 'debtsSavings',
    })),
    bar: split.bar ? SPLIT_KEYS.map((key) => ({ key, width: split.bar![key] * 100, colour: SPLIT_COLOURS[key] })) : null,
    marks: [guide.essential, guide.essential + guide.lifestyle],
    overspentMinor: split.overspentMinor,
    guide: guideText(guide),
  };
}

export interface SplitCardView {
  name: string;
  value: string;
  status: RatioStatus;
  statusLabel: string;
  benchmark: string;
  bar: { key: SplitKey; width: number; colour: string }[] | null;
  marks: [number, number];
  explanation: string;
}

/** The Financial health card, in the same parts as every other card there. */
export function splitCard(split: EssentialSplit | undefined, guide: SpendingGuide): SplitCardView {
  const status = split ? gradeSplit(split, guide) : 'unknown';
  const percents = split?.percents ?? null;
  return {
    name: SPLIT_TITLE,
    value: percents ? guideText({ essential: percents.essential, lifestyle: percents.lifestyle, debtsSavings: percents.debtsSavings }, ' · ') : '—',
    status,
    statusLabel: STATUS_LABELS[status],
    benchmark: guideText(guide, ' · '),
    bar: split?.bar ? SPLIT_KEYS.map((key) => ({ key, width: split.bar![key] * 100, colour: SPLIT_COLOURS[key] })) : null,
    marks: [guide.essential, guide.essential + guide.lifestyle],
    explanation: `Share of take-home pay over the period, by each category’s mark (unmarked counts as Essential). Debts & savings is what was not spent on Essential or Lifestyle, insurance, donations and loan interest marked so included; on track at ${guide.debtsSavings}% or more.`,
  };
}

export interface NeedsBoxRow {
  key: SplitKey;
  label: string;
  usedMinor: number;
  plannedMinor: number | null;
  warn: boolean;
  /** 0 to 100. */
  fill: number;
  colour: string;
}

/** The Budget box's three rows. */
export function needsBoxRows(rows: readonly NeedsPlanRow[]): NeedsBoxRow[] {
  return rows.map((row) => ({
    key: row.key,
    label: SPLIT_LABELS[row.key],
    usedMinor: row.usedMinor,
    plannedMinor: row.plannedMinor,
    warn: row.warn,
    fill: row.fill * 100,
    colour: row.warn ? 'var(--ph-warn)' : SPLIT_COLOURS[row.key],
  }));
}

export type GuideDraft = Record<SplitKey, string>;

export const draftOf = (guide: SpendingGuide): GuideDraft => ({ essential: String(guide.essential), lifestyle: String(guide.lifestyle), debtsSavings: String(guide.debtsSavings) });

/** What the Guide sheet's three boxes come to: the guide to save, or why it cannot be saved yet. */
export function readDraft(draft: GuideDraft): { guide: SpendingGuide | null; footer: string } {
  const parse = (text: string) => (/^\s*\d{1,3}\s*$/.test(text) ? Number(text) : Number.NaN);
  const guide = { essential: parse(draft.essential), lifestyle: parse(draft.lifestyle), debtsSavings: parse(draft.debtsSavings) };
  if (SPLIT_KEYS.some((key) => Number.isNaN(guide[key]))) return { guide: null, footer: 'Whole percents only, from 0 to 100.' };
  const left = guideLeft(guide);
  if (left > 0) return { guide: null, footer: `${left}% left to place.` };
  if (left < 0) return { guide: null, footer: `${-left}% over 100.` };
  return isValidGuide(guide) ? { guide, footer: 'Adds up to 100%.' } : { guide: null, footer: 'Whole percents only, from 0 to 100.' };
}
