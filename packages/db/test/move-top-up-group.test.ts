import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  postTransaction,
  categoryIdsByKey,
  createAccount,
  createBook,
  createCardAccount,
  type Database,
  inBook,
  listTransactionsIn,
  moveMoneyIn,
  personalBook,
  replaceTransaction,
  topUpsCategory,
} from '../src/index';
import { setupDb } from './helpers';

/*
 * A top-up or a withdrawal moved to another workspace: the transfer and the fee beside it go together, in one step, and
 * the old workspace shows neither afterwards. A group already split (fee in one workspace, transfer shown by all) is
 * reunited by moving it again.
 */

const setup = async () => {
  const { database, ws } = await setupDb();
  const personal = (await personalBook(database, ws)).id;
  const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const bank = await createAccount(database, ws, { name: 'BCA', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  const card = await createCardAccount(database, ws, { name: 'Card', subtype: 'credit_card', currency: 'IDR' });
  return { database, ws, personal, business, bank: bank.id, wallet: wallet.id, card: card.id };
};

type Ws = ReturnType<typeof inBook>;
const listed = async (database: Database, at: Ws) => (await listTransactionsIn(database, at, {})).transactions;
const shown = async (database: Database, at: Ws) => (await listed(database, at)).map((t) => t.description).sort();
const feeOf = async (database: Database, ws: Ws, bookId: string) => (await categoryIdsByKey(database, inBook(ws, bookId)))['miscellaneous.fees_charges']!;
const transferLines = (wallet: string, bank: string, amount: number) => [
  { accountId: wallet, amountMinor: amount, currency: 'IDR' },
  { accountId: bank, amountMinor: -amount, currency: 'IDR' },
];
const feeLines = (category: string, bank: string, amount: number) => [
  { accountId: category, amountMinor: amount, currency: 'IDR' },
  { accountId: bank, amountMinor: -amount, currency: 'IDR' },
];

describe('moving a top-up with its fee', () => {
  it('carries the transfer and the fee together, and the old workspace shows neither', async () => {
    const { database, ws, personal, business, bank, wallet } = await setup();
    const at = inBook(ws, personal);
    const { transferId } = await moveMoneyIn(database, at, { toId: wallet, fromId: bank, amountMinor: 100_000, feeMinor: 1_500, occurredOn: '2026-10-20', description: 'Top up', feeDescription: 'Top-up fee' });
    expect(await shown(database, at)).toEqual(['Top up', 'Top-up fee']);

    // The transfer is opened and moved; the fee is not touched by hand.
    await replaceTransaction(database, at, transferId, {
      occurredOn: '2026-10-20',
      description: 'Top up',
      lines: transferLines(wallet, bank, 100_000),
      moveToBook: true,
      toBookId: business,
    });
    expect(await shown(database, at)).toEqual([]);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up', 'Top-up fee']);
    const feeLine = await database.db.values(sql`
      SELECT e.account_id FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE t.description = 'Top-up fee' AND t.status = 'posted' AND e.amount_minor > 0`);
    expect(feeLine).toEqual([[await feeOf(database, ws, business)]]);
  });

  it('reunites a group already split across workspaces, from either half', async () => {
    const { database, ws, personal, business, bank, wallet } = await setup();
    const at = inBook(ws, personal);
    const { transferId, feeId } = await moveMoneyIn(database, at, { toId: wallet, fromId: bank, amountMinor: 50_000, feeMinor: 2_000, occurredOn: '2026-10-21', description: 'Top up', feeDescription: 'Top-up fee' });
    // The owner's state is from before transfers were filed: the transfer has no workspace.
    await database.db.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${transferId}`);
    // The owner's state: only the fee was moved (no toBookId, as the old form did), the transfer is shown by both.
    await replaceTransaction(database, at, feeId!, {
      occurredOn: '2026-10-21',
      description: 'Top-up fee',
      lines: feeLines(await feeOf(database, ws, business), bank, 2_000),
      moveToBook: true,
    });
    expect(await shown(database, at)).toEqual(['Top up']);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up', 'Top-up fee']);

    // Moving the transfer to Business files it there only.
    await replaceTransaction(database, at, transferId, {
      occurredOn: '2026-10-21',
      description: 'Top up',
      lines: transferLines(wallet, bank, 50_000),
      moveToBook: true,
      toBookId: business,
    });
    expect(await shown(database, at)).toEqual([]);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up', 'Top-up fee']);

    // And back, from the fee: both return to Personal.
    const [fee] = (await listed(database, inBook(ws, business))).filter((t) => t.description === 'Top-up fee');
    await replaceTransaction(database, inBook(ws, business), fee!.id, {
      occurredOn: '2026-10-21',
      description: 'Top-up fee',
      lines: feeLines(await feeOf(database, ws, personal), bank, 2_000),
      moveToBook: true,
      toBookId: personal,
    });
    expect(await shown(database, inBook(ws, business))).toEqual([]);
    expect(await shown(database, at)).toEqual(['Top up', 'Top-up fee']);
  });

  it('repairs a split group by moving the transfer to the workspace the fee is already in', async () => {
    const { database, ws, personal, business, bank, wallet } = await setup();
    const at = inBook(ws, personal);
    const { transferId, feeId } = await moveMoneyIn(database, at, { toId: wallet, fromId: bank, amountMinor: 50_000, feeMinor: 2_000, occurredOn: '2026-10-21', description: 'Top up', feeDescription: 'Top-up fee' });
    await database.db.run(sql`DELETE FROM book_transactions WHERE transaction_id = ${transferId}`);
    await replaceTransaction(database, at, feeId!, { occurredOn: '2026-10-21', description: 'Top-up fee', lines: feeLines(await feeOf(database, ws, business), bank, 2_000), moveToBook: true });
    // Fee in Business already; "moving" the transfer to Business alone clears it from Personal.
    await replaceTransaction(database, at, transferId, { occurredOn: '2026-10-21', description: 'Top up', lines: transferLines(wallet, bank, 50_000), moveToBook: true, toBookId: business });
    expect(await shown(database, at)).toEqual([]);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up', 'Top-up fee']);
  });

  it('keeps a filed transfer filed when edited without a move, and leaves another day’s top-up alone', async () => {
    const { database, ws, personal, business, bank, wallet } = await setup();
    const at = inBook(ws, personal);
    const other = await moveMoneyIn(database, at, { toId: wallet, fromId: bank, amountMinor: 10_000, feeMinor: 500, occurredOn: '2026-10-01', description: 'Top up', feeDescription: 'Top-up fee' });
    const { transferId } = await moveMoneyIn(database, at, { toId: wallet, fromId: bank, amountMinor: 20_000, feeMinor: 0, occurredOn: '2026-10-22', description: 'Top up', feeDescription: 'Top-up fee' });
    const moved = await replaceTransaction(database, at, transferId, { occurredOn: '2026-10-22', description: 'Top up', lines: transferLines(wallet, bank, 20_000), moveToBook: true, toBookId: business });
    const edited = await replaceTransaction(database, inBook(ws, business), moved, { occurredOn: '2026-10-22', description: 'Top up', lines: transferLines(wallet, bank, 25_000) });
    expect((await listed(database, at)).map((t) => t.id)).not.toContain(edited);
    expect((await listed(database, inBook(ws, business))).map((t) => t.id)).toContain(edited);
    expect((await listed(database, at)).map((t) => t.id)).toEqual(expect.arrayContaining([other.transferId, other.feeId!]));
  });

  it('moves a card top-up with a fee as one transaction, its Top-ups category swapped', async () => {
    const { database, ws, personal, business, wallet, card } = await setup();
    const at = inBook(ws, personal);
    const { transferId } = await moveMoneyIn(database, at, { toId: wallet, fromId: card, amountMinor: 100_000, feeMinor: 1_000, occurredOn: '2026-10-23', description: 'Top up', feeDescription: 'Top-up fee' });
    const topUpsBusiness = await topUpsCategory(database, inBook(ws, business));
    await replaceTransaction(database, at, transferId, {
      occurredOn: '2026-10-23',
      description: 'Top up',
      lines: [
        { accountId: wallet, amountMinor: 100_000, currency: 'IDR' },
        { accountId: card, amountMinor: -101_000, currency: 'IDR', spendCategoryId: topUpsBusiness },
        { accountId: await feeOf(database, ws, business), amountMinor: 1_000, currency: 'IDR' },
      ],
      moveToBook: true,
      toBookId: business,
    });
    expect(await shown(database, at)).toEqual([]);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up']);
  });

  it('files a card top-up without a fee (a bare transfer) in the chosen workspace only', async () => {
    const { database, ws, personal, business, wallet, card } = await setup();
    const at = inBook(ws, personal);
    const { transferId } = await moveMoneyIn(database, at, { toId: wallet, fromId: card, amountMinor: 100_000, feeMinor: 0, occurredOn: '2026-10-24', description: 'Top up', feeDescription: 'Top-up fee' });
    // Recorded in Personal, it is Personal's alone.
    expect(await shown(database, inBook(ws, business))).toEqual([]);
    expect(await shown(database, at)).toEqual(['Top up']);
    await replaceTransaction(database, at, transferId, {
      occurredOn: '2026-10-24',
      description: 'Top up',
      lines: [
        { accountId: wallet, amountMinor: 100_000, currency: 'IDR' },
        { accountId: card, amountMinor: -100_000, currency: 'IDR', spendCategoryId: await topUpsCategory(database, inBook(ws, business)) },
      ],
      moveToBook: true,
      toBookId: business,
    });
    expect(await shown(database, at)).toEqual([]);
    expect(await shown(database, inBook(ws, business))).toEqual(['Top up']);
  });

  it('files a newly recorded transfer in the open workspace only; a legacy one shows in all until it is moved', async () => {
    const { database, ws, personal, business, bank, wallet } = await setup();
    const at = inBook(ws, personal);
    const other = inBook(ws, business);
    const holiday = await postTransaction(database, at, { occurredOn: '2026-10-25', description: 'ATM holiday', lines: transferLines(wallet, bank, 300_000), fileTransfer: true });
    const legacy = await postTransaction(database, at, { occurredOn: '2026-10-25', description: 'Old transfer', lines: transferLines(wallet, bank, 100_000) });
    expect(await shown(database, at)).toEqual(['ATM holiday', 'Old transfer']);
    expect(await shown(database, other)).toEqual(['Old transfer']);

    // Moving the new one to Business: present only there. Balances do not care which workspace holds it.
    await replaceTransaction(database, at, holiday, { occurredOn: '2026-10-25', description: 'ATM holiday', lines: transferLines(wallet, bank, 300_000), moveToBook: true, toBookId: business });
    expect(await shown(database, at)).toEqual(['Old transfer']);
    expect(await shown(database, other)).toEqual(['ATM holiday', 'Old transfer']);

    // Editing the legacy one without a move does not assign it silently; moving it does.
    const edited = await replaceTransaction(database, at, legacy, { occurredOn: '2026-10-25', description: 'Old transfer', lines: transferLines(wallet, bank, 110_000), fileTransfer: true });
    expect(await shown(database, other)).toContain('Old transfer');
    await replaceTransaction(database, at, edited, { occurredOn: '2026-10-25', description: 'Old transfer', lines: transferLines(wallet, bank, 110_000), moveToBook: true, toBookId: business });
    expect(await shown(database, at)).toEqual([]);
    const balance = await database.db.values(sql`SELECT COALESCE(SUM(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE t.status = 'posted' AND e.account_id = ${wallet}`);
    expect(Number(balance[0]![0])).toBe(410_000);
  });
});
