import { outflowFrom, type SetAsideCheck } from '@expanses/core';
import type { AccountRow, RecordTradeInput, SetAsideChoice, SetAsideIntent } from '@expanses/db';
import type { FormDraft, FormPost } from '../transactions/tx-form';

/** Where money leaves, how much of it, what it is for, and which answers the question may offer. */
export interface Door {
  accountId: string;
  /** In the account's own currency. */
  outflowMinor: number;
  /** The goal the movement is for, whose own money on the account is its to use (spec §6.3). */
  ownGoalId: string | null;
  intents: readonly SetAsideIntent[];
  /** A move's destination. */
  toAccountId: string | null;
}

export interface SetAsideAnswer {
  goalId: string;
  intent: SetAsideIntent | null;
}

export const SPENDING: readonly SetAsideIntent[] = ['borrow', 'spend'];
export const MOVING: readonly SetAsideIntent[] = ['move', 'borrow'];
export const BORROW_ONLY: readonly SetAsideIntent[] = ['borrow'];

const open = (door: Door): Door | null => (door.accountId && door.outflowMinor > 0 ? door : null);

/** A door that pays something out and knows only its account and amount: bills, loans, people, statements, quick rows. */
export function spendingDoor(accountId: string, outflowMinor: number): Door | null {
  return open({ accountId, outflowMinor, ownGoalId: null, intents: SPENDING, toAccountId: null });
}

/**
 * A buy's door, for the transaction card and `TradeForm` alike (one rule, two callers). What leaves the cash account is
 * `cashMinor` when the form gave one and the cost otherwise — exactly what `cashLines` posts and what `writeTradeTx`
 * lowers the goal's cash promise by (spec §4.6). No currency comparison: a cross-currency buy without `cashMinor`
 * still pays the cost out of the cash account, and reading it as 0 would let it through unasked.
 */
export function tradeDoor(input: Pick<RecordTradeInput, 'kind' | 'cashAccountId' | 'cashMinor' | 'grossMinor' | 'feeMinor' | 'taxMinor' | 'goalId'>): Door | null {
  if (input.kind !== 'buy' || !input.cashAccountId) return null;
  return open({
    accountId: input.cashAccountId,
    outflowMinor: input.cashMinor ?? input.grossMinor + input.feeMinor + input.taxMinor,
    ownGoalId: input.goalId ?? null,
    intents: input.goalId ? BORROW_ONLY : SPENDING,
    toAccountId: null,
  });
}

/** The door the transaction card is, read off what `formToPost` will send — never off the typed figure a second way. */
export function doorOfForm(draft: FormDraft, post: FormPost, accounts: readonly AccountRow[], canHold: (accountId: string) => boolean): Door | null {
  const byId = (id: string) => accounts.find((account) => account.id === id);
  switch (post.kind) {
    case 'trade':
      return tradeDoor(post.input);
    case 'split':
      return spendingDoor(post.input.moneyAccountId, post.input.totalMinor);
    case 'transfer-goal':
      return open({
        accountId: post.input.fromAccountId,
        outflowMinor: post.input.amountMinor,
        ownGoalId: post.input.goalId && canHold(post.input.toAccountId) ? post.input.goalId : null,
        intents: BORROW_ONLY,
        toAccountId: post.input.toAccountId,
      });
    case 'post': {
      const outflowMinor = outflowFrom(post.input.lines, draft.moneyId);
      if (draft.mode !== 'transfer') return spendingDoor(draft.moneyId, outflowMinor);
      const to = byId(draft.toId);
      const moves = !!to && to.kind === 'asset' && canHold(to.id);
      return open({ accountId: draft.moneyId, outflowMinor, ownGoalId: null, intents: moves ? MOVING : SPENDING, toAccountId: moves ? to.id : null });
    }
  }
}

const intentOf = (answer: SetAsideAnswer, door: Door): SetAsideIntent | null => (door.intents.length === 1 ? door.intents[0]! : answer.intent);

export function readyOf(check: SetAsideCheck, answer: SetAsideAnswer | null, door: Door): boolean {
  if (check.kind !== 'ask') return true;
  return !!answer && intentOf(answer, door) !== null;
}

export function choiceOf(check: SetAsideCheck, answer: SetAsideAnswer | null, door: Door, whole?: { whole: boolean; since: string | null }): SetAsideChoice | null {
  if (check.kind !== 'ask' || !answer) return null;
  const intent = intentOf(answer, door);
  if (!intent) return null;
  const borrowing = intent === 'borrow' && whole?.whole === true;
  return {
    accountId: door.accountId,
    goalId: answer.goalId,
    intent,
    overMinor: check.overMinor,
    toAccountId: intent === 'move' ? door.toAccountId : null,
    wasWhole: borrowing,
    wholeSince: borrowing ? whole!.since : null,
  };
}
