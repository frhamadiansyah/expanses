import { transferLines } from '@expanses/core';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAccount,
  assetsSchema,
  categoryIdsByKeyTx,
  type ConfirmDepositEventInput,
  confirmDepositEvent,
  createBook,
  createWorkspace,
  depositIncomePayments,
  type Database,
  DepositAutomationError,
  type DepositProposal,
  getDepositAutomation,
  getDepositTerms,
  inBook,
  listAccounts,
  listDueDeposits,
  nativeBalances,
  openCashAccount,
  personalBook,
  postTransactionTx,
  replaceTransaction,
  saveDepositAutomation,
  type SaveDepositAutomationInput,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { reopenDepositEventTx } from '../src/repos/deposit-event-log';
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

  it('is off by default with keepRate on', async () => {
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ keepRate: true, taxExempt: false });
  });

  it('carries keepRate and taxExempt through, in both directions', async () => {
    // The first save agrees with what the S2 defaults show (keepRate on, tax-free off).
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ keepRate: true, taxExempt: false });
    // A second save flips both. A hardcoded write on either field would leave one of these stuck.
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { keepRate: false, taxExempt: true }));
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ keepRate: false, taxExempt: true });
  });

  it('updates every field on a second save — a changed choice is not silently kept', async () => {
    const otherPayout = await openCashAccount(database, ws, { item: 'bank', name: 'Jenius', currency: 'IDR' });
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'principal' }));
    await saveDepositAutomation(
      database,
      ws,
      on(depositoId, otherPayout.id, { atMaturity: 'close', interestPaid: 'monthly', termMonths: 6, taxBps: 1_000, today: '2026-07-16' }),
    );
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({
      atMaturity: 'close',
      interestPaid: 'monthly',
      payoutAccountId: otherPayout.id,
      termMonths: 6,
      taxBps: 1_000,
    });
  });

  it('never erases a term start a roll-over stored, on an ordinary settings save', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    // Stands in for a confirmed roll-over, which is the only writer of term_started_on before T5.
    await database.db.run(sql`UPDATE deposit_automation SET term_started_on = '2026-07-15' WHERE account_id = ${depositoId}`);
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close', today: '2026-08-01' }));
    expect((await getDepositAutomation(database, ws, depositoId)).termStartedOn).toBe('2026-07-15');
  });
});

describe('a deposit that is not open', () => {
  it('refuses to save automation on an account that is not a time deposit', async () => {
    await expect(saveDepositAutomation(database, ws, on(bcaId, null))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to save automation on a deposit that has been archived', async () => {
    const empty = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Empty deposit', currency: 'IDR', maturesOn: '2027-01-01' });
    await archiveAccount(database, ws, empty.id);
    await expect(saveDepositAutomation(database, ws, on(empty.id, null))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('workspace scoping on the settings read', () => {
  it('never reads another workspace’s settings for the same account id', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    expect(await getDepositAutomation(database, other, depositoId)).toMatchObject({ enabled: false, payoutAccountId: null });
  });
});

describe('the tax percentage bound', () => {
  it('allows the full 100%, and refuses a negative one by name', async () => {
    await expect(saveDepositAutomation(database, ws, on(depositoId, bcaId, { taxBps: 10_000 }))).resolves.toBeUndefined();
    await expect(saveDepositAutomation(database, ws, on(depositoId, bcaId, { taxBps: -1 }))).rejects.toMatchObject({ code: 'BAD_TAX' });
  });
});

describe('where the money may land', () => {
  const refused = (input: SaveDepositAutomationInput) => expect(saveDepositAutomation(database, ws, input)).rejects.toBeInstanceOf(DepositAutomationError);

  it('refuses an account in another currency', async () => {
    const usd = await openCashAccount(database, ws, { item: 'bank', name: 'Jenius USD', currency: 'USD' });
    await refused(on(depositoId, usd.id));
  });

  it('refuses an account that is not spendable, and the deposit itself', async () => {
    // Both refusals are also given by the subtype clause of `payoutAccepts` alone: every account that could equal
    // `depositId` or hold a liability is a time_deposit or a credit_card/loan/payable, and none of those subtypes
    // is in SPENDABLE_SUBTYPES. The `id !== depositId` and `kind === 'asset'` clauses cannot be discriminated
    // through the public repo API — see the "d1-review" Minor 5 note, accepted here as defence in depth.
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

  it('a roll-over at a new rate and term: voiding it restores the rate, the term and its start as they were', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    // The first roll-over starts a stored term (1 month, 4,25%); the second changes both, and is the one voided.
    await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { newTermMonths: 1 }));
    const second = await confirmDepositEvent(database, ws, asProposed(await next('2026-11-15'), '2026-11-15', { newRateBps: 510, newTermMonths: 6 }));
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2027-05-15', rateBps: 510 });
    await voidTransaction(database, ws, second.interestTransactionId!);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2026-11-15', rateBps: 425 });
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ termMonths: 1, termStartedOn: '2026-10-15' });
    // The same maturity again, over the same 31 days at the old rate: 50 000 000 × 4,25% × 31 / 365 = 180 479 (floored).
    expect(await next('2026-11-15')).toMatchObject({ event: { kind: 'maturity', dueOn: '2026-11-15', periodFrom: '2026-10-15', days: 31 }, rateBps: 425, grossMinor: 180_479 });
    expect(await logged()).toHaveLength(1);
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
    // Un-archived through the accounts repo, so the audit has it.
    expect(await database.db.values(sql`SELECT action FROM audit_log WHERE entity_id = ${depositoId} AND action LIKE '%archive' ORDER BY rowid`)).toEqual([['archive'], ['unarchive']]);
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

/** Everything a refused void must leave as it was: the log, the terms, the settings, every balance and every status. */
async function snapshot() {
  return {
    log: (await logged()).map(({ confirmedAt, ...row }) => row).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    terms: await getDepositTerms(database, ws, depositoId),
    settings: await getDepositAutomation(database, ws, depositoId),
    balances: await nativeBalances(database, ws),
    statuses: await database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`),
    live: (await listAccounts(database, ws)).map((a) => a.id).sort(),
  };
}

describe('voiding is last in, first out across a maturity', () => {
  /** Monthly payouts, rolling the principal: Aug, Sep, the Oct maturity (rolls into a 3-month term), then 15 Nov. */
  async function throughNovember() {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const ids: string[] = [];
    for (const day of ['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15']) {
      const today = day < '2026-10-15' ? '2026-10-15' : day;
      ids.push((await confirmDepositEvent(database, ws, asProposed(await next(today), today, { newRateBps: 510, newTermMonths: 3 }))).interestTransactionId!);
    }
    expect((await logged()).map((row) => row.dueOn).sort()).toEqual(['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-15']);
    return { aug: ids[0]!, sep: ids[1]!, oct: ids[2]!, nov: ids[3]! };
  }

  it('refuses to void a roll-over while a payout of the term it started is logged, and changes nothing', async () => {
    const { oct } = await throughNovember();
    const before = await snapshot();
    const refusal = voidTransaction(database, ws, oct);
    await expect(refusal).rejects.toMatchObject({ code: 'NOT_LAST' });
    await expect(voidTransaction(database, ws, oct)).rejects.toThrow('Void that one first');
    expect(await snapshot()).toEqual(before);
    expect(before.terms).toMatchObject({ maturesOn: '2027-01-15', rateBps: 510 });
  });

  it('refuses to void a payout from before a logged roll-over, and changes nothing', async () => {
    const { aug } = await throughNovember();
    const before = await snapshot();
    await expect(voidTransaction(database, ws, aug)).rejects.toMatchObject({ code: 'NOT_LAST' });
    expect(await snapshot()).toEqual(before);
  });

  it('voids the roll-over once the later payout is voided first: term, rate and start come back', async () => {
    const { oct, nov } = await throughNovember();
    await voidTransaction(database, ws, nov);
    expect((await logged()).map((row) => row.dueOn).sort()).toEqual(['2026-08-15', '2026-09-15', '2026-10-15']);
    await voidTransaction(database, ws, oct);
    expect((await logged()).map((row) => row.dueOn).sort()).toEqual(['2026-08-15', '2026-09-15']);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2026-10-15', rateBps: 425 });
    expect(await getDepositAutomation(database, ws, depositoId)).toMatchObject({ termMonths: 3, termStartedOn: null });
    // The October maturity again, over its own 30 days at the old rate, on the principal of the due day:
    // 50 000 000 × 4,25% × 30 / 365 = 174 657 (floored).
    expect(await next('2026-11-15')).toMatchObject({
      event: { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-09-15', days: 30 },
      waiting: 0,
      rateBps: 425,
      grossMinor: 174_657,
    });
  });

  it('still reopens a monthly payout with only later payouts of the same term logged', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const aug = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await voidTransaction(database, ws, aug.interestTransactionId!);
    expect((await logged()).map((row) => row.dueOn)).toEqual(['2026-09-15']);
    expect(await next('2026-10-15')).toMatchObject({ event: { kind: 'monthly', dueOn: '2026-08-15' }, waiting: 1 });
  });
});

describe('what is due, across deposits and over time', () => {
  it('proposes nothing once the switch is turned off again, although the row is kept', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { enabled: false }));
    expect(await logged()).toEqual([]);
    expect(await database.db.values(sql`SELECT enabled FROM deposit_automation WHERE account_id = ${depositoId}`)).toEqual([[0]]);
    expect(await listDueDeposits(database, ws, '2026-12-31')).toEqual([]);
  });

  it('keeps proposing a second deposit due the same day after the first is confirmed', async () => {
    const twin = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Twin', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await saveDepositAutomation(database, ws, on(twin.id, bcaId));
    await confirmDepositEvent(database, ws, asProposed((await listDueDeposits(database, ws, '2026-10-15')).find((p) => p.accountId === depositoId)!, '2026-10-15'));
    // 20 000 000 × 4,25% × 92 / 365 = 214 246 (floored).
    expect(await listDueDeposits(database, ws, '2026-10-15')).toMatchObject([{ accountId: twin.id, event: { kind: 'maturity', dueOn: '2026-10-15' }, grossMinor: 214_246 }]);
  });

  it('lists deposits soonest first, whatever order they were switched on in', async () => {
    const later = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Later', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-08-20', maturesOn: '2026-11-20', rateBps: 425 });
    const sooner = await openCashAccount(database, ws, { item: 'time_deposit', name: 'Sooner', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-06-01', maturesOn: '2026-09-01', rateBps: 425 });
    await saveDepositAutomation(database, ws, on(later.id, bcaId));
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await saveDepositAutomation(database, ws, on(sooner.id, bcaId));
    expect((await listDueDeposits(database, ws, '2026-12-01')).map((p) => p.event.dueOn)).toEqual(['2026-09-01', '2026-10-15', '2026-11-20']);
  });

  it('works the interest on the balance of the due day, not on what is left by the day it is confirmed', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    await database.transaction((tx) =>
      postTransactionTx(tx, ws, {
        occurredOn: '2026-10-20',
        description: 'Broke part of it',
        lines: transferLines({ fromAccountId: depositoId, toAccountId: bcaId, amountMinor: 10_000_000, currency: 'IDR' }),
      }),
    );
    // 40 000 000 on the 25th would give 428 493; the due day's 50 000 000 gives 535 616.
    expect(await next('2026-10-25')).toMatchObject({ principalMinor: 50_000_000, grossMinor: 535_616 });
  });
});

describe('another workspace', () => {
  /** A second book with its own deposit, automated and confirmed once, so its log and its settings both exist. */
  async function otherBook() {
    const other = await createWorkspace(database, { name: 'Business', type: 'business', baseCurrency: 'IDR' });
    const bank = await openCashAccount(database, other, { item: 'bank', name: 'Mandiri', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-07-15' });
    const dep = await openCashAccount(database, other, { item: 'time_deposit', name: 'Mandiri Deposito', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-07-15', maturesOn: '2026-10-15', rateBps: 425 });
    await saveDepositAutomation(database, other, on(dep.id, bank.id, { interestPaid: 'monthly' }));
    const [first] = await listDueDeposits(database, other, '2026-10-15');
    await confirmDepositEvent(database, other, asProposed(first!, '2026-10-15'));
    return { other, dep };
  }

  it('never lists, or reports, another workspace’s deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const { other, dep } = await otherBook();
    expect((await listDueDeposits(database, ws, '2026-10-15')).map((p) => p.accountId)).toEqual([depositoId]);
    expect((await listDueDeposits(database, other, '2026-10-15')).map((p) => p.accountId)).toEqual([dep.id]);
    expect(await depositIncomePayments(database, ws)).toEqual([]);
    expect((await depositIncomePayments(database, other)).map((p) => p.accountId)).toEqual([dep.id]);
  });

  it('never reopens an event of this workspace from another one', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const mine = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const { other } = await otherBook();
    expect(await database.transaction((tx) => reopenDepositEventTx(tx, other, mine.interestTransactionId!))).toEqual([]);
    expect(await logged()).toHaveLength(1);
  });
});

describe('confirm refusals', () => {
  it('refuses a payout account archived after the settings were saved', async () => {
    const jenius = await openCashAccount(database, ws, { item: 'bank', name: 'Jenius', currency: 'IDR' });
    await saveDepositAutomation(database, ws, on(depositoId, jenius.id));
    await archiveAccount(database, ws, jenius.id);
    await expect(confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'))).rejects.toMatchObject({ code: 'BAD_PAYOUT' });
    expect(await logged()).toEqual([]);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
  });

  it('refuses a roll-over without a valid new term or rate', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId));
    const p = await next('2026-10-15');
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { newTermMonths: undefined }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { newTermMonths: 2 as never }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { newRateBps: undefined }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    await expect(confirmDepositEvent(database, ws, asProposed(p, '2026-10-15', { newRateBps: 42.5 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    expect(await logged()).toEqual([]);
    expect(await getDepositTerms(database, ws, depositoId)).toMatchObject({ maturesOn: '2026-10-15', rateBps: 425 });
  });

  it('refuses a close that says nothing came back', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    await expect(confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15', { principalMinor: 0 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    expect(await logged()).toEqual([]);
  });

  it('lets an unexpected failure of the archive fail the whole close, and keeps nothing of it', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    // Fault injection: the archive's audit write fails with an error that is not the archive's own refusal.
    await database.db.run(sql`CREATE TRIGGER audit_down BEFORE INSERT ON audit_log WHEN NEW.action = 'archive' BEGIN SELECT RAISE(ABORT, 'audit is down'); END`);
    await expect(confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'))).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining('audit is down') }),
    });
    expect(await logged()).toEqual([]);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(50_000_000);
    expect((await listAccounts(database, ws)).map((a) => a.id)).toContain(depositoId);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(true);
  });
});

describe('editing a close’s principal transfer', () => {
  it('the log takes the edited principal and the replacement’s id, and voiding the replacement reopens the close whole', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const replacement = await replaceTransaction(database, ws, result.principalTransactionId!, {
      occurredOn: '2026-10-15',
      description: 'BCA Deposito matured',
      lines: transferLines({ fromAccountId: depositoId, toAccountId: bcaId, amountMinor: 49_999_000, currency: 'IDR' }),
    });
    expect(await logged()).toMatchObject([{ principalMinor: 49_999_000, principalTransactionId: replacement, interestTransactionId: result.interestTransactionId }]);
    // The 1 000 left behind keeps the deposit open (net worth shows it), with automation off, as a short close does.
    expect((await nativeBalances(database, ws))[depositoId]).toBe(1_000);
    expect((await listAccounts(database, ws)).map((a) => a.id)).toContain(depositoId);
    expect((await getDepositAutomation(database, ws, depositoId)).enabled).toBe(false);
    await voidTransaction(database, ws, replacement);
    expect(await logged()).toEqual([]);
    const balances = await nativeBalances(database, ws);
    expect(balances[bcaId]).toBe(1_000_000);
    expect(balances[depositoId]).toBe(50_000_000);
    expect(await incomeAndTax()).toEqual({ income: 0, tax: 0 });
    expect((await listAccounts(database, ws)).map((a) => a.id)).toContain(depositoId);
  });
});

describe('a close after money left the deposit, and edits that are not the principal', () => {
  it('refuses a close for more than the deposit holds now, and closes for what it holds', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    await database.transaction((tx) =>
      postTransactionTx(tx, ws, {
        occurredOn: '2026-10-20',
        description: 'Broke part of it',
        lines: transferLines({ fromAccountId: depositoId, toAccountId: bcaId, amountMinor: 10_000_000, currency: 'IDR' }),
      }),
    );
    const proposal = await next('2026-10-25');
    expect(proposal.principalMinor).toBe(50_000_000);
    const before = await nativeBalances(database, ws);
    await expect(confirmDepositEvent(database, ws, asProposed(proposal, '2026-10-25'))).rejects.toMatchObject({ code: 'BAD_FIGURE', message: expect.stringContaining('holds less') });
    // One minor unit over is still refused; the exact balance is not.
    await expect(confirmDepositEvent(database, ws, asProposed(proposal, '2026-10-25', { principalMinor: 40_000_001 }))).rejects.toMatchObject({ code: 'BAD_FIGURE' });
    expect(await logged()).toEqual([]);
    expect(await nativeBalances(database, ws)).toEqual(before);
    const result = await confirmDepositEvent(database, ws, asProposed(proposal, '2026-10-25', { principalMinor: 40_000_000 }));
    expect(result.archived).toBe(true);
    expect((await nativeBalances(database, ws))[depositoId]).toBe(0);
  });

  it('leaves a close archived when an edit to its transfer still empties the deposit', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { atMaturity: 'close' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await replaceTransaction(database, ws, result.principalTransactionId!, {
      occurredOn: '2026-10-16',
      description: 'Deposito paid out',
      lines: transferLines({ fromAccountId: depositoId, toAccountId: bcaId, amountMinor: 50_000_000, currency: 'IDR' }),
    });
    expect((await listAccounts(database, ws)).map((a) => a.id)).not.toContain(depositoId);
    expect(await database.db.values(sql`SELECT action FROM audit_log WHERE entity_id = ${depositoId} AND action LIKE '%archive' ORDER BY rowid`)).toEqual([['archive']]);
  });

  it('reads only the tax line as tax withheld when an edit adds a bank fee', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const keys = await categoryIdsByKeyTx(database.db, ws);
    await replaceTransaction(database, ws, result.interestTransactionId!, {
      occurredOn: '2026-08-15',
      description: 'Interest: BCA Deposito',
      lines: [
        { accountId: bcaId, amountMinor: 139_384, currency: 'IDR' },
        { accountId: keys['government_taxes.estimated_tax']!, amountMinor: 36_095, currency: 'IDR' },
        { accountId: keys['miscellaneous.fees_charges']!, amountMinor: 5_000, currency: 'IDR' },
        { accountId: keys['income.investment']!, amountMinor: -180_479, currency: 'IDR' },
      ],
    });
    expect(await logged()).toMatchObject([{ grossMinor: 180_479, taxMinor: 36_095, netMinor: 144_384 }]);
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

describe('editing the posted interest, beyond the tax the confirm posted', () => {
  it('reads a credit on the tax line (a refund) as no tax withheld, never as a negative one', async () => {
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    const keys = await categoryIdsByKeyTx(database.db, ws);
    await replaceTransaction(database, ws, result.interestTransactionId!, {
      occurredOn: '2026-08-15',
      description: 'Interest: BCA Deposito',
      lines: [
        { accountId: bcaId, amountMinor: 185_479, currency: 'IDR' },
        { accountId: keys['government_taxes.estimated_tax']!, amountMinor: -5_000, currency: 'IDR' },
        { accountId: keys['income.investment']!, amountMinor: -180_479, currency: 'IDR' },
      ],
    });
    // Tax withheld cannot be below zero (confirm refuses it too), so the log keeps gross = net + tax with tax 0.
    expect(await logged()).toMatchObject([{ grossMinor: 180_479, taxMinor: 0, netMinor: 180_479 }]);
    expect((await depositIncomePayments(database, ws))[0]).toMatchObject({ grossMinor: 180_479, taxMinor: 0 });
  });

  it('reads the tax from an edit made while another book is open, not as 0', async () => {
    const personal = await personalBook(database, ws);
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal.id });
    const mine = await categoryIdsByKeyTx(database.db, inBook(ws, personal.id));
    const theirs = await categoryIdsByKeyTx(database.db, inBook(ws, business));
    expect(theirs['government_taxes.estimated_tax']).not.toBe(mine['government_taxes.estimated_tax']);
    await saveDepositAutomation(database, ws, on(depositoId, bcaId, { interestPaid: 'monthly' }));
    const result = await confirmDepositEvent(database, ws, asProposed(await next('2026-10-15'), '2026-10-15'));
    await replaceTransaction(database, inBook(ws, business), result.interestTransactionId!, {
      occurredOn: '2026-08-15',
      description: 'Interest: BCA Deposito',
      lines: [
        { accountId: bcaId, amountMinor: 144_401, currency: 'IDR' },
        { accountId: mine['government_taxes.estimated_tax']!, amountMinor: 36_100, currency: 'IDR' },
        { accountId: mine['income.investment']!, amountMinor: -180_501, currency: 'IDR' },
      ],
    });
    expect(await logged()).toMatchObject([{ grossMinor: 180_501, taxMinor: 36_100, netMinor: 144_401 }]);
  });
});
