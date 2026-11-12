import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  billOfPurchase,
  billsInMonth,
  categoryTotalsIn,
  inBook,
  linkPurchaseToBill,
  listAccounts,
  postTransaction,
  relinkPurchaseToBill,
  replaceTransaction,
  saveExpenseTemplate,
  unlinkPurchaseFromBill,
} from '../../src/index';
import { headOf, Household, projectBook, type Device } from './household';
import { outboxOps } from './sync-helpers';

/*
 * A purchase linked to a bill's month after the fact, in a shared workspace (sync gaps F1). Pay and Skip always reached
 * the partner; a link did not: in a shared workspace it was refused outright, and one made before sharing went as no
 * bill at all. Invented figures throughout.
 */

const TODAY = '2026-10-28';

async function internet(d: Device): Promise<string> {
  return (await listAccounts(d.database, d.ws)).find((a) => a.systemKey === 'utilities.internet_provider')!.id;
}

const buy = (d: Device, category: string, occurredOn: string, amountMinor: number, description: string) =>
  postTransaction(d.database, d.ws, {
    occurredOn,
    description,
    lines: [
      { accountId: category, amountMinor, currency: 'IDR' },
      { accountId: d.bank, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

async function stateOf(d: Device, billId: string, month: string): Promise<string | undefined> {
  return (await billsInMonth(d.database, d.ws, month, TODAY)).find((b) => b.bill.id === billId)?.state;
}

async function couple() {
  const home = new Household();
  const wife = await home.device('Wife');
  const husband = await home.device('Husband');
  const bookId = await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  const cat = await internet(wife);
  const bill = await saveExpenseTemplate(wife.database, wife.ws, { name: 'Fibre', categoryAccountId: cat, moneyAccountId: wife.bank, amountMinor: 410_000, dayOfMonth: 10, startsMonth: '2026-09' });
  await home.settle();
  return { home, wife, husband, bookId, cat, bill };
}

/** A purchase's bill link as one phone holds it: the bill, the month, and whether it is a link (not a Pay payment). */
async function linkOn(d: Device, lineageId: string) {
  const head = await headOf(d.database, lineageId);
  return head ? billOfPurchase(d.database, d.ws, head) : null;
}

describe('a bill link in a shared workspace reaches the partner', () => {
  it('link, relink and unlink go to the partner as a link, never as a payment, and the phones agree', async () => {
    const { home, wife, husband, bookId, cat, bill } = await couple();
    const purchase = await buy(wife, cat, '2026-10-12', 410_000, 'Fibre October');
    await home.settle();

    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-10', transactionId: purchase, today: TODAY });
    const ops = await outboxOps(wife.database);
    expect(ops.at(-1)).toMatchObject({ entity: 'purchase', id: purchase, fields: { bill: { templateId: bill, billMonth: '2026-10', linked: true } } });
    await home.settle();
    expect(await stateOf(husband, bill, '2026-10')).toBe(await stateOf(wife, bill, '2026-10'));
    expect(await stateOf(husband, bill, '2026-10')).toBe('paid');
    expect(await linkOn(husband, purchase)).toMatchObject({ templateId: bill, billMonth: '2026-10', linked: true });
    // A link is the purchase's own date and figure: never a Pay payment, never moved into the bill's month.
    const [row] = await husband.database.db.values<[string | null]>(sql`SELECT template_id FROM transactions WHERE id = ${await headOf(husband.database, purchase)}`);
    expect(row).toEqual([null]);
    expect(await projectBook(husband.database, bookId)).toEqual(await projectBook(wife.database, bookId));

    await relinkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-09', transactionId: purchase, today: TODAY });
    await home.settle();
    expect(await linkOn(husband, purchase)).toMatchObject({ billMonth: '2026-09', linked: true });
    expect(await stateOf(husband, bill, '2026-10')).toBe(await stateOf(wife, bill, '2026-10'));
    expect(await stateOf(husband, bill, '2026-10')).not.toBe('paid');

    await unlinkPurchaseFromBill(wife.database, wife.ws, { transactionId: purchase });
    await home.settle();
    expect(await linkOn(husband, purchase)).toBeNull();
    expect(await linkOn(wife, purchase)).toBeNull();
    expect(await projectBook(husband.database, bookId)).toEqual(await projectBook(wife.database, bookId));
  });

  it('the partner’s edit of a linked purchase keeps the link on both phones; an unlink is never carried back by an edit', async () => {
    const { home, wife, husband, bookId, cat, bill } = await couple();
    const purchase = await buy(wife, cat, '2026-10-12', 410_000, 'Fibre October');
    await home.settle();
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-10', transactionId: purchase, today: TODAY });
    await home.settle();
    // The husband corrects the note on his copy.
    const copy = (await headOf(husband.database, purchase))!;
    const [money] = await husband.database.db.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${copy} AND a.kind = 'asset'`);
    const [[hcat]] = await husband.database.db.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${copy} AND a.kind = 'expense'`);
    await replaceTransaction(husband.database, husband.ws, copy, {
      occurredOn: '2026-10-12', description: 'Fibre Oct', lines: [{ accountId: hcat, amountMinor: 410_000, currency: 'IDR' }, { accountId: money![0], amountMinor: -410_000, currency: 'IDR' }],
    });
    await home.settle();
    expect(await linkOn(wife, purchase)).toMatchObject({ billMonth: '2026-10', linked: true });
    expect(await linkOn(husband, purchase)).toMatchObject({ billMonth: '2026-10', linked: true });

    await unlinkPurchaseFromBill(husband.database, husband.ws, { transactionId: (await headOf(husband.database, purchase))! });
    await home.settle();
    // The wife edits afterwards: her edit must not bring the link back.
    const head = (await headOf(wife.database, purchase))!;
    await replaceTransaction(wife.database, wife.ws, head, {
      occurredOn: '2026-10-12', description: 'Fibre, October', lines: [{ accountId: cat, amountMinor: 410_000, currency: 'IDR' }, { accountId: wife.bank, amountMinor: -410_000, currency: 'IDR' }],
    });
    await home.settle();
    expect(await linkOn(wife, purchase)).toBeNull();
    expect(await linkOn(husband, purchase)).toBeNull();
    expect(await projectBook(husband.database, bookId)).toEqual(await projectBook(wife.database, bookId));
  });

  it('a link leaves the October spending total where the purchase was spent, on both phones', async () => {
    const { home, wife, husband, bookId, cat, bill } = await couple();
    const purchase = await buy(wife, cat, '2026-10-12', 410_000, 'Fibre for September');
    await home.settle();
    await linkPurchaseToBill(wife.database, wife.ws, { templateId: bill, billMonth: '2026-09', transactionId: purchase, today: TODAY });
    await home.settle();
    for (const d of [wife, husband]) {
      const { rows } = await categoryTotalsIn(d.database, inBook(d.ws, bookId), 'expense', '2026-10-01', '2026-10-31', { billMonths: true });
      expect(rows.reduce((sum, r) => sum + r.amountBaseMinor, 0)).toBe(410_000);
    }
  });
});
