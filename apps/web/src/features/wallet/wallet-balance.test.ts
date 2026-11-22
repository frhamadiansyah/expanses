import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { spendingBook } from '../accounts/pockets';
import { type AccountSetAsideInput, type BillMonthInput, billsToPay, filteredCards, jointFaceMinor, type JointBoxInput, moneyCardMinor, moneyFace, toggleFilter, walletBox, type WalletBoxInput, walletFilterSets } from './wallet-balance';
import { walletCredit, walletMoney } from './wallet-model';
import { deskGroups } from './wallet-desk-model';

const account = (id: string, subtype: string, extra: Partial<AccountRow> = {}) =>
  ({ id, name: id, parentId: null, kind: 'asset', subtype, currency: 'IDR', archivedAt: null, sortOrder: 0, forSpending: 1, ...extra }) as AccountRow;
const card = (id: string, extra: Partial<AccountRow> = {}) => account(id, 'credit_card', { kind: 'liability', ...extra });

const bill = (id: string, extra: Partial<BillMonthInput> = {}): BillMonthInput => ({
  id,
  name: id,
  categoryAccountId: `cat-${id}`,
  month: '2026-11',
  state: 'upcoming',
  payBy: '2026-11-25',
  amountMinor: 100_000,
  estimateMinor: 100_000,
  currency: 'IDR',
  ...extra,
});

describe('the bills still to pay this month', () => {
  it('counts this month’s unpaid occurrences — upcoming, open, due soon and late — soonest first', () => {
    const rows = [
      bill('internet', { payBy: '2026-11-28', state: 'open' }),
      bill('electricity', { payBy: '2026-11-25', state: 'dueSoon' }),
      bill('water', { payBy: '2026-11-05', state: 'overdue' }),
      bill('gym', { payBy: '2026-11-30', state: 'upcoming' }),
    ];
    expect(billsToPay(rows, '2026-11').map((b) => b.id)).toEqual(['water', 'electricity', 'internet', 'gym']);
  });

  it('leaves out a bill paid, skipped or paused this month, and an earlier month still late', () => {
    const rows = [
      bill('paid', { state: 'paid' }),
      bill('skipped', { state: 'skipped' }),
      bill('paused', { state: 'paused' }),
      bill('october', { month: '2026-10', payBy: '2026-10-25', state: 'overdue' }),
      bill('kept'),
    ];
    expect(billsToPay(rows, '2026-11').map((b) => b.id)).toEqual(['kept']);
  });

  it('counts a varying bill at its estimate, marked about, and leaves out one with nothing to go by', () => {
    const rows = [bill('phone', { amountMinor: null, estimateMinor: 500_000 }), bill('new', { amountMinor: null, estimateMinor: null })];
    expect(billsToPay(rows, '2026-11')).toEqual([expect.objectContaining({ id: 'phone', minor: 500_000, about: true })]);
  });

  it('counts only what a sinking fund has not already set aside, and leaves out a bill its fund covers', () => {
    const rows = [bill('insurance', { amountMinor: 1_200_000 }), bill('tax', { amountMinor: 800_000 })];
    const funds = [
      { billId: 'insurance', minor: 900_000, currency: 'IDR' },
      { billId: 'tax', minor: 800_000, currency: 'IDR' },
    ];
    expect(billsToPay(rows, '2026-11', funds)).toEqual([expect.objectContaining({ id: 'insurance', minor: 300_000, setAsideMinor: 900_000 })]);
  });

  it('nets a fund only in its bill’s own currency', () => {
    expect(billsToPay([bill('visa', { currency: 'SGD', amountMinor: 10_000 })], '2026-11', [{ billId: 'visa', minor: 4_000, currency: 'IDR' }])[0]!.minor).toBe(10_000);
  });
});

/*
 * The mockup's table (docs/mockups/2026-11-12-wallet-after-bills.html): Payroll and an e-wallet, two credit cards,
 * three bills. Paying a bill by card, a bill from the bank, then the card from the bank, the Balance never moves.
 */
describe('the Balance through a month of paying', () => {
  const accounts = [account('payroll', 'bank'), account('ewallet', 'ewallet'), card('card-1234'), card('card-5678')];
  const book = spendingBook(accounts);
  const credit = walletCredit(accounts);
  const bills = (paid: readonly string[]) => [
    bill('Electricity', { payBy: '2026-11-25', amountMinor: 450_000, state: paid.includes('Electricity') ? 'paid' : 'upcoming' }),
    bill('Internet', { payBy: '2026-11-28', amountMinor: 200_000, state: paid.includes('Internet') ? 'paid' : 'upcoming' }),
    bill('Phone plan', { payBy: '2026-11-30', amountMinor: null, estimateMinor: 500_000 }),
  ];
  const box = (balances: Record<string, number>, paid: readonly string[] = []) =>
    walletBox({ book, balances, credit, baseCurrency: 'IDR', rates: {}, setAsides: [], bills: bills(paid), month: '2026-11' });
  // A credit card's balance is a liability's: owed is below nought in the ledger.
  const steps: { on: string; balances: Record<string, number>; paid: string[]; spending: number; cards: number; billsLeft: number }[] = [
    { on: '1 Nov · start', balances: { payroll: 5_900_000, ewallet: 900_000, 'card-1234': -1_650_000, 'card-5678': -500_000 }, paid: [], spending: 6_800_000, cards: 2_150_000, billsLeft: 1_150_000 },
    { on: '20 Nov · Electricity paid with card 1234', balances: { payroll: 5_900_000, ewallet: 900_000, 'card-1234': -2_100_000, 'card-5678': -500_000 }, paid: ['Electricity'], spending: 6_800_000, cards: 2_600_000, billsLeft: 700_000 },
    { on: '22 Nov · Internet paid from Payroll', balances: { payroll: 5_700_000, ewallet: 900_000, 'card-1234': -2_100_000, 'card-5678': -500_000 }, paid: ['Electricity', 'Internet'], spending: 6_600_000, cards: 2_600_000, billsLeft: 500_000 },
    { on: '25 Nov · card 1234 paid from Payroll', balances: { payroll: 3_600_000, ewallet: 900_000, 'card-1234': 0, 'card-5678': -500_000 }, paid: ['Electricity', 'Internet'], spending: 4_500_000, cards: 500_000, billsLeft: 500_000 },
  ];
  for (const step of steps) {
    it(`stays at 3.500.000 — ${step.on}`, () => {
      const result = box(step.balances, step.paid);
      expect(result).toMatchObject({ spendingMinor: step.spending, cardsMinor: step.cards, billsMinor: step.billsLeft, balanceMinor: 3_500_000, missing: [], estimated: false });
    });
  }

  it('lists the bills the row adds up, in the sheet’s order', () => {
    expect(box(steps[0]!.balances).bills.map((b) => [b.name, b.minor, b.about])).toEqual([
      ['Electricity', 450_000, false],
      ['Internet', 200_000, false],
      ['Phone plan', 500_000, true],
    ]);
  });

  it('has no bills row to show once every bill is dealt with', () => {
    const result = walletBox({ book, balances: steps[0]!.balances, credit, baseCurrency: 'IDR', rates: {}, setAsides: [], bills: [], month: '2026-11' });
    expect(result.bills).toEqual([]);
    expect(result.billsMinor).toBe(0);
    expect(result.balanceMinor).toBe(4_650_000);
  });
});

describe('the box with set-asides and other currencies', () => {
  const accounts = [account('payroll', 'bank'), card('card')];
  const base: WalletBoxInput = {
    book: spendingBook(accounts),
    balances: { payroll: 10_000_000, card: -1_000_000 },
    credit: walletCredit(accounts),
    baseCurrency: 'IDR',
    rates: {},
    setAsides: [],
    bills: [],
    month: '2026-11',
  };

  it('takes a funded yearly bill off once: its saving with the set-asides, only the rest as a bill', () => {
    const result = walletBox({
      ...base,
      setAsides: [{ accountId: 'payroll', setAsideMinor: 2_000_000, currency: 'IDR', funds: [{ billId: 'insurance', promisedMinor: 1_500_000 }] }],
      bills: [bill('insurance', { amountMinor: 1_800_000 })],
    });
    expect(result).toMatchObject({ spendingMinor: 8_000_000, cardsMinor: 1_000_000, billsMinor: 300_000, balanceMinor: 6_700_000 });
  });

  it('does not net a fund kept on money the box does not count', () => {
    const result = walletBox({
      ...base,
      setAsides: [{ accountId: 'elsewhere', setAsideMinor: 1_500_000, currency: 'IDR', funds: [{ billId: 'insurance', promisedMinor: 1_500_000 }] }],
      bills: [bill('insurance', { amountMinor: 1_800_000 })],
    });
    expect(result).toMatchObject({ spendingMinor: 10_000_000, billsMinor: 1_800_000 });
  });

  it('converts a bill in another currency, and names a missing rate rather than adding it raw', () => {
    const sgd = [bill('visa', { currency: 'SGD', amountMinor: 10_000 })];
    expect(walletBox({ ...base, bills: sgd, rates: { SGD: 12_000 } })).toMatchObject({ billsMinor: 1_200_000, balanceMinor: 7_800_000, estimated: true });
    expect(walletBox({ ...base, bills: sgd })).toMatchObject({ spendingMinor: null, cardsMinor: null, billsMinor: null, balanceMinor: null, missing: ['SGD'] });
  });
});

describe('a row tapped filters the grid', () => {
  const accounts = [
    account('payroll', 'bank'),
    account('wise', 'bank'),
    account('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    account('wise-idr', 'bank', { parentId: 'wise' }),
    account('ewallet', 'ewallet'),
    account('rainy', 'savings', { forSpending: 0 }),
    card('card-1234'),
    card('card-0', { sortOrder: 0 }),
  ];
  const book = spendingBook(accounts);
  const money = walletMoney(accounts);
  const credit = walletCredit(accounts);
  const cards = [...money, ...credit].map((a) => ({ key: a.id }));
  const balances = { payroll: 5_900_000, 'wise-usd': 10_000, 'wise-idr': 100_000, ewallet: 900_000, rainy: 4_000_000, 'card-1234': -1_650_000 };
  const rates = { USD: 16_000 };
  const box = walletBox({ book, balances, credit, baseCurrency: 'IDR', rates, setAsides: [], bills: [], month: '2026-11' });

  it('toggles: a row once filters, the same row again clears, the other row switches', () => {
    expect(toggleFilter(null, 'spending')).toBe('spending');
    expect(toggleFilter('spending', 'spending')).toBeNull();
    expect(toggleFilter('spending', 'cards')).toBe('cards');
  });

  it('Spending money keeps the money cards, and they add up to its figure', () => {
    const shown = filteredCards(cards, 'spending', money, credit);
    expect(shown.map((c) => c.key)).toEqual(['payroll', 'wise', 'ewallet']);
    const total = shown.reduce((sum, c) => sum + moneyCardMinor(accounts.find((a) => a.id === c.key)!, book, balances, 'IDR', rates)!, 0);
    expect(total).toBe(box.spendingMinor);
  });

  it('Outstanding on cards keeps every credit card, one owing nothing too, and they add up to its figure', () => {
    const shown = filteredCards(cards, 'cards', money, credit);
    expect(shown.map((c) => c.key)).toEqual(['card-1234', 'card-0']);
    const owed = shown.reduce((sum, c) => sum + Math.max(0, -(balances[c.key as keyof typeof balances] ?? 0)), 0);
    expect(owed).toBe(box.cardsMinor);
  });

  it('no filter keeps every card, in the grid’s order', () => {
    expect(filteredCards(cards, null, money, credit)).toEqual(cards);
  });
});

/*
 * The partner's joint account and joint card (mockup 2026-11-12-wallet-joint-items, A1): Andi's Payroll 4,3 jt and
 * Rina's joint savings 8 jt are Spending money; Andi's card 1,25 jt and Rina's joint card 850 rb are Outstanding on cards.
 */
describe('the partner’s joint items in the Balance', () => {
  const accounts = [account('payroll', 'bank'), card('card-1234')];
  const book = spendingBook(accounts);
  const money = walletMoney(accounts);
  const credit = walletCredit(accounts);
  const balances = { payroll: 4_300_000, 'card-1234': -1_250_000 };
  const joint: JointBoxInput[] = [
    { key: 'joint:savings', side: 'money', minor: 8_000_000, currency: 'IDR' },
    { key: 'joint:card', side: 'credit', minor: 850_000, currency: 'IDR' },
  ];
  const base: WalletBoxInput = { book, balances, credit, baseCurrency: 'IDR', rates: {}, setAsides: [], bills: [bill('Bills', { amountMinor: 1_150_000 })], month: '2026-11' };

  it('adds joint money to Spending money and what a joint card owes to Outstanding on cards', () => {
    expect(walletBox({ ...base, joint })).toMatchObject({ spendingMinor: 12_300_000, cardsMinor: 2_100_000, billsMinor: 1_150_000, balanceMinor: 9_050_000, estimated: false, accounts: 2 });
  });

  it('counts nothing for a joint card in credit, as an own card owing nothing', () => {
    expect(walletBox({ ...base, joint: [{ key: 'joint:card', side: 'credit', minor: -200_000, currency: 'IDR' }] })).toMatchObject({ cardsMinor: 1_250_000 });
  });

  it('converts a joint item in another currency, and names its missing rate rather than adding it raw', () => {
    const usd: JointBoxInput[] = [{ key: 'joint:usd', side: 'money', minor: 10_000, currency: 'USD' }];
    expect(walletBox({ ...base, joint: usd, rates: { USD: 16_000 } })).toMatchObject({ spendingMinor: 5_900_000, estimated: true });
    expect(walletBox({ ...base, joint: usd })).toMatchObject({ spendingMinor: null, balanceMinor: null, missing: ['USD'] });
    const sgdCard: JointBoxInput[] = [{ key: 'joint:sgd', side: 'credit', minor: 10_000, currency: 'SGD' }];
    expect(walletBox({ ...base, joint: sgdCard })).toMatchObject({ cardsMinor: null, balanceMinor: null, missing: ['SGD'] });
  });

  it('takes what the holder set aside of joint money off Spending money, as the holder’s own Wallet does', () => {
    const setAside: JointBoxInput[] = [{ ...joint[0]!, setAsideMinor: 3_000_000 }, joint[1]!];
    expect(walletBox({ ...base, joint: setAside })).toMatchObject({ spendingMinor: 9_300_000, cardsMinor: 2_100_000, balanceMinor: 6_050_000, estimated: false });
    // The holder's phone: the same account is its own, with the same set-aside, and Spending money drops by the same.
    const held = [account('payroll', 'bank'), account('savings', 'savings'), card('card-1234')];
    const holder = walletBox({
      ...base,
      book: spendingBook(held),
      credit: walletCredit(held),
      balances: { ...balances, savings: 8_000_000 },
      setAsides: [{ accountId: 'savings', setAsideMinor: 3_000_000, currency: 'IDR', funds: [] }],
      joint: [joint[1]!],
    });
    expect(holder.spendingMinor).toBe(9_300_000);
  });

  it('leaves Spending money as it was when the holder sent no set-aside (an older build), and never nets one on a card', () => {
    expect(walletBox({ ...base, joint: [{ ...joint[0]!, setAsideMinor: 0 }, joint[1]!] }).spendingMinor).toBe(12_300_000);
    expect(walletBox({ ...base, joint: [joint[0]!, { ...joint[1]!, setAsideMinor: 500_000 }] })).toMatchObject({ spendingMinor: 12_300_000, cardsMinor: 2_100_000 });
  });

  it('converts a joint set-aside in another currency at the same rate as its balance', () => {
    const usd: JointBoxInput[] = [{ key: 'joint:usd', side: 'money', minor: 10_000, currency: 'USD', setAsideMinor: 2_500 }];
    expect(walletBox({ ...base, joint: usd, rates: { USD: 16_000 } })).toMatchObject({ spendingMinor: 4_300_000 + 1_200_000, estimated: true });
  });

  it('draws the box over joint money alone', () => {
    expect(walletBox({ ...base, book: [], balances: {}, credit: [], joint: [joint[0]!] }).accounts).toBe(1);
  });

  it('each row tapped keeps the partner’s cards too, and the cards shown still add up to its figure', () => {
    const cards = [{ key: 'payroll' }, { key: 'joint:savings' }, { key: 'card-1234' }, { key: 'joint:card' }];
    const box = walletBox({ ...base, joint });
    const spending = filteredCards(cards, 'spending', ...walletFilterSets(money, credit, joint));
    expect(spending.map((c) => c.key)).toEqual(['payroll', 'joint:savings']);
    expect(moneyCardMinor(accounts[0]!, book, balances, 'IDR', {})! + joint[0]!.minor).toBe(box.spendingMinor);
    const owed = filteredCards(cards, 'cards', ...walletFilterSets(money, credit, joint));
    expect(owed.map((c) => c.key)).toEqual(['card-1234', 'joint:card']);
    expect(-balances['card-1234'] + joint[1]!.minor).toBe(box.cardsMinor);
  });
});

/*
 * Outstanding on cards counts only what is due now (owner, 17 Nov 2026): BCA Tahapan 6.000.000; BCA Visa owes
 * 12.500.000, of which 10.000.000 is a laptop's instalments not billed yet. Outstanding on cards 2.500.000, Balance 3.500.000.
 */
describe('instalments not billed yet stay out of the Balance', () => {
  const accounts = [account('tahapan', 'bank'), card('visa'), card('mandiri')];
  const input = (later: Record<string, number>): WalletBoxInput => ({
    book: spendingBook(accounts),
    balances: { tahapan: 6_000_000, visa: -12_500_000, mandiri: 0 },
    credit: walletCredit(accounts),
    baseCurrency: 'IDR',
    rates: {},
    setAsides: [],
    bills: [],
    month: '2026-11',
    laterOnCards: later,
  });

  it('counts the card at what is due now', () => {
    expect(walletBox(input({ visa: 10_000_000 }))).toMatchObject({ spendingMinor: 6_000_000, cardsMinor: 2_500_000, balanceMinor: 3_500_000 });
  });

  it('counts the whole balance with no plans', () => {
    expect(walletBox(input({}))).toMatchObject({ cardsMinor: 12_500_000, balanceMinor: -6_500_000 });
  });

  it('never counts a card below nothing, nor a card owing nothing for its plans', () => {
    expect(walletBox(input({ visa: 20_000_000, mandiri: 3_000_000 }))).toMatchObject({ cardsMinor: 0, balanceMinor: 6_000_000 });
  });
});

/*
 * Each money card's face is what is free to spend on it (owner, 22 Nov 2026, option A): its balance less what goals and
 * sinking funds set aside of it, the per-account amount Spending money takes off, so the faces add up to Spending money.
 */
describe('money faces show what is free to spend', () => {
  const accounts = [
    account('payroll', 'bank'),
    account('wise', 'bank'),
    account('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    account('wise-idr', 'bank', { parentId: 'wise' }),
    account('wise-try', 'bank', { parentId: 'wise', currency: 'TRY', forSpending: 0 }),
    account('ewallet', 'ewallet'),
    account('rainy', 'savings', { forSpending: 0 }),
    card('card-1234'),
  ];
  const book = spendingBook(accounts);
  const money = walletMoney(accounts);
  const balances = { payroll: 5_900_000, 'wise-usd': 10_000, 'wise-idr': 100_000, 'wise-try': 50_000, ewallet: 900_000, rainy: 4_000_000, 'card-1234': -1_650_000 };
  const rates = { USD: 16_000, TRY: 500 };
  const setAsides: AccountSetAsideInput[] = [
    // A goal's money on the payroll account.
    { accountId: 'payroll', setAsideMinor: 2_000_000, currency: 'IDR', funds: [] },
    // A sinking fund saving in the dollar pocket.
    { accountId: 'wise-usd', setAsideMinor: 2_500, currency: 'USD', funds: [{ billId: 'insurance', promisedMinor: 2_500 }] },
    // Money set aside on savings switched off, and on a pocket switched off: neither is Spending money nor a face.
    { accountId: 'rainy', setAsideMinor: 1_000_000, currency: 'IDR', funds: [] },
    { accountId: 'wise-try', setAsideMinor: 10_000, currency: 'TRY', funds: [] },
  ];
  const box = walletBox({ book, balances, credit: walletCredit(accounts), baseCurrency: 'IDR', rates, setAsides, bills: [], month: '2026-11' });

  it('the faces add up to Spending money, a goal and a fund taken off', () => {
    // US$100 at 16.000 is 1.600.000, of which US$25 (400.000) is the fund's.
    expect(box.spendingMinor).toBe(5_900_000 - 2_000_000 + 100_000 + 1_600_000 - 400_000 + 900_000);
    const total = money.reduce((sum, a) => sum + moneyCardMinor(a, book, balances, 'IDR', rates, setAsides)!, 0);
    expect(total).toBe(box.spendingMinor);
  });

  it('a plain account is read in its own money, its set-aside taken off', () => {
    expect(moneyFace(accounts[0]!, book, balances, 'IDR', rates, setAsides)).toEqual({ minor: 3_900_000, currency: 'IDR', converted: false, missing: [], setAsideMinor: 2_000_000 });
    expect(moneyFace(accounts.find((a) => a.id === 'ewallet')!, book, balances, 'IDR', rates, setAsides)).toMatchObject({ minor: 900_000, setAsideMinor: 0 });
  });

  it('an account with pockets is its spending pockets less what is set aside on them, in the base', () => {
    expect(moneyFace(accounts[1]!, book, balances, 'IDR', rates, setAsides)).toEqual({ minor: 1_300_000, currency: 'IDR', converted: true, missing: [], setAsideMinor: 400_000 });
  });

  it('a missing rate gives no figure rather than a partial subtraction, as Spending money does', () => {
    expect(moneyFace(accounts[1]!, book, balances, 'IDR', {}, setAsides)).toMatchObject({ minor: null, missing: ['USD'] });
    expect(moneyCardMinor(accounts[1]!, book, balances, 'IDR', {}, setAsides)).toBeNull();
    // A plain account needs no rate: its set-aside is in its own money.
    expect(moneyFace(accounts[0]!, book, balances, 'IDR', {}, setAsides)).toMatchObject({ minor: 3_900_000 });
  });

  it('set aside beyond the balance shows below nothing, as Spending money counts it', () => {
    const short = [{ accountId: 'ewallet', setAsideMinor: 1_200_000, currency: 'IDR', funds: [] }];
    expect(moneyFace(accounts.find((a) => a.id === 'ewallet')!, book, balances, 'IDR', rates, short)).toMatchObject({ minor: -300_000, setAsideMinor: 1_200_000 });
  });

  it('a plain account in another currency shows its own money, and still adds up to Spending money in the base', () => {
    const usd = [account('travel', 'bank', { currency: 'USD' })];
    const held = { travel: 20_000 };
    const aside = [{ accountId: 'travel', setAsideMinor: 5_000, currency: 'USD', funds: [] }];
    expect(moneyFace(usd[0]!, usd, held, 'IDR', {}, aside)).toMatchObject({ minor: 15_000, currency: 'USD', setAsideMinor: 5_000 });
    const usdBox = walletBox({ book: usd, balances: held, credit: [], baseCurrency: 'IDR', rates, setAsides: aside, bills: [], month: '2026-11' });
    expect(moneyCardMinor(usd[0]!, usd, held, 'IDR', rates, aside)).toBe(usdBox.spendingMinor);
    expect(usdBox.spendingMinor).toBe(2_400_000);
  });

  it('with nothing set aside the face is the balance it always was', () => {
    expect(moneyCardMinor(accounts[1]!, book, balances, 'IDR', rates)).toBe(1_700_000);
  });

  it('joint money is its holder’s figure less the set-aside its phone sent; a joint card is what it owes', () => {
    expect(jointFaceMinor({ side: 'money', minor: 8_000_000, setAsideMinor: 3_000_000 })).toBe(5_000_000);
    expect(jointFaceMinor({ side: 'money', minor: 8_000_000, setAsideMinor: 0 })).toBe(8_000_000);
    expect(jointFaceMinor({ side: 'credit', minor: 850_000, setAsideMinor: 500_000 })).toBe(850_000);
    const joint: JointBoxInput[] = [{ key: 'joint:savings', side: 'money', minor: 8_000_000, currency: 'IDR', setAsideMinor: 3_000_000 }];
    const withJoint = walletBox({ book, balances, credit: [], baseCurrency: 'IDR', rates, setAsides, bills: [], month: '2026-11', joint });
    const own = money.reduce((sum, a) => sum + moneyCardMinor(a, book, balances, 'IDR', rates, setAsides)!, 0);
    expect(own + jointFaceMinor({ side: 'money', minor: 8_000_000, setAsideMinor: 3_000_000 })).toBe(withJoint.spendingMinor);
  });
});

/*
 * Mac Wallet groups the money faces (bank accounts, cash and e-wallets, foreign currency). Each face is what is free to
 * spend on it (owner, 22 Nov 2026), so the money groups' totals add up to Spending money exactly, nothing set aside left
 * to explain under it. Invented figures.
 */
describe('Mac Wallet: the money groups add up to Spending money', () => {
  const accounts = [
    account('payroll', 'bank'),
    account('rainy', 'savings'),
    account('pocket', 'cash'),
    account('ewallet', 'ewallet'),
    account('wise', 'bank'),
    account('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    account('wise-idr', 'bank', { parentId: 'wise' }),
    card('card-1234'),
  ];
  const book = spendingBook(accounts);
  const money = walletMoney(accounts);
  const credit = walletCredit(accounts);
  const balances = { payroll: 6_400_000, rainy: 2_750_000, pocket: 180_000, ewallet: 95_000, 'wise-usd': 12_500, 'wise-idr': 310_000, 'card-1234': -870_000 };
  const rates = { USD: 16_200 };
  const setAsides: AccountSetAsideInput[] = [
    { accountId: 'payroll', setAsideMinor: 1_300_000, currency: 'IDR', funds: [] },
    { accountId: 'rainy', setAsideMinor: 900_000, currency: 'IDR', funds: [{ billId: 'insurance', promisedMinor: 600_000 }] },
    { accountId: 'wise-usd', setAsideMinor: 2_500, currency: 'USD', funds: [] },
  ];
  /** The groups as DesktopWallet builds them: each money face's figure (`moneyFace`) in its own currency, a card what it owes. */
  const groupsMoney = (asides: readonly AccountSetAsideInput[]) => {
    const items = [...money, ...credit].map((a) => {
      const face = a.subtype === 'credit_card' ? null : moneyFace(a, book, balances, 'IDR', rates, asides);
      return {
        key: a.id,
        name: a.name,
        side: a.subtype === 'credit_card' ? ('credit' as const) : ('money' as const),
        subtype: a.subtype,
        currencies: a.id === 'wise' ? ['USD', 'IDR'] : [a.currency ?? 'IDR'],
        minor: face ? face.minor : 870_000,
        currency: face ? face.currency : 'IDR',
      };
    });
    const groups = deskGroups(items, 'IDR', rates).filter((group) => group.key !== 'credit');
    return groups.reduce((sum, group) => sum + group.totalMinor!, 0);
  };
  const boxOf = (asides: readonly AccountSetAsideInput[]) => walletBox({ book, balances, credit, baseCurrency: 'IDR', rates, setAsides: asides, bills: [], month: '2026-11' });

  it('goals and a fund set aside: the groups are Spending money, to the rupiah', () => {
    // 6.400.000 − 1.300.000 + 2.750.000 − 900.000 + 180.000 + 95.000 + (US$125 − US$25) × 16.200 + 310.000.
    expect(boxOf(setAsides).spendingMinor).toBe(9_155_000);
    expect(groupsMoney(setAsides)).toBe(boxOf(setAsides).spendingMinor);
  });

  it('nothing set aside: the groups are the balances, and still Spending money', () => {
    expect(groupsMoney([])).toBe(boxOf([]).spendingMinor);
  });
});
