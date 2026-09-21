import type { SetAsideCheck } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { emptyForm, type FormDraft, type FormPost } from '../transactions/tx-form';
import { BORROW_ONLY, choiceOf, doorOfForm, MOVING, postForDoor, readyOf, SPENDING, spendingDoor, tradeDoor } from './set-aside-question';

const account = (id: string, partial: Partial<AccountRow> = {}) => ({ id, name: id, kind: 'asset', subtype: 'savings', currency: 'IDR', ...partial }) as AccountRow;
const ACCOUNTS = [account('jenius'), account('bca', { subtype: 'bank' }), account('card', { kind: 'liability', subtype: 'credit_card' }), account('gold', { subtype: 'investment' }), account('usd', { currency: 'USD' })];
const holds = (id: string) => ['jenius', 'bca', 'usd'].includes(id);
const draft = (patch: Partial<FormDraft>): FormDraft => ({ ...emptyForm(''), ...patch });
const post = (lines: { accountId: string; amountMinor: number; currency: string }[]): FormPost => ({ kind: 'post', input: { occurredOn: '2026-09-19', description: 'x', lines } });

describe('doorOfForm', () => {
  it('reads an expense\'s outflow from the lines that will post', () => {
    const door = doorOfForm(draft({ mode: 'expense', moneyId: 'jenius' }), post([{ accountId: 'food', amountMinor: 6_800_000, currency: 'IDR' }, { accountId: 'jenius', amountMinor: -6_800_000, currency: 'IDR' }]), ACCOUNTS, holds);
    expect(door).toEqual({ accountId: 'jenius', outflowMinor: 6_800_000, ownGoalId: null, intents: SPENDING, toAccountId: null });
  });

  it('has no door for income', () => {
    expect(doorOfForm(draft({ mode: 'income', moneyId: 'jenius' }), post([{ accountId: 'jenius', amountMinor: 5_000, currency: 'IDR' }, { accountId: 'salary', amountMinor: -5_000, currency: 'IDR' }]), ACCOUNTS, holds)).toBeNull();
  });

  it('offers to move the promise on a transfer into an account that can hold one, and not into a card', () => {
    const lines = (to: string) => post([{ accountId: to, amountMinor: 20_000_000, currency: 'IDR' }, { accountId: 'jenius', amountMinor: -20_000_000, currency: 'IDR' }]);
    expect(doorOfForm(draft({ mode: 'transfer', moneyId: 'jenius', toId: 'bca' }), lines('bca'), ACCOUNTS, holds)).toMatchObject({ intents: MOVING, toAccountId: 'bca' });
    expect(doorOfForm(draft({ mode: 'transfer', moneyId: 'jenius', toId: 'card' }), lines('card'), ACCOUNTS, holds)).toMatchObject({ intents: SPENDING, toAccountId: null });
  });

  it('lets a tagged transfer use its own goal\'s money only where that money can go', () => {
    const tagged = (to: string): FormPost => ({ kind: 'transfer-goal', input: { occurredOn: '2026-09-19', description: 'x', amountMinor: 7_000_000, fromAccountId: 'jenius', toAccountId: to, goalId: 'umrah' } });
    expect(doorOfForm(draft({ mode: 'transfer' }), tagged('bca'), ACCOUNTS, holds)).toEqual({ accountId: 'jenius', outflowMinor: 7_000_000, ownGoalId: 'umrah', intents: BORROW_ONLY, toAccountId: 'bca' });
    expect(doorOfForm(draft({ mode: 'transfer' }), tagged('card'), ACCOUNTS, holds)).toMatchObject({ ownGoalId: null });
  });

  it('an edit of a tagged transfer is the tagged door again: the tag is kept, so its own goal\'s money is room', () => {
    const lines = (to: string) => post([{ accountId: to, amountMinor: 7_000_000, currency: 'IDR' }, { accountId: 'jenius', amountMinor: -7_000_000, currency: 'IDR' }]);
    const editing = (to: string) => draft({ mode: 'transfer', moneyId: 'jenius', toId: to, goalId: 'umrah', editing: true });
    expect(doorOfForm(editing('bca'), lines('bca'), ACCOUNTS, holds)).toEqual({ accountId: 'jenius', outflowMinor: 7_000_000, ownGoalId: 'umrah', intents: BORROW_ONLY, toAccountId: 'bca' });
    expect(doorOfForm(editing('card'), lines('card'), ACCOUNTS, holds)).toMatchObject({ ownGoalId: null, intents: BORROW_ONLY });
    // An untagged edit still offers the move.
    expect(doorOfForm({ ...editing('bca'), goalId: '' }, lines('bca'), ACCOUNTS, holds)).toMatchObject({ ownGoalId: null, intents: MOVING });
  });

  it('reads a cross-currency buy\'s outflow in the cash account\'s money', () => {
    const buy = (goalId: string | null): FormPost => ({ kind: 'trade', input: { accountId: 'usd', kind: 'buy', occurredOn: '2026-09-19', unitsMicro: 1, grossMinor: 10_000, feeMinor: 0, taxMinor: 0, cashAccountId: 'jenius', cashMinor: 1_600_000, goalId } });
    // 1.600.000 rupiah left Jenius, not 10.000 cents.
    expect(doorOfForm(draft({ mode: 'trade' }), buy(null), ACCOUNTS, holds)).toEqual({ accountId: 'jenius', outflowMinor: 1_600_000, ownGoalId: null, intents: SPENDING, toAccountId: null });
    expect(doorOfForm(draft({ mode: 'trade' }), buy('umrah'), ACCOUNTS, holds)).toMatchObject({ ownGoalId: 'umrah', intents: BORROW_ONLY });
    // No cashMinor: the cost left the cash account (what cashLines posts). Reading it as 0 would never ask.
    const noCash: FormPost = { kind: 'trade', input: { accountId: 'usd', kind: 'buy', occurredOn: '2026-09-19', unitsMicro: 1, grossMinor: 6_700_000, feeMinor: 67_000, taxMinor: 33_000, cashAccountId: 'jenius', goalId: null } };
    expect(doorOfForm(draft({ mode: 'trade' }), noCash, ACCOUNTS, holds)).toMatchObject({ outflowMinor: 6_800_000 });
    expect(tradeDoor({ kind: 'sell', cashAccountId: 'jenius', grossMinor: 1, feeMinor: 0, taxMinor: 0, goalId: null })).toBeNull();
  });

  it('reads a split\'s whole bill from the paying account', () => {
    const split: FormPost = { kind: 'split', input: { occurredOn: '2026-09-19', description: 'x', totalMinor: 6_800_000, moneyAccountId: 'jenius', ownCategoryId: 'food', ownShareMinor: 3_400_000, shares: [] } };
    expect(doorOfForm(draft({ mode: 'expense' }), split, ACCOUNTS, holds)).toMatchObject({ outflowMinor: 6_800_000 });
  });
});

describe('choiceOf and readyOf', () => {
  const ask: SetAsideCheck = { kind: 'ask', overMinor: 1_800_000, freeMinor: 5_000_000, goals: [{ goalId: 'ef', name: 'Emergency fund', rank: 0, promisedMinor: 30_000_000, coveredMinor: 30_000_000, shortMinor: 0, borrowedShortMinor: 0 }] };
  const door = spendingDoor('jenius', 6_800_000)!;

  it('is ready when silent, and not until both questions are answered when asking', () => {
    expect(readyOf({ kind: 'silent' }, null, door)).toBe(true);
    expect(readyOf({ kind: 'already-short', shortMinor: 1 }, null, door)).toBe(true);
    expect(readyOf(ask, null, door)).toBe(false);
    expect(readyOf(ask, { goalId: 'ef', intent: null }, door)).toBe(false);
    expect(readyOf(ask, { goalId: 'ef', intent: 'borrow' }, door)).toBe(true);
    expect(readyOf(ask, { goalId: 'ef', intent: null }, { ...door, intents: BORROW_ONLY })).toBe(true);
  });

  it('carries the overage and the snapshot on a borrow, and nothing on silence', () => {
    expect(choiceOf({ kind: 'silent' }, null, door)).toBeNull();
    expect(choiceOf(ask, { goalId: 'ef', intent: 'borrow' }, door, { whole: true, since: '2026-08-03' })).toEqual({
      accountId: 'jenius', goalId: 'ef', intent: 'borrow', overMinor: 1_800_000, toAccountId: null, wasWhole: true, wholeSince: '2026-08-03',
    });
    expect(choiceOf(ask, { goalId: 'ef', intent: 'spend' }, door, { whole: true, since: '2026-08-03' })).toMatchObject({ intent: 'spend', wasWhole: false, wholeSince: null });
    expect(choiceOf(ask, { goalId: 'ef', intent: null }, { ...door, intents: BORROW_ONLY })).toMatchObject({ intent: 'borrow' });
    expect(choiceOf(ask, { goalId: 'ef', intent: 'move' }, { ...door, intents: MOVING, toAccountId: 'bca' })).toMatchObject({ intent: 'move', toAccountId: 'bca' });
  });
});

describe('an answer the door no longer offers', () => {
  const ask: SetAsideCheck = { kind: 'ask', overMinor: 1_800_000, freeMinor: 5_000_000, goals: [{ goalId: 'ef', name: 'Emergency fund', rank: 0, promisedMinor: 30_000_000, coveredMinor: 30_000_000, shortMinor: 0, borrowedShortMinor: 0 }] };

  it('a move picked before the money was sent to a card is not an answer: Save waits instead of throwing', () => {
    const toCard = spendingDoor('jenius', 6_800_000)!;
    expect(readyOf(ask, { goalId: 'ef', intent: 'move' }, toCard)).toBe(false);
    expect(choiceOf(ask, { goalId: 'ef', intent: 'move' }, toCard)).toBeNull();
  });

  it('nor is a goal the question no longer lists', () => {
    const door = spendingDoor('jenius', 6_800_000)!;
    expect(readyOf(ask, { goalId: 'umrah', intent: 'borrow' }, door)).toBe(false);
    expect(choiceOf(ask, { goalId: 'umrah', intent: 'borrow' }, door)).toBeNull();
    expect(readyOf(ask, { goalId: 'umrah', intent: null }, { ...door, intents: BORROW_ONLY })).toBe(false);
  });
});

describe('postForDoor', () => {
  it('reads the outflow before a category is chosen: the question comes while the amount is typed', () => {
    const typed = draft({ mode: 'expense', moneyId: 'jenius', amount: '6800001' });
    const read = postForDoor(typed, ACCOUNTS);
    expect(read).not.toBeNull();
    expect(doorOfForm(typed, read!, ACCOUNTS, holds)).toMatchObject({ accountId: 'jenius', outflowMinor: 6_800_001 });
  });

  it('reads a split\'s rows with a row still missing its category', () => {
    const typed = draft({ mode: 'expense', moneyId: 'jenius', splits: [{ categoryId: '', amount: '4000000' }, { categoryId: 'food', amount: '2800001' }] as FormDraft['splits'] });
    expect(doorOfForm(typed, postForDoor(typed, ACCOUNTS)!, ACCOUNTS, holds)).toMatchObject({ outflowMinor: 6_800_001 });
  });

  it('has no door while the figure or the account is missing', () => {
    expect(postForDoor(draft({ mode: 'expense', moneyId: 'jenius', amount: '' }), ACCOUNTS)).toBeNull();
    expect(postForDoor(draft({ mode: 'expense', moneyId: '', amount: '5000' }), ACCOUNTS)).toBeNull();
  });
});
