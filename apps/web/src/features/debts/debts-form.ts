import { type DebtDirection, formatMinor, parseMajor } from '@expanses/core';
import type { PeopleDebts, RecordLoanInput, RecordRepaymentInput } from '@expanses/db';

export interface DebtDraft {
  direction: DebtDirection;
  personName: string;
  /** Chosen when the person already has an account, so a second one is never opened for them. */
  existingAccountId: string;
  occurredOn: string;
  amount: string;
  moneyId: string;
  moneyIsCard: boolean;
  /** Card loans only: the category the purchase would have had, so the points still count. */
  spendCategoryId: string;
  mcc: string;
  reason: string;
  dueOn: string;
  personIdNumber: string;
}

export const emptyDebtDraft = (today: string): DebtDraft => ({
  direction: 'lent',
  personName: '',
  existingAccountId: '',
  occurredOn: today,
  amount: '',
  moneyId: '',
  moneyIsCard: false,
  spendCategoryId: '',
  mcc: '',
  reason: '',
  dueOn: '',
  personIdNumber: '',
});

/** Turns what was typed into a loan to record, with messages meant for the screen. */
export function debtDraftToInput(draft: DebtDraft, currency: string, today: string): RecordLoanInput {
  const personName = draft.personName.trim();
  if (!draft.existingAccountId && !personName) throw new Error('Say who this is with');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A loan cannot be dated after today');
  if (!draft.moneyId) throw new Error('Choose which account the money came from');

  if (draft.amount.trim() === '') throw new Error('Enter how much');
  let amountMinor: number;
  try {
    amountMinor = parseMajor(draft.amount, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (!(amountMinor > 0)) throw new Error('Enter how much');

  return {
    debtAccountId: draft.existingAccountId || undefined,
    person: draft.existingAccountId
      ? undefined
      : {
          name: personName,
          direction: draft.direction,
          currency,
          reason: draft.reason.trim() || null,
          dueOn: draft.dueOn || null,
          personIdNumber: draft.personIdNumber.trim() || null,
        },
    occurredOn: draft.occurredOn,
    amountMinor,
    moneyAccountId: draft.moneyId,
    spendCategoryId: draft.moneyIsCard && draft.spendCategoryId ? draft.spendCategoryId : null,
    mcc: draft.moneyIsCard && draft.mcc.trim() !== '' ? draft.mcc.trim() : null,
  };
}

export interface RepaymentDraft {
  amount: string;
  interest: string;
  occurredOn: string;
  moneyId: string;
}

export const emptyRepaymentDraft = (today: string, moneyId: string): RepaymentDraft => ({ amount: '', interest: '', occurredOn: today, moneyId });

/** Turns a repayment as typed into one to record, refusing more than is owed before the ledger has to. */
export function repaymentDraftToInput(
  draft: RepaymentDraft,
  debtAccountId: string,
  currency: string,
  balanceMinor: number,
  personName: string,
): RecordRepaymentInput {
  if (draft.amount.trim() === '') throw new Error('Enter how much came back');
  let amountMinor: number;
  try {
    amountMinor = parseMajor(draft.amount, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (!(amountMinor > 0)) throw new Error('Enter how much came back');
  if (amountMinor > balanceMinor) throw new Error(`${personName} owes ${formatMinor(balanceMinor, currency)}`);

  let interestMinor = 0;
  if (draft.interest.trim() !== '') {
    try {
      interestMinor = parseMajor(draft.interest, currency);
    } catch {
      throw new Error('The interest must be a number');
    }
    if (interestMinor < 0) throw new Error('Interest cannot be negative');
  }

  return { debtAccountId, occurredOn: draft.occurredOn, amountMinor, interestMinor, moneyAccountId: draft.moneyId };
}

/** Names the workspace already knows, so typing "An" offers "Andi". Settled people count: they may borrow again. */
export function personSuggestions(people: PeopleDebts, typed: string): string[] {
  const needle = typed.trim().toLowerCase();
  if (!needle) return [];
  const names = [...people.owedToYou, ...people.youOwe, ...people.settled].map((person) => person.personName);
  return [...new Set(names)].filter((name) => name.toLowerCase().includes(needle));
}
