import { createDatabase, findRate, migrate, type RateFetcher, resolveRates, upsertRate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ratesBehind } from './queries';

const TODAY = '2026-11-20';

async function setup() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  return { database, queryClient };
}

/** A rate server that answers when told to, counting what it was asked. */
function gatedServer(rates: Record<string, number>) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const asked: string[] = [];
  const fetcher: RateFetcher = async (from, _to, onDate) => {
    asked.push(from);
    await gate;
    if (!(from in rates)) throw new Error('offline');
    return { rate: rates[from]!, sourceDate: onDate };
  };
  return { fetcher, asked, open };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the rates a screen reads', () => {
  it('converts at the last stored rate at once, saves the day’s rate behind it, then reads again at that rate', async () => {
    const { database, queryClient } = await setup();
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2026-11-19', rate: 16_200, source: 'frankfurter', sourceDate: '2026-11-19' });
    const server = gatedServer({ USD: 16_310 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const o = { database, baseCurrency: 'IDR', queryClient, fetcher: server.fetcher, today: TODAY };

    // Both of the page's reads ask together: answered at once from what is stored, with the server asked once.
    const [line, sheet] = await Promise.all([ratesBehind(o, ['USD', 'IDR'], TODAY), ratesBehind(o, ['IDR', 'USD'], TODAY)]);
    expect(line).toEqual({ rates: { USD: 16_200 }, stale: ['USD'], missing: [] });
    expect(sheet).toEqual(line);
    await settle();
    expect(server.asked).toEqual(['USD']);
    expect(invalidate).not.toHaveBeenCalled();

    server.open();
    await settle();
    // Saved exactly as a fetch while the screen waited would have saved it, and the figures that read rates re-read.
    expect(await findRate(database, 'USD', 'IDR', TODAY)).toMatchObject({ rate: 16_310, source: 'frankfurter', stale: false });
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['sheet-inputs'], ['net-worth-series'], ['net-worth', 'received-rates']]);
    // That re-read ends on the very rates the old waiting resolver gives.
    const again = await ratesBehind(o, ['USD', 'IDR'], TODAY);
    expect(again).toEqual(await resolveRates(database, { currencies: ['USD', 'IDR'], baseCurrency: 'IDR', onDate: TODAY, today: TODAY, fetcher: server.fetcher }));
    expect(again).toEqual({ rates: { USD: 16_310 }, stale: [], missing: [] });
  });

  it('waits for a currency with no rate stored at all, as before', async () => {
    const { database, queryClient } = await setup();
    const server = gatedServer({ THB: 455.5 });
    const read = ratesBehind({ database, baseCurrency: 'IDR', queryClient, fetcher: server.fetcher, today: TODAY }, ['THB'], TODAY);
    let done = false;
    void read.then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    server.open();
    expect(await read).toEqual({ rates: { THB: 455.5 }, stale: [], missing: [] });
  });

  it('keeps the last rate when the server does not answer, and asks again on the next read', async () => {
    const { database, queryClient } = await setup();
    await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: '2026-11-01', rate: 12_500, source: 'manual', sourceDate: '2026-11-01' });
    const server = gatedServer({});
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const o = { database, baseCurrency: 'IDR', queryClient, fetcher: server.fetcher, today: TODAY };
    server.open();
    expect(await ratesBehind(o, ['SGD'], TODAY)).toEqual({ rates: { SGD: 12_500 }, stale: ['SGD'], missing: [] });
    await settle();
    expect(invalidate).not.toHaveBeenCalled();
    expect(await ratesBehind(o, ['SGD'], TODAY)).toEqual({ rates: { SGD: 12_500 }, stale: ['SGD'], missing: [] });
    await settle();
    expect(server.asked).toEqual(['SGD', 'SGD']);
  });

  it('resolves a past day as it always has: fetched while the screen waits, never at another day’s rate', async () => {
    const { database, queryClient } = await setup();
    await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: '2025-12-01', rate: 15_900, source: 'frankfurter', sourceDate: '2025-12-01' });
    const server = gatedServer({ USD: 16_050 });
    server.open();
    expect(await ratesBehind({ database, baseCurrency: 'IDR', queryClient, fetcher: server.fetcher, today: TODAY }, ['USD'], '2025-12-31')).toEqual({
      rates: { USD: 16_050 },
      stale: [],
      missing: [],
    });
  });
});
