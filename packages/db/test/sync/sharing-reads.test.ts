import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { devicesSeen, listSharedBooks, outboxOps, postTransaction, purchasePayers, recordDevicesSeen, sharingDetail } from '../../src/index';
import { categoryOf, Household, type Device } from './household';

/*
 * What the sharing screens read (spec §11): the switcher's "Shared with …", the members and their devices, what waits
 * in the outbox, and who paid for each purchase — a list row's "· paid by Dewi" and the receipt's two lines.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor: number): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-09-10',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

async function headOfDescription(d: Device, description: string): Promise<string> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE description = ${description} AND status = 'posted'`);
  return row![0];
}

describe('sharing reads', () => {
  it('nothing is shared on a device that shared nothing', async () => {
    const home = new Household();
    const alone = await home.device('Alone');
    expect(await listSharedBooks(alone.database)).toEqual([]);
    expect(await sharingDetail(alone.database, 'no-such-book', alone.deviceId)).toBeNull();
    expect(await purchasePayers(alone.database, ['x'])).toEqual({});
  });

  it('counts the seed in ops while it waits, and nothing once it is drained', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const bookId = await home.share(fandri);
    await spend(fandri, bookId, 'before drain', 10_000);
    const ops = await outboxOps(fandri.database, bookId);
    const [changeSets] = await fandri.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox`);
    expect(ops).toBeGreaterThan(Number(changeSets![0]));
    expect((await sharingDetail(fandri.database, bookId, fandri.deviceId))!.waiting).toBe(Number(changeSets![0]));
    await fandri.engine.syncOnce(bookId);
    expect(await outboxOps(fandri.database, bookId)).toBe(0);
    expect((await sharingDetail(fandri.database, bookId, fandri.deviceId))!.waiting).toBe(0);
  });

  it('names both members and their devices on both sides, and who of them is me and who owns the book', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await home.settle();

    for (const [device, me] of [
      [fandri, 'Fandri'],
      [dewi, 'Dewi'],
    ] as const) {
      const [summary] = await listSharedBooks(device.database);
      expect(summary).toMatchObject({ bookId, state: 'active' });
      expect(summary!.members.map((m) => [m.name, m.role])).toEqual([
        ['Fandri', 'owner'],
        ['Dewi', 'member'],
      ]);
      const detail = (await sharingDetail(device.database, bookId, device.deviceId))!;
      expect(detail.owner).toBe(me === 'Fandri');
      expect(detail.members.find((m) => m.me)!.name).toBe(me);
      const mine = detail.members.flatMap((m) => m.devices).find((d) => d.mine)!;
      expect(mine.deviceId).toBe(device.deviceId);
      expect(detail.members.map((m) => m.devices.map((d) => d.name))).toEqual([["Fandri's phone"], ["Dewi's phone"]]);
    }
  });

  it('a purchase names its payer: mine on the payer, the other member elsewhere, with the label the payer gave it', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    await spend(fandri, bookId, 'Fandri paid', 50_000);
    await spend(dewi, bookId, 'Dewi paid', 20_000);
    await home.settle();

    const onFandri = await purchasePayers(fandri.database, [await headOfDescription(fandri, 'Fandri paid'), await headOfDescription(fandri, 'Dewi paid')]);
    expect(Object.values(onFandri).map((p) => [p.paidLabel, p.payerName, p.mine])).toEqual(
      expect.arrayContaining([
        ['Fandri Bank', 'Fandri', true],
        ['Dewi Bank', 'Dewi', false],
      ]),
    );
    const onDewi = await purchasePayers(dewi.database, [await headOfDescription(dewi, 'Fandri paid')]);
    expect(Object.values(onDewi)).toEqual([expect.objectContaining({ paidLabel: 'Fandri Bank', payerName: 'Fandri', mine: false })]);
  });

  it('keeps when each device was last heard from, never moving a time backwards', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    await recordDevicesSeen(fandri.database, 'book', { a: 100, b: 50 });
    await recordDevicesSeen(fandri.database, 'book', { a: 80, b: 70 });
    expect(await devicesSeen(fandri.database, 'book')).toEqual({ a: 100, b: 70 });
  });
});
