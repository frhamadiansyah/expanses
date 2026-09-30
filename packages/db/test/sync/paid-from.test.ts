import { expenseLines, isoDate, statementCycleFor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  cardSpendLines,
  cardStatement,
  confirmReview,
  createCardAccount,
  paidFromAccount,
  paidWithItems,
  postTransaction,
  purchasePayers,
  replaceTransaction,
  saveCardTerms,
  setShareSetting,
} from '../../src/index';
import { itemIdOf } from '../../src/sync/net-worth/summaries';
import { categoryOf, headOf, Household, type Device } from './household';

/*
 * Paid with the other's item (joint-net-worth §5.3, §7.1, D14; task 7). Rina and Andi are an active net-worth group in
 * the shared workspace; Rina's card is shared. Andi records the Household groceries and picks Rina's card in Paid with:
 * on Rina's phone the money side lands on her real card (statement, cycle, points); on Andi's it sits on Rina's
 * placeholder; everywhere the purchase reads "paid by Andi".
 */

const today = isoDate();

async function settle(home: Household) {
  for (let i = 0; i < 3; i += 1) await home.settle();
}

/** Rina and Andi active in `separate` mode (so an item can be hidden), both past their review; Rina's card shared. */
async function sharing() {
  const home = new Household();
  const rina = await home.device('Rina');
  const andi = await home.device('Andi');
  const bookId = await home.share(rina);
  await home.join(andi, rina);
  await home.settle();
  const card = await createCardAccount(rina.database, rina.ws, { name: 'Rina Card', subtype: 'credit_card', currency: 'IDR', last4: '1234' });
  await saveCardTerms(rina.database, rina.ws, { accountId: card.id, statementDay: 25, dueDay: 10, creditLimitMinor: 500_000_000, annualFeeMinor: null });
  const proposalId = await rina.engine.proposeNetWorth(bookId, { mode: 'separate', members: [andi.memberId] });
  await settle(home);
  await andi.engine.answerNetWorth(bookId, proposalId, 'confirm');
  await settle(home);
  await confirmReview(rina.database, rina.ws, { [card.id]: 'total' });
  await confirmReview(andi.database, andi.ws, {});
  await settle(home);
  const groupBookId = (await rina.engine.netWorthGroup(bookId)).groupBookId!;
  const cardItem = await itemIdOf(groupBookId, card.id);
  const [primary] = await rina.database.db.values<[string]>(sql`SELECT id FROM cards WHERE account_id = ${card.id}`);
  const groceries = await categoryOf(andi.database, bookId, 'Groceries');
  return { home, rina, andi, bookId, groupBookId, card: card.id, cardItem, cardId: primary![0], groceries };
}

/** The money side of a posted row: its non-category entries' accounts. */
async function moneySide(d: Device, transactionId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.transaction_id = ${transactionId} AND a.kind NOT IN ('income', 'expense') ORDER BY e.rowid`);
  return rows.map((r) => r[0]);
}

async function placeholderOf(d: Device, bookId: string, memberId: string): Promise<string | null> {
  const [row] = await d.database.db.values<[string]>(sql`SELECT account_id FROM book_member_accounts WHERE book_id = ${bookId} AND member_id = ${memberId} AND currency = 'IDR'`);
  return row?.[0] ?? null;
}

async function cardIdOf(d: Device, transactionId: string): Promise<string | null> {
  const [row] = await d.database.db.values<[string | null]>(sql`SELECT card_id FROM transactions WHERE id = ${transactionId}`);
  return row?.[0] ?? null;
}

/** Andi pays the Household groceries from Rina's shared card, as the add form does: Rina's placeholder and the hint. */
async function andiPaysFromRinaCard(s: Awaited<ReturnType<typeof sharing>>, amountMinor = 300_000_00): Promise<string> {
  const [item] = (await paidWithItems(s.andi.database, s.bookId)).filter((i) => i.itemId === s.cardItem);
  expect(item).toBeDefined();
  const account = await paidFromAccount(s.andi.database, s.bookId, item!.owner, item!.currency);
  return postTransaction(s.andi.database, s.andi.ws, {
    occurredOn: today,
    description: 'Household groceries',
    lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: account, amountMinor, currency: 'IDR' }),
    paidFrom: { owner: item!.owner, itemId: item!.itemId },
  });
}

describe('paid with the other’s item (task 7)', () => {
  it('Andi pays from Rina’s card: her real card on her phone (statement), her placeholder on his; paid by Andi on both', async () => {
    const s = await sharing();
    const lineage = await andiPaysFromRinaCard(s);
    await settle(s.home);

    const rinaHead = (await headOf(s.rina.database, lineage))!;
    expect(rinaHead).toBeTruthy();
    expect(await moneySide(s.rina, rinaHead)).toEqual([s.card]);
    expect(await cardIdOf(s.rina, rinaHead)).toBe(s.cardId);
    const statement = await cardStatement(s.rina.database, s.rina.ws, s.card, statementCycleFor(today, 25), today);
    expect(statement.lines.map((line) => line.transactionId)).toContain(rinaHead);
    // The points her card earns read it too: the spending line in the card's cycle.
    const cycle = statementCycleFor(today, 25);
    const spend = await cardSpendLines(s.rina.database, s.rina.ws, s.card, cycle.start, cycle.end);
    expect(spend.map((line) => line.transactionId)).toContain(rinaHead);

    const andiHead = (await headOf(s.andi.database, lineage))!;
    expect(await moneySide(s.andi, andiHead)).toEqual([await placeholderOf(s.andi, s.bookId, s.rina.memberId)]);

    for (const [d, head] of [[s.rina, rinaHead], [s.andi, andiHead]] as const) {
      const payer = (await purchasePayers(d.database, [head]))[head]!;
      expect(payer.paidBy).toBe(s.andi.memberId);
      // The label is the item's summary name, as Andi's phone read it (§5.3).
      expect(payer.paidLabel).toBe('Rina Card ···· 1234');
      expect(payer.paidFrom).toEqual({ owner: s.rina.memberId, itemId: s.cardItem });
    }
    // The purchase went out as Andi's, from Rina's item: the lineage on both says so.
    const lineageOn = async (d: Device) =>
      (await d.database.db.values(sql`SELECT paid_by, paid_label, paid_from_owner, paid_from_item FROM sync_lineage WHERE lineage_id = ${lineage}`))[0];
    expect(await lineageOn(s.rina)).toEqual([s.andi.memberId, 'Rina Card ···· 1234', s.rina.memberId, s.cardItem]);
    expect(await lineageOn(s.andi)).toEqual([s.andi.memberId, 'Rina Card ···· 1234', s.rina.memberId, s.cardItem]);
  });

  it('an edit that keeps the payment keeps Rina’s card; one back to Andi’s own account moves Rina’s side to Andi’s placeholder', async () => {
    const s = await sharing();
    const lineage = await andiPaysFromRinaCard(s);
    await settle(s.home);

    // A new description only, the money side as it was: still on Rina's card.
    const andiHead = (await headOf(s.andi.database, lineage))!;
    const placeholder = (await moneySide(s.andi, andiHead))[0]!;
    await replaceTransaction(s.andi.database, s.andi.ws, andiHead, {
      occurredOn: today,
      description: 'Groceries, the big shop',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: placeholder, amountMinor: 300_000_00, currency: 'IDR' }),
    });
    await settle(s.home);
    let rinaHead = (await headOf(s.rina.database, lineage))!;
    expect(await moneySide(s.rina, rinaHead)).toEqual([s.card]);
    expect((await purchasePayers(s.rina.database, [rinaHead]))[rinaHead]).toMatchObject({ paidBy: s.andi.memberId, paidFrom: { owner: s.rina.memberId, itemId: s.cardItem } });

    // Back to Andi's own bank: off Rina's card, onto Andi's placeholder, and off her statement.
    await replaceTransaction(s.andi.database, s.andi.ws, (await headOf(s.andi.database, lineage))!, {
      occurredOn: today,
      description: 'Groceries, the big shop',
      lines: expenseLines({ categoryAccountId: s.groceries, paymentAccountId: s.andi.bank, amountMinor: 300_000_00, currency: 'IDR' }),
      paidFrom: null,
    });
    await settle(s.home);
    rinaHead = (await headOf(s.rina.database, lineage))!;
    expect(await moneySide(s.rina, rinaHead)).toEqual([await placeholderOf(s.rina, s.bookId, s.andi.memberId)]);
    expect(await cardIdOf(s.rina, rinaHead)).toBeNull();
    const statement = await cardStatement(s.rina.database, s.rina.ws, s.card, statementCycleFor(today, 25), today);
    expect(statement.lines).toEqual([]);
    const payer = (await purchasePayers(s.rina.database, [rinaHead]))[rinaHead]!;
    // Andi's own bank is one of his shared items, so it carries its own id (Task 9 ruling).
    expect(payer).toMatchObject({ paidBy: s.andi.memberId, paidLabel: 'Andi Bank', paidFrom: { owner: s.andi.memberId, itemId: await itemIdOf(s.groupBookId, s.andi.bank) } });
  });

  it('unshared after paying (review focus 5): the purchase still lands on Rina’s card, and Andi’s Paid with no longer offers it', async () => {
    const s = await sharing();
    const lineage = await andiPaysFromRinaCard(s);
    await s.andi.engine.syncOnce(s.bookId);
    // Rina hides the card before she has synced the purchase.
    await setShareSetting(s.rina.database, s.card, 'hidden');
    await settle(s.home);

    const rinaHead = (await headOf(s.rina.database, lineage))!;
    expect(await moneySide(s.rina, rinaHead)).toEqual([s.card]);
    expect(await cardIdOf(s.rina, rinaHead)).toBe(s.cardId);
    expect((await paidWithItems(s.andi.database, s.bookId)).map((i) => i.itemId)).not.toContain(s.cardItem);
  });

  it('Paid with offers only the partner’s items that can pay, and only in the group’s workspace', async () => {
    const s = await sharing();
    const offered = await paidWithItems(s.andi.database, s.bookId);
    expect(offered.every((i) => i.owner === s.rina.memberId)).toBe(true);
    expect(offered.every((i) => i.ownerName === 'Rina')).toBe(true);
    expect(offered.map((i) => i.subtype).sort()).toEqual(['bank', 'bank', 'cash', 'credit_card']);
    expect(await paidWithItems(s.andi.database, 'another-book')).toEqual([]);
  });

  it('a Household purchase Rina pays from her own shared card carries paidFrom = her item; from an unshared account, null (Task 9 ruling)', async () => {
    const s = await sharing();
    const groceries = await categoryOf(s.rina.database, s.bookId, 'Groceries');
    const outgoing = async () => {
      const rows = await s.rina.database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox WHERE book_id = ${s.bookId} ORDER BY rowid`);
      return rows.flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string; id: string; fields: { money?: { paidFrom?: unknown } } }[] }).ops).filter((op) => op.entity === 'purchase');
    };
    const fromCard = await postTransaction(s.rina.database, s.rina.ws, {
      occurredOn: today,
      description: 'Household groceries',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: s.card, amountMinor: 120_000_00, currency: 'IDR' }),
    });
    await setShareSetting(s.rina.database, s.rina.bank, 'hidden');
    const fromBank = await postTransaction(s.rina.database, s.rina.ws, {
      occurredOn: today,
      description: 'Household water',
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: s.rina.bank, amountMinor: 50_000_00, currency: 'IDR' }),
    });
    const ops = await outgoing();
    expect(ops.find((op) => op.id === fromCard)!.fields.money!.paidFrom).toEqual({ owner: s.rina.memberId, itemId: s.cardItem });
    expect(ops.find((op) => op.id === fromBank)!.fields.money!.paidFrom).toBeNull();

    // On Andi's phone: Rina's placeholder, paid by Rina, from her card.
    await settle(s.home);
    const andiHead = (await headOf(s.andi.database, fromCard))!;
    expect(await moneySide(s.andi, andiHead)).toEqual([await placeholderOf(s.andi, s.bookId, s.rina.memberId)]);
    expect((await purchasePayers(s.andi.database, [andiHead]))[andiHead]).toMatchObject({ paidBy: s.rina.memberId, paidFrom: { owner: s.rina.memberId, itemId: s.cardItem } });
  });
});
