import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listTransactions, postTransaction, replaceTransaction } from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import { projectPurchase } from '../../src/sync/capture';
import { encodeHlc } from '../../src/sync/hlc';
import { categoryOf, type Device, Household } from './household';

/* A shared purchase typed with cents (0068) carries its exact figure as the purchase's `exactHundredths`. */

const DAY = '2026-10-14';
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

async function linesOf(d: Device, bookId: string, amountMinor: number) {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' });
}

/** The posted purchase on a device: its id, description, what it moved and the exact figure beside it. */
async function purchase(d: Device) {
  const [tx] = await listTransactions(d.database, d.ws, { from: DAY, to: DAY });
  return { id: tx!.id, description: tx!.description, amount: Math.max(...tx!.entries.map((e) => e.amountMinor)), exact: tx!.exactHundredths };
}

async function outboxOps(d: Device): Promise<{ entity: string; id: string; fields: Record<string, unknown> }[]> {
  const rows = await d.database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox ORDER BY rowid`);
  return rows.flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string; id: string; fields: Record<string, unknown> }[] }).ops);
}

async function pair(options: { olderDewi?: boolean } = {}) {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  // A build before 0068: no column to hold the figure. Every door into it reads the column's absence the same way.
  // The capture run's watch on transactions names the column, as it would not on such a build: it goes first.
  if (options.olderDewi) {
    await dewi.database.execScript('DROP TRIGGER IF EXISTS temp.__capture_transactions_upd; ALTER TABLE transactions DROP COLUMN exact_hundredths;');
  }
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  return { home, fandri, dewi, bookId };
}

describe('a shared purchase typed with cents', () => {
  it('arrives with its exact figure, and a new figure alone is written in place on the partner’s phone', async () => {
    const { home, fandri, dewi, bookId } = await pair();
    const id = await postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_030 });
    await home.settle();
    const arrived = await purchase(dewi);
    expect(arrived).toMatchObject({ description: 'Bakery', amount: 12_501, exact: 1_250_030 });

    // 12.500,80 is charged the same 12.501: only the exact figure changed, and that is all that travels.
    await pause();
    await replaceTransaction(fandri.database, fandri.ws, id, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_080 });
    const sent = (await outboxOps(fandri)).filter((op) => op.entity === 'purchase');
    expect(sent.at(-1)!.fields).toEqual({ exactHundredths: 1_250_080 });
    await home.settle();
    // Written in place: the same row, not voided and reposted.
    expect(await purchase(dewi)).toEqual({ ...arrived, exact: 1_250_080 });

    // A new whole amount clears it on both phones.
    await pause();
    const [head] = await listTransactions(fandri.database, fandri.ws, { from: DAY, to: DAY });
    await replaceTransaction(fandri.database, fandri.ws, head!.id, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 13_000) });
    await home.settle();
    expect(await purchase(dewi)).toMatchObject({ amount: 13_000, exact: null });
    expect(await purchase(fandri)).toMatchObject({ amount: 13_000, exact: null });
  });

  it('comes back from the partner’s phone when the partner edits it, keeping the figure while the amount stays', async () => {
    const { home, fandri, dewi, bookId } = await pair();
    await postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_030 });
    await home.settle();
    await pause();
    const theirs = await purchase(dewi);
    await replaceTransaction(dewi.database, dewi.ws, theirs.id, { occurredOn: DAY, description: 'Bakery, two loaves', lines: (await listTransactions(dewi.database, dewi.ws, { id: theirs.id }))[0]!.entries.map((e) => ({ accountId: e.accountId, amountMinor: e.amountMinor, currency: e.currency })) });
    await home.settle();
    expect(await purchase(fandri)).toMatchObject({ description: 'Bakery, two loaves', amount: 12_501, exact: 1_250_030 });
  });

  it('an op from a build without the field changes nothing about it while the amount stays, and clears it when the amount changes', async () => {
    const { home, fandri, dewi, bookId } = await pair();
    const id = await postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_030 });
    await home.settle();

    const later = (seconds: number) => encodeHlc(Date.now() + seconds * 1_000, 0, fandri.deviceId);
    await applyChangeSet(dewi.database, bookId, { v: 1, hlc: later(60), member: fandri.memberId, ops: [{ entity: 'purchase', id, op: 'upsert', fields: { description: 'Bakery, renamed' } }] });
    expect(await purchase(dewi)).toMatchObject({ description: 'Bakery, renamed', amount: 12_501, exact: 1_250_030 });

    // The money as an older build would send it: the same purchase at a new whole amount, no word of the figure.
    const { money } = (await projectPurchase(fandri.database.db, (await purchase(fandri)).id, fandri.memberId, null))!;
    const changed = { ...money, lines: money.lines.map((line) => ({ ...line, amountMinor: 13_000, amountBaseMinor: 13_000 })) };
    await applyChangeSet(dewi.database, bookId, { v: 1, hlc: later(120), member: fandri.memberId, ops: [{ entity: 'purchase', id, op: 'upsert', fields: { money: changed } }] });
    expect(await purchase(dewi)).toMatchObject({ amount: 13_000, exact: null });
  });

  it('a phone that predates the figure posts the same money, and its own edits leave the figure where it is kept', async () => {
    const { home, fandri, dewi, bookId } = await pair({ olderDewi: true });
    const id = await postTransaction(fandri.database, fandri.ws, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_030 });
    await home.settle();
    expect(await purchase(dewi)).toMatchObject({ description: 'Bakery', amount: 12_501, exact: null });

    // The figure alone, to a phone with nowhere to keep it: reposted as it was, the money untouched.
    await pause();
    await replaceTransaction(fandri.database, fandri.ws, id, { occurredOn: DAY, description: 'Bakery', lines: await linesOf(fandri, bookId, 12_501), exactHundredths: 1_250_080 });
    await home.settle();
    expect(await purchase(dewi)).toMatchObject({ description: 'Bakery', amount: 12_501, exact: null });

    // Its own edit says nothing of the figure: the phone that keeps it keeps it.
    await pause();
    const theirs = await purchase(dewi);
    const lines = (await listTransactions(dewi.database, dewi.ws, { id: theirs.id }))[0]!.entries.map((e) => ({ accountId: e.accountId, amountMinor: e.amountMinor, currency: e.currency }));
    await replaceTransaction(dewi.database, dewi.ws, theirs.id, { occurredOn: DAY, description: 'Bakery, renamed', lines });
    await home.settle();
    expect(await purchase(fandri)).toMatchObject({ description: 'Bakery, renamed', amount: 12_501, exact: 1_250_080 });
  });
});
