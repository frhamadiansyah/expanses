import { afterEach, describe, expect, it } from 'vitest';
import {
  captureDrafts,
  confirmDraft,
  countPendingDrafts,
  createAccount,
  dismissDraft,
  editDraft,
  existingExternalRefs,
  listAccounts,
  listDrafts,
  type NewDraft,
  purgeExpiredPayloads,
  reopenDraft,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function workspace() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const groceries = (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
  const draft = (over: Partial<NewDraft> = {}): NewDraft => ({
    source: 'csv',
    occurredOn: '2026-09-09',
    description: 'SUPERINDO',
    amountMinor: 250_000,
    currency: 'IDR',
    accountId: card.id,
    categoryAccountId: groceries.id,
    externalRef: 'bca:2026-09-09:250000:1',
    rawPayload: '09/09/2026,SUPERINDO,250000',
    ...over,
  });
  return { database, ws, card, groceries, draft };
}

describe('capturing drafts', () => {
  it('queues what was captured, and skips what is already queued', async () => {
    const { database, ws, draft } = await workspace();

    expect(await captureDrafts(database, ws, [draft(), draft({ externalRef: 'second', description: 'KOPI' })])).toEqual({ captured: 2, skipped: 0 });
    // The same source read twice must not ask the owner to dismiss the same rows again.
    expect(await captureDrafts(database, ws, [draft()])).toEqual({ captured: 0, skipped: 1 });
    expect(await countPendingDrafts(database, ws)).toBe(2);
  });

  it('skips what has already been posted to the ledger', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft()]);
    const [pending] = await listDrafts(database, ws);
    await confirmDraft(database, ws, pending!.id);

    expect(await captureDrafts(database, ws, [draft()])).toEqual({ captured: 0, skipped: 1 });
  });
});

describe('working through the queue', () => {
  it('posts a confirmed draft through the ledger and remembers what it became', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft()]);
    const [pending] = await listDrafts(database, ws);

    const transactionId = await confirmDraft(database, ws, pending!.id);

    expect(await listDrafts(database, ws)).toEqual([]);
    const [confirmed] = await listDrafts(database, ws, 'confirmed');
    expect(confirmed).toMatchObject({ status: 'confirmed', transactionId });
    // Posted with the capture's own reference, which is what stops it being imported twice.
    expect(await existingExternalRefs(database, ws, ['bca:2026-09-09:250000:1'])).toEqual(new Set(['bca:2026-09-09:250000:1']));
  });

  it('refuses to post a draft that does not say where it goes', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft({ categoryAccountId: null, externalRef: 'no-category' })]);
    const [pending] = await listDrafts(database, ws);

    await expect(confirmDraft(database, ws, pending!.id)).rejects.toThrow(/category/i);

    // Correcting what was read is the point of the queue.
    await editDraft(database, ws, pending!.id, { categoryAccountId: (await workspaceGroceries(database, ws)).id });
    await expect(confirmDraft(database, ws, pending!.id)).resolves.toEqual(expect.any(String));
  });

  it('keeps a dismissed draft, so the same capture is not offered again', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft()]);
    const [pending] = await listDrafts(database, ws);

    await dismissDraft(database, ws, pending!.id);

    expect(await listDrafts(database, ws)).toEqual([]);
    expect((await listDrafts(database, ws, 'dismissed'))[0]).toMatchObject({ status: 'dismissed' });
    expect(await captureDrafts(database, ws, [draft()])).toEqual({ captured: 0, skipped: 1 });
  });

  it('puts a resolved draft back in the queue, whichever way it was resolved', async () => {
    const { database, ws, draft } = await workspace();

    // Recorded, then taken back: the draft is pending again and claims no transaction of its own. The transaction
    // it posted is the ledger's to void, not this function's.
    await captureDrafts(database, ws, [draft()]);
    const [recorded] = await listDrafts(database, ws);
    const transactionId = await confirmDraft(database, ws, recorded!.id);
    expect((await listDrafts(database, ws, 'confirmed'))[0]).toMatchObject({ transactionId });

    await reopenDraft(database, ws, recorded!.id);

    expect(await listDrafts(database, ws)).toMatchObject([{ id: recorded!.id, status: 'pending', transactionId: null }]);
    // Its keeping date came back with it: a reopened draft is not purged under the owner's feet.
    expect(await purgeExpiredPayloads(database, ws, '2026-09-20')).toBe(0);
    expect((await listDrafts(database, ws))[0]!.rawPayload).toBe('09/09/2026,SUPERINDO,250000');

    // Discarded, then taken back: the same way in from the other direction.
    const [again] = await listDrafts(database, ws);
    await dismissDraft(database, ws, again!.id);
    expect(await listDrafts(database, ws)).toEqual([]);

    await reopenDraft(database, ws, again!.id);

    expect(await listDrafts(database, ws)).toMatchObject([{ id: again!.id, status: 'pending' }]);
  });
});

describe('what the source said', () => {
  it('is dropped once its keeping date has passed, and the draft stays', async () => {
    const { database, ws, draft } = await workspace();
    await captureDrafts(database, ws, [draft()]);
    const [pending] = await listDrafts(database, ws);
    await confirmDraft(database, ws, pending!.id);

    // Nothing to purge while the date is ahead: a mis-parse can still be read back.
    expect(await purgeExpiredPayloads(database, ws, '2026-09-20')).toBe(0);
    expect((await listDrafts(database, ws, 'confirmed'))[0]!.rawPayload).toBe('09/09/2026,SUPERINDO,250000');

    // A kept bank email is a liability, so it goes and the record of the draft remains.
    expect(await purgeExpiredPayloads(database, ws, '2027-01-01')).toBe(1);
    const [confirmed] = await listDrafts(database, ws, 'confirmed');
    expect(confirmed!.rawPayload).toBeNull();
    expect(confirmed!.description).toBe('SUPERINDO');
  });
});

async function workspaceGroceries(database: TestDb['database'], ws: TestDb['ws']) {
  return (await listAccounts(database, ws)).find((account) => account.systemKey === 'household.groceries')!;
}
