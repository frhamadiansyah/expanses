import { transferLines } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAccount,
  assetsSchema,
  categoryIdsByKeyTx,
  type ConfirmDepositEventInput,
  confirmDepositEvent,
  createWorkspace,
  type Database,
  DepositAutomationError,
  type DepositProposal,
  getDepositAutomation,
  getDepositTerms,
  listAccounts,
  listDueDeposits,
  nativeBalances,
  openCashAccount,
  postTransactionTx,
  replaceTransaction,
  saveDepositAutomation,
  type SaveDepositAutomationInput,
  voidTransaction,
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

/** The input that confirms the proposal exactly as proposed, the way the card does when nothing was edited. */
export function asProposed(p: DepositProposal, today: string, change: Partial<ConfirmDepositEventInput> = {}): ConfirmDepositEventInput {
  return {
    accountId: p.accountId,
    kind: p.event.kind,
    dueOn: p.event.dueOn,
    today,
    principalMinor: p.principalMinor,
    grossMinor: p.grossMinor,
    taxMinor: p.taxMinor,
    newRateBps: p.rateBps,
    newTermMonths: p.settings.termMonths,
    ...change,
  };
}

const next = async (today: string) => (await listDueDeposits(database, ws, today))[0]!;

/** What the two categories an investment payment posts into hold now: income is a credit, so it reads negative. */
async function incomeAndTax() {
  const keys = await categoryIdsByKeyTx(database.db, ws);
  const balances = await nativeBalances(database, ws);
  return { income: balances[keys['income.investment']!] ?? 0, tax: balances[keys['government_taxes.estimated_tax']!] ?? 0 };
}

describe('confirming', () => {
  it('rolls the principal over: gross to income, the tax on its own line, the net to the payout account, and a new term', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    expect(result).toMatchObject({ netMinor: 428_493, principalTransactionId: null, archived: false });
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(1_428_493);
    expect(balances[depositoId]).toBe(50_000_000);
    // Gross, not net, is the income; the tax is a line of its own, exactly as an investment payment posts.
    expect(await incomeAndTax()).toEqual({ income: -535_616, tax: 107_123 });
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-01-15', rateBps: 425 });
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ termStartedOn: '2026-10-15', termMonths: 3 });
    expect(await listDueDeposits(database, ws, '2026-10-15')).toEqual([]);
  });

  it('posts the gross and tax that were typed, lands their difference, and carries a corrected rate and term', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const p = await next('2026-10-15');
    const result = await confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { grossMinor: 535_700, taxMinor: 107_140, newRateBps: 400, newTermMonths: 6 }));
    expect(result.netMinor).toBe(428_560);
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_428_560);
    expect(await incomeAndTax()).toEqual({ income: -535_700, tax: 107_140 });
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-04-15', rateBps: 400 });
  });

  it('posts no tax line on a tax-free deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { taxExempt: true }));
    await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_535_616);
    expect(await incomeAndTax()).toEqual({ income: -535_616, tax: 0 });
  });

  it('closes a deposit that does not roll over: it empties into the payout account and is archived', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    expect(result.archived).toBe(true);
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(51_428_493);
    expect(balances[depositoId] ?? 0).toBe(0);
    expect((await listAccounts(database, ws)).map((a) => a.id)).not.toContain(depositoId);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
  });

  it('keeps a deposit open when the principal typed leaves money in it', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { principalMinor: 49_000_000 }));
    expect(result.archived).toBe(false);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(1_000_000);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
  });

  it('refuses the second of two confirms, and anything that is not next', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const first = await next('2026-10-15');
    await expect(confirmDepositEvent(database, ws, asProposed(first, '2026-10-15', { dueOn: '2026-09-15' }))).rejects.toMatchObject({ code: 'NOT_NEXT' });
    await confirmDepositEvent(database, ws, asProposed(first, '2026-10-15'));
    await expect(confirmDepositEvent(database, ws, asProposed(first, '2026-10-15'))).rejects.toMatchObject({ code: 'NOT_NEXT' });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_144_384);
  });

  it('refuses while off, and without a payout account where money must land', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, null));
    const p = await next('2026-10-15');
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15'))).rejects.toMatchObject({ code: 'NO_PAYOUT' });
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { enabled: false }));
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15'))).rejects.toMatchObject({ code: 'OFF' });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
  });

  it('refuses a figure that is not whole minor units, a tax above the gross, or a tax that leaves nothing to land', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const p = await next('2026-10-15');
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { grossMinor: 535_616.5 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { taxMinor: 600_000 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { taxMinor: 535_616 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
  });
});

describe('recorded it myself', () => {
  it('marks a payout done and posts nothing; the next one is proposed, and no payout account is needed', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, null, { interestPaid: 'monthly' }));
    const first = await next('2026-10-15');
    const result = await confirmDepositEvent(database, ws, asProposed(first, '2026-10-15', { byHand: true }));
    expect(result).toEqual({ interestTransactionId: null, principalTransactionId: null, netMinor: 144_384, archived: false });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-09-15' }, waiting: 1 });
  });

  it('still starts the next term when a roll-over was recorded by hand', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { byHand: true }));
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-01-15', rateBps: 425 });
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
    expect(await listDueDeposits(database, ws, '2026-10-15')).toEqual([]);
  });

  it('closes by hand only once the owner has emptied the deposit; until then it stays open, with automation off', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const kept = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { byHand: true }));
    expect(kept.archived).toBe(false);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(50_000_000);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
  });

  it('archives a deposit the owner already emptied by hand', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const p = await next('2026-10-15');
    // The owner's own transfer, posted before they tell the app they did it.
    await database.transaction((tx) =>
      postTransactionTx(tx, ws, {
        occurredOn: '2026-10-15',
        description: 'Deposito back',
        lines: transferLines({ fromAccountId: depositoId, toAccountId: bcaId, amountMinor: 50_000_000, currency: 'IDR' }),
      }),
    );
    expect((await confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { byHand: true }))).archived).toBe(true);
    expect((await nativeBalances(database, ws))[bcaId]).toBe(51_000_000);
  });
});

/** The confirmed-event log of the workspace, as stored. */
const logged = () => database.db.select().from(assetsSchema.depositEvents).where(eq(assetsSchema.depositEvents.workspaceId, ws.workspaceId));

describe('voiding what an event posted reopens it', () => {
  it('a monthly payout: the log row goes, the money goes, and the same payout is proposed again', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    expect(await logged()).toHaveLength(1);
    await voidTransaction(database, ws, result.interestTransactionId!);
    expect(await logged()).toEqual([]);
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15' }, waiting: 2, grossMinor: 180_479, taxMinor: 36_095 });
  });

  it('a roll-over: the term it started is taken back, so the maturity is proposed again', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await voidTransaction(database, ws, result.interestTransactionId!);
    expect(await logged()).toEqual([]);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2026-10-15', rateBps: 425 });
    expect(await next('2026-10-15')).toMatchObject({
      event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 },
      grossMinor: 535_616,
      taxMinor: 107_123,
    });
  });

  it('a close: its other posting is voided with it, the deposit reopens with automation on, and the maturity returns', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    expect(result.archived).toBe(true);
    await voidTransaction(database, ws, result.interestTransactionId!);
    expect(await logged()).toEqual([]);
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(1_000_000);
    expect(balances[depositoId]).toBe(50_000_000);
    expect((await listAccounts(database, ws)).map((a) => a.id)).toContain(depositoId);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(true);
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'maturity', dueOn: '2026-10-15' }, principalMinor: 50_000_000, grossMinor: 535_616 });
  });

  it('a close, from its principal transfer: the interest goes with it', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await voidTransaction(database, ws, result.principalTransactionId!);
    expect(await logged()).toEqual([]);
    expect((await nativeBalances(database, ws))[bcaId]).toBe(1_000_000);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'maturity', dueOn: '2026-10-15' } });
  });

  it('touches no other deposit’s log', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const other = await database.transaction((tx) =>
      postTransactionTx(tx, ws, {
        occurredOn: '2026-10-15',
        description: 'Coffee money',
        lines: transferLines({ fromAccountId: bcaId, toAccountId: depositoId, amountMinor: 1_000, currency: 'IDR' }),
      }),
    );
    await voidTransaction(database, ws, other);
    expect(await logged()).toHaveLength(1);
  });

  it('editing the posted interest keeps the event done, and the log takes the edited gross and tax', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const keys = await categoryIdsByKeyTx(database.db, ws);
    const replacement = await replaceTransaction(database, ws, result.interestTransactionId!, {
      occurredOn: '2026-08-15',
      description: 'Interest: BCA Deposito',
      lines: [
        { accountId: bcaId, amountMinor: 144_401, currency: 'IDR' },
        { accountId: keys['government_taxes.estimated_tax']!, amountMinor: 36_100, currency: 'IDR' },
        { accountId: keys['income.investment']!, amountMinor: -180_501, currency: 'IDR' },
      ],
    });
    expect(await logged()).toMatchObject([{ dueOn: '2026-08-15', grossMinor: 180_501, taxMinor: 36_100, netMinor: 144_401, interestTransactionId: replacement }]);
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-09-15' }, waiting: 1 });
    // …and voiding the replacement then reopens the event.
    await voidTransaction(database, ws, replacement);
    expect(await logged()).toEqual([]);
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15' } });
  });
});

describe('recorded it myself, with the figures corrected', () => {
  it('logs the gross and tax the owner confirmed, not the estimate', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { grossMinor: 535_700, taxMinor: 107_141, byHand: true }));
    expect(result).toEqual({ interestTransactionId: null, principalTransactionId: null, netMinor: 428_559, archived: false });
    expect(await logged()).toMatchObject([{ grossMinor: 535_700, taxMinor: 107_141, netMinor: 428_559, recordedByHand: 1 }]);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
  });
});
