import type { AccountRow, CardRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { heroCaption, receiptLines } from './receipt-view';

/**
 * `formatMinor` puts a no-break space between a currency symbol and its digits — "Rp 400.000" — and every
 * screen in this app renders that, so a receipt must too. The brief's expected strings were written as
 * "Rp400.000"; they are normalised here rather than the formatter being changed, because a receipt printing
 * money one way while the list beside it prints it another is a second style, not a fix.
 * `packages/core/test/assets-units.test.ts` already normalises the same way.
 */
const said = (lines: { label: string; value: string }[]) => lines.map((line) => [line.label, line.value.replace(/ /g, ' ')]);
const valueOf = (lines: { label: string; value: string }[], label: string) => lines.find((line) => line.label === label)!.value.replace(/ /g, ' ');

const card: CardRow = { id: 'card-1', accountId: 'acct-card', last4: '1467', holderName: null, isPrimary: true };
const accounts = [
  { id: 'acct-card', name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
] as AccountRow[];

/** A dinner on the card: 400.000 charged, 100.000 of it the owner's own share. */
const dinner = (over: Partial<TransactionView> = {}): TransactionView =>
  ({
    id: 'tx-1',
    occurredOn: '2026-09-17',
    description: 'Dinner at Plataran',
    status: 'posted',
    cardId: 'card-1',
    entries: [
      { accountId: 'acct-card', accountKind: 'liability', amountMinor: -400_000, amountBaseMinor: -400_000, currency: 'IDR' },
      { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 100_000, amountBaseMinor: 100_000, currency: 'IDR' },
    ],
    ...over,
  }) as TransactionView;

describe('what a receipt says', () => {
  it('says what was paid with, what it came to, and who owes what', () => {
    const lines = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: { points: 1200, unit: 'KrisFlyer miles', approximate: false },
      owed: [
        { personName: 'Andi', totalMinor: 100_000 },
        { personName: 'Putri', totalMinor: 100_000 },
        { personName: 'Chika', totalMinor: 100_000 },
      ],
    });
    expect(said(lines)).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp 400.000'],
      ['Points earned', '1.200 KrisFlyer miles'],
      ['Andi, Putri and Chika owe you', 'Rp 300.000'],
      ['Your share', 'Rp 100.000'],
    ]);
    expect(lines.find((line) => line.label === 'Points earned')!.tone).toBe('points');
  });

  it('leaves out a line it has nothing to say about', () => {
    const lines = receiptLines({ tx: dinner(), accounts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(lines.map((line) => line.label)).toEqual(['Paid with', 'Total']);
    // No points, nobody owing, no event, no channel, no foreign currency, no bill month: two lines, not nine empties.
    expect(lines.some((line) => line.value === '' || line.value === '—')).toBe(false);
  });

  it('says an excluded purchase is still on the card', () => {
    const lines = receiptLines({
      tx: dinner({ excluded: true, channel: 'offline', eventId: 'ev-1' }),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [],
      eventName: 'Bali holiday',
    });
    expect(said(lines)).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp 400.000'],
      ['Event', 'Bali holiday'],
      ['Channel', 'Offline'],
    ]);
    // Excluded is not one of these lines: it is the sentence under the date, and Total is the whole 400.000
    // whatever the chart does with it, because the card really was charged that.
    expect(lines.some((line) => line.label === 'Excluded')).toBe(false);
  });
});

/*
 * The three above are the brief's, and there are figures they cannot tell apart.
 *
 * Three equal shares of 100.000 summing to 300.000 would pass just as well if the owed total were one share
 * times the head count. 1.200 points does not exercise the thousands grouping, the `≈` branch or a refund's
 * minus. And nothing above has a second money account, a foreign price, or a bill month. Those are here.
 */
describe('the figures a receipt has to get right', () => {
  it('adds up what a split really owes, rather than counting heads', () => {
    const lines = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      // Uneven on purpose: equal shares cannot tell a sum from a multiplication.
      owed: [
        { personName: 'Andi', totalMinor: 175_000 },
        { personName: 'Putri', totalMinor: 125_000 },
      ],
    });
    expect(valueOf(lines, 'Andi and Putri owe you')).toBe('Rp 300.000');
  });

  it('says one person owes, not owe', () => {
    const lines = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [{ personName: 'Andi', totalMinor: 300_000 }],
    });
    expect(lines.map((line) => line.label)).toContain('Andi owes you');
  });

  it('takes the total from what the card was charged, not from the share that was kept', () => {
    // The two differ by 300.000 here, so a Total read off the expense entry would say Rp 100.000.
    const lines = receiptLines({ tx: dinner(), accounts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(lines, 'Total')).toBe('Rp 400.000');
  });

  it('marks an estimate with ≈ and a refund with a minus, the way the list already does', () => {
    const approximate = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      // 20.000 rather than 1.200: the grouped thousand is part of what is being checked.
      points: { points: 20_000, unit: 'KrisFlyer miles', approximate: true },
      owed: [],
    });
    expect(valueOf(approximate, 'Points earned')).toBe('≈ 20.000 KrisFlyer miles');

    const refund = receiptLines({
      tx: dinner(),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: { points: -1200, unit: 'KrisFlyer miles', approximate: false },
      owed: [],
    });
    expect(valueOf(refund, 'Points earned')).toBe('−1.200 KrisFlyer miles');
  });

  it('names the other side of a transfer, and the month a bill payment settles', () => {
    const transfer = receiptLines({
      tx: dinner({
        occurredOn: '2026-10-03',
        billMonth: '2026-09',
        entries: [
          { accountId: 'acct-bank', accountKind: 'asset', amountMinor: -400_000, amountBaseMinor: -400_000, currency: 'IDR' },
          { accountId: 'acct-card', accountKind: 'liability', amountMinor: 400_000, amountBaseMinor: 400_000, currency: 'IDR' },
        ],
      } as Partial<TransactionView>),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [],
    });
    expect(said(transfer)).toEqual([
      ['Paid with', 'BCA Tahapan'],
      ['Into', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp 400.000'],
      ['Bill month', 'September 2026'],
    ]);
  });

  it('says money arrived rather than that it was paid with', () => {
    const salary = receiptLines({
      tx: dinner({
        cardId: null,
        entries: [
          { accountId: 'acct-bank', accountKind: 'asset', amountMinor: 12_000_000, amountBaseMinor: 12_000_000, currency: 'IDR' },
          { accountId: 'cat-salary', accountKind: 'income', amountMinor: -12_000_000, amountBaseMinor: -12_000_000, currency: 'IDR' },
        ],
      } as Partial<TransactionView>),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [],
    });
    expect(said(salary)).toEqual([
      ['Paid into', 'BCA Tahapan'],
      ['Total', 'Rp 12.000.000'],
    ]);
  });

  it('shows what the merchant charged in its own currency, beside what the card was billed', () => {
    const abroad = receiptLines({
      tx: dinner({ originalCurrency: 'SGD', originalAmountMinor: 3550 }),
      accounts,
      cards: [card],
      currency: 'IDR',
      points: null,
      owed: [],
    });
    // Two decimals for SGD, none for IDR: the exponent comes from the currency, never from the workspace.
    expect(said(abroad)).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Total', 'Rp 400.000'],
      ['Original amount', 'SGD 35,50'],
    ]);
  });

  it('lends no other card its digits', () => {
    // The supplementary was used; the primary's 1467 must not appear on it.
    const supplementary: CardRow = { id: 'card-2', accountId: 'acct-card', last4: '9021', holderName: 'Putri', isPrimary: false };
    const lines = receiptLines({ tx: dinner({ cardId: 'card-2' }), accounts, cards: [card, supplementary], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(lines, 'Paid with')).toBe('BCA KrisFlyer ···· 9021');
  });

  it('names the goal a transfer funds, because the list already does', () => {
    const lines = receiptLines({ tx: dinner(), accounts, cards: [card], currency: 'IDR', points: null, owed: [], goalName: 'Umrah' });
    expect(valueOf(lines, 'For goal')).toBe('Umrah');
  });
});

/**
 * The two figures a split bill puts one above the other.
 *
 * The hero is what the transaction cost the owner — the expense side, 100.000 of the dinner — and it matches
 * the list row the receipt was opened from. The `Total` line under it is what the card was charged, 400.000.
 * On the screen that was Rp 100.000 in 3xl type with Rp 400.000 directly beneath it and not a word between
 * them, which reads as a mistake rather than as two true facts.
 */
describe('the word between a share and a bill', () => {
  it('says which figure the big one is, when the bill and the share of it differ', () => {
    // Exactly what `ReceiptPage` passes: `classify(tx).amountMinor`, the expense side of the split.
    expect(heroCaption(dinner(), 100_000)).toBe('Your share');
  });

  it('says nothing on an ordinary purchase, where there is only one figure to read', () => {
    const whole = dinner({
      entries: [
        { accountId: 'acct-card', accountKind: 'liability', amountMinor: -400_000, amountBaseMinor: -400_000, currency: 'IDR' },
        { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 400_000, amountBaseMinor: 400_000, currency: 'IDR' },
      ],
    } as Partial<TransactionView>);
    expect(heroCaption(whole, 400_000)).toBeNull();
  });

  it('says nothing about a transaction with no money entry to compare against', () => {
    const noMoney = dinner({ entries: [{ accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 100_000, amountBaseMinor: 100_000, currency: 'IDR' }] } as Partial<TransactionView>);
    expect(heroCaption(noMoney, 100_000)).toBeNull();
  });
});
