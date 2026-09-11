import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, nativeBalances } from '../src/index';
import { importRows } from '../src/repos/imports';
import { setupDb } from './helpers';

describe('importRows', () => {
  it('imports charges and refunds, skips re-imports, and is all-or-nothing', async () => {
    const { database, ws } = await setupDb();
    const card = await createAccount(database, ws, { name: 'Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const all = await listAccounts(database, ws);
    const coffee = all.find((a) => a.name === 'Coffee & Snacks')!.id;
    const rows = [
      { occurredOn: '2026-09-01', description: 'Kopi', amountMinor: 25_000, externalRef: 'csv:a|0', categoryAccountId: coffee },
      { occurredOn: '2026-09-02', description: 'Kopi refund', amountMinor: -5_000, externalRef: 'csv:b|0', categoryAccountId: coffee },
    ];
    expect(await importRows(database, ws, { accountId: card.id, currency: 'IDR', rows })).toEqual({ imported: 2, skipped: 0 });
    expect(await importRows(database, ws, { accountId: card.id, currency: 'IDR', rows })).toEqual({ imported: 0, skipped: 2 });
    let balances = await nativeBalances(database, ws);
    expect(balances[coffee]).toBe(20_000);
    expect(balances[card.id]).toBe(-20_000);

    await expect(
      importRows(database, ws, {
        accountId: card.id,
        currency: 'IDR',
        rows: [
          { occurredOn: '2026-09-03', description: 'ok', amountMinor: 1_000, externalRef: 'csv:c|0', categoryAccountId: coffee },
          { occurredOn: 'not-a-date', description: 'bad', amountMinor: 1_000, externalRef: 'csv:d|0', categoryAccountId: coffee },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE' });
    balances = await nativeBalances(database, ws);
    expect(balances[coffee]).toBe(20_000);
  });
});
