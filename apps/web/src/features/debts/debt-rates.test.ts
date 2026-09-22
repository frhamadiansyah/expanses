import { createAccount, createDatabase, createWorkspace, findRate, migrate, nativeBalances, recordLoan } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';
import { debtDraftToInput, emptyDebtDraft } from './debts-form';
import { debtRatesForSave } from './debt-rates';

const TODAY = '2026-09-12';

async function setup() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });
  return { database, ws, wise };
}

/** No rate stored, and none to fetch: the case the form met before it passed any rate at all. */
const nothingFound = () => vi.fn().mockResolvedValue({ rates: {}, missing: ['USD'] });

describe('debtRatesForSave', () => {
  it('asks for nothing in the base currency', async () => {
    const { database, ws } = await setup();
    const resolveRates = nothingFound();
    expect(await debtRatesForSave({ database, ws, currency: 'IDR', occurredOn: TODAY, amountMinor: 1_000_000, typed: '', resolveRates, onMissing: vi.fn() })).toEqual({});
    expect(resolveRates).not.toHaveBeenCalled();
  });

  it('names the missing rate and asks the screen for it, rather than failing inside the ledger', async () => {
    const { database, ws } = await setup();
    const onMissing = vi.fn();
    await expect(debtRatesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: 10_000, typed: '', resolveRates: nothingFound(), onMissing })).rejects.toThrow(/No USD→IDR rate/);
    expect(onMissing).toHaveBeenCalledWith('USD');
  });

  it('lends US$100 with a typed rate: the rate is stored for the day and the loan records', async () => {
    const { database, ws, wise } = await setup();
    const draft = { ...emptyDebtDraft(TODAY), personName: 'Andi', amount: '100', moneyId: wise.id };
    const input = debtDraftToInput(draft, 'USD', TODAY);
    const ratesToBase = await debtRatesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: input.amountMinor, typed: '16250', resolveRates: nothingFound(), onMissing: vi.fn() });

    expect(ratesToBase).toEqual({ USD: 16_250 });
    expect((await findRate(database, 'USD', 'IDR', TODAY))?.rate).toBe(16_250);
    const { debtAccountId } = await recordLoan(database, ws, { ...input, ratesToBase });
    const balances = await nativeBalances(database, ws);
    expect(balances[debtAccountId]).toBe(10_000);
    expect(balances[wise.id]).toBe(90_000);
  });

  it('borrows US$50 on a rate the resolver found', async () => {
    const { database, ws, wise } = await setup();
    const draft = { ...emptyDebtDraft(TODAY), direction: 'borrowed' as const, personName: 'Budi', amount: '50', moneyId: wise.id };
    const input = debtDraftToInput(draft, 'USD', TODAY);
    const resolveRates = vi.fn().mockResolvedValue({ rates: { USD: 16_300 }, missing: [] });
    const ratesToBase = await debtRatesForSave({ database, ws, currency: 'USD', occurredOn: TODAY, amountMinor: input.amountMinor, typed: '', resolveRates, onMissing: vi.fn() });

    expect(ratesToBase).toEqual({ USD: 16_300 });
    expect(resolveRates).toHaveBeenCalledWith(['USD'], TODAY);
    const { debtAccountId } = await recordLoan(database, ws, { ...input, ratesToBase });
    expect((await nativeBalances(database, ws))[wise.id]).toBe(105_000);
    // A liability's native balance is credit-signed.
    expect((await nativeBalances(database, ws))[debtAccountId]).toBe(-5_000);
  });

  it('is why the form failed: the same loan with no rate is refused by the ledger', async () => {
    const { database, ws, wise } = await setup();
    const input = debtDraftToInput({ ...emptyDebtDraft(TODAY), personName: 'Andi', amount: '100', moneyId: wise.id }, 'USD', TODAY);
    await expect(recordLoan(database, ws, input)).rejects.toThrow(/USD/);
  });
});
