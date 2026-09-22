import { createAccount, createDatabase, createWorkspace, findRate, migrate, nativeBalances, recordLoan, upsertRate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';
import { debtDraftToInput, emptyDebtDraft } from '../features/debts/debts-form';
import { openingRateFor, ratesForSave } from './rates';

async function setup() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws };
}

describe('the rate an opening balance is posted at', () => {
  it('is the typed one, checked and stored for the opening date', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    const rate = await openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 240_000, typed: '15.940,5', resolveRates });
    expect(rate).toBe(15_940.5);
    expect((await findRate(database, 'USD', 'IDR', '2025-02-04'))!.rate).toBe(15_940.5);
  });

  it('reads a dot as the thousands separator, as parseRate does: 16.500 is 16,5 — never 16500 (P2-I1)', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    // The reader Add asset used to have stripped every dot first, so "16.500" opened a USD asset 1000× too high.
    expect(await openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 1_000_000, typed: '16.500', resolveRates })).toBe(16.5);
    expect((await findRate(database, 'USD', 'IDR', '2025-02-04'))!.rate).toBe(16.5);
    const fresh = await setup();
    expect(await openingRateFor({ ...fresh, currency: 'USD', openedOn: '2025-02-05', openingBalanceMinor: 1_000_000, typed: '16.250,75', resolveRates })).toBe(16_250.75);
  });

  it('refuses a typed rate ten times off the last known one, and stores nothing (P2-I3)', async () => {
    const { database, ws } = await setup();
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2025-02-03', rate: 16_250, source: 'manual', sourceDate: '2025-02-03' });
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    await expect(
      openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 240_000, typed: '162.500', resolveRates }),
    ).rejects.toThrow('Check the decimal separator');
    // Nothing stored for the opening date: the last known rate is still the one from the day before.
    expect(await findRate(database, 'USD', 'IDR', '2025-02-04')).toMatchObject({ rate: 16_250, onDate: '2025-02-03', stale: true });
  });

  it('is resolved for the opening date when left blank', async () => {
    const { database, ws } = await setup();
    const asked: [string[], string][] = [];
    const resolveRates = async (currencies: string[], onDate: string) => {
      asked.push([currencies, onDate]);
      return { rates: { SGD: 12_110.5 } as Record<string, number> };
    };
    expect(await openingRateFor({ database, ws, currency: 'SGD', openedOn: '2025-02-04', openingBalanceMinor: 115_000, typed: '  ', resolveRates })).toBe(12_110.5);
    expect(asked).toEqual([[['SGD'], '2025-02-04']]);
  });

  it('stops, naming the currency, when blank and unresolvable', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => ({ rates: {} as Record<string, number> });
    await expect(openingRateFor({ database, ws, currency: 'SGD', openedOn: '2025-02-04', openingBalanceMinor: 115_000, typed: '', resolveRates })).rejects.toThrow(
      'No SGD→IDR rate available. Enter it manually.',
    );
  });

  it('is not needed for the base currency or an empty balance', async () => {
    const { database, ws } = await setup();
    const resolveRates = async () => {
      throw new Error('must not be asked');
    };
    expect(await openingRateFor({ database, ws, currency: 'IDR', openedOn: '2025-02-04', openingBalanceMinor: 5_400_000, typed: '', resolveRates })).toBeUndefined();
    expect(await openingRateFor({ database, ws, currency: 'USD', openedOn: '2025-02-04', openingBalanceMinor: 0, typed: '', resolveRates })).toBeUndefined();
  });
});

/** A workspace with a dollar account: the money a loan between people moves through, and the money a loan is paid from. */
const TODAY = '2026-09-12';

async function dollarSetup() {
  const { database, ws } = await setup();
  const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
  return { database, ws, wise };
}

/** No rate stored, and none to fetch: the case the forms met before they passed any rate at all. */
const nothingFound = () => vi.fn().mockResolvedValue({ rates: {}, missing: ['USD'] });

describe('ratesForSave', () => {
  it('asks for nothing in the base currency', async () => {
    const { database, ws } = await dollarSetup();
    const resolveRates = nothingFound();
    expect(await ratesForSave({ database, ws, currency: 'IDR', occurredOn: TODAY, amountMinor: 1_000_000, typed: '', resolveRates, onMissing: vi.fn() })).toEqual({});
    expect(resolveRates).not.toHaveBeenCalled();
  });

  it('names the missing rate and asks the screen for it, rather than failing inside the ledger', async () => {
    const { database, ws } = await dollarSetup();
    const onMissing = vi.fn();
    await expect(ratesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: 10_000, typed: '', resolveRates: nothingFound(), onMissing })).rejects.toThrow(/No USD→IDR rate/);
    expect(onMissing).toHaveBeenCalledWith('USD');
  });

  it('lends US$100 with a typed rate: the rate is stored for the day and the loan records', async () => {
    const { database, ws, wise } = await dollarSetup();
    const draft = { ...emptyDebtDraft(TODAY), personName: 'Andi', amount: '100', moneyId: wise.id };
    const input = debtDraftToInput(draft, 'USD', TODAY);
    const ratesToBase = await ratesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: input.amountMinor, typed: '16250', resolveRates: nothingFound(), onMissing: vi.fn() });

    expect(ratesToBase).toEqual({ USD: 16_250 });
    expect((await findRate(database, 'USD', 'IDR', TODAY))?.rate).toBe(16_250);
    const { debtAccountId } = await recordLoan(database, ws, { ...input, ratesToBase });
    const balances = await nativeBalances(database, ws);
    expect(balances[debtAccountId]).toBe(10_000);
    expect(balances[wise.id]).toBe(90_000);
  });

  it('borrows US$50 on a rate the resolver found', async () => {
    const { database, ws, wise } = await dollarSetup();
    const draft = { ...emptyDebtDraft(TODAY), direction: 'borrowed' as const, personName: 'Budi', amount: '50', moneyId: wise.id };
    const input = debtDraftToInput(draft, 'USD', TODAY);
    const resolveRates = vi.fn().mockResolvedValue({ rates: { USD: 16_300 }, missing: [] });
    const ratesToBase = await ratesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: input.amountMinor, typed: '', resolveRates, onMissing: vi.fn() });

    expect(ratesToBase).toEqual({ USD: 16_300 });
    expect(resolveRates).toHaveBeenCalledWith(['USD'], TODAY);
    const { debtAccountId } = await recordLoan(database, ws, { ...input, ratesToBase });
    expect((await nativeBalances(database, ws))[wise.id]).toBe(105_000);
    // A liability's native balance is credit-signed.
    expect((await nativeBalances(database, ws))[debtAccountId]).toBe(-5_000);
  });

  it('is why the form failed: the same loan with no rate is refused by the ledger', async () => {
    const { database, ws, wise } = await dollarSetup();
    const input = debtDraftToInput({ ...emptyDebtDraft(TODAY), personName: 'Andi', amount: '100', moneyId: wise.id }, 'USD', TODAY);
    await expect(recordLoan(database, ws, input)).rejects.toThrow(/USD/);
  });
});
