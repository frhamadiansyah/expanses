import { describe, expect, it } from 'vitest';
import { capturedCategory, dayNet, matchCategory, matchesSearch, matchPayment, merchantKey, parseLooseAmount, parseLooseDate, type PaymentOption } from '../src/index';

const TODAY = '2026-09-15';

describe('parseLooseDate', () => {
  it('reads the ways a date gets typed', () => {
    expect(parseLooseDate('2026-09-12', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('12/9', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('12/09/2026', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('12-9-26', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('12 sep', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('12 September 2025', TODAY)).toBe('2025-09-12');
    expect(parseLooseDate('Sep 12', TODAY)).toBe('2026-09-12');
    expect(parseLooseDate('21 April', TODAY)).toBe('2026-04-21');
    expect(parseLooseDate('April 21', TODAY)).toBe('2026-04-21');
  });

  it('puts the month first where people write it that way', () => {
    expect(parseLooseDate('9/12', TODAY, { dayFirst: false })).toBe('2026-09-12');
    expect(parseLooseDate('9/12', TODAY)).toBe('2026-12-09');
  });

  it('says nothing about what is not a real date', () => {
    for (const raw of ['', '31/2', '15 smarch', 'yesterday', '2026-13-01']) expect(parseLooseDate(raw, TODAY), raw).toBeNull();
  });
});

describe('parseLooseAmount', () => {
  it('reads rupiah however it is written, with no decimals to lose', () => {
    expect(parseLooseAmount('450000', 'IDR')).toBe(450_000);
    expect(parseLooseAmount('450.000', 'IDR')).toBe(450_000);
    expect(parseLooseAmount('Rp 1.250.000', 'IDR')).toBe(1_250_000);
  });

  it('keeps cents for a currency that has them', () => {
    expect(parseLooseAmount('45,20', 'SGD')).toBe(4520);
    expect(parseLooseAmount('1,250.50', 'USD')).toBe(125_050);
  });

  it('refuses nothing, negatives and nonsense rather than guessing', () => {
    for (const raw of ['', '0', '-5000', 'abc']) expect(parseLooseAmount(raw, 'IDR'), raw).toBeNull();
  });
});

describe('matchPayment', () => {
  const options: PaymentOption[] = [
    { accountId: 'krisflyer', cardId: 'c4411', accountName: 'BCA KrisFlyer', last4: '4411', holderName: null },
    { accountId: 'bonvoy', cardId: 'c1467', accountName: 'Mandiri Marriott Bonvoy', last4: '1467', holderName: 'Fandrian' },
    { accountId: 'bonvoy', cardId: 'c8802', accountName: 'Mandiri Marriott Bonvoy', last4: '8802', holderName: 'Spouse' },
    { accountId: 'cash', cardId: null, accountName: 'Cash', last4: null, holderName: null },
  ];

  it('finds the card from its digits or its holder', () => {
    expect(matchPayment('8802', options)).toEqual({ accountId: 'bonvoy', cardId: 'c8802' });
    expect(matchPayment('Mandiri Bonvoy 8802', options)).toEqual({ accountId: 'bonvoy', cardId: 'c8802' });
    expect(matchPayment('bonvoy spouse', options)).toEqual({ accountId: 'bonvoy', cardId: 'c8802' });
    expect(matchPayment('KrisFlyer', options)).toEqual({ accountId: 'krisflyer', cardId: 'c4411' });
  });

  it('knows the account but will not pick between its cards', () => {
    expect(matchPayment('Mandiri Bonvoy', options)).toEqual({ accountId: 'bonvoy', cardId: null });
  });

  it('matches nothing when the words point nowhere or everywhere', () => {
    expect(matchPayment('jenius', options)).toBeNull();
    expect(matchPayment('a', options)).toBeNull();
    expect(matchPayment('', options)).toBeNull();
  });
});

describe('matchCategory', () => {
  const options = [
    { id: 'groceries', name: 'Groceries', parentName: 'Household' },
    { id: 'restaurants', name: 'Restaurants', parentName: 'Food and beverage' },
    { id: 'cafe', name: 'Cafe & dessert', parentName: 'Food and beverage' },
    { id: 'fuel', name: 'Fuel cost', parentName: 'Transportation' },
  ];

  it('takes an exact name, or the one category every word points to', () => {
    expect(matchCategory('groceries', options)).toBe('groceries');
    expect(matchCategory('fuel', options)).toBe('fuel');
    expect(matchCategory('food cafe', options)).toBe('cafe');
  });

  it('leaves an ambiguous word alone', () => {
    expect(matchCategory('food', options)).toBeNull();
    expect(matchCategory('', options)).toBeNull();
  });
});

describe('matchesSearch', () => {
  const row = { text: ['Superindo Kemang', 'Groceries', 'Household', 'Mandiri Marriott Bonvoy', 'Spouse'], amountMinor: 450_000, last4: '8802' };

  it('matches on every word, across description, category, account and holder', () => {
    expect(matchesSearch(row, 'superindo')).toBe(true);
    expect(matchesSearch(row, 'household bonvoy')).toBe(true);
    expect(matchesSearch(row, 'superindo grab')).toBe(false);
  });

  it('matches digits against the amount however typed, or the card', () => {
    expect(matchesSearch(row, '450.000')).toBe(true);
    expect(matchesSearch(row, '450000')).toBe(true);
    expect(matchesSearch(row, '8802')).toBe(true);
    expect(matchesSearch(row, '999')).toBe(false);
  });

  it('matches everything when there is no query', () => {
    expect(matchesSearch(row, '  ')).toBe(true);
  });
});

describe('dayNet', () => {
  it('is income less spending, leaving transfers and uncounted rows out', () => {
    expect(
      dayNet([
        { kind: 'expense', amountMinor: 450_000, counted: true },
        { kind: 'income', amountMinor: 25_000_000, counted: true },
        { kind: 'transfer', amountMinor: 4_500_000, counted: true },
        { kind: 'expense', amountMinor: 685_000, counted: false },
      ]),
    ).toBe(24_550_000);
  });
});

describe('merchantKey', () => {
  it('reads a statement line and a typed name as the same merchant', () => {
    expect(merchantKey('SUPERINDO KEBAYORAN 0912')).toBe(merchantKey('Superindo Kebayoran'));
    expect(merchantKey('Grab*A-7X2')).toBe('grab');
  });
});

describe('merchantKey on what a capture reads', () => {
  it('leaves out the payment words, masked numbers and references a bank prints around the name', () => {
    const typed = merchantKey('Kedai Senja');
    expect(typed).toBe('kedai senja');
    expect(merchantKey('QRIS KEDAI SENJA')).toBe(typed);
    expect(merchantKey('KEDAI SENJA XXXX7731')).toBe(typed);
    expect(merchantKey('VA kedai  senja 004417')).toBe(typed);
    expect(merchantKey('EDC Kedai Senja REF 99812')).toBe(typed);
    expect(merchantKey('trx qris  KEDAI-SENJA')).toBe(typed);
  });

  it('keeps a name that only shares a payment word with another apart from it', () => {
    expect(merchantKey('QRIS Roti Pagi')).not.toBe(merchantKey('QRIS Kedai Senja'));
    // Nothing but payment words names no merchant at all.
    expect(merchantKey('QRIS XXXX1234')).toBe('');
  });
});

describe('capturedCategory', () => {
  const seen = (description: string, categoryId: string) => ({ description, categoryId });

  it('files a merchant under the category it was last recorded with', () => {
    expect(capturedCategory('QRIS KEDAI SENJA', [seen('Bensin', 'cat-fuel'), seen('Kedai Senja', 'cat-cafe')])).toBe('cat-cafe');
  });

  it('knows nothing of a merchant never recorded, or a capture that names none', () => {
    expect(capturedCategory('ROTI PAGI', [seen('Kedai Senja', 'cat-cafe')])).toBeNull();
    expect(capturedCategory('QRIS 0042', [seen('Kedai Senja', 'cat-cafe')])).toBeNull();
    expect(capturedCategory('Kedai Senja', [])).toBeNull();
  });

  it('takes the newest when one of the two before it agrees', () => {
    const history = [seen('Kedai Senja', 'cat-cafe'), seen('KEDAI SENJA 12', 'cat-restaurants'), seen('kedai senja', 'cat-cafe')];
    expect(capturedCategory('KEDAI SENJA', history)).toBe('cat-cafe');
    expect(capturedCategory('KEDAI SENJA', [seen('Kedai Senja', 'cat-cafe'), seen('Kedai Senja', 'cat-cafe')])).toBe('cat-cafe');
  });

  it('leaves the row for the owner when the newest disagrees with the ones before it', () => {
    // Changed once: a change of mind and a one-off look the same.
    expect(capturedCategory('KEDAI SENJA', [seen('Kedai Senja', 'cat-restaurants'), seen('Kedai Senja', 'cat-cafe')])).toBeNull();
    expect(
      capturedCategory('KEDAI SENJA', [seen('Kedai Senja', 'cat-restaurants'), seen('Kedai Senja', 'cat-cafe'), seen('Kedai Senja', 'cat-cafe')]),
    ).toBeNull();
    expect(
      capturedCategory('KEDAI SENJA', [seen('Kedai Senja', 'cat-gifts'), seen('Kedai Senja', 'cat-cafe'), seen('Kedai Senja', 'cat-restaurants')]),
    ).toBeNull();
  });

  it('reads only the newest three of the merchant, and no other merchant between them', () => {
    const history = [
      seen('Kedai Senja', 'cat-cafe'),
      seen('Roti Pagi', 'cat-groceries'),
      seen('Kedai Senja', 'cat-cafe'),
      seen('Kedai Senja', 'cat-restaurants'),
      seen('Kedai Senja', 'cat-restaurants'),
    ];
    expect(capturedCategory('Kedai Senja', history)).toBe('cat-cafe');
  });
});

describe('parseLooseDate: Indonesian months and joined shapes', () => {
  it('reads them', () => {
    expect(parseLooseDate('21okt', TODAY)).toBe('2026-10-21');
    expect(parseLooseDate('21-okt', TODAY)).toBe('2026-10-21');
    expect(parseLooseDate('21 Oktober 2025', TODAY)).toBe('2025-10-21');
    expect(parseLooseDate('okt 21', TODAY)).toBe('2026-10-21');
    expect(parseLooseDate('1 des', TODAY)).toBe('2026-12-01');
    expect(parseLooseDate('3 mei', TODAY)).toBe('2026-05-03');
  });
  it('does not read a word that only starts like a month', () => {
    expect(parseLooseDate('2 martabak', TODAY)).toBeNull();
    expect(parseLooseDate('2 marketing', TODAY)).toBeNull();
  });
});
