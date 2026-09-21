import { createDatabase, createWorkspace, findRate, migrate } from '@expanses/db';
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
