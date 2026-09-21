import { createDatabase, createWorkspace, findRate, migrate, upsertRate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { openingRateFor } from './rates';

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
