import { expenseLines } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { householdPurchases, postTransaction, sharingDetail } from '../../src/index';
import { categoryOf, Household, type Device } from './household';

/* The Household purchases the partner's item page reads (joint-net-worth §8.3, task 9). */

async function spend(d: Device, bookId: string, description: string, occurredOn: string, amountMinor: number): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

describe('householdPurchases', () => {
  it('lists both members’ Household purchases of the period on either phone, and nothing private', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await spend(fandri, bookId, 'Fandri groceries', '2026-09-10', 50_000);
    await spend(dewi, bookId, 'Dewi groceries', '2026-09-12', 20_000);
    await spend(dewi, bookId, 'Last month', '2026-08-30', 7_000);
    await home.settle();

    for (const device of [fandri, dewi]) {
      const lines = await householdPurchases(device.database, bookId, { start: '2026-09-01', end: '2026-09-30' });
      expect(lines.map((l) => [l.description, l.amountMinor, l.currency, l.occurredOn])).toEqual([
        ['Fandri groceries', 50_000, 'IDR', '2026-09-10'],
        ['Dewi groceries', 20_000, 'IDR', '2026-09-12'],
      ]);
      for (const line of lines) expect(line.recordedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Who paid each: the payer's member on every phone, so an owner's own purchase is never read as waiting.
      const detail = (await sharingDetail(device.database, bookId, device.deviceId))!;
      const nameOf = (id: string) => detail.members.find((m) => m.memberId === id)?.name;
      expect(lines.map((l) => nameOf(l.paidBy))).toEqual(['Fandri', 'Dewi']);
      // Until Task 7's paidFrom is wired, no purchase names a shared item.
      for (const line of lines) expect(line.paidFromItemId).toBeNull();
    }
  });

  it('reads nothing on a device with no shared book', async () => {
    const home = new Household();
    const alone = await home.device('Alone');
    expect(await householdPurchases(alone.database, 'no-such-book', { start: '2026-09-01', end: '2026-09-30' })).toEqual([]);
  });
});
