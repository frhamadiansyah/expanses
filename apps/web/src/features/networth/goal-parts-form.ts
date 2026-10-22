import { formatUnits, type GoalPart, parseMajor, parseUnits } from '@expanses/core';
import { bareFigure } from './debt-rows';

/** The goal select's value that opens the split: a trade between several goals rather than one. */
export const SPLIT = '__split';

/** One goal's part as typed: which goal, and its units (or, a fund tracked by money, its amount). */
export interface PartDraft {
  goalId: string;
  amount: string;
}

/** A saved split, written back the way the owner types it. */
export function partsToTyped(parts: readonly GoalPart[], currency: string): PartDraft[] {
  const byMoney = parts.some((part) => part.moneyMinor > 0);
  return parts.map((part) => ({ goalId: part.goalId, amount: byMoney ? bareFigure(part.moneyMinor, currency) : formatUnits(part.unitsMicro) }));
}

/** What a typed part is worth: micro-units, or minor units of money; null when blank or not a number. */
function valueOf(text: string, byMoney: boolean, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    return byMoney ? parseMajor(text, currency) : parseUnits(text);
  } catch {
    return null;
  }
}

/** How much of the trade the parts take, and whether that is more than it has: the editor's "Placed" line. */
export function placed(parts: readonly PartDraft[], whole: string, byMoney: boolean, currency: string): { placedValue: number; wholeValue: number | null; over: boolean } {
  const placedValue = parts.reduce((sum, part) => sum + Math.max(0, valueOf(part.amount, byMoney, currency) ?? 0), 0);
  const wholeValue = valueOf(whole, byMoney, currency);
  return { placedValue, wholeValue, over: wholeValue !== null && placedValue > wholeValue };
}

/**
 * The typed parts as a split to save, with messages meant for the screen. A part with no goal or nothing typed is left
 * out; a goal named twice, a part that is not a number, or parts taking more than the trade are refused.
 */
export function partsFromTyped(parts: readonly PartDraft[], whole: string, byMoney: boolean, currency: string): GoalPart[] {
  const out: GoalPart[] = [];
  for (const part of parts) {
    if (!part.goalId || part.amount.trim() === '') continue;
    const value = valueOf(part.amount, byMoney, currency);
    if (value === null || value <= 0) throw new Error(byMoney ? 'Each goal’s amount must be a number above zero' : 'Each goal’s units must be a number above zero');
    if (out.some((kept) => kept.goalId === part.goalId)) throw new Error('A goal is named twice; give it one part');
    out.push({ goalId: part.goalId, unitsMicro: byMoney ? 0 : value, moneyMinor: byMoney ? value : 0 });
  }
  if (out.length === 0) throw new Error('Give each goal its part, or choose one goal');
  const { over } = placed(parts, whole, byMoney, currency);
  if (over) throw new Error('The goals take more than this trade; enter up to its own amount');
  return out;
}
