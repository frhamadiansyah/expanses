import { expenseLines, transferLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { addCard, archiveCard, createAccount, createCardAccount, createDatabase, createWorkspace, type Database, listAccounts, listCards, migrate, MIGRATIONS, postTransaction, type WorkspaceContext } from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';

/*
 * Migration 0072: purchases recorded while a card account had one card were saved naming no card, because Paid with
 * offered that account as one row naming none. Once a supplementary card was added and the old primary removed, they
 * read as made on no card at all. The migration names the card each was made with, where there is no question which.
 *
 * The owner's history, with invented names, digits and figures: a card account opened with its one card, purchases on
 * it (some dated before the card was even recorded), a supplementary added, the old primary removed and a new primary
 * added the same day.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const VERSION = 72;
const at = (database: Database, id: string, column: 'created_at' | 'archived_at', when: string) => database.db.run(sql.raw(`UPDATE cards SET ${column} = '${when}' WHERE id = '${id}'`));

async function before0072(): Promise<{ database: Database; ws: WorkspaceContext }> {
  executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database, MIGRATIONS.filter((m) => m.version < VERSION));
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  return { database, ws };
}

async function ownersHistory() {
  const { database, ws } = await before0072();
  const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
  const bank = await createAccount(database, ws, { name: 'Rekening Harian', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const octo = await createCardAccount(database, ws, { name: 'Octo Card', subtype: 'credit_card', currency: 'IDR', issuer: 'CIMB Niaga', last4: '1467' });
  const old = (await listCards(database, ws, octo.id))[0]!;
  // Recorded after the account's first purchases were typed in, as a card often is.
  await at(database, old.id, 'created_at', '2026-08-20T03:00:00.000Z');

  /*
   * What an older build saved: no card, however many the account had. Posted through today's ledger, which names the
   * only card itself, and then put back to how that build left them.
   */
  const purchase = async (occurredOn: string, description: string, cardId?: string) => {
    const id = await postTransaction(database, ws, {
      occurredOn,
      description,
      cardId,
      lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: octo.id, amountMinor: 61_000, currency: 'IDR' }),
    });
    if (!cardId) await database.db.run(sql`UPDATE transactions SET card_id = NULL WHERE id = ${id}`);
    return id;
  };
  const beforeRecorded = await purchase('2026-08-05', 'Toko Roti');
  const oneCardEra = await purchase('2026-09-01', 'Pasar Minggu');
  const payment = await postTransaction(database, ws, {
    occurredOn: '2026-09-05',
    description: 'Card payment',
    lines: transferLines({ fromAccountId: bank.id, toAccountId: octo.id, amountMinor: 61_000, currency: 'IDR' }),
  });

  const supplementary = await addCard(database, ws, { accountId: octo.id, last4: '2290', holderName: 'Pasangan' });
  await at(database, supplementary, 'created_at', '2026-09-10T02:00:00.000Z');
  const dayBefore = await purchase('2026-09-09', 'Apotek Sehat');
  const twoCardEra = await purchase('2026-09-20', 'Kedai Mie');
  const named = await purchase('2026-09-25', 'Toko Buku', supplementary);

  await archiveCard(database, ws, old.id);
  await at(database, old.id, 'archived_at', '2026-10-01T04:00:00.000Z');
  const fresh = await addCard(database, ws, { accountId: octo.id, last4: '7781', holderName: 'Pemilik', isPrimary: true });
  await at(database, fresh, 'created_at', '2026-10-01T04:05:00.000Z');
  const newCardsEra = await purchase('2026-10-10', 'Warung Sate');

  return { database, ws, groceries, octo, old: old.id, supplementary, fresh, beforeRecorded, oneCardEra, payment, dayBefore, twoCardEra, named, newCardsEra };
}

const cardOf = async (database: Database, id: string) => (await database.db.values<[string | null]>(sql`SELECT card_id FROM transactions WHERE id = ${id}`))[0]?.[0];

describe('migration 0072 (the card an older purchase was made with)', () => {
  it('is version 72 and named purchase_only_card', () => {
    expect(MIGRATIONS.find((m) => m.version === VERSION)).toMatchObject({ name: 'purchase_only_card' });
  });

  it('names the old primary on the purchases made while it was the account’s only card, even before it was recorded', async () => {
    const h = await ownersHistory();
    await migrate(h.database);
    expect(await cardOf(h.database, h.beforeRecorded)).toBe(h.old);
    expect(await cardOf(h.database, h.oneCardEra)).toBe(h.old);
  });

  it('leaves alone the purchases made while two cards were in use, and the one the day before the second was added', async () => {
    const h = await ownersHistory();
    await migrate(h.database);
    // Two cards could have made each of these, so nothing says which did.
    expect(await cardOf(h.database, h.twoCardEra)).toBeNull();
    expect(await cardOf(h.database, h.newCardsEra)).toBeNull();
    // A card's dates are kept in UTC and a purchase's in the owner's own day, so each is read with a day's slack.
    expect(await cardOf(h.database, h.dayBefore)).toBeNull();
  });

  it('never touches a purchase that already names a card, nor a payment to the card', async () => {
    const h = await ownersHistory();
    await migrate(h.database);
    expect(await cardOf(h.database, h.named)).toBe(h.supplementary);
    expect(await cardOf(h.database, h.payment)).toBeNull();
  });

  it('names the one card an account ever had, and nothing on an account with none', async () => {
    const { database, ws } = await before0072();
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!;
    const single = await createCardAccount(database, ws, { name: 'Kartu Tunggal', subtype: 'credit_card', currency: 'IDR', last4: '4402' });
    const card = (await listCards(database, ws, single.id))[0]!;
    await at(database, card.id, 'created_at', '2026-09-30T01:00:00.000Z');
    const none = await createCardAccount(database, ws, { name: 'Kartu Tanpa Nomor', subtype: 'credit_card', currency: 'IDR' });
    const ids: string[] = [];
    for (const account of [single, none]) {
      const id = await postTransaction(database, ws, {
        occurredOn: '2026-07-01',
        description: `Belanja ${account.name}`,
        lines: expenseLines({ categoryAccountId: groceries.id, paymentAccountId: account.id, amountMinor: 23_000, currency: 'IDR' }),
      });
      await database.db.run(sql`UPDATE transactions SET card_id = NULL WHERE id = ${id}`);
      ids.push(id);
    }
    await migrate(database);
    expect(await cardOf(database, ids[0]!)).toBe(card.id);
    expect(await cardOf(database, ids[1]!)).toBeNull();
  });

  it('changes nothing more when it runs again', async () => {
    const h = await ownersHistory();
    await migrate(h.database);
    const read = () => h.database.db.values(sql`SELECT id, card_id FROM transactions ORDER BY id`);
    const once = await read();
    await h.database.execScript(MIGRATIONS.find((m) => m.version === VERSION)!.sql);
    expect(await read()).toEqual(once);
  });
});
