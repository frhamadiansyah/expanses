import { type DebtDirection, formatMinor, hartaLabel, KODE_UTANG, parseMajor } from '@expanses/core';
import type { PeopleDebts, RecordLoanInput, RecordRepaymentInput } from '@expanses/db';
import { type CodeChoice, personCodeChoices } from '../ownables/catalogue-view';

/**
 * What a loan between two people files as when nobody says otherwise.
 *
 * `0201` trade receivables is the piutang the report asks for by default, and `109` other debts is the utang one —
 * the same defaults the ledger writes when a loan arrives from somewhere that never asked. A loan whose sub-category
 * is picked in the form overrides these; they are what the form opens on.
 */
export const DEFAULT_SUB_CATEGORY: Record<DebtDirection, string> = { lent: '0201', borrowed: '109' };

export interface DebtDraft {
  direction: DebtDirection;
  personName: string;
  /** Chosen when the person already has an account, so a second one is never opened for them. */
  existingAccountId: string;
  /**
   * What the debt files as: `0201` trade receivables, `0202` an affiliate's, `0209` something else — and `103` or
   * `109` for money you owe. The piutang and utang codes the tax report groups by, chosen by their everyday names.
   */
  subCategory: string;
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
  subCategory: DEFAULT_SUB_CATEGORY.lent,
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

/**
 * The sub-categories a loan between two people can file as, in the catalogue's own words: money owed to you is piutang —
 * a customer's, a relative's, or neither — and money you owe is utang.
 *
 * `101`, a bank or finance-company loan, is left out: a loan from a bank has terms and a schedule and is opened as one,
 * not as a debt with a person. The person's card keeps offering it, for a bank loan already recorded against them.
 */
export function subCategories(direction: DebtDirection): CodeChoice[] {
  return personCodeChoices(direction).filter((choice) => choice.code !== '101');
}

/** What a sub-category files as, in the report's own words — "Piutang usaha", "Utang lain-lain". */
export function subCategoryGloss(direction: DebtDirection, code: string): string {
  return direction === 'lent' ? hartaLabel(code) : (KODE_UTANG.find((entry) => entry.code === code)?.label ?? '');
}

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
    coretaxCode: draft.subCategory || undefined,
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
