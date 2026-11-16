import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ensureCategoryKeys, migrate, renameAccount } from '../../src/index';
import { defaultCategoryIdOf } from '../../src/repos/categories';
import { Household, skipsOf, type Device } from './household';

/*
 * The income renames (migration 0117) and Side business and selling in a shared book, each phone upgrading on its own
 * day. Each phone renames its own copy, so nothing is sent and the book agrees once both have upgraded; a phone still
 * on the older build keeps the old names meanwhile, and gets Side business from the owner's phone by sync. A rename made
 * by hand travels as ever, and the migration never overwrites it.
 */

const SIDE = 'income.side_business';

/** One phone as an older build left it: old names, no Side business, 0117 not run. Not captured. */
async function asBeforeTheUpgrade(d: Device): Promise<void> {
  await d.database.execScript(`
    UPDATE accounts SET name = 'Salary' WHERE system_key = 'income.salary';
    UPDATE accounts SET name = 'Bonus' WHERE system_key = 'income.bonus';
    UPDATE accounts SET name = 'Gifts Received' WHERE system_key = 'income.gifts';
    DELETE FROM book_categories WHERE category_account_id IN (SELECT id FROM accounts WHERE system_key = '${SIDE}');
    DELETE FROM accounts WHERE system_key = '${SIDE}';
    DELETE FROM schema_migrations WHERE version = 117;`);
}

/** The app's open on the new build: its migrations, then the built-in categories. */
async function upgrade(d: Device): Promise<void> {
  await migrate(d.database);
  await ensureCategoryKeys(d.database, d.ws);
}

/** The book's top-level income categories as one phone lists them: key, id and name. */
const incomeIn = async (d: Device, bookId: string) =>
  d.database.db.values<[string | null, string, string]>(sql`
    SELECT a.system_key, a.id, a.name FROM accounts a JOIN book_categories b ON b.category_account_id = a.id
     WHERE b.book_id = ${bookId} AND a.kind = 'income' AND a.subtype = 'category' AND a.parent_id IS NULL AND a.archived_at IS NULL
     ORDER BY a.sort_order, a.id`);

const names = async (d: Device, bookId: string) => (await incomeIn(d, bookId)).map(([, , name]) => name);
const outbox = async (d: Device) => (await d.database.db.values<[number]>(sql`SELECT count(*) FROM sync_outbox`))[0]![0];

const OLD = ['Salary', 'Bonus', 'Investment Income', 'Realized Gains', 'Cashback & Rewards', 'Gifts Received', 'Other Income'];
const NEW = ['Salary, wage, or pay', 'Bonus and benefits', 'Investment Income', 'Realized Gains', 'Cashback & Rewards', 'Gifts, awards, and grants', 'Side business and selling', 'Other Income'];

async function sharedBeforeTheUpgrade() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  await asBeforeTheUpgrade(fandri);
  await asBeforeTheUpgrade(dewi);
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  expect(await names(dewi, bookId)).toEqual(OLD);
  return { home, fandri, dewi, bookId };
}

describe('income categories in a shared book', () => {
  it('owner first: the older phone keeps the old names, gets Side business by sync, and agrees once it upgrades', async () => {
    const { home, fandri, dewi, bookId } = await sharedBeforeTheUpgrade();

    const sentBefore = await outbox(fandri);
    await migrate(fandri.database);
    // The renames are each phone's own: nothing goes out for them.
    expect(await outbox(fandri)).toBe(sentBefore);
    await ensureCategoryKeys(fandri.database, fandri.ws);
    await home.settle();

    expect(await names(fandri, bookId)).toEqual(NEW);
    // Dewi's phone, still on the older build: the old three names, and the new category from the owner's phone.
    expect(await names(dewi, bookId)).toEqual(['Salary', 'Bonus', 'Investment Income', 'Realized Gains', 'Cashback & Rewards', 'Gifts Received', 'Side business and selling', 'Other Income']);

    await upgrade(dewi);
    await home.settle();
    expect(await incomeIn(dewi, bookId)).toEqual(await incomeIn(fandri, bookId));
    expect(await names(dewi, bookId)).toEqual(NEW);
    const side = (await incomeIn(dewi, bookId)).filter(([key]) => key === SIDE);
    expect(side.map(([, id]) => id)).toEqual([await defaultCategoryIdOf(bookId, SIDE)]);
    expect(await skipsOf(dewi.database)).toEqual([]);
    expect(await skipsOf(fandri.database)).toEqual([]);
  });

  it('joined phone first: it renames its own copy, makes no Side business of its own in the book, and the two agree', async () => {
    const { home, fandri, dewi, bookId } = await sharedBeforeTheUpgrade();

    await upgrade(dewi);
    await home.settle();
    expect((await incomeIn(dewi, bookId)).filter(([key]) => key === SIDE)).toEqual([]);
    expect(await names(fandri, bookId)).toEqual(OLD);

    await upgrade(fandri);
    await home.settle();
    await upgrade(dewi);
    await home.settle();
    expect(await names(fandri, bookId)).toEqual(NEW);
    expect(await incomeIn(dewi, bookId)).toEqual(await incomeIn(fandri, bookId));
    expect(await skipsOf(dewi.database)).toEqual([]);
  });

  it('keeps a rename made by hand on the older phone’s side, through the other phone’s upgrade', async () => {
    const { home, fandri, dewi, bookId } = await sharedBeforeTheUpgrade();
    const [, bonusId] = (await incomeIn(fandri, bookId)).find(([key]) => key === 'income.bonus')!;

    // The owner, still on the older build, renames Bonus; Dewi's phone upgrades before that arrives.
    await renameAccount(fandri.database, fandri.ws, bonusId, 'Tunjangan kantor');
    await upgrade(dewi);
    await home.settle();
    expect((await incomeIn(dewi, bookId)).find(([key]) => key === 'income.bonus')?.[2]).toBe('Tunjangan kantor');

    await upgrade(fandri);
    await home.settle();
    for (const d of [fandri, dewi]) {
      expect((await incomeIn(d, bookId)).find(([key]) => key === 'income.bonus')?.[2]).toBe('Tunjangan kantor');
      expect((await incomeIn(d, bookId)).find(([key]) => key === 'income.salary')?.[2]).toBe('Salary, wage, or pay');
    }
  });

  it('a phone that joins after the owner upgraded is given the new names too, with nothing sent for them', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    await asBeforeTheUpgrade(fandri);
    const bookId = await home.share(fandri);
    await home.settle();
    await upgrade(fandri);
    await home.settle();

    // Dewi's phone, on the new build, joins now: the book's log still holds the names from before the upgrade.
    await home.join(dewi, fandri);
    await home.settle();
    const sentBefore = await outbox(dewi);
    await ensureCategoryKeys(dewi.database, dewi.ws);
    expect(await outbox(dewi)).toBe(sentBefore);
    await home.settle();
    expect(await names(dewi, bookId)).toEqual(NEW);
    expect(await incomeIn(dewi, bookId)).toEqual(await incomeIn(fandri, bookId));
    expect(await skipsOf(dewi.database)).toEqual([]);
  });

  it('keeps an old name typed again by hand, on a phone that joins later', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    await asBeforeTheUpgrade(fandri);
    const bookId = await home.share(fandri);
    await home.settle();
    await upgrade(fandri);
    const [, salaryId] = (await incomeIn(fandri, bookId)).find(([key]) => key === 'income.salary')!;
    await renameAccount(fandri.database, fandri.ws, salaryId, 'Salary');
    await home.settle();

    await home.join(dewi, fandri);
    await home.settle();
    await ensureCategoryKeys(dewi.database, dewi.ws);
    await ensureCategoryKeys(fandri.database, fandri.ws);
    await home.settle();
    for (const d of [fandri, dewi]) expect((await incomeIn(d, bookId)).find(([key]) => key === 'income.salary')?.[2]).toBe('Salary');
  });
});
