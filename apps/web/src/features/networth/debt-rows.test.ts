import { balanceSheet, type SheetLiability } from '@expanses/core';
import type { LoanTermsRow, PersonDebtRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type CardFacts, type DebtAccount, type DebtInputs, bareFigure, creditLine, creditMinor, groupDebts, owedMinor } from './debt-rows';

const account = (partial: Partial<DebtAccount> & Pick<DebtAccount, 'id' | 'name' | 'subtype'>): DebtAccount => ({
  kind: 'liability',
  currency: 'IDR',
  archivedAt: null,
  ...partial,
});

const loan = (partial: Partial<LoanTermsRow> & Pick<LoanTermsRow, 'accountId'>): LoanTermsRow => ({
  workspaceId: 'ws',
  lenderName: 'BCA',
  lenderNpwp: null,
  purpose: null,
  originalMinor: 800_000_000,
  firstPaymentOn: '2024-01-05',
  tenorMonths: 180,
  method: 'annuity',
  paymentDay: 5,
  assetAccountId: null,
  coretaxCode: '101',
  status: 'open',
  statusOn: null,
  isHomeLoan: false,
  periods: [{ fromOn: '2024-01-05', rateBps: 475, kind: 'fixed', paymentMinor: 0 } as LoanTermsRow['periods'][number]],
  ...partial,
});

const person = (partial: Partial<PersonDebtRow> & Pick<PersonDebtRow, 'personName' | 'totalMinor'>): PersonDebtRow => ({
  direction: 'borrowed',
  currency: 'IDR',
  dueState: 'none',
  loans: [
    {
      accountId: `pay-${partial.personName}`,
      reason: null,
      openedOn: '2026-09-02',
      originalMinor: partial.totalMinor,
      balanceMinor: partial.totalMinor,
      repaidMinor: 0,
      dueOn: null,
      dueState: 'none',
      dueLabel: '',
      status: 'open',
      currency: partial.currency ?? 'IDR',
    },
  ],
  ...partial,
});

const card = (partial: Partial<CardFacts> = {}): CardFacts => ({ last4: null, hasTerms: true, dueOn: null, billedMinor: 0, leftToPayMinor: 0, ...partial });

/**
 * The balance sheet's own reading of the same four debts, as `sheetInputsAt` would hand it over: every one of them,
 * so the split it produces and the whole this page converts are the same money read twice.
 */
const sheetLiabilities = (): SheetLiability[] => [
  { accountId: 'kpr', name: 'KPR BCA', subtype: 'loan', balanceMinor: 712_500_000, dueWithinYearMinor: 33_690_000, note: null },
  { accountId: 'car', name: 'Car loan', subtype: 'loan', balanceMinor: 18_750_000, dueWithinYearMinor: 6_250_000, note: null },
  { accountId: 'kris', name: 'BCA KrisFlyer', subtype: 'credit_card', balanceMinor: 8_460_000, dueWithinYearMinor: 8_460_000, note: null },
  { accountId: 'pay-Dewi', name: 'Dewi', subtype: 'payable', balanceMinor: 750_000, dueWithinYearMinor: 750_000, note: null },
];

/** The mockup's sample, in the ledger's own signs: a liability's raw balance is negative. */
function sample(overrides: Partial<DebtInputs> = {}): DebtInputs {
  return {
    accounts: [
      account({ id: 'house', name: 'House in Bintaro', subtype: 'property', kind: 'asset' }),
      account({ id: 'kpr', name: 'KPR BCA', subtype: 'loan' }),
      account({ id: 'car', name: 'Car loan', subtype: 'loan' }),
      account({ id: 'kris', name: 'BCA KrisFlyer', subtype: 'credit_card' }),
      account({ id: 'pay-Dewi', name: 'Dewi', subtype: 'payable' }),
    ],
    balances: { kpr: -712_500_000, car: -18_750_000, kris: -8_460_000, 'pay-Dewi': -750_000 },
    loans: [loan({ accountId: 'kpr', isHomeLoan: true, assetAccountId: 'house' }), loan({ accountId: 'car', lenderName: 'Adira', tenorMonths: 36 })],
    cards: { kris: card({ last4: '4417', dueOn: '2026-10-05', billedMinor: 6_360_000, leftToPayMinor: 6_360_000 }) },
    people: [person({ personName: 'Dewi', totalMinor: 750_000 })],
    sheet: null,
    baseCurrency: 'IDR',
    ratesToBase: {},
    ...overrides,
  };
}

describe('groupDebts', () => {
  it('groups by kind in the order Loans, Credit cards, You owe people, each with its subtotal and the whole converted', () => {
    const debts = groupDebts(sample());
    expect(debts.groups.map((group) => [group.label, group.totalMinor])).toEqual([
      ['Loans', 731_250_000],
      ['Credit cards', 8_460_000],
      ['You owe people', 750_000],
    ]);
    expect(debts.total).toEqual({ totalMinor: 740_460_000, missing: [] });
    expect(debts.groups[0]!.rows.map((row) => [row.name, row.minor, row.icon])).toEqual([
      ['KPR BCA', 712_500_000, 'home'],
      ['Car loan', 18_750_000, 'loan'],
    ]);
  });

  it('keeps a debt in another currency in its own currency and converts it for the totals', () => {
    const debts = groupDebts(
      sample({
        accounts: [account({ id: 'usd', name: 'Dollar car loan', subtype: 'loan', currency: 'USD' })],
        balances: { usd: -2_000_000 },
        loans: [],
        cards: {},
        people: [],
        ratesToBase: { USD: 16_250 },
      }),
    );
    const [row] = debts.groups[0]!.rows;
    expect(row).toMatchObject({ minor: 2_000_000, currency: 'USD', baseMinor: 325_000_000, missing: null });
    expect(debts.groups[0]!.totalMinor).toBe(325_000_000);
    expect(debts.total.totalMinor).toBe(325_000_000);
  });

  it('names a missing rate instead of counting that debt as nothing, in the group and in the total', () => {
    const debts = groupDebts(sample({ people: [person({ personName: 'Dewi', totalMinor: 750_000 }), person({ personName: 'Budi', totalMinor: 4_000, currency: 'USD' })] }));
    const people = debts.groups.find((group) => group.kind === 'person')!;
    expect(people.totalMinor).toBeNull();
    expect(people.missing).toEqual(['USD']);
    expect(people.rows.find((row) => row.name === 'Budi')).toMatchObject({ minor: 4_000, currency: 'USD', baseMinor: null, missing: 'USD' });
    // The other groups still add up; only the whole cannot.
    expect(debts.groups[0]!.totalMinor).toBe(731_250_000);
    expect(debts.total).toEqual({ totalMinor: null, missing: ['USD'] });
  });

  it('owes a person in dollars in dollars, converted at the held rate', () => {
    const debts = groupDebts(
      sample({ people: [person({ personName: 'Dewi', totalMinor: 750_000 }), person({ personName: 'Budi', totalMinor: 4_000, currency: 'USD' })], ratesToBase: { USD: 16_200 } }),
    );
    const people = debts.groups.find((group) => group.kind === 'person')!;
    expect(people.rows[1]).toMatchObject({ name: 'Budi', minor: 4_000, currency: 'USD', baseMinor: 648_000, personName: 'Budi', detail: 'since 2 Sep' });
    // Rp 750.000 and US$40,00 at 16.200: the mockup's Rp 1.398.000, not 750.000 + 4.000.
    expect(people.totalMinor).toBe(1_398_000);
  });

  it('owes a card everything not yet paid — billed and unbilled — as its ledger balance says, and says which is which', () => {
    const debts = groupDebts(sample());
    const [row] = debts.groups.find((group) => group.kind === 'card')!.rows;
    // 6.360.000 billed and unpaid, 2.100.000 bought since: the balance is both, read and not rebuilt.
    expect(row).toMatchObject({ name: 'BCA KrisFlyer', minor: 8_460_000, last4: '4417', icon: 'card' });
    expect(row!.detail).toBe('due 5 Oct · 2.100.000 unbilled');
  });

  it('lists a card at the very figure its own page reads for the Unpaid tile and the current balance', () => {
    // Billed and unbilled with an instalment in it, a card paid past its bill, and a card with nothing on it yet.
    for (const raw of [-8_460_000, 1_250_000, undefined]) {
      const balances: Record<string, number> = raw === undefined ? {} : { kris: raw };
      const debts = groupDebts(sample({ balances }));
      const [row] = debts.groups.find((group) => group.kind === 'card')!.rows;
      expect(row!.minor).toBe(owedMinor(balances, 'kris'));
    }
    expect(owedMinor({ kris: -8_460_000 }, 'kris')).toBe(8_460_000);
    expect(owedMinor({ kris: 1_250_000 }, 'kris')).toBe(0);
  });

  it('says what a card paid past its bill holds for you, as the row’s subtitle, and still owes nothing', () => {
    const debts = groupDebts(sample({ balances: { ...sample().balances, kris: 250_000 } }));
    const group = debts.groups.find((g) => g.kind === 'card')!;
    expect(group.rows[0]).toMatchObject({ minor: 0, baseMinor: 0, detail: creditLine(250_000, 'IDR') });
    expect(group.rows[0]!.detail).toMatch(/^Credit Rp\s250\.000$/);
    expect(group.totalMinor).toBe(0);
  });

  it('says a card with nothing billed yet has nothing billed, and still owes what it has bought', () => {
    const debts = groupDebts(sample({ cards: { kris: card({ last4: '3091', billedMinor: 0 }) } }));
    const [row] = debts.groups.find((group) => group.kind === 'card')!.rows;
    expect(row).toMatchObject({ minor: 8_460_000, detail: 'nothing billed' });
  });

  it('leaves a cleared loan out of the list and the totals, and keeps it for the cleared list', () => {
    const debts = groupDebts(
      sample({
        accounts: [...sample().accounts, account({ id: 'old', name: 'Old car loan', subtype: 'loan' })],
        // A stray balance left on a cleared loan still does not bring it back into what is owed.
        balances: { ...sample().balances, old: -1_000_000 },
        loans: [...sample().loans, loan({ accountId: 'old', status: 'paid_off', statusOn: '2025-03-01' })],
      }),
    );
    expect(debts.groups[0]!.rows.map((row) => row.name)).not.toContain('Old car loan');
    expect(debts.groups[0]!.totalMinor).toBe(731_250_000);
    expect(debts.cleared).toEqual([{ accountId: 'old', name: 'Old car loan', clearedOn: '2025-03-01' }]);
  });

  it('lists a loan account with no terms yet, at what it owes, and leaves out archived accounts and ones owing nothing', () => {
    const debts = groupDebts(
      sample({
        accounts: [
          account({ id: 'paylater', name: 'Paylater', subtype: 'loan' }),
          account({ id: 'gone', name: 'Closed loan', subtype: 'loan', archivedAt: '2026-01-01' }),
          account({ id: 'zero', name: 'Settled loan', subtype: 'loan' }),
        ],
        balances: { paylater: -1_200_000, gone: -5_000_000, zero: 0 },
        loans: [],
        cards: {},
        people: [],
      }),
    );
    expect(debts.groups).toHaveLength(1);
    expect(debts.groups[0]!.rows.map((row) => [row.name, row.detail])).toEqual([['Paylater', 'no terms yet']]);
  });

  it('writes a loan’s details the way the list always has: lender, rate, tenor, and a mortgage said so', () => {
    const debts = groupDebts(sample());
    expect(debts.groups[0]!.rows.map((row) => row.detail)).toEqual(['BCA · 4,75% · 180 months · mortgage', 'Adira · 4,75% · 36 months']);
  });

  it('files an owed-to-someone account no person holds under You owe people, by its own name', () => {
    const debts = groupDebts(sample({ accounts: [account({ id: 'misc', name: 'Other debts', subtype: 'payable' })], balances: { misc: -300_000 }, loans: [], cards: {}, people: [] }));
    expect(debts.groups[0]).toMatchObject({ kind: 'person', totalMinor: 300_000 });
    expect(debts.groups[0]!.rows[0]).toMatchObject({ name: 'Other debts', personName: null, accountId: 'misc' });
  });

  it('splits by due date exactly as the balance sheet does, from the same rows', () => {
    const liabilities = sheetLiabilities();
    const sheet = balanceSheet([], liabilities);
    const debts = groupDebts(sample({ sheet: { liabilities, missing: [] } }));
    expect(debts.due).toEqual({ withinYearMinor: sheet.shortTerm.totalMinor, longTermMinor: sheet.longTerm.totalMinor, missing: [] });
    expect(debts.due.withinYearMinor).toBe(49_150_000);
    // The split and the whole are the same money read twice: their sum is the converted total above.
    expect(debts.due.withinYearMinor! + debts.due.longTermMinor!).toBe(debts.total.totalMinor);
  });

  it('keeps the due split while only an ASSET is missing a rate, which the sheet names in its own list', () => {
    /*
     * `sheetInputsAt` collects one `missing` list across both sides of the balance sheet, and this page used to
     * refuse the split whenever it had anything in it — so a dollar holding with no dollar rate hid what was owed,
     * which has nothing to do with it. Every debt here is rupiah and every one of them has its figure.
     */
    const liabilities = sheetLiabilities();
    const debts = groupDebts(sample({ sheet: { liabilities, missing: ['USD'] } }));

    expect(debts.due).toEqual({ withinYearMinor: 49_150_000, longTermMinor: 691_310_000, missing: [] });
    expect(debts.due.withinYearMinor! + debts.due.longTermMinor!).toBe(debts.total.totalMinor);
  });

  it('has no due split while a DEBT is missing its own rate, and names it — never a figure beside a refusal', () => {
    const liabilities = sheetLiabilities();
    const debts = groupDebts(
      sample({
        accounts: [account({ id: 'usd', name: 'Dollar loan', subtype: 'loan', currency: 'USD' }), ...sample().accounts],
        balances: { ...sample().balances, usd: -2_000_000 },
        sheet: { liabilities, missing: [] },
      }),
    );

    // The row says it in its own words, the total refuses to add up, and the split refuses with the same currency.
    expect(debts.groups.find((group) => group.kind === 'loan')!.missing).toEqual(['USD']);
    expect(debts.total).toEqual({ totalMinor: null, missing: ['USD'] });
    expect(debts.due).toEqual({ withinYearMinor: null, longTermMinor: null, missing: ['USD'] });
  });
});

describe('creditMinor', () => {
  it('is what a card was paid past what it owed', () => {
    expect(creditMinor({ kris: 250_000 }, 'kris')).toBe(250_000);
    expect(owedMinor({ kris: 250_000 }, 'kris')).toBe(0);
  });
  it('is nothing on a card paid exactly, or with no balance at all', () => {
    expect(creditMinor({ kris: 0 }, 'kris')).toBe(0);
    expect(creditMinor({}, 'kris')).toBe(0);
    expect(Object.is(creditMinor({ kris: 0 }, 'kris'), -0)).toBe(false);
  });
  it('is nothing while the card owes', () => {
    expect(creditMinor({ kris: -8_460_000 }, 'kris')).toBe(0);
  });
  it('is in the card’s own currency, never converted', () => {
    // A dollar card paid US$12,34 too much: 1.234 cents, written with its own symbol.
    expect(creditMinor({ usd: 1_234 }, 'usd')).toBe(1_234);
    expect(creditLine(1_234, 'USD')).toBe(`Credit ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'USD' }).format(12.34)}`);
  });
});

describe('bareFigure', () => {
  it('prints the figure without its symbol, in the currency’s own decimals', () => {
    expect(bareFigure(712_500_000, 'IDR')).toBe('712.500.000');
    expect(bareFigure(4_000, 'USD')).toBe('40,00');
  });
});
