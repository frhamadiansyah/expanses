import { describe, expect, it } from 'vitest';
import {
  activityLine,
  activityOf,
  archiveAccount,
  categoryIdsByKey,
  checkLedgerIntegrity,
  createAccount,
  createBook,
  inBook,
  listTransactions,
  nativeBalances,
  personalBook,
  postTransaction,
  recordBillPayments,
  renameAccount,
  replaceTransaction,
  replaceTransactionTx,
  saveExpenseTemplate,
  undoActivity,
  voidTransaction,
} from '../src/index';
import { setupDb } from './helpers';

async function world() {
  const { database, ws } = await setupDb();
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  const visa = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const keys = await categoryIdsByKey(database, ws);
  const food = keys['food_beverage.takeaways']!;
  const dining = keys['food_beverage.restaurants']!;
  const buy = (accountId: string, categoryId: string, amount: number, description = 'Groceries', occurredOn = '2026-09-02') =>
    postTransaction(database, ws, {
      occurredOn,
      description,
      lines: [
        { accountId: categoryId, amountMinor: amount, currency: 'IDR' },
        { accountId, amountMinor: -amount, currency: 'IDR' },
      ],
    });
  const live = async () => await listTransactions(database, ws, { from: '2026-09-01', to: '2026-12-31' });
  return { database, ws, bca, visa, food, dining, buy, live };
}

const lines = (w: Awaited<ReturnType<typeof world>>, options = {}) => activityOf(w.database, w.ws, options);

describe('Activity: what is listed', () => {
  it('lists a purchase, an edit and a delete, newest first, with what changed', async () => {
    const w = await world();
    const id = await w.buy(w.bca.id, w.food, 180_000);
    const edited = await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-02',
      description: 'Groceries',
      lines: [
        { accountId: w.dining, amountMinor: 180_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -180_000, currency: 'IDR' },
      ],
    });
    await voidTransaction(w.database, w.ws, edited);

    const all = await lines(w);
    expect(all.map((line) => [line.kind, line.title])).toEqual([
      ['delete', 'Groceries deleted'],
      ['edit', 'Groceries edited'],
      ['create', 'Groceries added'],
    ]);
    const edit = all[1]!;
    expect(edit.subtitle).toMatch(/^Category .+ → .+$/);
    expect(edit.changes).toHaveLength(1);
    expect(edit.changes[0]).toMatchObject({ field: 'Category' });
    // The edit's row is gone again (deleted after), so it cannot be undone any more: only the newest version can.
    expect(edit.state).toBe('changed');
    expect(edit.undo).toBeNull();
    expect(all[0]!.subtitle).toContain('BCA Tahapan');
    expect(all[0]!.state).toBe('open');
  });

  it('names the first changed field and counts the rest', async () => {
    const w = await world();
    const id = await w.buy(w.bca.id, w.food, 180_000);
    await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-03',
      description: 'Supermarket',
      lines: [
        { accountId: w.dining, amountMinor: 200_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -200_000, currency: 'IDR' },
      ],
    });
    const [edit] = await lines(w, { kind: 'edit' });
    expect(edit!.title).toBe('Supermarket edited');
    expect(edit!.subtitle).toMatch(/ \+3$/);
    expect(edit!.changes.map((c) => c.field)).toEqual(['Category', 'Amount', 'Date', 'Note']);
    expect(edit!.changes.find((c) => c.field === 'Date')).toMatchObject({ from: '2026-09-02', to: '2026-09-03' });
  });

  it('filters by kind and by segment, and limits', async () => {
    const w = await world();
    const a = await w.buy(w.bca.id, w.food, 10_000, 'A');
    await w.buy(w.bca.id, w.food, 20_000, 'B');
    await voidTransaction(w.database, w.ws, a);
    await renameAccount(w.database, w.ws, w.bca.id, 'BCA Utama');

    expect((await lines(w, { kind: 'delete' })).map((l) => l.title)).toEqual(['A deleted']);
    expect((await lines(w, { kind: 'create' })).map((l) => l.title)).toEqual(['B added', 'A added']);
    expect((await lines(w, { kind: 'transactions' })).length).toBe(3);
    expect((await lines(w, { kind: 'accounts' })).map((l) => l.title)).toEqual(['Account renamed']);
    expect(await lines(w, { limit: 2 })).toHaveLength(2);
    const [first] = await lines(w, { limit: 1 });
    expect(first!.title).toBe('Account renamed');
  });

  it('lists a rename as recorded but with nothing to go back to', async () => {
    const w = await world();
    await renameAccount(w.database, w.ws, w.bca.id, 'BCA Utama');
    const [rename] = await lines(w);
    expect(rename).toMatchObject({ kind: 'rename', group: 'accounts', state: 'cannot', undo: null, subtitle: 'Now BCA Utama' });
    await expect(undoActivity(w.database, w.ws, rename!.id)).rejects.toThrow(/cannot be undone/);
  });

  it('lists a bill payment as paid, and leaves out what the app posts on its own', async () => {
    const w = await world();
    const bill = await saveExpenseTemplate(w.database, w.ws, {
      name: 'Biznet Home',
      categoryAccountId: w.food,
      moneyAccountId: w.bca.id,
      amountMinor: 450_000,
      dayOfMonth: 28,
      startsMonth: '2026-08',
    });
    const [paid] = await recordBillPayments(w.database, w.ws, { paidOn: '2026-09-03', payments: [{ templateId: bill, billMonth: '2026-08', amountMinor: 450_000 }] });
    const [line] = await lines(w);
    expect(line).toMatchObject({ kind: 'payment', title: 'Biznet Home paid', state: 'open', transactionId: paid });
    expect(line!.subtitle).toContain('BCA Tahapan');
  });
});

describe('Activity: Undo', () => {
  it('undoes an edit by writing the earlier version again, balanced, and lists the undo', async () => {
    const w = await world();
    const before = await nativeBalances(w.database, w.ws);
    const id = await w.buy(w.bca.id, w.food, 180_000);
    const edited = await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-05',
      description: 'Groceries big',
      lines: [
        { accountId: w.dining, amountMinor: 250_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -250_000, currency: 'IDR' },
      ],
    });
    const [edit] = await lines(w, { kind: 'edit' });
    expect(edit).toMatchObject({ state: 'open', undo: { kind: 'edit', newId: edited, oldId: id } });
    expect((await nativeBalances(w.database, w.ws))[w.bca.id]).toBe((before[w.bca.id] ?? 0) - 250_000);

    await undoActivity(w.database, w.ws, edit!.id);

    const live = await w.live();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ occurredOn: '2026-09-02', description: 'Groceries' });
    expect(live[0]!.entries.map((e) => [e.accountId, e.amountMinor]).sort()).toEqual([[w.bca.id, -180_000], [w.food, 180_000]].sort());
    expect((await nativeBalances(w.database, w.ws))[w.bca.id]).toBe((before[w.bca.id] ?? 0) - 180_000);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
    // History is added to, never rewritten: the undo is a third version in the lineage.
    expect(live[0]!.id).not.toBe(id);

    const after = await lines(w);
    expect(after[0]).toMatchObject({ kind: 'other', state: 'log', title: 'Undone: Groceries big edit' });
    expect(after.find((l) => l.id === edit!.id)).toMatchObject({ state: 'undone', undo: null });
  });

  it('refuses a second Undo of the same line', async () => {
    const w = await world();
    const id = await w.buy(w.bca.id, w.food, 180_000);
    await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-02',
      description: 'Groceries',
      lines: [
        { accountId: w.dining, amountMinor: 180_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -180_000, currency: 'IDR' },
      ],
    });
    const [edit] = await lines(w, { kind: 'edit' });
    await undoActivity(w.database, w.ws, edit!.id);
    await expect(undoActivity(w.database, w.ws, edit!.id)).rejects.toThrow(/already undone/);
    expect(await w.live()).toHaveLength(1);
  });

  it('refuses to undo an edit once the row was changed again', async () => {
    const w = await world();
    const id = await w.buy(w.bca.id, w.food, 180_000);
    const second = await replaceTransaction(w.database, w.ws, id, {
      occurredOn: '2026-09-02',
      description: 'Groceries',
      lines: [
        { accountId: w.dining, amountMinor: 180_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -180_000, currency: 'IDR' },
      ],
    });
    await replaceTransaction(w.database, w.ws, second, {
      occurredOn: '2026-09-02',
      description: 'Groceries',
      lines: [
        { accountId: w.dining, amountMinor: 190_000, currency: 'IDR' },
        { accountId: w.bca.id, amountMinor: -190_000, currency: 'IDR' },
      ],
    });
    const edits = await lines(w, { kind: 'edit' });
    expect(edits.map((e) => e.state)).toEqual(['open', 'changed']);
    await expect(undoActivity(w.database, w.ws, edits[1]!.id)).rejects.toThrow(/changed again/);
    expect(await w.live()).toHaveLength(1);
    expect((await w.live())[0]!.entries.map((e) => e.amountMinor).sort()).toEqual([-190_000, 190_000]);
  });

  it('undoes a delete by posting the same purchase again', async () => {
    const w = await world();
    const before = await nativeBalances(w.database, w.ws);
    const id = await w.buy(w.visa.id, w.food, 186_000, 'Netflix');
    await voidTransaction(w.database, w.ws, id);
    expect(await w.live()).toHaveLength(0);
    const [deleted] = await lines(w);
    expect(deleted).toMatchObject({ kind: 'delete', title: 'Netflix deleted', state: 'open' });

    await undoActivity(w.database, w.ws, deleted!.id);

    const live = await w.live();
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ description: 'Netflix', occurredOn: '2026-09-02' });
    expect((await nativeBalances(w.database, w.ws))[w.visa.id]).toBe(before[w.visa.id] === undefined ? -186_000 : before[w.visa.id]! - 186_000);
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
    await expect(undoActivity(w.database, w.ws, deleted!.id)).rejects.toThrow(/already undone/);
    expect((await lines(w))[0]).toMatchObject({ state: 'log', title: 'Undone: Netflix delete' });
  });

  it('undoes a new purchase by taking it away, and a bill payment by voiding it', async () => {
    const w = await world();
    await w.buy(w.bca.id, w.food, 30_000, 'Coffee');
    const bill = await saveExpenseTemplate(w.database, w.ws, {
      name: 'Biznet Home',
      categoryAccountId: w.food,
      moneyAccountId: w.bca.id,
      amountMinor: 450_000,
      dayOfMonth: 28,
      startsMonth: '2026-08',
    });
    await recordBillPayments(w.database, w.ws, { paidOn: '2026-09-03', payments: [{ templateId: bill, billMonth: '2026-08', amountMinor: 450_000 }] });
    const [payment, coffee] = await lines(w);
    expect(await w.live()).toHaveLength(2);
    await undoActivity(w.database, w.ws, payment!.id);
    expect((await w.live()).map((t) => t.description)).toEqual(['Coffee']);
    await undoActivity(w.database, w.ws, coffee!.id);
    expect(await w.live()).toHaveLength(0);
    const after = await lines(w);
    expect(after.filter((l) => l.state === 'undone').map((l) => l.title).sort()).toEqual(['Biznet Home paid', 'Coffee added']);
    expect(after[0]!.title).toBe('Undone: Coffee add');
    expect(await checkLedgerIntegrity(w.database, w.ws)).toEqual([]);
  });

  it('moves a purchase to another workspace and back, and reads a selection moved together as one line', async () => {
    const { database, ws } = await setupDb();
    const personal = (await personalBook(database, ws)).id;
    const business = await createBook(database, ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
    const card = await createAccount(database, ws, { name: 'KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    const mine = (await categoryIdsByKey(database, inBook(ws, personal)))['food_beverage.restaurants']!;
    const theirs = (await categoryIdsByKey(database, inBook(ws, business)))['food_beverage.restaurants']!;
    const at = inBook(ws, personal);
    const dinner = (description: string, category: string, amount: number) => ({
      occurredOn: '2026-09-02',
      description,
      lines: [
        { accountId: category, amountMinor: amount, currency: 'IDR' },
        { accountId: card.id, amountMinor: -amount, currency: 'IDR' },
      ],
    });
    const one = await postTransaction(database, at, dinner('Supplier dinner', mine, 640_000));
    const two = await postTransaction(database, at, dinner('Team lunch', mine, 300_000));
    await replaceTransaction(database, at, one, { ...dinner('Supplier dinner', theirs, 640_000), moveToBook: true });
    const [single] = await activityOf(database, ws, { kind: 'move' });
    expect(single).toMatchObject({ kind: 'move', title: 'Supplier dinner moved to Business', subtitle: 'From Personal', state: 'open' });
    expect(single!.changes[0]).toEqual({ field: 'Workspace', from: 'Personal', to: 'Business' });

    await replaceTransaction(database, at, two, { ...dinner('Team lunch', theirs, 300_000), moveToBook: true });
    const grouped = await activityOf(database, ws, { kind: 'move' });
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ title: '2 purchases moved to Business', subtitle: 'From Personal', state: 'open' });
    expect(grouped[0]!.changes.map((c) => c.field).sort()).toEqual(['Supplier dinner', 'Team lunch']);

    await undoActivity(database, ws, grouped[0]!.id);
    const back = await listTransactions(database, inBook(ws, personal), { from: '2026-09-01', to: '2026-09-30' });
    expect(back.map((t) => t.description).sort()).toEqual(['Supplier dinner', 'Team lunch']);
    expect(await listTransactions(database, inBook(ws, business), { from: '2026-09-01', to: '2026-09-30' })).toHaveLength(0);
    expect(await checkLedgerIntegrity(database, ws)).toEqual([]);
    await expect(undoActivity(database, ws, grouped[0]!.id)).rejects.toThrow(/already undone/);
  });

  it('undoes an archive and shows it as changed once the account is live again', async () => {
    const w = await world();
    const spare = await createAccount(w.database, w.ws, { name: 'Spare', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    await archiveAccount(w.database, w.ws, spare.id);
    const [archived] = await lines(w, { kind: 'accounts' });
    expect(archived).toMatchObject({ title: 'Spare archived', state: 'open', undo: { kind: 'unarchive', accountId: spare.id } });
    await undoActivity(w.database, w.ws, archived!.id);
    const [log, line] = await lines(w, { kind: 'accounts' });
    expect(log).toMatchObject({ state: 'log', group: 'accounts' });
    expect(line!.state).toBe('undone');
  });

  it('names the member whose change arrived by sync, and undoes it through the same doors', async () => {
    const w = await world();
    const id = await w.buy(w.bca.id, w.food, 180_000);
    await w.database.execScript(`CREATE TABLE IF NOT EXISTS book_members (book_id TEXT NOT NULL, member_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (book_id, member_id));
      INSERT INTO book_members VALUES ('b', 'm-ayu', 'Ayu', 'member', '2026-01-01');`);
    // A change from the other phone comes in through the transaction door, with its author, and leaves no local mark.
    await w.database.transaction((tx) =>
      replaceTransactionTx(tx, w.ws, id, {
        occurredOn: '2026-09-02',
        description: 'Groceries',
        lines: [
          { accountId: w.dining, amountMinor: 200_000, currency: 'IDR' },
          { accountId: w.bca.id, amountMinor: -200_000, currency: 'IDR' },
        ],
        syncAuthor: 'm-ayu',
      }),
    );
    const [edit] = await lines(w, { kind: 'edit' });
    expect(edit).toMatchObject({ who: 'Ayu', state: 'open' });
    await undoActivity(w.database, w.ws, edit!.id);
    expect((await w.live())[0]!.entries.map((e) => e.amountMinor).sort()).toEqual([-180_000, 180_000]);
  });

  it('looks a line up by its id', async () => {
    const w = await world();
    await w.buy(w.bca.id, w.food, 10_000, 'A');
    const [line] = await lines(w);
    expect((await activityLine(w.database, w.ws, line!.id))?.title).toBe('A added');
    expect(await activityLine(w.database, w.ws, 'nope')).toBeNull();
  });
});
