import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureDrafts,
  confirmDraft,
  createAccount,
  createDatabase,
  createWorkspace,
  editDraft,
  listAccounts,
  listDrafts,
  MIGRATIONS,
  migrate,
  nativeBalances,
  type NewDraft,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

let executor: NodeExecutor | undefined;
let current: TestDb | undefined;
afterEach(() => {
  executor?.close();
  current?.executor.close();
  executor = undefined;
  current = undefined;
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const savings = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR' });
  const accounts = await listAccounts(database, ws);
  const groceries = accounts.find((account) => account.systemKey === 'household.groceries')!;
  const otherIncome = accounts.find((account) => account.systemKey === 'income.other')!;
  const balanceOf = async (accountId: string) => (await nativeBalances(database, ws, '2026-12-31'))[accountId] ?? 0;
  const draft = (over: Partial<NewDraft> = {}): NewDraft => ({
    source: 'notification',
    occurredOn: '2026-09-29',
    description: 'KOPI KENANGAN',
    amountMinor: 38_000,
    currency: 'IDR',
    accountId: bank.id,
    categoryAccountId: groceries.id,
    ...over,
  });
  return { database, ws, bank, savings, groceries, otherIncome, balanceOf, draft };
}

describe('the kind a draft is', () => {
  it('leaves a version 61 database with its drafts intact, and calls them expenses', async () => {
    executor = createNodeExecutor();
    const older = createDatabase(executor);
    await migrate(
      older,
      MIGRATIONS.filter((m) => m.version <= 61),
    );
    const ws = await createWorkspace(older, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    // Exactly what a version 61 build wrote: no kind, no capture columns of its own.
    await older.db.run(sql`INSERT INTO draft_transactions
      (id, workspace_id, source, status, occurred_on, description, amount_minor, currency, created_at)
      VALUES ('d-old', ${ws.workspaceId}, 'csv', 'pending', '2026-09-09', 'SUPERINDO', 250000, 'IDR', '2026-09-09T00:00:00.000Z')`);

    await migrate(older);

    const drafts = await listDrafts(older, ws);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: 'd-old',
      kind: 'expense',
      source: 'csv',
      description: 'SUPERINDO',
      amountMinor: 250_000,
      toAccountId: null,
      sourceId: null,
      imageFile: null,
      reading: null,
      mergedInto: null,
    });
  });

  it('posts an income draft as money received', async () => {
    const { database, ws, bank, otherIncome, balanceOf, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ description: 'GAJI', amountMinor: 5_000_000, categoryAccountId: otherIncome.id })]);
    const [pending] = await listDrafts(database, ws);
    await editDraft(database, ws, pending!.id, { kind: 'income' });

    const posted = await confirmDraft(database, ws, pending!.id);

    expect(posted.transactionId).toBeTruthy();
    expect(posted.keptImage).toBeNull();
    expect(await balanceOf(bank.id)).toBe(5_000_000);
    expect(await balanceOf(otherIncome.id)).toBe(-5_000_000);
  });

  it('moves money between two of your own accounts, and asks for no category', async () => {
    const { database, ws, bank, savings, balanceOf, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ kind: 'transfer', toAccountId: savings.id, categoryAccountId: null, amountMinor: 1_000_000 })]);
    const [pending] = await listDrafts(database, ws);
    expect(pending!.categoryAccountId).toBeNull();

    await confirmDraft(database, ws, pending!.id);

    expect(await balanceOf(bank.id)).toBe(-1_000_000);
    expect(await balanceOf(savings.id)).toBe(1_000_000);
  });

  it('refuses a transfer that does not say where the money went', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ kind: 'transfer', toAccountId: null, categoryAccountId: null })]);
    const [pending] = await listDrafts(database, ws);

    await expect(confirmDraft(database, ws, pending!.id)).rejects.toMatchObject({ code: 'NO_TO_ACCOUNT' });
  });

  it('takes the sources a phone captures on', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [
      draft({ source: 'notification', externalRef: 'n1' }),
      draft({ source: 'screen', externalRef: 's1' }),
      draft({ source: 'photo', externalRef: 'p1' }),
    ]);

    expect((await listDrafts(database, ws)).map((row) => row.source).sort()).toEqual(['notification', 'photo', 'screen']);
  });

  it('hides a draft that was merged into another', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ externalRef: 'a' }), draft({ externalRef: 'b', description: 'KOPI' })]);
    const [first, second] = await listDrafts(database, ws);
    // Merging is the matcher's job (Task 3); what is asserted here is that the pointer hides the row from the queue.
    await database.db.run(sql`UPDATE draft_transactions SET merged_into = ${first!.id} WHERE id = ${second!.id}`);

    const queue = await listDrafts(database, ws);
    expect(queue.map((row) => row.id)).toEqual([first!.id]);
  });

  it('hands the image back when the draft kept its photo', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ externalRef: 'a', imageFile: 'capture-1.png' }), draft({ externalRef: 'b', description: 'KOPI' })]);
    const [withPhoto, withoutPhoto] = await listDrafts(database, ws);

    expect(await confirmDraft(database, ws, withPhoto!.id, { keepPhoto: true })).toMatchObject({ keptImage: 'capture-1.png' });
    expect(await confirmDraft(database, ws, withoutPhoto!.id, { keepPhoto: true })).toMatchObject({ keptImage: null });
  });
});
