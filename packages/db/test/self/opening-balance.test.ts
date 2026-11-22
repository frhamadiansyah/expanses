import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { changeOpeningBalance, createAccount, nativeBalances } from '../../src/index';
import { exchange, linkedPair, sameRows } from './devices';

vi.setConfig({ testTimeout: 60_000 });

/*
 * A starting balance changed on one of the owner's devices (Settings › Balance) reaches the other as the same rows:
 * the old opening voided, its replacement posted, and the balance after it alike on both. Invented figures only.
 */
describe('a changed starting balance on a linked device', () => {
  it('reaches the other device as it is, and so does one given to an account opened at nothing', async () => {
    let cashId = '';
    let walletId = '';
    const { phone, mac } = await linkedPair(async ({ database, ws }) => {
      cashId = (await createAccount(database, ws, { name: 'Test Cash', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 800_000, openedOn: '2026-11-01' })).id;
      walletId = (await createAccount(database, ws, { name: 'Test Wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' })).id;
    });

    await changeOpeningBalance(phone.database, phone.ws, cashId, 950_000);
    await changeOpeningBalance(phone.database, phone.ws, walletId, 120_000);
    await exchange(phone, mac);

    const balances = await nativeBalances(mac.database, mac.ws);
    expect(balances[cashId]).toBe(950_000);
    expect(balances[walletId]).toBe(120_000);
    const voided = await mac.database.db.values<[number]>(sql`SELECT count(*) FROM transactions WHERE status = 'void' AND description = 'Opening balance: Test Cash'`);
    expect(voided[0]![0]).toBe(1);
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});
