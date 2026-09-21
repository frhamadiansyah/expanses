import { addMonthsToDate, dueDepositEvents, eventKey, type TermMonths } from '@expanses/core';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  assetsSchema,
  categoryIdsByKeyTx,
  confirmDepositEvent,
  type Database,
  getDepositAutomation,
  getDepositTerms,
  incomeInputsFor,
  listAccounts,
  listDueDeposits,
  nativeBalances,
  openCashAccount,
  saveDepositAutomation,
  undoRecordedByHand,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

/**
 * A deposit that pays monthly and closes at maturity, driven by random sequences of confirm (as proposed, edited, or
 * recorded by hand), void of a random posted half, undo by hand, and the clock moving on. Voids and undos are picked
 * in any order, so NOT_LAST refuses many of them. After every step the ledger, the log and the tax report must agree,
 * and no event may be lost or doubled (C1: a close reopened before a monthly payout of its term lost that payout).
 */

const SEQUENCES = 100;
const STEPS = 30;

/** mulberry32: small, seeded, reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

interface Logged {
  id: string;
  kind: 'monthly' | 'maturity';
  dueOn: string;
  recordedByHand: number;
  interestTransactionId: string | null;
  principalTransactionId: string | null;
  principalMinor: number;
  grossMinor: number;
  taxMinor: number;
  netMinor: number;
}

async function runSequence(seed: number): Promise<void> {
  const r = prng(seed);
  const { database, ws, executor } = await setupDb('IDR');
  try {
    const usd = r.next() < 0.5;
    const currency = usd ? 'USD' : 'IDR';
    const fx = usd ? 16_350 : undefined;
    const term = r.pick([1, 3, 3, 6] as const) as TermMonths;
    const openedOn = r.pick(['2026-01-31', '2026-07-15', '2026-11-30']);
    const maturesOn = addMonthsToDate(openedOn, term);
    const taxExempt = r.next() < 0.3;
    const opening = { deposit: usd ? 1_000_000 : 50_000_000, payout: usd ? 5_000 : 1_000_000 };

    const payout = await openCashAccount(database, ws, { item: 'bank', name: 'Payout', currency, openingBalanceMinor: opening.payout, openedOn, openingRateToBase: fx });
    const deposit = await openCashAccount(database, ws, {
      item: 'time_deposit', name: 'Deposito', currency, openingBalanceMinor: opening.deposit, openedOn, openingRateToBase: fx, maturesOn, rateBps: 425,
    });
    await saveDepositAutomation(database, ws, {
      accountId: deposit.id, enabled: true, atMaturity: 'close', interestPaid: 'monthly', payoutAccountId: payout.id,
      termMonths: term, keepRate: true, taxBps: 2_000, taxExempt, today: openedOn,
    });
    // The whole schedule, as the stored terms define it. Closing never rolls, so it never changes.
    const schedule = dueDepositEvents({ maturesOn, termMonths: term, termStartedOn: null, interestPaid: 'monthly', enabledOn: openedOn }, new Set(), '2099-12-31');
    const keys = await categoryIdsByKeyTx(database.db, ws);
    const years = [...new Set(schedule.map((e) => Number(e.dueOn.slice(0, 4))))];

    const logged = async (): Promise<Logged[]> =>
      (await database.db.select().from(assetsSchema.depositEvents).where(eq(assetsSchema.depositEvents.workspaceId, ws.workspaceId))).sort((a, b) =>
        a.dueOn.localeCompare(b.dueOn),
      );
    const snapshot = async () => ({
      log: (await logged()).map(({ confirmedAt, ...row }: Logged & { confirmedAt?: string }) => row),
      terms: await getDepositTerms(database, ws, deposit.id),
      settings: await getDepositAutomation(database, ws, deposit.id),
      balances: await nativeBalances(database, ws),
      statuses: await database.db.values(sql`SELECT id, status FROM transactions ORDER BY id`),
      live: (await listAccounts(database, ws)).map((a) => a.id).sort(),
    });
    /** NOT_LAST, stated independently: a later logged event blocks when either side is a maturity. */
    const blocked = (event: Logged, log: Logged[]) => {
      const later = log.filter((row) => row.dueOn > event.dueOn);
      return later.length > 0 && (event.kind === 'maturity' || later.some((row) => row.kind === 'maturity'));
    };

    let today = schedule[0]!.dueOn;
    const trail: string[] = [];

    const check = async () => {
      const log = await logged();
      const where = `seed ${seed} (${currency}, ${term} months from ${openedOn}, tax-free ${taxExempt}) after ${trail.join(' → ')}`;
      // Nothing doubled: one row per key, and every row adds up.
      expect(new Set(log.map((row) => eventKey(row.kind, row.dueOn))).size, where).toBe(log.length);
      for (const row of log) expect(row.netMinor, where).toBe(row.grossMinor - row.taxMinor);

      // Posted by the app = what the log holds, exactly.
      const postedIds = (await database.db.values<[string]>(
        sql`SELECT id FROM transactions WHERE status = 'posted' AND (description LIKE 'Interest: %' OR description LIKE '% matured')`,
      )).map(([id]) => id).sort();
      const loggedIds = log.flatMap((row) => [row.interestTransactionId, row.principalTransactionId]).filter((id): id is string => id !== null).sort();
      expect(postedIds, where).toEqual(loggedIds);

      // Ledger = log.
      const posted = log.filter((row) => row.recordedByHand === 0);
      const sum = (rows: Logged[], pick: (row: Logged) => number) => rows.reduce((total, row) => total + pick(row), 0);
      const principalOut = sum(posted.filter((row) => row.principalTransactionId !== null), (row) => row.principalMinor);
      const balances = await nativeBalances(database, ws);
      expect(balances[deposit.id] ?? 0, where).toBe(opening.deposit - principalOut);
      expect(balances[payout.id] ?? 0, where).toBe(opening.payout + sum(posted, (row) => row.netMinor) + principalOut);
      expect(balances[keys['income.investment']!] ?? 0, where).toBe(0 - sum(posted, (row) => row.grossMinor));
      expect(balances[keys['government_taxes.estimated_tax']!] ?? 0, where).toBe(sum(posted, (row) => row.taxMinor));

      // Tax report = log, year by year.
      for (const year of years) {
        const reported = (await incomeInputsFor(database, ws, year)).filter((row) => row.accountId === deposit.id);
        const ofYear = log.filter((row) => row.grossMinor > 0 && row.dueOn.startsWith(`${year}-`));
        expect([sum(reported as never, (row: { grossMinor: number }) => row.grossMinor), sum(reported as never, (row: { taxMinor: number }) => row.taxMinor)], where).toEqual([
          sum(ofYear, (row) => row.grossMinor),
          sum(ofYear, (row) => row.taxMinor),
        ]);
      }

      // Nothing lost: every due event of the schedule is logged or waiting; a close ends the deposit's automation.
      const done = new Set(log.map((row) => eventKey(row.kind, row.dueOn)));
      const closed = log.some((row) => row.kind === 'maturity');
      const [proposal] = await listDueDeposits(database, ws, today);
      const settings = await getDepositAutomation(database, ws, deposit.id);
      if (closed) {
        expect(schedule.every((e) => done.has(eventKey(e.kind, e.dueOn))), where).toBe(true);
        expect(settings.enabled, where).toBe(false);
        expect(proposal, where).toBeUndefined();
      } else {
        const waiting = schedule.filter((e) => e.dueOn <= today && !done.has(eventKey(e.kind, e.dueOn)));
        expect(settings.enabled, where).toBe(true);
        expect(proposal ? [eventKey(proposal.event.kind, proposal.event.dueOn), proposal.waiting + 1] : null, where).toEqual(
          waiting.length > 0 ? [eventKey(waiting[0]!.kind, waiting[0]!.dueOn), waiting.length] : null,
        );
      }
      // Archived only by a close the app posted, which emptied it; a close recorded by hand never archives (I1).
      const live = (await listAccounts(database, ws)).some((a) => a.id === deposit.id);
      expect(live, where).toBe(!log.some((row) => row.kind === 'maturity' && row.recordedByHand === 0));
    };

    for (let step = 0; step < STEPS; step++) {
      const roll = r.next();
      const log = await logged();
      if (roll < 0.4) {
        const [p] = await listDueDeposits(database, ws, today);
        if (!p) continue;
        const byHand = r.next() < 0.3;
        let { grossMinor, taxMinor } = p;
        if (r.next() < 0.3) {
          grossMinor = Math.max(2, grossMinor + r.int(-500, 500));
          taxMinor = taxExempt ? 0 : r.int(0, grossMinor - 1);
        }
        await confirmDepositEvent(database, ws, {
          accountId: deposit.id, kind: p.event.kind, dueOn: p.event.dueOn, today, principalMinor: p.principalMinor,
          grossMinor, taxMinor, rateToBase: fx, byHand,
        });
        trail.push(`${byHand ? 'by hand' : 'confirm'} ${p.event.kind} ${p.event.dueOn}`);
      } else if (roll < 0.7) {
        const candidates = log.filter((row) => row.recordedByHand === 0);
        if (candidates.length === 0) continue;
        const event = r.pick(candidates);
        const halves = [event.interestTransactionId, event.principalTransactionId].filter((id): id is string => id !== null);
        const target = r.pick(halves);
        trail.push(`void ${event.kind} ${event.dueOn}`);
        if (blocked(event, log)) {
          const before = await snapshot();
          await expect(voidTransaction(database, ws, target), trail.join(' → ')).rejects.toMatchObject({ code: 'NOT_LAST' });
          expect(await snapshot()).toEqual(before);
        } else {
          await voidTransaction(database, ws, target);
        }
      } else if (roll < 0.9) {
        const candidates = log.filter((row) => row.recordedByHand === 1);
        if (candidates.length === 0) continue;
        const event = r.pick(candidates);
        trail.push(`undo ${event.kind} ${event.dueOn}`);
        if (blocked(event, log)) {
          const before = await snapshot();
          await expect(undoRecordedByHand(database, ws, event.id), trail.join(' → ')).rejects.toMatchObject({ code: 'NOT_LAST' });
          expect(await snapshot()).toEqual(before);
        } else {
          await undoRecordedByHand(database, ws, event.id);
        }
      } else {
        today = [plusDays(today, r.int(1, 45)), plusDays(maturesOn, 10)].sort()[0]!;
        trail.push(`today ${today}`);
      }
      await check();
    }
  } finally {
    executor.close();
  }
}

describe('a monthly deposit that closes, under random confirm, void and undo', () => {
  it(`keeps the ledger, the log and the tax report in step over ${SEQUENCES} sequences, and loses no event`, async () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) await runSequence(seed);
  }, 300_000);
});
