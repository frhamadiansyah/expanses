import { expenseLines, incomeLines, UNCATEGORISED } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ensureCategoryKeys, inBook, postTransaction, uncategorisedCategory } from '../../src/index';
import { uuidv5 } from '../../src/sync/uuidv5';
import { Household, type Device } from './household';

/*
 * Uncategorised in a shared book: one row per book and kind, under an id every device works out alike, so two phones
 * saving with "Choose later" offline meet in one category — and the expense one is the very row rule 4 files an
 * unknown category under.
 */
async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  const ws = (d: Device) => inBook(d.ws, bookId);
  return { home, fandri, dewi, bookId, ws };
}

const rows = async (d: Device, bookId: string, kind: 'expense' | 'income') =>
  d.database.db.values<[string, string | null, string]>(
    sql`SELECT a.id, a.system_key, a.name FROM accounts a JOIN book_categories b ON b.category_account_id = a.id
        WHERE b.book_id = ${bookId} AND a.kind = ${kind} AND a.name = 'Uncategorised'`,
  );

describe('Uncategorised in a shared book', () => {
  it('is one row after two devices each made it offline, for spending and for income', async () => {
    const { home, fandri, dewi, bookId, ws } = await household();
    const ids: string[] = [];
    for (const d of [fandri, dewi]) {
      const spend = await uncategorisedCategory(d.database, ws(d), 'expense');
      const earn = await uncategorisedCategory(d.database, ws(d), 'income');
      ids.push(spend, earn);
      await postTransaction(d.database, ws(d), { occurredOn: '2026-10-01', description: `${d.name} later`, lines: expenseLines({ categoryAccountId: spend, paymentAccountId: d.bank, amountMinor: 10_000, currency: 'IDR' }) });
      await postTransaction(d.database, ws(d), { occurredOn: '2026-10-02', description: `${d.name} in later`, lines: incomeLines({ incomeAccountId: earn, depositAccountId: d.bank, amountMinor: 20_000, currency: 'IDR' }) });
    }
    // Worked out alike, without either telling the other.
    expect(ids[0]).toBe(ids[2]);
    expect(ids[1]).toBe(ids[3]);
    expect(ids[0]).toBe(await uuidv5(bookId, 'uncategorised'));
    expect(ids[1]).toBe(await uuidv5(bookId, 'uncategorised:income'));

    await home.settle();
    for (const d of [fandri, dewi]) {
      expect(await rows(d, bookId, 'expense')).toEqual([[ids[0], UNCATEGORISED.expense.key, 'Uncategorised']]);
      expect(await rows(d, bookId, 'income')).toEqual([[ids[1], UNCATEGORISED.income.key, 'Uncategorised']]);
    }
  });

  it('reuses the row rule 4 made, and gives it its key', async () => {
    const { fandri, bookId, ws } = await household();
    const ruleFour = await uuidv5(bookId, 'uncategorised');
    // As apply makes it for a category this device does not know: no key, last in the list.
    await fandri.database.db.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${ruleFour}, ${fandri.ws.workspaceId}, NULL, 'expense', 'category', 'Uncategorised', NULL, NULL, NULL, 999, NULL, '2026-10-01T00:00:00Z')`);
    await fandri.database.db.run(sql`INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${ruleFour}, ${fandri.ws.workspaceId}, ${bookId})`);

    expect(await uncategorisedCategory(fandri.database, ws(fandri), 'expense')).toBe(ruleFour);
    expect(await rows(fandri, bookId, 'expense')).toEqual([[ruleFour, UNCATEGORISED.expense.key, 'Uncategorised']]);
  });

  it('keys a rule-4 row on app open, before anything is saved for later', async () => {
    const { dewi, bookId } = await household();
    const ruleFour = await uuidv5(bookId, 'uncategorised');
    await dewi.database.db.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${ruleFour}, ${dewi.ws.workspaceId}, NULL, 'expense', 'category', 'Uncategorised', NULL, NULL, NULL, 999, NULL, '2026-10-01T00:00:00Z')`);
    await dewi.database.db.run(sql`INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${ruleFour}, ${dewi.ws.workspaceId}, ${bookId})`);
    await ensureCategoryKeys(dewi.database, dewi.ws);
    expect(await rows(dewi, bookId, 'expense')).toEqual([[ruleFour, UNCATEGORISED.expense.key, 'Uncategorised']]);
  });
});
