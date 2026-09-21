import { expenseLines } from '@expanses/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assetsSchema,
  confirmDepositEvent,
  createAccount,
  type Database,
  goalsSchema,
  listDueDeposits,
  listEarmarks,
  openCashAccount,
  postTransaction,
  replaceTransaction,
  saveDepositAutomation,
  saveEarmark,
  saveGoal,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { entries } from '../src/schema';
import { setupDb } from './helpers';

/**
 * Where the deposit's reopen on void meets set-aside's take-back (final review I3, set-aside ruling I4): the take-back
 * and the answer's undo live in `markVoidTx`, which both a void and an edit go through; only a void reopens a deposit
 * event. An edit therefore carries an answer once, and a void undoes both what the answer did and what the event did.
 */
let database: Database;
let ws: WorkspaceContext;
let bcaId: string;
let depositoId: string;
let goalId: string;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bcaId = (await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-07-15' })).id;
  depositoId = (
    await openCashAccount(database, ws, {
      item: 'time_deposit', name: 'BCA Deposito', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425,
    })
  ).id;
  goalId = await saveGoal(database, ws, {
    name: 'Umrah 2027', kind: 'umrah', growthBps: 0, returnBps: 0,
    stages: [{ name: 'Tickets', targetMinor: 30_000_000, targetMonths: null, dueOn: '2027-03-31' }],
  });
});

const promised = async (accountId: string) =>
  (await listEarmarks(database, ws)).find((row) => row.goalId === goalId && row.accountId === accountId)?.amountMinor ?? 0;
const draws = () => database.db.select().from(goalsSchema.goalDraws).where(eq(goalsSchema.goalDraws.workspaceId, ws.workspaceId));
const logged = () => database.db.select().from(assetsSchema.depositEvents).where(eq(assetsSchema.depositEvents.workspaceId, ws.workspaceId));
const linesOf = (id: string) =>
  database.db.select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency }).from(entries).where(eq(entries.transactionId, id));

describe('an edit carries a goal answer once', () => {
  it('a spend answered from a goal, edited with and without the answer, takes the promise down by what it spends now, once', async () => {
    await saveEarmark(database, ws, { goalId, accountId: bcaId, amountMinor: 8_000_000 });
    const tickets = await createAccount(database, ws, { name: 'Travel', kind: 'expense', subtype: 'category', currency: null });
    const answer = { accountId: bcaId, goalId, intent: 'spend' as const, overMinor: 1 };
    const id = await postTransaction(database, ws, {
      occurredOn: '2026-09-19', description: 'Tickets',
      lines: expenseLines({ categoryAccountId: tickets.id, paymentAccountId: bcaId, amountMinor: 3_000_000, currency: 'IDR' }), setAside: answer,
    });
    expect(await promised(bcaId)).toBe(5_000_000);

    // Not mentioned: carried. The same answer again: kept. Neither applies it a second time.
    const noted = await replaceTransaction(database, ws, id, { occurredOn: '2026-09-19', description: 'Tickets, note', lines: await linesOf(id) });
    expect(await promised(bcaId)).toBe(5_000_000);
    const again = await replaceTransaction(database, ws, noted, { occurredOn: '2026-09-19', description: 'Tickets', lines: await linesOf(noted), setAside: answer });
    expect(await promised(bcaId)).toBe(5_000_000);
    // A bigger spend with the same answer: the difference, once (8 − 4), not 8 − 3 − 4.
    const bigger = await replaceTransaction(database, ws, again, {
      occurredOn: '2026-09-19', description: 'Tickets',
      lines: expenseLines({ categoryAccountId: tickets.id, paymentAccountId: bcaId, amountMinor: 4_000_000, currency: 'IDR' }), setAside: answer,
    });
    expect(await promised(bcaId)).toBe(4_000_000);
    expect((await draws()).map((row) => row.transactionId)).toEqual([bigger]);

    await voidTransaction(database, ws, bigger);
    expect(await promised(bcaId)).toBe(8_000_000);
    expect(await draws()).toEqual([]);
  });
});

describe('a deposit payout that also carries a goal answer', () => {
  it('voided: the payout is reopened and proposed again, and the promise its spend took comes back', async () => {
    // The bank took a stamp duty for the payout from Jenius, and the owner says Umrah's money paid it.
    const jeniusId = (await openCashAccount(database, ws, { item: 'savings', name: 'Jenius', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-07-15' })).id;
    await saveEarmark(database, ws, { goalId, accountId: jeniusId, amountMinor: 3_000_000 });
    const fees = await createAccount(database, ws, { name: 'Bank fees', kind: 'expense', subtype: 'category', currency: null });
    await saveDepositAutomation(database, ws, {
      accountId: depositoId, enabled: true, atMaturity: 'principal', interestPaid: 'monthly', payoutAccountId: bcaId,
      termMonths: 3, keepRate: true, taxBps: 2_000, taxExempt: false, today: '2026-07-15',
    });
    const [p] = await listDueDeposits(database, ws, '2026-10-15');
    const paid = await confirmDepositEvent(database, ws, {
      accountId: depositoId, kind: 'monthly', dueOn: '2026-08-15', today: '2026-10-15',
      principalMinor: p!.principalMinor, grossMinor: p!.grossMinor, taxMinor: p!.taxMinor,
    });

    const edited = await replaceTransaction(database, ws, paid.interestTransactionId!, {
      occurredOn: '2026-08-15', description: 'Interest: BCA Deposito',
      lines: [
        ...(await linesOf(paid.interestTransactionId!)),
        { accountId: jeniusId, amountMinor: -10_000, currency: 'IDR' },
        { accountId: fees.id, amountMinor: 10_000, currency: 'IDR' },
      ],
      setAside: { accountId: jeniusId, goalId, intent: 'spend', overMinor: 10_000 },
    });
    expect(await promised(jeniusId)).toBe(2_990_000);
    // The event followed the edit and kept its figures: the fee is not tax withheld.
    expect(await logged()).toMatchObject([{ kind: 'monthly', interestTransactionId: edited, grossMinor: 180_479, taxMinor: 36_095, netMinor: 144_384 }]);

    await voidTransaction(database, ws, edited);
    expect(await logged()).toEqual([]);
    expect((await listDueDeposits(database, ws, '2026-10-15'))[0]).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15' }, waiting: 2 });
    expect(await promised(jeniusId)).toBe(3_000_000);
    expect(await draws()).toEqual([]);
  });
});
