import { createAccount, createDatabase, createWorkspace, migrate, saveAssetProfile, saveEarmark, saveGoal, setAsideChoiceOf } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';
import { submitTrade } from './tx-save';

/** A real database, the same way lib/rates.test.ts and networth/trade-money.test.ts's typed-rate tests do. */
async function setup() {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws };
}

/**
 * I5 (8e3): the Buy / sell tab's own save has to send the set-aside answer, exactly as TradeForm's does — the
 * fact this whole finding is about. `submitTrade` is the one call `TransactionCard.submit` now makes for a trade,
 * so this proves the fact directly rather than only ever through a mount: the goal really is borrowed from, read
 * back off the ledger, not merely passed through an argument nothing checked.
 */
describe('submitTrade', () => {
  it('records the set-aside answer on the trade it posts', async () => {
    const { database, ws } = await setup();
    const jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
    const aapl = await createAccount(database, ws, { name: 'AAPL', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: aapl.id, assetKind: 'stock' });
    const efId = await saveGoal(database, ws, {
      name: 'Emergency fund', kind: 'other', growthBps: 0, returnBps: 0,
      stages: [{ name: 'Emergency fund', targetMinor: 30_000_000, targetMonths: null, dueOn: '2027-12-31' }],
    });
    await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });

    // Rp 6.800.000 paid from Jenius, which has Rp 5.000.000 free: Rp 1.800.000 over, borrowed from the goal —
    // exactly the Jenius scenario the S3 brief's TradeForm test already covers, on the Buy / sell tab instead.
    const input = {
      accountId: aapl.id, kind: 'buy' as const, occurredOn: '2026-09-01', unitsMicro: 2_000_000, grossMinor: 41_850,
      feeMinor: 0, taxMinor: 0, cashAccountId: jenius.id, cashMinor: 6_800_000,
    };
    const setAside = { accountId: jenius.id, goalId: efId, intent: 'borrow' as const, overMinor: 1_800_000 };
    const result = await submitTrade({
      database, ws, input, holdingCurrency: 'USD', cashCurrency: 'IDR',
      needsRate: null, manualRate: '', resolveRates: vi.fn(), onMissing: vi.fn(), where: 'Add more details', setAside,
    });

    expect(result.transactionId).not.toBeNull();
    expect(await setAsideChoiceOf(database, ws, result.transactionId!)).toMatchObject({ goalId: efId, intent: 'borrow', overMinor: 1_800_000 });
  });

  it('records no answer when none was given', async () => {
    const { database, ws } = await setup();
    const jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 42_500_000, openedOn: '2026-01-01' });
    const aapl = await createAccount(database, ws, { name: 'AAPL', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: aapl.id, assetKind: 'stock' });
    const input = {
      accountId: aapl.id, kind: 'buy' as const, occurredOn: '2026-09-01', unitsMicro: 2_000_000, grossMinor: 41_850,
      feeMinor: 0, taxMinor: 0, cashAccountId: jenius.id, cashMinor: 680_000,
    };
    const result = await submitTrade({
      database, ws, input, holdingCurrency: 'USD', cashCurrency: 'IDR',
      needsRate: null, manualRate: '', resolveRates: vi.fn(), onMissing: vi.fn(), where: 'Add more details', setAside: null,
    });
    expect(await setAsideChoiceOf(database, ws, result.transactionId!)).toBeNull();
  });
});
