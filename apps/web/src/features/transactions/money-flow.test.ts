import type { TransactionEntryView, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { compactMinor, moneyFlow, OTHERS_KEY, SAVED_KEY } from './money-flow';

type Line = [accountId: string, kind: TransactionEntryView['accountKind'], amountMinor: number, subtype?: string];

/** A posted transaction on the day given, its lines named by their account ids. */
function tx(id: string, occurredOn: string, lines: readonly Line[], extra: Partial<TransactionView> = {}): TransactionView {
  return {
    id,
    occurredOn,
    description: id,
    source: 'manual',
    status: 'posted',
    externalRef: null,
    originalCurrency: null,
    originalAmountMinor: null,
    mcc: null,
    cardId: null,
    goalId: null,
    createdAt: `${occurredOn}T00:00:00Z`,
    entries: lines.map(([accountId, accountKind, amountMinor, accountSubtype], index) => ({
      id: `${id}-${index}`,
      accountId,
      accountName: accountId,
      accountKind,
      accountSubtype,
      amountMinor,
      currency: 'IDR',
      fxRateToBase: 1,
      amountBaseMinor: amountMinor,
      memo: null,
      spendCategoryId: null,
    })),
    ...extra,
  };
}

const salary = tx('salary', '2026-09-01', [['bca', 'asset', 12_000_000, 'bank'], ['Salary', 'income', -12_000_000]]);
const groceriesBca = tx('superindo', '2026-09-03', [['Groceries', 'expense', 900_000], ['bca', 'asset', -900_000, 'bank']]);
const groceriesCard = tx('ranch', '2026-09-10', [['Groceries', 'expense', 600_000], ['card', 'liability', -600_000, 'credit_card']]);
const topUp = tx('topup', '2026-09-05', [['gopay', 'asset', 500_000, 'ewallet'], ['bca', 'asset', -500_000, 'bank']]);
const link = (flow: ReturnType<typeof moneyFlow>, source: string, target: string) => flow.links.find((l) => l.source === source && l.target === target)?.amountMinor;

describe('moneyFlow', () => {
  it('draws salary into the bank, spending out of the bank and the card, and what was kept — never the top-up', () => {
    const flow = moneyFlow([salary, groceriesBca, groceriesCard, topUp], '2026-09', { topCategories: 5 });
    expect(flow.sources).toEqual([{ key: 'Salary', name: 'Salary', amountMinor: 12_000_000 }]);
    // The bank ran 12m in, 900k out to groceries and the rest to Saved; the card only ever paid. GoPay saw a transfer alone.
    expect(flow.accounts).toEqual([
      { key: 'bca', name: 'bca', amountMinor: 12_000_000, card: false },
      { key: 'card', name: 'card', amountMinor: 600_000, card: true },
    ]);
    expect(flow.targets).toEqual([
      { key: 'Groceries', name: 'Groceries', amountMinor: 1_500_000 },
      { key: SAVED_KEY, name: 'Saved', amountMinor: 10_500_000 },
    ]);
    expect(link(flow, 'Salary', 'bca')).toBe(12_000_000);
    expect(link(flow, 'bca', 'Groceries')).toBe(900_000);
    expect(link(flow, 'card', 'Groceries')).toBe(600_000);
    // Saved is the month's income less its spending, drawn out of the one account that ended ahead.
    expect(link(flow, 'bca', SAVED_KEY)).toBe(10_500_000);
    expect(flow.links).toHaveLength(4);
    expect(flow).toMatchObject({ incomeMinor: 12_000_000, spentMinor: 1_500_000 });
  });

  it('is empty for a month with nothing in it, and has no Saved bar', () => {
    const flow = moneyFlow([salary, groceriesBca], '2026-10', { topCategories: 5 });
    expect(flow).toEqual({ sources: [], accounts: [], targets: [], links: [], incomeMinor: 0, spentMinor: 0 });
  });

  it('folds the tail of the spending into Others, and their bands with it', () => {
    const rows = ['Rent', 'Groceries', 'Transport', 'Eating out', 'Phone'].map((name, index) =>
      tx(name, '2026-09-02', [[name, 'expense', (5 - index) * 100_000], ['bca', 'asset', -(5 - index) * 100_000, 'bank']]),
    );
    const flow = moneyFlow(rows, '2026-09', { topCategories: 3 });
    expect(flow.targets.map((node) => [node.key, node.amountMinor])).toEqual([['Rent', 500_000], ['Groceries', 400_000], ['Transport', 300_000], [OTHERS_KEY, 300_000]]);
    expect(link(flow, 'bca', OTHERS_KEY)).toBe(300_000);
    expect(flow.links).toHaveLength(4);
    // One category past the limit would be an Others of one, so it stands as itself instead.
    expect(moneyFlow(rows, '2026-09', { topCategories: 4 }).targets.map((node) => node.key)).toEqual(['Rent', 'Groceries', 'Transport', 'Eating out', 'Phone']);
    // Nothing is folded with no spending at all to spare, and nothing is saved when there was no income.
    expect(flow.targets.some((node) => node.key === SAVED_KEY)).toBe(false);
  });

  it('takes a refund off its category and its band', () => {
    const refund = tx('refund', '2026-09-12', [['Groceries', 'expense', -200_000], ['bca', 'asset', 200_000, 'bank']]);
    const flow = moneyFlow([salary, groceriesBca, refund], '2026-09', { topCategories: 5 });
    expect(flow.targets).toEqual([
      { key: 'Groceries', name: 'Groceries', amountMinor: 700_000 },
      { key: SAVED_KEY, name: 'Saved', amountMinor: 11_300_000 },
    ]);
    expect(link(flow, 'bca', 'Groceries')).toBe(700_000);
    expect(flow.spentMinor).toBe(700_000);
  });

  it('draws a child category under its top-level parent, and keeps a transfer’s fee as spending', () => {
    const child = tx('cinema', '2026-09-08', [['Cinema', 'expense', 150_000], ['card', 'liability', -150_000, 'credit_card']]);
    const feed = tx('topup-fee', '2026-09-09', [['gopay', 'asset', 500_000, 'ewallet'], ['card', 'liability', -510_000, 'credit_card'], ['Fees', 'expense', 10_000]]);
    const flow = moneyFlow([child, feed], '2026-09', { topCategories: 5, roots: { Cinema: { id: 'Leisure', name: 'Leisure' } } });
    expect(flow.targets).toEqual([
      { key: 'Leisure', name: 'Leisure', amountMinor: 150_000 },
      { key: 'Fees', name: 'Fees', amountMinor: 10_000 },
    ]);
    expect(link(flow, 'card', 'Leisure')).toBe(150_000);
    expect(link(flow, 'card', 'Fees')).toBe(10_000);
    expect(flow.accounts.map((node) => node.key)).toEqual(['card']);
  });

  it('writes a figure short enough to sit beside a bar, in the currency’s own units', () => {
    expect(compactMinor(12_000_000, 'IDR')).toBe('12M');
    expect(compactMinor(900_000, 'IDR')).toBe('900K');
    expect(compactMinor(45_000, 'IDR')).toBe('45K');
    expect(compactMinor(123_456, 'USD')).toBe('1.2K');
  });

  it('leaves out what is void or excluded, and what fell outside the period', () => {
    const gone = tx('void', '2026-09-04', [['Groceries', 'expense', 1_000_000], ['bca', 'asset', -1_000_000, 'bank']], { status: 'void' });
    const aside = tx('aside', '2026-09-04', [['Groceries', 'expense', 1_000_000], ['bca', 'asset', -1_000_000, 'bank']], { excluded: true });
    const later = tx('later', '2026-10-01', [['Groceries', 'expense', 1_000_000], ['bca', 'asset', -1_000_000, 'bank']]);
    const flow = moneyFlow([groceriesBca, gone, aside, later], '2026-09', { topCategories: 5 });
    expect(flow.spentMinor).toBe(900_000);
    // A week is a period too.
    expect(moneyFlow([groceriesBca, later], '2026-09-01..2026-09-07', { topCategories: 5 }).spentMinor).toBe(900_000);
  });
});
