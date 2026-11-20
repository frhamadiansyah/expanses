import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createAccount, listAccounts, postTransaction, renameAccount, saveBudget, voidTransaction } from '../../src/index';
import { applySelfChangeSet, collectSelfChanges, drainSelfOutbox, type SelfChangeSet } from '../../src/self/channel';
import { linkedPair, sameRows, type Device } from './devices';

/*
 * Link my devices, Drop 1: whatever each device does while apart, and in whatever order their change-sets cross, the
 * two end with the same rows (spec §6, Drop 1 property). Invented accounts, shops and figures.
 */

type Step =
  | { kind: 'rename'; who: 0 | 1; name: string }
  | { kind: 'spend'; who: 0 | 1; amount: number }
  | { kind: 'void'; who: 0 | 1 }
  | { kind: 'budget'; who: 0 | 1; amount: number }
  | { kind: 'category'; who: 0 | 1; name: string }
  | { kind: 'send'; who: 0 | 1 }
  | { kind: 'deliver'; who: 0 | 1 };

const who = fc.constantFrom<0 | 1>(0, 1);
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('rename' as const), who, name: fc.constantFrom('Test Bank A', 'Test Bank B', 'Test Bank C') }),
  fc.record({ kind: fc.constant('spend' as const), who, amount: fc.integer({ min: 1, max: 900 }).map((n) => n * 1000) }),
  fc.record({ kind: fc.constant('void' as const), who }),
  fc.record({ kind: fc.constant('budget' as const), who, amount: fc.integer({ min: 1, max: 90 }).map((n) => n * 100_000) }),
  fc.record({ kind: fc.constant('category' as const), who, name: fc.constantFrom('Test hobby', 'Test pets') }),
  fc.record({ kind: fc.constant('send' as const), who }),
  fc.record({ kind: fc.constant('deliver' as const), who }),
);

describe('two devices apart, then together', () => {
  it('end with the same rows, whatever each did and in whatever order the changes crossed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 3, maxLength: 14 }), async (steps) => {
        let bankId = '';
        const { phone, mac } = await linkedPair(async ({ database, ws }) => {
          bankId = (await createAccount(database, ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' })).id;
        });
        const devices: [Device, Device] = [phone, mac];
        // What each device has collected and not yet delivered to the other, oldest first.
        const queues: [SelfChangeSet[], SelfChangeSet[]] = [[], []];
        const groceries = (await listAccounts(phone.database, phone.ws)).find((a) => a.name === 'Groceries')!.id;
        // Collected and taken out of the outbox for sending (an apply collects what is waiting too, into the outbox).
        const collect = async (i: 0 | 1) => {
          await collectSelfChanges(devices[i].database, devices[i].deviceId);
          queues[i].push(...(await drainSelfOutbox(devices[i].database)));
        };
        for (const s of steps) {
          const d = devices[s.who];
          if (s.kind === 'rename') await renameAccount(d.database, d.ws, bankId, s.name);
          if (s.kind === 'spend') {
            await postTransaction(d.database, d.ws, { occurredOn: '2026-11-15', description: 'Test shop', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bankId, amountMinor: s.amount, currency: 'IDR' }) });
          }
          if (s.kind === 'void') {
            const [posted] = await d.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE status = 'posted' AND description = 'Test shop' ORDER BY id LIMIT 1`);
            if (posted) await voidTransaction(d.database, d.ws, posted[0]);
          }
          if (s.kind === 'budget') await saveBudget(d.database, d.ws, { categoryAccountId: groceries, amountMinor: s.amount });
          if (s.kind === 'category') {
            const exists = (await listAccounts(d.database, d.ws)).some((a) => a.name === s.name);
            if (!exists) await createAccount(d.database, d.ws, { name: s.name, kind: 'expense', subtype: 'category', currency: null });
          }
          if (s.kind === 'send') await collect(s.who);
          if (s.kind === 'deliver') {
            const next = queues[s.who].shift();
            if (next) expect((await applySelfChangeSet(devices[1 - s.who]!.database, next, devices[1 - s.who]!.deviceId)).status).toBe('applied');
          }
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        // Together again: everything collected and delivered, both ways, until nothing is left.
        for (let round = 0; round < 4; round += 1) {
          for (const i of [0, 1] as const) {
            await collect(i);
            for (const next of queues[i].splice(0)) expect((await applySelfChangeSet(devices[1 - i]!.database, next, devices[1 - i]!.deviceId)).status).toBe('applied');
          }
        }
        expect(await sameRows(phone, mac)).toEqual([]);
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});
