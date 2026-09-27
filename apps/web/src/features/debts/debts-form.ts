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
  /** A fee on the money moved — a card's cash-advance charge, a bank's transfer fee. Your cost; '' for none. */
  fee: string;
  /** Where the fee is filed as spending; Fees & charges until chosen otherwise. */
  feeCategoryId: string;
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
  fee: '',
  feeCategoryId: '',
});

/**
 * The accounts money lent can come from, or money borrowed can arrive in.
 *
 * Money you hold, and — for a loan you make — a credit card, which is how paying for a friend on your card is
 * recorded: the card owes more, the friend owes you, the purchase still earns points. A card never takes borrowed
 * money in. **Other cash equivalents** — a cheque, a wesel, commercial paper — are left out both ways: a cheque you
 * are handed is recorded where it is deposited, and one you hold is not something you pay a person with.
 */
export function loanMoneyAccounts<T extends { kind: string; subtype: string }>(money: readonly T[], direction: DebtDirection): T[] {
  return money.filter(
    (account) =>
      account.subtype !== 'other_cash' &&
      ((account.kind === 'asset' && account.subtype !== 'credit_card') || (direction === 'lent' && account.subtype === 'credit_card')),
  );
}

/**
 * A draft for one side, which the screen it is opened on decides: New receivable is money you lent, New payable money
 * you borrowed. The sub-category belongs to the side, so a piutang code never stands over money you owe. A person
 * named on the way in (Lend & borrow filtered to one person) arrives already typed.
 */
export const debtDraftFor = (direction: DebtDirection, today: string, personName = ''): DebtDraft => ({
  ...emptyDebtDraft(today),
  direction,
  // Chosen, never assumed: what a loan files as in a tax report is the reader's call, so the row starts blank.
  subCategory: '',
  personName,
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
  // A new loan files as something; money added to an existing loan keeps what that loan already files as.
  if (!draft.existingAccountId && !draft.subCategory) throw new Error('Choose a sub category');

  if (draft.amount.trim() === '') throw new Error('Enter how much');
  let amountMinor: number;
  try {
    amountMinor = parseMajor(draft.amount, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (!(amountMinor > 0)) throw new Error('Enter how much');

  let feeMinor = 0;
  if (draft.fee.trim() !== '') {
    try {
      feeMinor = parseMajor(draft.fee, currency);
    } catch {
      throw new Error('The fee must be a number');
    }
    if (feeMinor < 0) throw new Error('A fee cannot be negative');
    if (feeMinor > 0 && !draft.feeCategoryId) throw new Error('Choose a category for the fee');
    if (draft.direction === 'borrowed' && feeMinor >= amountMinor) throw new Error('The fee cannot be all of what you borrowed');
  }

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
    ...(feeMinor > 0 ? { feeMinor, feeCategoryId: draft.feeCategoryId } : {}),
  };
}

/** One of a person's open loans, offered as a chip under What it is for. */
export interface LoanChoice {
  accountId: string;
  /** What the loan is for, as written; empty when none was noted. */
  reason: string;
  /** "Motorcycle repair · Rp 1.500.000 left" — the reason, or that none was noted, and what is still owed. */
  label: string;
}

/**
 * The loans already open with this person on this side, which a new amount could be added to.
 *
 * A person can hold several loans — the motorcycle repair and the laptop are two, each with its own reason and due
 * date, listed apart on their card — so a name the workspace already knows is not one loan to add to but a choice
 * between them and a new one. Only open loans are offered: one that was settled or forgiven is finished, and money
 * lent again is a new loan. Matched on the name without regard to capitals, as the Person field is.
 */
export function openLoansWith(people: PeopleDebts | undefined, direction: DebtDirection, personName: string): LoanChoice[] {
  const name = personName.trim().toLowerCase();
  if (!people || !name) return [];
  const side = direction === 'lent' ? people.owedToYou : people.youOwe;
  return side
    .filter((person) => person.personName.trim().toLowerCase() === name)
    .flatMap((person) => person.loans)
    .filter((loan) => loan.status === 'open')
    .map((loan) => ({
      accountId: loan.accountId,
      reason: loan.reason?.trim() ?? '',
      label: `${loan.reason?.trim() || 'No reason noted'} · ${formatMinor(loan.balanceMinor, loan.currency)} left`,
    }));
}

/**
 * The open loan a typed purpose names, as a typed name names a person: the same words (ignoring capitals and spaces
 * at the ends) as one of theirs means more money on that loan. Anything else, or nothing, is a new loan.
 */
export function loanNamed(loans: LoanChoice[], typed: string): string {
  const words = typed.trim().toLowerCase();
  if (!words) return '';
  return loans.find((loan) => loan.reason.toLowerCase() === words)?.accountId ?? '';
}

/**
 * Whether anything behind "Add more details" is already filled in: a due date or a tax ID. The details open by
 * themselves when it is, so nothing typed is ever out of sight.
 */
export function debtDetailsFilled(draft: DebtDraft): boolean {
  return (
    draft.dueOn !== '' ||
    draft.personIdNumber.trim() !== ''
  );
}

/**
 * Whether the ✓ can save: everything `debtDraftToInput` requires is there — a person, a date that is not in the
 * future, an account, an amount above zero, and a category for any fee. Asked of the very function Save calls, so the
 * ✓ can never light up for a draft Save would refuse, nor stay dim for one it would take.
 */
export function debtDraftReady(draft: DebtDraft, currency: string, today: string): boolean {
  try {
    debtDraftToInput(draft, currency, today);
    return true;
  } catch {
    return false;
  }
}

/**
 * What leaves the account when money is lent: the loan and its fee. The set-aside question weighs this, not the loan
 * alone — a Rp 100.000 fee is Rp 100.000 more taken from what is free.
 */
export function lentOutflowMinor(draft: DebtDraft, currency: string, today: string): number {
  if (draft.direction !== 'lent') return 0;
  try {
    const input = debtDraftToInput(draft, currency, today);
    return input.amountMinor + (input.feeMinor ?? 0);
  } catch {
    return 0;
  }
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
