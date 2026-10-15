import { type BudgetFrequency, formatBp, parseMajor, parsePercentBp, shareOfMinor } from '@expanses/core';
import type { BudgetRow, SaveBudgetInput } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { type ShareBase, toAmount, toPercent } from './share-form';

/** What the field holds and what it is typed as: the part of the form a switch changes. */
interface Shown {
  mode: 'amount' | 'share';
  amount: string;
  frequency: BudgetFrequency;
  thisMonthOnly: boolean;
}

/** What the cap sheet holds while it is open: the figure as typed, what it is typed as, and whether it is this month's. */
export interface CapForm extends Shown {
  /**
   * The plan's: an amount in its unit, or a %. Just this month never changes it: while that is on, the field holds
   * the month's Rp figure and the % control is hidden, and turning it off gives the plan back in its own mode.
   */
  mode: 'amount' | 'share';
  /** Something was typed, picked or switched since the sheet opened. */
  touched: boolean;
  /** What was shown before the last switch, while nothing has been typed since: switching back gives it back exactly. */
  before: Shown | null;
}

/**
 * What is typed into the Cap row to begin with: this month's own figure when it has one, else the plan as it was typed
 * — its share, for a budget set as a %.
 */
function startingFigure(row: BudgetRow | undefined, thisMonthOnly: boolean, currency: string): string {
  if (!row) return '';
  if (!thisMonthOnly && row.share) return formatBp(row.share.bp);
  return bareFigure(thisMonthOnly ? row.amountMinor : row.amountAsSetMinor, currency);
}

/** The sheet as it opens on a category's budget, or on none. */
export function openForm(row: BudgetRow | undefined, currency: string): CapForm {
  const thisMonthOnly = Boolean(row?.overridden);
  return {
    mode: row?.share ? 'share' : 'amount',
    amount: startingFigure(row, thisMonthOnly, currency),
    frequency: row?.frequency ?? 'monthly',
    thisMonthOnly,
    touched: false,
    before: null,
  };
}

/**
 * A switch from `form` to `next`, remembered. Back to what was shown before the last switch, with nothing typed since,
 * the figure comes back exactly as it was rather than converted twice: a % holds only two decimals.
 */
function remembered(form: CapForm, next: CapForm): CapForm {
  const shown: Shown = { mode: form.mode, amount: form.amount, frequency: form.frequency, thisMonthOnly: form.thisMonthOnly };
  const back = form.before && form.before.mode === next.mode && form.before.thisMonthOnly === next.thisMonthOnly ? form.before : null;
  return { ...next, ...(back ? { amount: back.amount, frequency: back.frequency } : {}), before: shown };
}

/**
 * Amount ↔ %. Switching converts what is typed, so nothing is lost: 1.800.000 of a 12.000.000 take-home is 15%. An
 * amount is read by the month whatever its unit, and a % comes back as a month's figure.
 */
export function switchMode(form: CapForm, next: 'amount' | 'share', base: ShareBase, currency: string): CapForm {
  if (next === form.mode) return form;
  const amount = next === 'share' ? toPercent(form.amount, form.frequency, base, currency) : toAmount(form.amount, base, currency);
  return remembered(form, { ...form, touched: true, amount, frequency: 'monthly', mode: next });
}

/**
 * Just this month on or off; the plan's mode stays as it is. On, the field holds the month's figure: as stored when
 * nothing was typed, else what is typed, a % as the amount it comes to. Off, it holds the plan again: as stored when
 * nothing was typed, else the month's figure carried back, as its % for a plan that is a %.
 */
export function switchMonth(form: CapForm, on: boolean, row: BudgetRow | undefined, base: ShareBase, currency: string): CapForm {
  if (on === form.thisMonthOnly) return form;
  const share = form.mode === 'share';
  const carried = on ? (share ? toAmount(form.amount, base, currency) : form.amount) : share ? toPercent(form.amount, 'monthly', base, currency) : form.amount;
  return remembered(form, { ...form, thisMonthOnly: on, amount: form.touched ? carried : startingFigure(row, on, currency) });
}

/** A figure typed into the field. */
export function typeFigure(form: CapForm, amount: string): CapForm {
  return { ...form, touched: true, amount, before: null };
}

/** The unit the plan is typed in. */
export function setUnit(form: CapForm, frequency: BudgetFrequency): CapForm {
  return { ...form, frequency, before: null };
}

/**
 * A chip's figure into the Cap row. The figures are a month's, so the unit becomes Month and the plan an amount —
 * unless Just this month is on, where the field is already the month's figure and the plan keeps its mode. Nothing is
 * saved yet.
 */
export function takeFigure(form: CapForm, minor: number, currency: string): CapForm {
  return { ...form, touched: true, mode: form.thisMonthOnly ? form.mode : 'amount', frequency: 'monthly', amount: bareFigure(minor, currency), before: null };
}

/**
 * What ✓ writes: this month's own figure, or the plan — as a %, or as an amount in its unit. Throws, in words, when the
 * field cannot be read.
 */
export function savedOf(form: CapForm, base: ShareBase, currency: string): { kind: 'month'; amountMinor: number } | { kind: 'plan'; plan: Omit<SaveBudgetInput, 'categoryAccountId'> } {
  // A % is always the plan's: this month's own figure is an amount.
  const sharing = form.mode === 'share' && !form.thisMonthOnly;
  // The empty box is the one refusal `parseMajor` has no words for, so it is worded here.
  if (!form.amount.trim()) throw new Error(sharing ? 'The share is empty — type a %' : 'The cap is empty — type a figure');
  if (sharing) {
    const bp = parsePercentBp(form.amount);
    return { kind: 'plan', plan: { amountMinor: shareOfMinor(base.minor, bp, currency), frequency: 'monthly', share: { basis: base.basis, bp } } };
  }
  const minor = parseMajor(form.amount, currency);
  return form.thisMonthOnly ? { kind: 'month', amountMinor: minor } : { kind: 'plan', plan: { amountMinor: minor, frequency: form.frequency } };
}
