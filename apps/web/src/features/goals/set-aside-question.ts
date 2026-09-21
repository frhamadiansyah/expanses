import { outflowFrom, type SetAsideCheck, spreadOver } from '@expanses/core';
import type { AccountRow, RecordTradeInput, SetAsideChoice, SetAsideIntent } from '@expanses/db';
import { type FormDraft, type FormPost, formToPost } from '../transactions/tx-form';

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

/** Stands in for a category not chosen yet. Never posted: only the money side of the lines is read. */
const NO_CATEGORY_YET = '\u0000category-not-chosen';

/**
 * What Save would send, as far as the door needs it — read by `formToPost` itself, never a second way. The question
 * has to come while the amount is typed, and the category is often picked after it: a draft missing only its
 * category is read with a stand-in, which moves no money and changes no figure on the paying account. Anything else
 * still missing (the figure, the account, a transfer's To) leaves no door yet.
 */
export function postForDoor(draft: FormDraft, accounts: readonly AccountRow[]): FormPost | null {
  const read = (candidate: FormDraft) => {
    try {
      return formToPost(candidate, accounts);
    } catch {
      return null;
    }
  };
  return (
    read(draft) ??
    read({
      ...draft,
      categoryId: draft.categoryId || NO_CATEGORY_YET,
      splits: draft.splits.map((row) => ({ ...row, categoryId: row.categoryId || NO_CATEGORY_YET })),
    })
  );
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
      // An edit of a tagged transfer posts plainly and keeps its tag (replaceTransaction): it is the tagged door again.
      const tagged = draft.editing && !!draft.goalId;
      return open({
        accountId: draft.moneyId,
        outflowMinor,
        ownGoalId: tagged && moves ? draft.goalId : null,
        intents: tagged ? BORROW_ONLY : moves ? MOVING : SPENDING,
        toAccountId: moves ? to.id : null,
      });
    }
  }
}

/**
 * The answer's intent, only while the door still offers it: picking "Move the promise to BCA" and then sending the money
 * to the card leaves a move the door no longer has, and Save would throw. Such an answer is no answer, and neither is
 * one naming a goal the question no longer lists.
 */
const intentOf = (check: Extract<SetAsideCheck, { kind: 'ask' }>, answer: SetAsideAnswer, door: Door): SetAsideIntent | null => {
  if (!check.goals.some((goal) => goal.goalId === answer.goalId)) return null;
  if (door.intents.length === 1) return door.intents[0]!;
  return answer.intent && door.intents.includes(answer.intent) ? answer.intent : null;
};

export function readyOf(check: SetAsideCheck, answer: SetAsideAnswer | null, door: Door): boolean {
  if (check.kind !== 'ask') return true;
  return !!answer && intentOf(check, answer, door) !== null;
}

export function choiceOf(check: SetAsideCheck, answer: SetAsideAnswer | null, door: Door, whole?: { whole: boolean; since: string | null }): SetAsideChoice | null {
  if (check.kind !== 'ask' || !answer) return null;
  const intent = intentOf(check, answer, door);
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

/**
 * What each payment from one account carries when several are paid together under one answer (Pay several), so the
 * answer does to the goal what it does to one payment of the same total (ruling M5).
 *
 * A borrow is what went over the free money, spread across the payments in order (`spreadOver`): one that still fit
 * carries nothing. A spend is the whole payment up to what the goal promised (Q2): every payment carries it until the
 * promise is used up, and only the first pays a stage (`stageId: null` after it) — one payment, one stage.
 */
export function payerChoices(
  choice: SetAsideChoice | null,
  amounts: readonly number[],
  freeMinor: number | null,
  promisedMinor: number,
): (SetAsideChoice | null)[] {
  if (!choice) return amounts.map(() => null);
  if (choice.intent === 'spend') {
    let left = promisedMinor;
    let first = true;
    return amounts.map((amount) => {
      if (!(amount > 0) || left <= 0) return null;
      left -= amount;
      const carried: SetAsideChoice = first ? { ...choice, overMinor: amount } : { ...choice, overMinor: amount, stageId: null };
      first = false;
      return carried;
    });
  }
  const overs = freeMinor === null ? amounts.map(() => 0) : spreadOver(amounts, freeMinor);
  return overs.map((over) => (over > 0 ? { ...choice, overMinor: over } : null));
}
