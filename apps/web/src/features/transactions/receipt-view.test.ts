import type { AccountRow, CardRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { heroCaption, receiptLines, splitParts } from './receipt-view';

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
      ['Owed by Andi, Putri and Chika', 'Rp 300.000'],
      ['My share', 'Rp 100.000'],
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
    expect(valueOf(lines, 'Owed by Andi and Putri')).toBe('Rp 300.000');
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
    expect(lines.map((line) => line.label)).toContain('Owed by Andi');
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

  it('names a card since removed by its digits, and says it was removed', () => {
    const removed: CardRow = { ...card, archived: true };
    const lines = receiptLines({ tx: dinner(), accounts, cards: [removed], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(lines, 'Paid with')).toBe('BCA KrisFlyer ···· 1467 · removed card');
    // A card still in use, read from the same list, says nothing of the kind.
    const kept = receiptLines({ tx: dinner(), accounts, cards: [{ ...card, archived: false }], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(kept, 'Paid with')).toBe('BCA KrisFlyer ···· 1467');
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
describe('a purchase in a shared workspace (household sharing spec §11)', () => {
  /** Paid by the other member: posted here against their placeholder, which no receipt names. */
  const theirs = (): TransactionView =>
    ({
      id: 'tx-2',
      occurredOn: '2026-09-18',
      description: 'Groceries',
      status: 'posted',
      cardId: null,
      entries: [
        { accountId: 'placeholder-dewi', accountKind: 'asset', amountMinor: -250_000, amountBaseMinor: -250_000, currency: 'IDR' },
        { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 250_000, amountBaseMinor: 250_000, currency: 'IDR' },
      ],
    }) as TransactionView;

  it('says what the payer paid with, as their device named it, and who paid', () => {
    const lines = receiptLines({
      tx: theirs(),
      accounts,
      cards: [],
      currency: 'IDR',
      points: null,
      owed: [],
      payer: { paidBy: 'm-dewi', paidLabel: 'Mandiri Visa ···· 9001', payerName: 'Dewi', mine: false, paidFrom: null },
    });
    expect(said(lines)).toEqual([
      ['Paid with', 'Mandiri Visa ···· 9001'],
      ['Paid by', 'Dewi'],
      ['Total', 'Rp 250.000'],
    ]);
  });

  it('says You on your own purchase, with the label your device gave it', () => {
    const lines = receiptLines({ tx: dinner(), accounts, cards: [card], currency: 'IDR', points: null, owed: [], payer: { paidBy: 'm-me', paidLabel: 'BCA KrisFlyer ···· 1467', payerName: 'Fandri', mine: true, paidFrom: null } });
    expect(said(lines).slice(0, 2)).toEqual([
      ['Paid with', 'BCA KrisFlyer ···· 1467'],
      ['Paid by', 'Me'],
    ]);
  });
});

describe('the word between a share and a bill', () => {
  it('says which figure the big one is, when the bill and the share of it differ', () => {
    // Exactly what `ReceiptPage` passes: `classify(tx).amountMinor`, the expense side of the split.
    expect(heroCaption(dinner(), 100_000)).toBe('My share');
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

  it('says nothing on a transfer between two currencies: what landed and what left are one move, not a share', () => {
    // An ATM abroad: Rp 1.450.000 out of the rupiah wallet, TRY 2.500,00 into the lira one, the spread on Currency Exchange.
    const atm = dinner({
      description: 'Bank Contoh ATM',
      cardId: null,
      entries: [
        { accountId: 'acct-idr', accountKind: 'asset', accountSubtype: 'cash', amountMinor: -1_450_000, amountBaseMinor: -1_450_000, currency: 'IDR' },
        { accountId: 'acct-fx', accountKind: 'equity', accountSystemKey: 'currency_exchange', amountMinor: 1_450_000, amountBaseMinor: 1_450_000, currency: 'IDR' },
        { accountId: 'acct-try', accountKind: 'asset', accountSubtype: 'cash', amountMinor: 250_000, amountBaseMinor: 1_400_000, currency: 'TRY' },
        { accountId: 'acct-fx', accountKind: 'equity', accountSystemKey: 'currency_exchange', amountMinor: -250_000, amountBaseMinor: -1_400_000, currency: 'TRY' },
      ],
    } as unknown as Partial<TransactionView>);
    // The hero is the lira that landed, as `ReceiptPage` passes it.
    expect(heroCaption(atm, 250_000)).toBeNull();
  });

  it('says nothing on a transfer with its fee beside it', () => {
    const topUp = dinner({
      cardId: null,
      entries: [
        { accountId: 'acct-bank', accountKind: 'asset', accountSubtype: 'bank', amountMinor: -506_500, amountBaseMinor: -506_500, currency: 'IDR' },
        { accountId: 'acct-wallet', accountKind: 'asset', accountSubtype: 'cash', amountMinor: 500_000, amountBaseMinor: 500_000, currency: 'IDR' },
        { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 6_500, amountBaseMinor: 6_500, currency: 'IDR' },
      ],
    } as unknown as Partial<TransactionView>);
    expect(heroCaption(topUp, 500_000)).toBeNull();
  });

  it('says nothing about a transaction with no money entry to compare against', () => {
    const noMoney = dinner({ entries: [{ accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 100_000, amountBaseMinor: 100_000, currency: 'IDR' }] } as Partial<TransactionView>);
    expect(heroCaption(noMoney, 100_000)).toBeNull();
  });
});

describe('money back on a purchase', () => {
  it('says it is a refund, and its total is money in', () => {
    const back = dinner({
      entries: [
        { accountId: 'acct-card', accountKind: 'liability', amountMinor: 450_000, amountBaseMinor: 450_000, currency: 'IDR' },
        { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: -450_000, amountBaseMinor: -450_000, currency: 'IDR' },
      ] as TransactionView['entries'],
    });
    const lines = receiptLines({ tx: back, accounts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(lines, 'Refund')).toBe('Money back');
    expect(valueOf(lines, 'Total')).toBe('+Rp 450.000');
  });

  it('reads Cashback · Lowers spending for Cashback & Rewards into a card, and no Refund', () => {
    const promo = dinner({
      description: 'Promo cashback',
      entries: [
        { accountId: 'acct-card', accountKind: 'liability', amountMinor: 75_000, amountBaseMinor: 75_000, currency: 'IDR' },
        { accountId: 'cat-cashback', accountKind: 'expense', accountSystemKey: 'expense.cashback', amountMinor: -75_000, amountBaseMinor: -75_000, currency: 'IDR' },
      ] as TransactionView['entries'],
    });
    const lines = receiptLines({ tx: promo, accounts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(valueOf(lines, 'Cashback')).toBe('Lowers spending');
    expect(lines.some((line) => line.label === 'Refund')).toBe(false);
    expect(valueOf(lines, 'Total')).toBe('+Rp 75.000');
  });
});

describe('a spend from foreign cash (withdrawal rate §7)', () => {
  const lira = [
    { id: 'acct-lira', name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' },
    { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
  ] as AccountRow[];
  const meal = {
    id: 'tx-lira',
    occurredOn: '2026-11-13',
    description: 'Fish by the harbour',
    status: 'posted',
    cardId: null,
    entries: [
      { accountId: 'acct-lira', accountKind: 'asset', amountMinor: -45_000, amountBaseMinor: -236_250, currency: 'TRY' },
      { accountId: 'cat-restaurants', accountKind: 'expense', amountMinor: 45_000, amountBaseMinor: 236_250, currency: 'TRY' },
    ],
  } as TransactionView;
  const used = (uses: { lotId: string; lotDate: string }[], uncoveredMinor = 0) => ({
    accountId: 'acct-lira',
    currency: 'TRY',
    minor: 45_000,
    costBaseMinor: 236_250,
    uncoveredMinor,
    ratePerUnit: 525,
    uses: uses.map((use) => ({ ...use, minor: 45_000 / uses.length, costBaseMinor: 236_250 / uses.length })),
  });

  it('says what it cost at the withdrawal rate, and which withdrawal it came from', () => {
    const lines = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: used([{ lotId: 'w1', lotDate: '2026-11-12' }]), today: '2026-11-20' });
    expect(valueOf(lines, 'Cost')).toBe('≈ Rp 236.250 at the withdrawal rate (525)');
    expect(valueOf(lines, 'Withdrawn')).toBe('From the 12 Nov withdrawal');
  });

  it('values a past spend’s uncovered part at the day’s rate, never today’s (final review M2)', () => {
    const lines = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: used([{ lotId: 'w1', lotDate: '2026-11-12' }], 15_000), today: '2027-03-02' });
    expect(valueOf(lines, 'Cost')).toBe('≈ Rp 236.250 · ₺ 150 at the day’s rate (no withdrawal recorded)');
  });

  it('counts two withdrawals, and says nothing for money that was not foreign', () => {
    const two = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: used([{ lotId: 'w1', lotDate: '2026-11-02' }, { lotId: 'w2', lotDate: '2026-11-09' }]), today: '2026-11-20' });
    expect(valueOf(two, 'Withdrawn')).toBe('From 2 withdrawals');
    const none = receiptLines({ tx: meal, accounts: lira, cards: [], currency: 'IDR', points: null, owed: [], withdrawal: null });
    expect(none.map((line) => line.label)).not.toContain('Cost');
  });
});

describe('a purchase split across workspaces', () => {
  const family = { id: 'family', name: 'Family', kind: 'family' as const };
  const business = { id: 'business', name: 'Business', kind: 'business' as const };
  const withParts = [
    ...accounts,
    { id: 'cat-groceries', name: 'Groceries', kind: 'expense', subtype: 'category', currency: null },
    { id: 'cat-office', name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null },
  ] as AccountRow[];
  // Invented: Rp 1.350.000 on the card, Rp 900.000 groceries for Family and Rp 450.000 office supplies for Business.
  const market = dinner({
    description: 'Pasar Sentosa',
    splitBooks: [family, business],
    entries: [
      { accountId: 'acct-card', accountKind: 'liability', amountMinor: -1_350_000, amountBaseMinor: -1_350_000, currency: 'IDR' },
      { accountId: 'cat-office', accountName: 'Office supplies', accountKind: 'expense', amountMinor: 450_000, amountBaseMinor: 450_000, currency: 'IDR', bookId: 'business' },
      { accountId: 'cat-groceries', accountName: 'Groceries', accountKind: 'expense', amountMinor: 900_000, amountBaseMinor: 900_000, currency: 'IDR', bookId: 'family' },
    ] as TransactionView['entries'],
  });

  it('says the whole charge, on the card it was charged to, in one line', () => {
    const lines = receiptLines({ tx: market, accounts: withParts, cards: [card], currency: 'IDR', points: null, owed: [] });
    expect(said(lines)).toEqual([['Charged on BCA KrisFlyer ···· 1467', 'Rp 1.350.000']]);
    expect(heroCaption(market, 1_350_000)).toBeNull();
  });

  it('lists each part with the workspace it is counted in, in the workspaces’ order', () => {
    expect(splitParts(market, withParts).map((part) => [part.categoryName, part.book?.name, part.amountMinor, part.excluded])).toEqual([
      ['Groceries', 'Family', 900_000, false],
      ['Office supplies', 'Business', 450_000, false],
    ]);
    expect(splitParts(dinner(), withParts)).toEqual([]);
  });

  it('marks the part left out of its workspace’s reports, and only that one (0090)', () => {
    const off = { ...market, splitBooks: [family, { ...business, excluded: true }] };
    expect(splitParts(off, withParts).map((part) => [part.categoryName, part.excluded])).toEqual([
      ['Groceries', false],
      ['Office supplies', true],
    ]);
    // The card line is still the whole charge.
    expect(said(receiptLines({ tx: off, accounts: withParts, cards: [card], currency: 'IDR', points: null, owed: [] }))).toEqual([
      ['Charged on BCA KrisFlyer ···· 1467', 'Rp 1.350.000'],
    ]);
  });

  it('marks one line of a workspace and not the other, and lists a split in one workspace once a line is out (0096)', () => {
    const lines = (market.entries as TransactionView['entries']).map((entry) => (entry.accountId === 'cat-groceries' ? { ...entry, excluded: true } : entry));
    expect(splitParts({ ...market, entries: lines }, withParts).map((part) => [part.categoryName, part.excluded])).toEqual([
      ['Groceries', true],
      ['Office supplies', false],
    ]);
    // One workspace, two lines: nothing to list until one is out, then each is said.
    const one = dinner({
      entries: [
        { accountId: 'acct-card', accountKind: 'liability', amountMinor: -500_000, amountBaseMinor: -500_000, currency: 'IDR' },
        { accountId: 'cat-restaurants', accountName: 'Restaurants', accountKind: 'expense', amountMinor: 300_000, amountBaseMinor: 300_000, currency: 'IDR', excluded: true },
        { accountId: 'cat-groceries', accountName: 'Groceries', accountKind: 'expense', amountMinor: 200_000, amountBaseMinor: 200_000, currency: 'IDR' },
      ] as TransactionView['entries'],
    });
    expect(splitParts(one, withParts).map((part) => [part.categoryName, part.excluded])).toEqual([
      ['Restaurants', true],
      ['Groceries', false],
    ]);
    expect(splitParts({ ...one, entries: one.entries.map((entry) => ({ ...entry, excluded: undefined })) }, withParts)).toEqual([]);
  });
});

describe('a purchase with a part Not counted', () => {
  const business = { id: 'business', name: 'Business', kind: 'business' as const };
  const withParts = [...accounts, { id: 'cat-office', name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null }] as AccountRow[];
  // Invented: Rp 4.500.000 at Toko Sinar Jaya, Rp 4.000.000 office supplies for Business, Rp 500.000 in no workspace.
  const shop = dinner({
    description: 'Toko Sinar Jaya',
    entries: [
      { accountId: 'acct-card', accountKind: 'liability', amountMinor: -4_500_000, amountBaseMinor: -4_500_000, currency: 'IDR' },
      { accountId: 'cat-office', accountName: 'Office supplies', accountKind: 'expense', amountMinor: 4_000_000, amountBaseMinor: 4_000_000, currency: 'IDR' },
      { accountId: 'eq-not-counted', accountName: 'Not counted', accountKind: 'equity', accountSystemKey: 'not_counted', amountMinor: 500_000, amountBaseMinor: 500_000, currency: 'IDR' },
    ] as TransactionView['entries'],
  });

  it('says the whole charge on the card, the hero the whole purchase', () => {
    expect(said(receiptLines({ tx: shop, accounts: withParts, cards: [card], currency: 'IDR', points: null, owed: [] }))).toEqual([
      ['Charged on BCA KrisFlyer ···· 1467', 'Rp 4.500.000'],
    ]);
    expect(heroCaption(shop, 4_500_000)).toBeNull();
  });

  it('lists the workspace’s part, then the part in no workspace', () => {
    expect(splitParts(shop, withParts, business).map((part) => [part.categoryName, part.book?.name ?? null, part.amountMinor, part.excluded])).toEqual([
      ['Office supplies', 'Business', 4_000_000, false],
      ['Not counted', null, 500_000, false],
    ]);
    // The workspace's part excluded is the purchase's own flag, in one workspace.
    expect(splitParts({ ...shop, excluded: true }, withParts, business).map((part) => part.excluded)).toEqual([true, false]);
  });
});

describe('a transfer between currencies (owner, 17 Nov 2026)', () => {
  const banks = [
    { id: 'acct-gbp', name: 'BCA GBP', kind: 'asset', subtype: 'bank', currency: 'GBP' },
    { id: 'acct-idr', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  ] as AccountRow[];
  /** £1.000 (less any fee) out of the pound bank, Rp 20.700.000 into the rupiah one, with the withdrawal rate's pair. */
  const exchange = (feeMinor = 0, received = 20_700_000) =>
    ({
      id: 'tx-gbp',
      occurredOn: '2026-11-17',
      description: 'GBP to IDR',
      status: 'posted',
      cardId: null,
      entries: [
        { accountId: 'acct-gbp', accountKind: 'asset', accountSubtype: 'bank', amountMinor: -100_000, amountBaseMinor: -21_000_000, currency: 'GBP' },
        { accountId: 'acct-fx', accountKind: 'equity', accountSystemKey: 'currency_exchange', amountMinor: 100_000 - feeMinor, amountBaseMinor: 21_000_000, currency: 'GBP' },
        { accountId: 'acct-idr', accountKind: 'asset', accountSubtype: 'bank', amountMinor: received, amountBaseMinor: received, currency: 'IDR' },
        { accountId: 'acct-fx', accountKind: 'equity', accountSystemKey: 'currency_exchange', amountMinor: -received, amountBaseMinor: -received, currency: 'IDR' },
        ...(feeMinor > 0
          ? [{ accountId: 'cat-fees', accountKind: 'expense', amountMinor: feeMinor, amountBaseMinor: 105_000, currency: 'GBP' }]
          : [
              { accountId: 'cat-loss', accountKind: 'expense', accountSystemKey: 'expense.exchange_loss', amountMinor: 300_000, amountBaseMinor: 300_000, currency: 'IDR' },
              { accountId: 'acct-fx', accountKind: 'equity', accountSystemKey: 'currency_exchange', amountMinor: -300_000, amountBaseMinor: -300_000, currency: 'IDR' },
            ]),
      ],
    }) as unknown as TransactionView;
  const withdrawal = { accountId: 'acct-gbp', currency: 'GBP', minor: 100_000, costBaseMinor: 21_000_000, uncoveredMinor: 0, ratePerUnit: 21_000, uses: [{ lotId: 'w1', lotDate: '2026-03-01', minor: 100_000, costBaseMinor: 21_000_000 }] };
  const lineOf = (lines: { label: string; value: string; detail?: string }[], label: string) => {
    const line = lines.find((one) => one.label === label);
    return line && { value: line.value.replace(/ /g, ' '), detail: line.detail?.replace(/ /g, ' ') ?? null };
  };

  it('reads one Rate row, the market under it, in place of Cost and Withdrawn; nothing says it counts', () => {
    const lines = receiptLines({ tx: exchange(), accounts: banks, cards: [], currency: 'IDR', points: null, owed: [], withdrawal, today: '2026-11-17', ratesToBase: { GBP: 21_000 } });
    expect(lineOf(lines, 'Rate')).toEqual({ value: 'Rp 20.700 per GBP', detail: 'market 21.000 · −1,4 %' });
    expect(lines.map((line) => line.label)).toEqual(['Paid with', 'Into', 'Total', 'Rate']);
    expect(JSON.stringify(lines)).not.toMatch(/exchange|recorded as|spending|income/i);
  });

  it('reads the rate alone when no market rate is held for the day', () => {
    const lines = receiptLines({ tx: exchange(), accounts: banks, cards: [], currency: 'IDR', points: null, owed: [], withdrawal, today: '2026-11-17', ratesToBase: {} });
    expect(lineOf(lines, 'Rate')).toEqual({ value: 'Rp 20.700 per GBP', detail: null });
    expect(lines.map((line) => line.label)).not.toContain('Cost');
  });

  it('prices only what was changed, never the fee beside it', () => {
    // £5 fee, £995 changed for Rp 20.596.500: Rp 20.700 a pound.
    const lines = receiptLines({ tx: exchange(500, 20_596_500), accounts: banks, cards: [], currency: 'IDR', points: null, owed: [], withdrawal, today: '2026-11-17', ratesToBase: { GBP: 21_000 } });
    expect(lineOf(lines, 'Rate')).toEqual({ value: 'Rp 20.700 per GBP', detail: 'market 21.000 · −1,4 %' });
  });
});
