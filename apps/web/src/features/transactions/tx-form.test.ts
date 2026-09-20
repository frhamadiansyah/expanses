import { evaluateAmount, expenseLines, incomeLines, parseMajor, splitExpenseLines } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  amountAfterDone,
  amountAfterEnter,
  amountFields,
  billMinor,
  canEditInSheet,
  chargedHint,
  chargedInNeeded,
  currencyChoosable,
  emptyForm,
  estimatedCharge,
  extraRowRefusal,
  extraRows,
  type FormDraft,
  formFromTransaction,
  formToPost,
  KEYPAD_KEYS,
  keypadAction,
  keypadPress,
  postingCurrency,
  prefilledCharge,
  recentCurrencies,
  SPLIT_WITH_REFUSAL,
  splitTotalMinor,
  suggestedRate,
  typedCurrency,
  withShares,
} from './tx-form';

const accounts = [
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
  { id: 'acct-card', name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' },
  { id: 'acct-cny', name: 'Alipay', kind: 'asset', subtype: 'cash', currency: 'CNY' },
  // Exponent 2, so a figure read in the wrong currency is off by 100 rather than quietly identical. Every
  // split assertion used to be IDR, which has exponent 0 and cannot tell a currency mistake from a correct read.
  { id: 'acct-usd', name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' },
  // Something to buy and sell, so the trade tab's own draft has a holding with a currency of its own.
  { id: 'acct-gold', name: 'Antam gold', kind: 'asset', subtype: 'investment', currency: 'IDR' },
  { id: 'cat-restaurants', name: 'Restaurants', kind: 'expense', subtype: 'category', currency: null },
] as AccountRow[];

/** An ordinary expense off the bank account: the case every other draft below is a variation on. */
const draft: FormDraft = {
  ...emptyForm('ws-1'),
  moneyId: 'acct-bank',
  categoryId: 'cat-restaurants',
  amount: '120000',
  currency: 'IDR',
  description: 'Warung Steak',
  occurredOn: '2026-09-17',
};
/** The same expense typed in CNY off an IDR account, so C2's "Charged in IDR" row applies. */
const foreign: FormDraft = { ...draft, currency: 'CNY', amount: '120', chargedAmount: '272400' };
/** A transfer with no From chosen yet, for the error message. */
const transfer: FormDraft = { ...emptyForm('ws-1'), mode: 'transfer', toId: 'acct-card', amount: '500000' };
/** The same accounts plus the system account `exchangeLines` books a cross-currency difference against. */
const withExchange = [
  ...accounts,
  { id: 'acct-fx', name: 'Currency exchange', kind: 'equity', subtype: 'equity', currency: null, systemKey: 'currency_exchange' },
] as AccountRow[];

/** Four views built the way `dinner()` is in receipt-view.test.ts: only the facts each assertion turns on. */
const view = (over: Partial<TransactionView>): TransactionView =>
  ({
    id: 'tx-1',
    occurredOn: '2026-09-17',
    description: 'Dinner',
    status: 'posted',
    originalCurrency: null,
    originalAmountMinor: null,
    mcc: null,
    cardId: null,
    entries: [],
    ...over,
  }) as TransactionView;

const paid = (amountMinor: number, currency = 'IDR') => ({
  accountId: 'acct-card',
  accountKind: 'liability',
  accountName: 'BCA KrisFlyer',
  amountMinor,
  amountBaseMinor: amountMinor,
  currency,
});
const spent = (accountId: string, amountMinor: number, currency = 'IDR') => ({
  accountId,
  accountKind: 'expense',
  accountName: 'Restaurants',
  amountMinor,
  amountBaseMinor: amountMinor,
  currency,
});

const plainExpense = view({ entries: [paid(-400_000), spent('cat-restaurants', 400_000)] as TransactionView['entries'] });
const splitPurchase = view({
  entries: [paid(-400_000), spent('cat-restaurants', 250_000), spent('cat-groceries', 150_000)] as TransactionView['entries'],
});
const transferTx = view({
  entries: [
    paid(-500_000),
    { accountId: 'acct-bank', accountKind: 'asset', accountName: 'BCA Tahapan', amountMinor: 500_000, amountBaseMinor: 500_000, currency: 'IDR' },
  ] as TransactionView['entries'],
});
const foreignPurchase = view({
  originalCurrency: 'CNY',
  originalAmountMinor: 12_000,
  entries: [paid(-272_400), spent('cat-restaurants', 272_400)] as TransactionView['entries'],
});

describe('what the form adds up to', () => {
  // `formToPost` returns a discriminated result, so every assertion about what was built reaches through `input`.
  it('builds an expense exactly as the old form did', () => {
    expect(formToPost(draft, accounts)).toMatchObject({
      kind: 'post',
      input: { lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-bank', amountMinor: 120_000, currency: 'IDR' }) },
    });
  });

  it('keeps the typed currency as the original, and the charged amount as the posting', () => {
    expect(formToPost(foreign, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: 'CNY', originalAmountMinor: 12_000 } });
    // The posting itself is what the account was charged, in the account's own currency — not the 120 typed.
    expect(formToPost(foreign, accounts)).toMatchObject({
      kind: 'post',
      input: { lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-bank', amountMinor: 272_400, currency: 'IDR' }) },
    });
  });

  it('clears the original pair when the currency is the account’s own', () => {
    expect(formToPost(draft, accounts)).toMatchObject({ kind: 'post', input: { originalCurrency: null, originalAmountMinor: null } });
  });

  it('asks for the charged amount only when the currencies differ', () => {
    expect(chargedInNeeded(foreign, accounts)).toBe(true);
    expect(chargedInNeeded(draft, accounts)).toBe(false);
    // An account paid in its own currency never asks, whichever currency that is.
    expect(chargedInNeeded({ ...draft, moneyId: 'acct-cny', currency: 'CNY' }, accounts)).toBe(false);
  });

  it('passes the channel, the exclusion, the event and the photos through', () => {
    expect(formToPost({ ...draft, channel: 'online', excluded: true, eventId: 'ev-1', photoIds: ['p1'] }, accounts)).toMatchObject({
      kind: 'post',
      input: { channel: 'online', excludedFromReport: true, eventId: 'ev-1', photoIds: ['p1'] },
    });
  });

  // Three cases, three assertions: the title promised three and one covered only the first.
  it('offers MCC only on a card, With only on a new expense, and the rate row only when one is missing', () => {
    expect(extraRows(draft, accounts, { missingRate: null })).toEqual(['event', 'split', 'with', 'channel', 'photos', 'exclude']);
    expect(extraRows({ ...draft, moneyId: 'acct-card' }, accounts, { missingRate: null })).toEqual([
      'event',
      'split',
      'with',
      'mcc',
      'channel',
      'photos',
      'exclude',
    ]);
    // Editing rather than adding: With is not offered, because splitBill posts a differently shaped transaction (§15.6).
    expect(extraRows({ ...draft, editing: true }, accounts, { missingRate: null })).toEqual(['event', 'split', 'channel', 'photos', 'exclude']);
    // The rate row is last, and only when resolveRates says one is missing.
    expect(extraRows(foreign, accounts, { missingRate: { from: 'CNY', to: 'IDR', onDate: '2026-09-17' } })).toEqual([
      'event',
      'split',
      'with',
      'channel',
      'photos',
      'exclude',
      'rate',
    ]);
  });

  it('keeps Add more details to §4 table: no event and no goal on money that never left', () => {
    // §4: Event appears "always, on Expense and Income"; Photos and Exclude appear always. There is no goal
    // row at all — §3.5 puts For goal on the transfer's own second card, and §3.6 on the trade's.
    expect(extraRows({ ...transfer, moneyId: 'acct-bank' }, accounts, { missingRate: null })).toEqual(['photos', 'exclude']);
    expect(extraRows({ ...transfer, moneyId: 'acct-bank' }, accounts, { missingRate: null })).not.toContain('goal');
    expect(extraRows({ ...draft, mode: 'trade' }, accounts, { missingRate: null })).toEqual(['photos', 'exclude']);
    // Income keeps the event and the channel, and never offers a split or the people to share with.
    expect(extraRows({ ...draft, mode: 'income' }, accounts, { missingRate: null })).toEqual(['event', 'channel', 'photos', 'exclude']);
  });

  it('sends a split with several people to splitBill, not to postTransaction', () => {
    const shared = formToPost({ ...draft, with: [{ debtAccountId: '', name: 'Andi', amount: '100000' }] }, accounts);
    expect(shared).toMatchObject({ kind: 'split' });
    // What Andi owes is what was typed, and the rest of the 120.000 stays as your own spending.
    expect(shared).toMatchObject({
      kind: 'split',
      input: { totalMinor: 120_000, ownShareMinor: 20_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 100_000 }] },
    });
  });

  it('routes a transfer tagged to a goal to recordTaggedTransfer, and checks the same two accounts', () => {
    expect(formToPost({ ...transfer, moneyId: 'acct-bank', goalId: 'goal-1' }, accounts)).toMatchObject({
      kind: 'transfer-goal',
      input: { amountMinor: 500_000, fromAccountId: 'acct-bank', toAccountId: 'acct-card', goalId: 'goal-1' },
    });
    // The From/To check is the same one the untagged transfer makes — one message, both paths.
    expect(() => formToPost({ ...transfer, moneyId: 'acct-card', goalId: 'goal-1' }, accounts)).toThrow('From and To must differ');
  });

  it('keeps the exclusion, the event and the photos on a transfer tagged to a goal', () => {
    // §4: Photos and Exclude from report appear "always". The untagged branch carried all three; tagging the
    // transfer to a goal used to throw them away without a word.
    const tagged = { ...transfer, moneyId: 'acct-bank', goalId: 'goal-1', excluded: true, eventId: 'ev-1', photoIds: ['p1'] };
    expect(formToPost(tagged, accounts)).toMatchObject({
      kind: 'transfer-goal',
      input: { excludedFromReport: true, eventId: 'ev-1', photoIds: ['p1'] },
    });
    // And the untagged transfer, the branch this one is measured against, is unchanged.
    expect(formToPost({ ...tagged, goalId: '' }, accounts)).toMatchObject({
      kind: 'post',
      input: { excludedFromReport: true, eventId: 'ev-1', photoIds: ['p1'] },
    });
  });

  it('keeps the receipt on a bill once someone else is added to it', () => {
    // Attach the photo, then add Andi: the photo used to vanish, because SplitBillInput had no room for it.
    expect(formToPost({ ...draft, photoIds: ['p1', 'p2'], with: [{ debtAccountId: '', name: 'Andi', amount: '100000' }] }, accounts)).toMatchObject({
      kind: 'split',
      input: { photoIds: ['p1', 'p2'] },
    });
  });

  it('keeps the original pair on a foreign income, not only on a foreign expense', () => {
    // §3.3: the two columns are kept for "any expense or income" whose currency differs from the account's.
    // The charged figure is what posts in IDR; the 120 CNY is what the payer sent.
    expect(formToPost({ ...foreign, mode: 'income', categoryId: 'inc-salary' }, accounts)).toMatchObject({
      kind: 'post',
      input: { originalCurrency: 'CNY', originalAmountMinor: 12_000, lines: incomeLines({ incomeAccountId: 'inc-salary', depositAccountId: 'acct-bank', amountMinor: 272_400, currency: 'IDR' }) },
    });
    // An income in the account's own currency still clears both, exactly as an expense does.
    expect(formToPost({ ...draft, mode: 'income', categoryId: 'inc-salary' }, accounts)).toMatchObject({
      kind: 'post',
      input: { originalCurrency: null, originalAmountMinor: null },
    });
    // A card's own facts stay a purchase's: income on a card carries no MCC and no card id.
    expect(formToPost({ ...draft, mode: 'income', categoryId: 'inc-salary', moneyId: 'acct-card', mcc: '5814', cardId: 'card-1' }, accounts)).toMatchObject({
      kind: 'post',
      input: { mcc: null, cardId: null },
    });
  });
});

describe('a bill spread over several categories', () => {
  it('posts a split typed from scratch, with no figure in the amount row', () => {
    // A split has no top-level amount — the rows are the figure. Asking for one made every split unsaveable.
    expect(
      formToPost(
        {
          ...emptyForm('ws-1'),
          moneyId: 'acct-bank',
          currency: 'IDR',
          splits: [
            { categoryId: 'cat-restaurants', amount: '250000' },
            { categoryId: 'cat-groceries', amount: '150000' },
          ],
        },
        accounts,
      ),
    ).toMatchObject({
      kind: 'post',
      input: {
        lines: splitExpenseLines({
          paymentAccountId: 'acct-bank',
          currency: 'IDR',
          splits: [
            { categoryAccountId: 'cat-restaurants', amountMinor: 250_000 },
            { categoryAccountId: 'cat-groceries', amountMinor: 150_000 },
          ],
        }),
      },
    });
  });

  it('reopens a split and saves it again as the same posting', () => {
    const form = formFromTransaction(splitPurchase, accounts);
    expect(form).toMatchObject({ amount: '', splits: [{ categoryId: 'cat-restaurants', amount: '250000' }, { categoryId: 'cat-groceries', amount: '150000' }] });
    expect(formToPost(form, accounts)).toMatchObject({
      kind: 'post',
      input: {
        lines: splitExpenseLines({
          paymentAccountId: 'acct-card',
          currency: 'IDR',
          splits: [
            { categoryAccountId: 'cat-restaurants', amountMinor: 250_000 },
            { categoryAccountId: 'cat-groceries', amountMinor: 150_000 },
          ],
        }),
      },
    });
  });

  it('reads each split row in the account’s own currency, not in rupiah', () => {
    // USD has exponent 2 and IDR has none, so `10.50` is 1050 minor units here and unreadable as IDR. Every
    // other split case on this page is IDR, where a currency mistake and a correct read give the same number.
    expect(
      formToPost(
        {
          ...emptyForm('ws-1'),
          moneyId: 'acct-usd',
          currency: 'USD',
          splits: [
            { categoryId: 'cat-restaurants', amount: '10.50' },
            { categoryId: 'cat-groceries', amount: '5.25' },
          ],
        },
        accounts,
      ),
    ).toMatchObject({
      kind: 'post',
      input: {
        lines: splitExpenseLines({
          paymentAccountId: 'acct-usd',
          currency: 'USD',
          splits: [
            { categoryAccountId: 'cat-restaurants', amountMinor: 1050 },
            { categoryAccountId: 'cat-groceries', amountMinor: 525 },
          ],
        }),
      },
    });
  });

  it('agrees with a sum typed in the amount row, in the currency that row is read in', () => {
    // The amount row accepts an expression — that is what the keypad and the desktop's Enter are for — so the
    // check that the rows add up must read it the same way, through `evaluateAmount`, and not through a
    // second, weaker reader that answers `250000+150000` with "Invalid amount".
    const sum = {
      ...draft,
      amount: '250000+150000',
      splits: [
        { categoryId: 'cat-restaurants', amount: '250000' },
        { categoryId: 'cat-groceries', amount: '150000' },
      ],
    };
    expect(formToPost(sum, accounts)).toMatchObject({ kind: 'post', input: { lines: [expect.objectContaining({ amountMinor: 250_000 }), expect.objectContaining({ amountMinor: 150_000 }), expect.objectContaining({ amountMinor: -400_000 })] } });
    // An expression that comes out somewhere else is still a disagreement, said in the same words.
    expect(() => formToPost({ ...sum, amount: '250000+150001' }, accounts)).toThrow('The splits must add up to the amount');
    // And one that cannot be read at all is refused in words rather than as a raw MoneyError.
    expect(() => formToPost({ ...sum, amount: '400.000,00,00' }, accounts)).toThrow('The splits must add up to the amount');
    // In USD too: `10.50+5.25` is 1575 and agrees, where read as IDR it could not be read at all.
    expect(
      formToPost(
        { ...emptyForm('ws-1'), moneyId: 'acct-usd', currency: 'USD', amount: '10.50+5.25', splits: [{ categoryId: 'cat-restaurants', amount: '10.50' }, { categoryId: 'cat-groceries', amount: '5.25' }] },
        accounts,
      ),
    ).toMatchObject({ kind: 'post' });
  });

  it('refuses a split typed in a currency the account does not settle in, in words', () => {
    // A split's rows *are* the figure and they post in the account's own currency; there is no second row to
    // carry what the merchant charged, so the pair §3.3 keeps has nowhere to live. Reachable since the currency
    // sheet arrived, and it used to answer with a core error about decimal places.
    expect(() =>
      formToPost(
        { ...emptyForm('ws-1'), moneyId: 'acct-bank', currency: 'USD', splits: [{ categoryId: 'cat-restaurants', amount: '10.50' }, { categoryId: 'cat-groceries', amount: '5.25' }] },
        accounts,
      ),
    ).toThrow('A split is entered in IDR. Change the currency back to IDR, or remove the split.');
  });

  it('will not let the amount row and the splits disagree in silence', () => {
    const split = {
      ...draft,
      splits: [
        { categoryId: 'cat-restaurants', amount: '250000' },
        { categoryId: 'cat-groceries', amount: '150000' },
      ],
    };
    // 120.000 in the amount row against 400.000 of splits: the old behaviour posted 400.000 and said nothing.
    expect(() => formToPost(split, accounts)).toThrow('The splits must add up to the amount');
    // A figure that does agree is no objection — a screen may keep the row in step with the rows below it.
    expect(formToPost({ ...split, amount: '400000' }, accounts)).toMatchObject({ kind: 'post' });
  });

  /**
   * A bill split by category and a bill shared with somebody, together.
   *
   * `extraRows` offers both rows on any new expense, and the pair used to post `splitBill` one category and the
   * sum of the rows: an 85.000 bill split Restaurants 50.000 / Groceries 35.000 and shared with Andi posted
   * `ownCategoryId: cat-restaurants, totalMinor: 85000` — the Groceries row gone and its 35.000 filed under
   * Restaurants, with no error and both rows still on the screen above Save.
   */
  describe('a split by category shared with somebody', () => {
    const both: FormDraft = {
      ...draft,
      amount: '',
      splits: [
        { categoryId: 'cat-restaurants', amount: '50000' },
        { categoryId: 'cat-groceries', amount: '35000' },
      ],
      withEqually: true,
      with: [{ debtAccountId: '', name: 'Andi', amount: '' }],
    };

    it('is refused in words rather than filing one category’s money under another', () => {
      expect(() => formToPost(both, accounts)).toThrow(SPLIT_WITH_REFUSAL);
      // The words name both ways out, because either one is a whole answer on its own.
      expect(SPLIT_WITH_REFUSAL).toContain('Remove the splits, or remove the people');
    });

    it('cannot reach splitBill at all, whichever half is dropped', () => {
      // Neither of the two shapes the old code could post is posted now: no split bill naming one category,
      // and no plain posting that quietly forgets Andi.
      expect(() => formToPost(both, accounts)).toThrow();
      // Take the people away and the split posts, both categories intact — the fix refuses the pair, not Split.
      expect(formToPost({ ...both, with: [] }, accounts)).toMatchObject({
        kind: 'post',
        input: {
          lines: splitExpenseLines({
            paymentAccountId: 'acct-bank',
            currency: 'IDR',
            splits: [
              { categoryAccountId: 'cat-restaurants', amountMinor: 50_000 },
              { categoryAccountId: 'cat-groceries', amountMinor: 35_000 },
            ],
          }),
        },
      });
      // Take the splits away and the shared bill posts, all 85.000 of it under the one category chosen.
      expect(formToPost({ ...both, splits: [], amount: '85000' }, accounts)).toMatchObject({
        kind: 'split',
        input: { totalMinor: 85_000, ownCategoryId: 'cat-restaurants', ownShareMinor: 42_500, shares: [{ amountMinor: 42_500 }] },
      });
    });

    it('greys out whichever row was not set first, and only that one', () => {
      // Nothing set: both rows are free, which is the state the combination is offered from.
      expect(extraRowRefusal('split', draft)).toBeNull();
      expect(extraRowRefusal('with', draft)).toBeNull();
      // A split set first closes With, and leaves Split itself open to be corrected.
      const split = { ...both, with: [] };
      expect(extraRowRefusal('with', split)).toBe(SPLIT_WITH_REFUSAL);
      expect(extraRowRefusal('split', split)).toBeNull();
      // People set first close Split, the same way round.
      const shared = { ...both, splits: [] };
      expect(extraRowRefusal('split', shared)).toBe(SPLIT_WITH_REFUSAL);
      expect(extraRowRefusal('with', shared)).toBeNull();
      // A row still being typed into names nobody, so it closes nothing.
      expect(extraRowRefusal('split', { ...both, splits: [], with: [{ debtAccountId: '', name: '  ', amount: '' }] })).toBeNull();
    });

    it('leaves a split with no category chosen a way out rather than a dead end', () => {
      // Open Split before choosing a category and the Category row goes; the save then asked for a category
      // there was no row anywhere to give it, and only deleting every split escaped. It asks for none now.
      const noCategory = { ...both, categoryId: '', with: [] };
      expect(formToPost(noCategory, accounts)).toMatchObject({ kind: 'post' });
      // And with Andi on it the refusal is the one that names the escape, not "Choose a category".
      expect(() => formToPost({ ...noCategory, with: both.with }, accounts)).toThrow(SPLIT_WITH_REFUSAL);
    });
  });

  it('keeps the photos and the exclusion on a buy or sell, which had nowhere to put them', () => {
    // §4 scopes both to "always" and `extraRows` answers both for a trade — but the card drew the row in the
    // expense branch alone, so the tab computed two rows nothing drew and `recordTrade` was handed neither.
    const trade: FormDraft = {
      ...emptyForm('ws-1'),
      mode: 'trade',
      excluded: true,
      photoIds: ['p1'],
      purchase: { ...emptyForm('ws-1').purchase, accountId: 'acct-gold', moneyId: 'acct-bank', amount: '3980000', units: '2', occurredOn: '2026-09-17' },
    };
    expect(formToPost(trade, accounts)).toMatchObject({
      kind: 'trade',
      input: { grossMinor: 3_980_000, excludedFromReport: true, photoIds: ['p1'] },
    });
    // Unset, they are not invented: an ordinary trade is in the report like everything else.
    expect(formToPost({ ...trade, excluded: false, photoIds: [] }, accounts)).toMatchObject({
      kind: 'trade',
      input: { excludedFromReport: false, photoIds: [] },
    });
  });

  it('still names the split row whose category is missing', () => {
    expect(() =>
      formToPost({ ...draft, amount: '', splits: [{ categoryId: 'cat-restaurants', amount: '250000' }, { categoryId: '', amount: '150000' }] }, accounts),
    ).toThrow('Choose a category for split 2');
  });

  it('leaves you the remainder when the bill is split equally and will not divide', () => {
    const shared = formToPost(
      {
        ...draft,
        amount: '100001',
        withEqually: true,
        with: [
          { debtAccountId: '', name: 'Andi', amount: '' },
          { debtAccountId: '', name: 'Putri', amount: '' },
        ],
      },
      accounts,
    );
    // floor(100001/3) = 33.333 each; the odd 2 stays with you rather than being asked of anyone.
    expect(shared).toMatchObject({
      kind: 'split',
      input: { totalMinor: 100_001, ownShareMinor: 33_335, shares: [{ amountMinor: 33_333 }, { amountMinor: 33_333 }] },
    });
  });

  it('keeps the same messages the old form threw', () => {
    expect(() => formToPost({ ...draft, categoryId: '' }, accounts)).toThrow('Choose a category');
    expect(() => formToPost({ ...transfer, moneyId: '' }, accounts)).toThrow('Choose the From account');
    expect(() => formToPost({ ...draft, mcc: '58' }, accounts)).toThrow('An MCC is four digits, like 5814');
    expect(() => formToPost({ ...transfer, moneyId: 'acct-card', toId: 'acct-card' }, accounts)).toThrow('From and To must differ');
  });

  it('asks for the charged figure by the account’s own currency, and never posts the foreign one by mistake', () => {
    expect(() => formToPost({ ...foreign, chargedAmount: '' }, accounts)).toThrow('Enter the amount charged in IDR');
  });

  it('carries a typed MCC on a card and drops it off a bank account', () => {
    expect(formToPost({ ...draft, moneyId: 'acct-card', mcc: '5814' }, accounts)).toMatchObject({ kind: 'post', input: { mcc: '5814' } });
    expect(formToPost({ ...draft, mcc: '5814' }, accounts)).toMatchObject({ kind: 'post', input: { mcc: null } });
  });

  it('says the sheet cannot hold a split, a transfer or a foreign purchase', () => {
    expect(canEditInSheet(plainExpense)).toBe(true);
    expect(canEditInSheet(splitPurchase)).toBe(false);
    expect(canEditInSheet(transferTx)).toBe(false);
    expect(canEditInSheet(foreignPurchase)).toBe(false);
  });
});

describe('what a transaction reads back as', () => {
  it('reopens a foreign purchase with the typed currency on the flag and the charge underneath', () => {
    const form = formFromTransaction(foreignPurchase, accounts);
    expect(form).toMatchObject({ currency: 'CNY', amount: '120.00', chargedAmount: '272400', editing: true });
    // And it goes back out as the same posting it came from.
    expect(formToPost({ ...form, categoryId: 'cat-restaurants' }, accounts)).toMatchObject({
      kind: 'post',
      input: { originalCurrency: 'CNY', originalAmountMinor: 12_000, lines: expenseLines({ categoryAccountId: 'cat-restaurants', paymentAccountId: 'acct-card', amountMinor: 272_400, currency: 'IDR' }) },
    });
  });

  it('reopens what was chosen beside the money', () => {
    const form = formFromTransaction(view({ ...plainExpense, channel: 'offline', excluded: true, eventId: 'ev-1' }), accounts);
    expect(form).toMatchObject({ channel: 'offline', excluded: true, eventId: 'ev-1' });
  });
});

describe('the amount row on a desktop keyboard', () => {
  it('works the expression out on Enter and holds the save back until it stops changing', () => {
    expect(amountAfterEnter('85000+15000', 'IDR')).toEqual({ text: '100000', submit: false });
    // Second Enter: the field no longer changes, so the form may save.
    expect(amountAfterEnter('100000', 'IDR')).toEqual({ text: '100000', submit: true });
  });

  it('leaves an expression it cannot read alone rather than clearing it', () => {
    expect(amountAfterEnter('85000+', 'IDR')).toEqual({ text: '85000+', submit: true });
  });

  it('reads a decimal figure the way the rest of the app does', () => {
    // The 100x bug: '10.50' in USD is ten dollars fifty, and a row that stripped the separator itself would
    // write back '1050.00'. Asserting the text it writes back is what catches that.
    expect(amountAfterEnter('10.50', 'USD')).toEqual({ text: '10.50', submit: true });
    expect(evaluateAmount('10.50', 'USD')).toBe(parseMajor('10.50', 'USD'));
    expect(amountAfterEnter('10.50×3', 'USD')).toEqual({ text: '31.50', submit: false });
  });

  it('never strips a separator of its own, whichever one was typed', () => {
    // The most natural "help the user who typed 1,000,000" patch is `value.replace(/,/g,'')` before the
    // evaluator — and it turns ten dollars fifty into a thousand and fifty. `parseMajor` is the only thing in
    // the app allowed an opinion about separators; a symmetric example could never have caught this.
    expect(amountAfterEnter('10,50', 'USD')).toEqual({ text: '10.50', submit: false });
    expect(amountAfterEnter('1,000,000', 'IDR')).toEqual({ text: '1000000', submit: false });
  });

  it('reads a count as a count and a divisor as a divisor, in a currency with three decimals', () => {
    // KWD has exponent 3, so `parseMajor('3','KWD')` is 3000: a multiplier read as money here is a 1000x
    // error, which the USD cases above (exponent 2) could only have shown as 100x.
    expect(amountAfterEnter('0.500×3', 'KWD')).toEqual({ text: '1.500', submit: false });
    // The divisor path, which nothing exercised at all: through `parseMajor` the 4 would be 400 and this
    // would settle at '0.25'.
    expect(amountAfterEnter('100.00÷4', 'USD')).toEqual({ text: '25.00', submit: false });
  });

  it('drops the decimals a zero-exponent currency does not have', () => {
    // '1.00' in JPY is one yen. A row that stripped the dot and kept the digits would write back '100'.
    expect(amountAfterEnter('1.00', 'JPY')).toEqual({ text: '1', submit: false });
  });

  it('reads the same dot as thousands where the currency has no decimals', () => {
    // The other direction of the same bug: '120.000' in IDR is a hundred and twenty thousand, not 120. Which
    // of '.' and ',' is a decimal point depends on the figure and the currency, and `parseMajor` is the only
    // thing in the app that decides it — this row must not have an opinion of its own.
    expect(amountAfterEnter('120.000', 'IDR')).toEqual({ text: '120000', submit: false });
    expect(amountAfterEnter('120.000+35.000', 'IDR')).toEqual({ text: '155000', submit: false });
  });
});

describe('the keypad', () => {
  it('lays its keys out as the dock draws them, with no Save', () => {
    expect(KEYPAD_KEYS).toEqual(['C', '÷', '×', '⌫', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', 'DONE', '0', '000', '00']);
    expect(KEYPAD_KEYS).not.toContain('Save');
  });

  it('appends, clears and backspaces what was typed', () => {
    expect(keypadPress('85', '000')).toBe('85000');
    expect(keypadPress('85000', '+')).toBe('85000+');
    expect(keypadPress('85000', '⌫')).toBe('8500');
    expect(keypadPress('85000', 'C')).toBe('');
    // ⌫ on an empty row stays empty rather than going negative.
    expect(keypadPress('', '⌫')).toBe('');
  });

  it('DONE writes the figure the rest of the app would read, in the currency it was typed in', () => {
    // The only phone path for money. When DONE re-implemented this instead of calling it, `minor * 100` and
    // `minorToMajorString(minor, 'IDR')` both survived the whole suite.
    expect(amountAfterDone('85000+15000', 'IDR')).toEqual({ text: '100000', close: true });
    expect(amountAfterDone('10.50', 'USD')).toEqual({ text: '10.50', close: true });
    expect(amountAfterDone('10.50×3', 'USD')).toEqual({ text: '31.50', close: true });
    // Not IDR by accident: the same text settles differently in a currency with decimals and one without.
    expect(amountAfterDone('120.000', 'IDR')).toEqual({ text: '120000', close: true });
    expect(amountAfterDone('120.000', 'KWD')).toEqual({ text: '120.000', close: true });
  });

  it('closes on a figure already in its final form, and stays open on one it cannot read', () => {
    // `close` is not `amountAfterEnter`'s `submit`: '100000' has nothing left to work out, and DONE must still
    // put the keypad away rather than sit there doing nothing.
    expect(amountAfterDone('100000', 'IDR')).toEqual({ text: '100000', close: true });
    expect(amountAfterDone('85000+', 'IDR')).toEqual({ text: '85000+', close: false });
    expect(amountAfterDone('', 'IDR')).toEqual({ text: '', close: false });
  });

  it('routes every key, DONE included, through one decision the dock only has to obey', () => {
    // `Keypad.tsx` holds no arithmetic: it calls this. A key that decided anything for itself would be a
    // second money path, and the second money path is the one no test walks.
    expect(keypadAction('85', 'IDR', '000')).toEqual({ text: '85000', close: false });
    expect(keypadAction('85000', 'IDR', '−')).toEqual({ text: '85000−', close: false });
    expect(keypadAction('85000', 'IDR', 'C')).toEqual({ text: '', close: false });
    expect(keypadAction('85000+15000', 'IDR', 'DONE')).toEqual({ text: '100000', close: true });
    expect(keypadAction('10.50×3', 'USD', 'DONE')).toEqual({ text: '31.50', close: true });
    expect(keypadAction('85000+', 'IDR', 'DONE')).toEqual({ text: '85000+', close: false });
  });
});

describe('which currency each money field is read in', () => {
  it('reads the typed figure in the flag’s currency and the charged figure in the account’s', () => {
    // The 100x class, one layer over the arithmetic: `settledAmount` made the *reading* single, and this makes
    // the *units* single. The field, the keypad and the label all take one record, so no two readers of one
    // figure can disagree about its scale — CNY has two decimals and IDR none, so a swap here is a 100x error.
    const fields = amountFields(foreign, accounts, 'IDR');
    expect(fields.amount).toEqual({ which: 'amount', label: 'Amount', value: '120', currency: 'CNY' });
    expect(fields.charged).toEqual({ which: 'charged', label: 'Charged in IDR', value: '272400', currency: 'IDR' });
    // And what each field says it is worth is what the kit's one reader makes of it, at that scale.
    expect(evaluateAmount(fields.amount.value, fields.amount.currency)).toBe(12_000);
    expect(evaluateAmount(fields.charged!.value, fields.charged!.currency)).toBe(272_400);
  });

  it('offers no charged field when the figure is typed in the account’s own currency', () => {
    expect(amountFields(draft, accounts, 'IDR')).toEqual({ amount: { which: 'amount', label: 'Amount', value: '120000', currency: 'IDR' }, charged: null });
    // A USD account typed in USD: still one field, and still read in USD rather than in the workspace's base.
    expect(amountFields({ ...draft, moneyId: 'acct-usd', currency: 'USD', amount: '10.50' }, accounts, 'IDR').amount.currency).toBe('USD');
  });

  it('falls back to the workspace’s own currency before an account is chosen', () => {
    // Never empty: `parseMajor` needs a currency to know the scale, and '' is not one.
    expect(amountFields({ ...emptyForm('ws-1'), amount: '12' }, accounts, 'KWD').amount.currency).toBe('KWD');
  });
});

describe('what the charged row opens with', () => {
  it('converts the typed figure at the day’s rate into the account’s own currency', () => {
    // 120 CNY at 2.270 IDR per CNY. IDR has no decimals and CNY has two, so this is the exponent shift too.
    expect(estimatedCharge({ amount: '120', currency: 'CNY', accountCurrency: 'IDR', rate: 2270 })).toBe('272400');
    // The other direction, where the account has the decimals: 272.400 IDR at 1/2270 is ¥120,00.
    expect(estimatedCharge({ amount: '272400', currency: 'IDR', accountCurrency: 'CNY', rate: 1 / 2270 })).toBe('120.00');
    // An expression in the amount row is read the same way the row itself reads it.
    expect(estimatedCharge({ amount: '100+20', currency: 'CNY', accountCurrency: 'IDR', rate: 2270 })).toBe('272400');
  });

  it('offers nothing rather than a guess', () => {
    expect(estimatedCharge({ amount: '120', currency: 'CNY', accountCurrency: 'IDR', rate: null })).toBeNull();
    expect(estimatedCharge({ amount: '', currency: 'CNY', accountCurrency: 'IDR', rate: 2270 })).toBeNull();
    expect(estimatedCharge({ amount: '120+', currency: 'CNY', accountCurrency: 'IDR', rate: 2270 })).toBeNull();
    // Same currency on both sides: there is no charged row to fill.
    expect(estimatedCharge({ amount: '120', currency: 'IDR', accountCurrency: 'IDR', rate: 1 })).toBeNull();
  });
});

describe('the rate the charged row suggests', () => {
  it('reads a rate against the base currency the right way round', () => {
    // 2.270 IDR per 1 CNY — not 1/2270, which would suggest the account was charged 0,05 rupiah.
    expect(suggestedRate({ rates: { CNY: 2270 }, from: 'CNY', to: 'IDR', base: 'IDR' })).toBe(2270);
  });

  it('crosses a pair that never touches the base', () => {
    expect(suggestedRate({ rates: { USD: 16_000, CNY: 2000 }, from: 'USD', to: 'CNY', base: 'IDR' })).toBe(8);
  });

  it('gives nothing rather than a guess when a leg is unknown', () => {
    expect(suggestedRate({ rates: { USD: 16_000 }, from: 'USD', to: 'CNY', base: 'IDR' })).toBeNull();
    expect(suggestedRate({ rates: {}, from: 'IDR', to: 'IDR', base: 'IDR' })).toBe(1);
  });
});

describe('the quiet line under the charged row', () => {
  it('names the rate, the day it came from and the account that charged it', () => {
    expect(chargedHint({ rate: 2270, currency: 'CNY', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'BCA Tahapan' })).toBe(
      '≈ 2.270 per 1 CNY · suggested from 2026-09-17, change it to what BCA Tahapan charged',
    );
  });

  it('does not claim a stale rate came from the day it is shown against', () => {
    expect(chargedHint({ rate: 2270, currency: 'CNY', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'BCA Tahapan', stale: true })).toBe(
      '≈ 2.270 per 1 CNY · the last CNY→IDR rate known, change it to what BCA Tahapan charged',
    );
  });

  it('says so when no rate is known', () => {
    expect(chargedHint({ rate: null, currency: 'CNY', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'BCA Tahapan' })).toBe(
      'No CNY→IDR rate is known for 2026-09-17. Enter what BCA Tahapan charged.',
    );
  });

  it('can be told which locale to write the number in', () => {
    // Country-neutral: only the tax report is Indonesia's. The function took six named parameters and could
    // not be told a locale, so `1,234.5` was unreachable however the app was read. `formatMinor` has always
    // taken its locale this way, with the same default, so this is that convention rather than a new one.
    const named = { rate: 1234.5, currency: 'USD', accountCurrency: 'IDR', onDate: '2026-09-17', accountName: 'Wise USD' };
    expect(chargedHint({ ...named, locale: 'en-US' })).toContain('≈ 1,234.5 per 1 USD');
    expect(chargedHint({ ...named, locale: 'de-DE' })).toContain('≈ 1.234,5 per 1 USD');
    // Unasked, it still writes the way the rest of this app writes numbers.
    expect(chargedHint(named)).toContain('≈ 1.234,5 per 1 USD');
  });
});

describe('the currency sheet', () => {
  it('puts the paying account first, then the workspace, then what was used lately', () => {
    expect(recentCurrencies({ accountCurrency: 'CNY', baseCurrency: 'IDR', stored: ['USD', 'SGD', 'JPY', 'THB'] })).toEqual(['CNY', 'IDR', 'USD', 'SGD', 'JPY']);
  });

  it('never repeats one and survives an account with no currency', () => {
    expect(recentCurrencies({ accountCurrency: '', baseCurrency: 'IDR', stored: ['IDR', 'USD'] })).toEqual(['IDR', 'USD']);
  });

  it('drops a code no longer in the list', () => {
    expect(recentCurrencies({ accountCurrency: 'IDR', baseCurrency: 'IDR', stored: ['XXX', 'USD'] })).toEqual(['IDR', 'USD']);
  });
});

/**
 * The shares the With sheet shows and the shares `formToPost` posts, proved to be the same arithmetic.
 *
 * Every figure here is uneven and most of them are in USD. An even division cannot tell a floored share from a
 * halving and so cannot exercise the remainder rule at all; and IDR has exponent 0, so an IDR-only fixture reads
 * the same whether the currency was honoured or ignored. This path was pinned in IDR alone once already.
 */
describe('withShares', () => {
  /**
   * US$100.03 on the USD account: uneven in a currency with two decimal places, and uneven the one way that
   * separates floor from round. 10001/4 is 2500.25, which floors and rounds to the same 2500 — so the fixture
   * this replaces survived a `Math.round` put where `Math.floor` is. 10003/4 is 2500.75: floored it is 2500
   * each and the odd 3 cents come back to you; rounded it would be 2501 each and the shares would come to
   * more than the bill.
   */
  const usd: FormDraft = { ...draft, moneyId: 'acct-usd', currency: 'USD', amount: '100.03' };
  const people = (...names: string[]) => names.map((name) => ({ debtAccountId: '', name, amount: '' }));

  it('divides a bill that does not divide evenly, and leaves the odd units with you', () => {
    const bill = billMinor({ ...usd, withEqually: true, with: people('Andi', 'Budi', 'Citra') }, accounts);
    expect(bill).toBe(10_003);
    const shared = withShares({ ...usd, withEqually: true, with: people('Andi', 'Budi', 'Citra') }, 'USD', bill!, { lenient: true });
    // floor(10003/4) = 2500 each — 2501 if it were rounded — and the odd 3 cents stay with you.
    expect(shared.each).toEqual([2500, 2500, 2500]);
    expect(shared.ownShareMinor).toBe(2503);
    // And the whole point of the rule: the four shares are the bill again, to the cent.
    expect(shared.each.reduce((sum, share) => sum + share, 0) + shared.ownShareMinor!).toBe(10_003);
  });

  it('leaves you what is left when a share is typed, rather than half of anything', () => {
    const typed = { ...usd, with: [{ debtAccountId: '', name: 'Andi', amount: '33.34' }] };
    const shown = withShares(typed, 'USD', 10_003, { lenient: true });
    // US$33.34 is 3334 cents, not 33 and not 3334 rupiah: the figure is read in the currency it was typed in.
    expect(shown.each).toEqual([3334]);
    // 6669, never 5001: what is left of the bill, not half of it.
    expect(shown.ownShareMinor).toBe(6669);
  });

  it('reads a half-typed share as nothing for the card, and refuses it at the save', () => {
    const halfTyped = { ...usd, with: [{ debtAccountId: '', name: 'Andi', amount: '' }] };
    // The card is read while the row is still being typed into, so nothing owed yet is nothing owed.
    expect(withShares(halfTyped, 'USD', 10_003, { lenient: true })).toMatchObject({ each: [0], ownShareMinor: 10_003 });
    // The save is the opposite bargain: a share of zero must never post as somebody owing nothing. An empty
    // box never reaches `positive`'s own "greater than zero", and `parseMajor` has no words for it either —
    // it answers `Invalid amount: ""`, the kit talking to itself. So the empty case says which box and what
    // to do about it, naming the share rather than the string that was not in it.
    expect(() => withShares(halfTyped, 'USD', 10_003, { lenient: false })).toThrow('Share 1 is empty — type a figure');
  });

  it('says so rather than showing a share below zero when the shares come to more than the bill', () => {
    const tooMuch = { ...usd, with: [{ debtAccountId: '', name: 'Andi', amount: '120' }] };
    expect(withShares(tooMuch, 'USD', 10_003, { lenient: true }).ownShareMinor).toBeNull();
    expect(() => withShares(tooMuch, 'USD', 10_003, { lenient: false })).toThrow('Their shares come to more than the bill');
  });

  it('is the same arithmetic the save posts, to the cent', () => {
    const shared = { ...usd, withEqually: true, with: people('Andi', 'Budi', 'Citra') };
    const shown = withShares(shared, 'USD', 10_003, { lenient: true });
    expect(formToPost(shared, accounts)).toMatchObject({
      kind: 'split',
      input: { totalMinor: 10_003, ownShareMinor: shown.ownShareMinor, shares: shown.each.map((amountMinor) => ({ amountMinor })) },
    });
  });

  it('divides the figure the save divides: a split by category is its rows, a foreign purchase is what was charged', () => {
    // The amount row is never the bill when the rows are: 40.50 + 44.50 in USD, not the empty amount field.
    const bySplit = { ...usd, amount: '', splits: [{ categoryId: 'cat-restaurants', amount: '40.50' }, { categoryId: 'cat-restaurants', amount: '44.50' }] };
    expect(billMinor(bySplit, accounts)).toBe(8500);
    // 120 CNY charged to the IDR account as 272.400: the bill is what the account paid, not what was typed.
    expect(billMinor(foreign, accounts)).toBe(272_400);
  });
});

describe('the charged row while it still belongs to the estimate', () => {
  /** How a person enters ¥120: three separate amounts, each a whole figure the moment it is on screen. */
  const typeDigitByDigit = (digits: string, rate: number | null) => {
    let charged = '';
    for (let i = 1; i <= digits.length; i += 1) {
      const estimate = estimatedCharge({ amount: digits.slice(0, i), currency: 'CNY', accountCurrency: 'IDR', rate });
      charged = prefilledCharge({ estimate, charged, touched: false }) ?? charged;
    }
    return charged;
  };

  it('tracks the amount through every keystroke, not only the first', () => {
    // Rp 272.400 — the conversion of ¥120. **Not Rp 2.270**, which is the rate for ¥1: the row used to lock
    // onto the first keystroke, because "the row is empty" was read as "the user has not touched it" and the
    // first digit is what stops it being empty. That figure is the one that posts.
    expect(typeDigitByDigit('120', 2270)).toBe('272400');
    // And it is the same figure a paste of the whole amount gives, which is all `fill()` ever exercised.
    expect(estimatedCharge({ amount: '120', currency: 'CNY', accountCurrency: 'IDR', rate: 2270 })).toBe('272400');
  });

  it('leaves the row empty while there is no rate to convert at, however much is typed', () => {
    expect(typeDigitByDigit('120', null)).toBe('');
  });

  it('is the user’s from the moment they write in it — or clear it', () => {
    // A figure the bank really took overrules the estimate, and a later keystroke in the amount cannot undo that.
    expect(prefilledCharge({ estimate: '272400', charged: '270000', touched: true })).toBeNull();
    // Cleared on purpose stays cleared: an empty row that is the user's is not an empty row that is free.
    expect(prefilledCharge({ estimate: '272400', charged: '', touched: true })).toBeNull();
  });

  it('follows the amount down to nothing as well as up, and then stops', () => {
    // The amount was deleted, so the conversion of it has no business still sitting in the row that posts.
    expect(prefilledCharge({ estimate: null, charged: '272400', touched: false })).toBe('');
    // Already right: nothing to write, so the effect settles in one pass rather than re-filling for ever.
    expect(prefilledCharge({ estimate: '272400', charged: '272400', touched: false })).toBeNull();
    expect(prefilledCharge({ estimate: null, charged: '', touched: false })).toBeNull();
  });
});

describe('what a shared bill and a tagged transfer carry', () => {
  /** A ¥120 dinner on the IDR credit card, charged as Rp 272.400, with Andi on it for half. */
  const sharedForeign: FormDraft = {
    ...foreign,
    moneyId: 'acct-card',
    cardId: 'card-8802',
    with: [{ debtAccountId: '', name: 'Andi', amount: '136200' }],
  };

  it('keeps the card a shared bill was paid on', () => {
    // §2: "Choosing it never changes the account or card." Without this the row prints no digits and the
    // receipt's "Paid with" names the bare account, so the points for the dinner belong to no card at all.
    expect(formToPost(sharedForeign, accounts)).toMatchObject({ kind: 'split', input: { cardId: 'card-8802' } });
    // A bill paid from a bank account has no card to name, exactly as a plain expense has none.
    expect(formToPost({ ...sharedForeign, moneyId: 'acct-bank' }, accounts)).toMatchObject({ kind: 'split', input: { cardId: null } });
  });

  it('keeps the original currency pair on a shared bill', () => {
    // The same pair `amounts()` worked out for the plain expense, off the same fields: ¥120 charged as Rp 272.400.
    expect(formToPost(sharedForeign, accounts)).toMatchObject({
      kind: 'split',
      input: { totalMinor: 272_400, originalCurrency: 'CNY', originalAmountMinor: 12_000 },
    });
    // A bill in the account's own currency has no original pair, and does not invent one.
    expect(formToPost({ ...sharedForeign, currency: 'IDR', amount: '272400', chargedAmount: '' }, accounts)).toMatchObject({
      kind: 'split',
      input: { originalCurrency: null, originalAmountMinor: null },
    });
  });

  it('carries the Received amount of a cross-currency transfer tagged to a goal', () => {
    // §2's "To · For goal · Received amount", all three at once. US$100,03 — an odd number of cents, so a
    // figure read at the wrong scale or rounded the wrong way cannot pass for the right one.
    const crossing: FormDraft = { ...transfer, moneyId: 'acct-bank', toId: 'acct-usd', amount: '1600000', toAmount: '100.03', goalId: 'goal-1' };
    expect(formToPost(crossing, accounts)).toMatchObject({
      kind: 'transfer-goal',
      input: { amountMinor: 1_600_000, toAmountMinor: 10_003, fromAccountId: 'acct-bank', toAccountId: 'acct-usd', goalId: 'goal-1' },
    });
    // Same currency on both sides: there is no second figure, and the screen draws no row for one.
    expect(formToPost({ ...transfer, moneyId: 'acct-bank', goalId: 'goal-1' }, accounts)).toMatchObject({
      kind: 'transfer-goal',
      input: { toAmountMinor: null },
    });
  });
});

describe('a transaction reopened for correction', () => {
  /*
   * The only hardcoded country currency left in the transaction kit, and it was wrong as well as parochial.
   * `formFromTransaction` wrote the figure with `minorToMajorString(amountMinor, settled || 'IDR')`, and its
   * own `?? ''` admitted the paying account can be absent from `accounts` — on a USD-base workspace the figure
   * was then written at IDR's exponent 0 and read back by the field at USD's exponent 2. US$85,00 is 8500
   * minor; at IDR's exponent that is the string "8500", which this app's own formatting reads as eight
   * thousand five hundred dollars. The entry knows what it posted in, so the entry is asked.
   */
  it('reads a figure at the exponent its own line posted in, never at a country\u2019s', () => {
    const abroad = view({
      entries: [
        { accountId: 'acct-elsewhere', accountKind: 'asset', accountName: 'A card nobody listed', amountMinor: -8_500, amountBaseMinor: -8_500, currency: 'USD' },
        spent('cat-restaurants', 8_500, 'USD'),
      ] as TransactionView['entries'],
    });
    // `acct-elsewhere` is deliberately not in `accounts`, which is the case the fallback exists for.
    expect(accounts.some((a) => a.id === 'acct-elsewhere')).toBe(false);
    expect(formFromTransaction(abroad, accounts, 'ws-1')).toMatchObject({ currency: 'USD', amount: '85.00' });
    // And with the account present it is the account's own currency, exactly as before.
    const known = view({ entries: [paid(-8_500, 'IDR'), spent('cat-restaurants', 8_500)] as TransactionView['entries'] });
    expect(formFromTransaction(known, accounts, 'ws-1')).toMatchObject({ currency: 'IDR', amount: '8500' });
  });

  it('opens with the pictures it already has, so the Photos row does not say None', () => {
    const dinner = view({ entries: [paid(-120_000), spent('cat-restaurants', 120_000)] as TransactionView['entries'] });
    expect(formFromTransaction(dinner, accounts, 'ws-1', ['photo-1', 'photo-2']).photoIds).toEqual(['photo-1', 'photo-2']);
    // A transaction with no pictures opens with none, and a caller that knows of none says so by saying nothing.
    expect(formFromTransaction(dinner, accounts, 'ws-1').photoIds).toEqual([]);
  });
});

/**
 * The sixth broken combination: **Transfer + the currency flag**.
 *
 * Proven in the built app before it was fixed. Transfer → From = BCA Tahapan (IDR) → tap the flag → USD →
 * type `100`. The card drew "Charged in IDR = 1600000" and "≈ 16.000 per 1 USD"; Save raised no error; Jago
 * received **Rp 100**. The transfer branch read the typed figure in the account's own currency, as it always
 * had, and `draft.currency` and `draft.chargedAmount` were read nowhere on that path.
 *
 * Nothing saw it because no transfer draft in this file ever set `currency`. Every draft below does.
 *
 * The property that matters is not "which branch runs" but **what the screen shows is what the save posts**:
 * the figure drawn in the row, read in the currency the row says it is in, is the figure that moves.
 */
describe('a transfer, and the currency flag that used to be drawn over it', () => {

  /** From BCA Tahapan, with the flag left on USD by a visit to the Expense tab. */
  const flagged: FormDraft = { ...transfer, moneyId: 'acct-bank', currency: 'USD', amount: '100' };

  it('offers no currency of its own, so no row is drawn that the save cannot honour', () => {
    expect(currencyChoosable(flagged)).toBe(false);
    // The flag's own reading, and the charged row's: both are the From account's currency, so there is no
    // second figure and no rate hint. `chargedInNeeded` had no mode test at all.
    expect(typedCurrency(flagged, accounts)).toBe('IDR');
    expect(chargedInNeeded(flagged, accounts)).toBe(false);
    expect(amountFields(flagged, accounts, 'IDR').charged).toBeNull();
    expect(amountFields(flagged, accounts, 'IDR').amount.currency).toBe('IDR');
    // Off a USD account the answer is USD, not the workspace's: it is the account's currency, never a fixed one.
    expect(typedCurrency({ ...flagged, moneyId: 'acct-usd', currency: 'IDR' }, accounts)).toBe('USD');
    // And every other mode still chooses freely — this removes a row from Transfer, not from the app.
    expect(currencyChoosable(foreign)).toBe(true);
    expect(chargedInNeeded(foreign, accounts)).toBe(true);
    expect(amountFields(foreign, accounts, 'IDR').charged).toMatchObject({ currency: 'IDR', value: '272400' });
  });

  it('posts the figure the row shows, read in the currency the row shows it in', () => {
    // The whole defect in one assertion: `1600000` was on screen under "Charged in IDR" and `100` was what
    // moved. Read the row the screen drew, parse it at the scale the screen labelled it with, and it has to be
    // the figure in the posting lines — for the plain transfer and for the goal-tagged one alike.
    for (const goalId of ['', 'goal-1']) {
      const shown = amountFields({ ...flagged, goalId }, accounts, 'IDR');
      const post = formToPost({ ...flagged, goalId, chargedAmount: '1600000' }, accounts);
      const posted =
        post.kind === 'transfer-goal'
          ? post.input.amountMinor
          : post.kind === 'post'
            ? -post.input.lines.find((line) => line.amountMinor < 0)!.amountMinor
            : NaN;
      expect(posted).toBe(parseMajor(shown.amount.value, shown.amount.currency));
      expect(posted).toBe(100);
    }
  });

  it('records no original pair on a transfer, because there is no merchant to have charged one', () => {
    const post = formToPost({ ...flagged, chargedAmount: '1600000' }, accounts);
    expect(post).toMatchObject({ kind: 'post', input: { originalCurrency: null, originalAmountMinor: null } });
    // Both legs in the From account's currency, and the charged row is read by nobody.
    expect(post.kind === 'post' && post.input.lines.every((line) => line.currency === 'IDR')).toBe(true);
  });

  it('still crosses currencies the way §3.5 says it does — through the To account and Received amount', () => {
    // Removing the flag takes nothing away: a cross-currency transfer is still expressible, and still exact.
    const crossing: FormDraft = { ...transfer, moneyId: 'acct-bank', toId: 'acct-usd', amount: '1600000', toAmount: '100.03', currency: 'USD' };
    const post = formToPost(crossing, withExchange);
    expect(post.kind).toBe('post');
    expect(post.kind === 'post' && post.input.lines.find((line) => line.accountId === 'acct-bank')?.amountMinor).toBe(-1_600_000);
    expect(post.kind === 'post' && post.input.lines.find((line) => line.accountId === 'acct-usd')?.amountMinor).toBe(10_003);
  });
});

/**
 * The figure a sheet totals is the figure Save takes.
 *
 * Every screen that reads money accepts arithmetic — the amount row evaluates on blur and on Enter, the keypad
 * computes it, the Split sheet added the rows up and printed "Total Rp 95.000", the With sheet divided by it.
 * `positive()` did not: it went straight to `parseMajor`, which cannot read `50000+10000`, so Save refused the
 * very figure the screen had just shown with `Invalid amount: "50000+10000"`. One reader now, for both.
 */
describe('arithmetic typed into a figure the save reads', () => {
  it('saves a split whose rows were typed as sums, at the total the sheet printed', () => {
    const split: FormDraft = { ...draft, amount: '', splits: [{ categoryId: 'cat-restaurants', amount: '50000+10000' }, { categoryId: 'cat-restaurants', amount: '35000' }] };
    // What the sheet said: the running total, through `evaluateAmount`.
    expect(splitTotalMinor(split.splits, 'IDR')).toBe(95_000);
    // What Save does with it. These were two different arithmetics; the second one threw.
    const post = formToPost(split, accounts);
    expect(post).toMatchObject({ kind: 'post' });
    expect(post.kind === 'post' && post.input.lines.find((line) => line.accountId === 'acct-bank')?.amountMinor).toBe(-95_000);
  });

  it('saves what each person owes when it was typed as a sum, at the share the card showed', () => {
    const shared: FormDraft = { ...draft, amount: '400000', with: [{ debtAccountId: '', name: 'Andi', amount: '100000+50000' }] };
    // The card: "1 person · They owe you Rp 150.000".
    expect(withShares(shared, 'IDR', 400_000, { lenient: true })).toMatchObject({ each: [150_000], ownShareMinor: 250_000 });
    // And Save, which used to throw `Invalid amount: "100000+50000"` on the very same rows.
    expect(formToPost(shared, accounts)).toMatchObject({
      kind: 'split',
      input: { totalMinor: 400_000, ownShareMinor: 250_000, shares: [{ person: { name: 'Andi', currency: 'IDR' }, amountMinor: 150_000 }] },
    });
  });

  it('saves an amount left as an expression by a dock closed without DONE', () => {
    // The dock can be shut from the backdrop, from Escape, or by tapping the Amount row again, and none of
    // those evaluates on the way out — where the desktop field's blur would have. Save reads it either way now.
    expect(formToPost({ ...draft, amount: '250000+150000' }, accounts)).toMatchObject({
      kind: 'post',
      input: { lines: [{ accountId: 'cat-restaurants', amountMinor: 400_000, currency: 'IDR' }, { accountId: 'acct-bank', amountMinor: -400_000, currency: 'IDR' }] },
    });
    // A transfer's Received amount is read by the same function, so it accepts the same arithmetic.
    expect(formToPost({ ...transfer, moneyId: 'acct-bank', toId: 'acct-usd', amount: '1600000', toAmount: '100+0.03' }, withExchange)).toMatchObject({
      kind: 'post',
      input: { lines: expect.arrayContaining([{ accountId: 'acct-usd', amountMinor: 10_003, currency: 'USD' }]) },
    });
  });

  it('still refuses what cannot be read, in the words that say why', () => {
    // No message is lost by evaluating first: `parseMajor` is still asked for the words when it has them.
    // The empty box is the one case it has none for — `Invalid amount: ""` reached the user verbatim — so
    // that one is worded here, naming the row it is about.
    expect(() => formToPost({ ...draft, amount: '' }, accounts)).toThrow('Amount is empty — type a figure');
    expect(() => formToPost({ ...draft, amount: '   ' }, accounts)).toThrow('Amount is empty — type a figure');
    expect(() => formToPost({ ...transfer, moneyId: 'acct-bank', toId: 'acct-usd', amount: '1600000', toAmount: '' }, withExchange)).toThrow(
      'Received amount is empty — type a figure',
    );
    expect(() => formToPost({ ...draft, amount: '0' }, accounts)).toThrow('Amount must be greater than zero');
    expect(() => formToPost({ ...draft, amount: '-5000' }, accounts)).toThrow('Amount must be greater than zero');
    // A decimal figure on a zero-exponent account still says which currency refused it and why.
    expect(() => formToPost({ ...foreign, chargedAmount: '272400.50' }, accounts)).toThrow('IDR allows 0 decimal places');
  });
});

/**
 * The currency a figure posts in, asked once — `MoreDetails` used to work it out again for itself.
 *
 * Every base currency below is deliberately **not** the expected answer wherever an account is chosen: a
 * workspace whose base is the account's own currency cannot tell "the account's" from "the workspace's", and
 * an example that cannot tell the two apart is an example that would pass either way.
 */
describe('which currency the extras read a figure in', () => {
  it('is the paying account’s own, whatever the flag says', () => {
    // An IDR account in a USD-base workspace: the split rows and the shares are read in IDR, what posts.
    expect(postingCurrency(draft, accounts, 'USD')).toBe('IDR');
    // And with the flag on CNY it is still IDR — the charged row is the one that posts, not the typed one.
    expect(postingCurrency(foreign, accounts, 'USD')).toBe('IDR');
    // The other way round, so the answer turns on the account rather than on IDR being the answer.
    expect(postingCurrency({ ...draft, moneyId: 'acct-usd', currency: '' }, accounts, 'IDR')).toBe('USD');
  });

  it('is the workspace’s own until an account is chosen, so a total is never written bare', () => {
    // No account yet: "Total US$0,00" rather than "Total 0". Save still refuses it with "Choose an account".
    expect(postingCurrency(emptyForm('ws-1'), accounts, 'USD')).toBe('USD');
    expect(postingCurrency(emptyForm('ws-1'), accounts, 'JPY')).toBe('JPY');
  });
});
