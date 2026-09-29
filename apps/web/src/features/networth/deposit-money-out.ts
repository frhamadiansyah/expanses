import { depositInterest, dueDepositEvents, formatMinor, minorToMajorString, parseMajor, withholdTax } from '@expanses/core';
import type { AccountRow, DepositAutomationRow, DepositTermsRow } from '@expanses/db';

/** Before the maturity the bank breaks the deposit; on or after it, or with no maturity known, the money is withdrawn. */
export type MoneyOutMode = 'early' | 'withdraw';

export const moneyOutMode = (maturesOn: string | null | undefined, today: string): MoneyOutMode =>
  maturesOn && today < maturesOn ? 'early' : 'withdraw';

export const MONEY_OUT_TITLE: Record<MoneyOutMode, string> = { early: 'Break early', withdraw: 'Withdraw' };

export const MONEY_OUT_FOOTER: Record<MoneyOutMode, string> = {
  early: 'The penalty is posted as an expense under Fees & charges. The deposit is closed.',
  withdraw: 'Interest is income; the tax goes to the tax report. The deposit is closed.',
};

export interface MoneyOutDraft {
  intoAccountId: string;
  occurredOn: string;
  principal: string;
  interest: string;
  tax: string;
  penalty: string;
}

export interface MoneyOutFigures {
  principalMinor: number;
  grossMinor: number;
  taxMinor: number;
  penaltyMinor: number;
}

/**
 * The interest the whole term earns, as the automation works out its maturity payout: the maturity event of the
 * current term (the last month only when interest is paid monthly), on the balance now. Zero without a rate.
 */
export function termInterest(balanceMinor: number, terms: Pick<DepositTermsRow, 'maturesOn' | 'rateBps'>, settings: DepositAutomationRow): number {
  const schedule = { maturesOn: terms.maturesOn, termMonths: settings.termMonths, termStartedOn: settings.termStartedOn, interestPaid: settings.interestPaid, enabledOn: terms.maturesOn };
  const maturity = dueDepositEvents(schedule, new Set(), terms.maturesOn).find((event) => event.kind === 'maturity');
  return maturity ? depositInterest(balanceMinor, terms.rateBps, maturity.days) : 0;
}

/** The account it lands in first: the one the maturity settings pay out to, else the first current account, else the first. */
export function defaultInto(choices: readonly Pick<AccountRow, 'id' | 'subtype'>[], payoutAccountId: string | null): string {
  if (payoutAccountId && choices.some((account) => account.id === payoutAccountId)) return payoutAccountId;
  return (choices.find((account) => account.subtype === 'bank') ?? choices[0])?.id ?? '';
}

/**
 * What the sheet opens with. Breaking early earns nothing unless the owner types it; a withdrawal starts from the
 * term's interest and the deposit's own withholding.
 */
export function moneyOutDraft(o: {
  mode: MoneyOutMode;
  balanceMinor: number;
  currency: string;
  terms: Pick<DepositTermsRow, 'maturesOn' | 'rateBps'> | undefined;
  settings: DepositAutomationRow;
  intoAccountId: string;
  today: string;
}): MoneyOutDraft {
  const grossMinor = o.mode === 'withdraw' && o.terms ? termInterest(o.balanceMinor, o.terms, o.settings) : 0;
  const { taxMinor } = withholdTax(grossMinor, o.settings.taxBps, o.settings.taxExempt);
  return {
    intoAccountId: o.intoAccountId,
    occurredOn: o.today,
    principal: minorToMajorString(o.balanceMinor, o.currency),
    interest: minorToMajorString(grossMinor, o.currency),
    tax: minorToMajorString(taxMinor, o.currency),
    penalty: '',
  };
}

const amount = (text: string, currency: string): number => (text.trim() === '' ? 0 : parseMajor(text, currency));

/**
 * The figures to post, read by `parseMajor` in the deposit's currency. A break early has no tax row and a withdrawal
 * no penalty row, so the one the sheet does not show reads as zero. Throws a sentence the sheet shows.
 */
export function readMoneyOut(mode: MoneyOutMode, draft: MoneyOutDraft, currency: string): MoneyOutFigures {
  const principalMinor = amount(draft.principal, currency);
  const grossMinor = amount(draft.interest, currency);
  const taxMinor = mode === 'withdraw' ? amount(draft.tax, currency) : 0;
  const penaltyMinor = mode === 'early' ? amount(draft.penalty, currency) : 0;
  if (principalMinor <= 0) throw new Error('Say how much came back');
  if (grossMinor < 0 || taxMinor < 0 || penaltyMinor < 0) throw new Error('No figure can be below zero');
  if (taxMinor > grossMinor) throw new Error('The tax cannot be more than the interest');
  if (landedMinor({ principalMinor, grossMinor, taxMinor, penaltyMinor }) < 0) throw new Error('The penalty is more than what comes back');
  return { principalMinor, grossMinor, taxMinor, penaltyMinor };
}

/** What lands: principal + interest − tax − penalty. */
export const landedMinor = (f: MoneyOutFigures): number => f.principalMinor + f.grossMinor - f.taxMinor - f.penaltyMinor;

/** The Lands in row while the figures are typed: the sum by the same reader, or a dash until it reads. */
export function landsText(mode: MoneyOutMode, draft: MoneyOutDraft, currency: string): string {
  try {
    return formatMinor(landedMinor(readMoneyOut(mode, draft, currency)), currency);
  } catch {
    return '—';
  }
}
