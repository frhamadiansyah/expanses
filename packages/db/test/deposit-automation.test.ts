import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAccount,
  createWorkspace,
  type Database,
  DepositAutomationError,
  getDepositAutomation,
  listDueDeposits,
  openCashAccount,
  saveDepositAutomation,
  type SaveDepositAutomationInput,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let bcaId: string;
let depositoId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bcaId = (await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-07-15' })).id;
  depositoId = (
    await openCashAccount(database, ws, {
      item: 'time_deposit',
      name: 'BCA Deposito',
      currency: 'IDR',
      openingBalanceMinor: 50_000_000,
      openedOn: '2026-07-15',
      maturesOn: '2026-10-15',
      rateBps: 425,
    })
  ).id;
});

export const on = (accountId: string, payoutAccountId: string | null, change: Partial<SaveDepositAutomationInput> = {}): SaveDepositAutomationInput => ({
  accountId,
  enabled: true,
  atMaturity: 'principal',
  interestPaid: 'at_maturity',
  payoutAccountId,
  termMonths: 3,
  keepRate: true,
  taxBps: 2_000,
  taxExempt: false,
  today: '2026-07-15',
  ...change,
});

describe('the switch', () => {
  it('is off for every deposit until it is turned on', async () => {
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ enabled: false, enabledOn: null, taxBps: 2_000, taxExempt: false, termMonths: 1 });
  });

  it('keeps what was chosen, and remembers the day it was turned on', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly', taxBps: 1_250 }));
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({
      enabled: true,
      enabledOn: '2026-07-15',
      atMaturity: 'principal',
      interestPaid: 'monthly',
      payoutAccountId: bcaId,
      termMonths: 3,
      taxBps: 1_250,
    });
    // Saving again while on keeps the original day; turning off clears it; on again takes the new day.
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { today: '2026-08-01' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBe('2026-07-15');
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { enabled: false, today: '2026-08-02' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBeNull();
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { today: '2026-08-03' }));
    expect((await getDepositAutomation(database, ws, depositoId)).enabledOn).toBe('2026-08-03');
  });
});

describe('where the money may land', () => {
  const refused = (input: SaveDepositAutomationInput) => expect(saveDepositAutomation(database, ws, input)).rejects.toBeInstanceOf(DepositAutomationError);

  it('refuses an account in another currency', async () => {
    const usd = await openCashAccount(database, ws, { item: 'bank', name: 'Jenius USD', currency: 'USD' });
    await refused(on(depositoId, usd.id));
  });

  it('refuses an account that is not spendable, and the deposit itself', async () => {
    const other = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Other deposit', currency: 'IDR', maturesOn: '2027-01-01' });
    await refused(on(depositoId, other.id));
    await refused(on(depositoId, depositoId));
  });

  it('refuses an archived account', async () => {
    const empty = await openCashAccount(database, ws, { item: 'bank', name: 'Old account', currency: 'IDR' });
    await archiveAccount(database, ws, empty.id);
    await refused(on(depositoId, empty.id));
  });

  it('refuses an account, or a deposit, of another workspace', async () => {
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const theirs = await openCashAccount(database, other, { item: 'bank', name: 'Their bank', currency: 'IDR' });
    await refused(on(depositoId, theirs.id));
    await expect(saveDepositAutomation(database, other, on(depositoId, null))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a term or a tax the table could not hold', async () => {
    await refused(on(depositoId, bcaId, { termMonths: 2 as never }));
    await refused(on(depositoId, bcaId, { taxBps: 10_001 }));
    await refused(on(depositoId, bcaId, { taxBps: 12.5 }));
  });
});

describe('what is due', () => {
  it('is nothing while the switch is off, even after the maturity', async () => {
    expect(await listDueDeposits(database, ws, '2026-12-31')).toEqual([]);
  });

  it('proposes the maturity on its day, with the figures of the mockup', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    expect(await listDueDeposits(database, ws, '2026-10-14')).toEqual([]);
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({
      accountId: depositoId,
      name: 'BCA Deposito',
      currency: 'IDR',
      event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 },
      waiting: 0,
      principalMinor: 50_000_000,
      rateBps: 425,
      grossMinor: 535_616,
      taxMinor: 107_123,
      netMinor: 428_493,
    });
  });

  it('queues monthly payouts in date order and proposes only the earliest, counting the rest', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15', days: 31 }, waiting: 2, grossMinor: 180_479, taxMinor: 36_095, netMinor: 144_384 });
  });

  it('takes no tax from a tax-free deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { taxExempt: true }));
    const [proposal] = await listDueDeposits(database, ws, '2026-10-15');
    expect(proposal).toMatchObject({ grossMinor: 535_616, taxMinor: 0, netMinor: 535_616 });
  });

  it('forgets an archived deposit', async () => {
    const small = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Empty', currency: 'IDR', maturesOn: '2026-08-15', rateBps: 300 });
    await saveDepositAutomation(database, ws, on(small.id, bcaId, { termMonths: 1 }));
    await archiveAccount(database, ws, small.id);
    expect((await listDueDeposits(database, ws, '2026-10-15')).map((p) => p.accountId)).not.toContain(small.id);
  });
});
