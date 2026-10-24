import { expenseLines, splitExpenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
  createBook,
  createCardAccount,
  inBook,
  listTransactions,
  nativeBalances,
  NOT_COUNTED_LINE,
  personalBook,
  postTransaction,
  replaceTransaction,
  voidTransaction,
} from '../../src/index';
import type { Database } from '../../src/database';
import { categoryOf, headOf, Household, projectBook, skipsOf, type Device } from './household';

/*
 * One card purchase split across workspaces (0084) where one of them is shared with a household: the partner's phone
 * gets that workspace's part alone, as a purchase of its own paid from the owner's card, as any household purchase on
 * the owner's own card reaches it. The other part, its category and the whole charge never leave the owner's phone.
 * Invented figures: Rp 1.247.000 at Toko Sumber Rejeki, Rp 830.000 groceries for Family, Rp 417.000 office supplies.
 */

const FAMILY_PART = 830_000;
const PRIVATE_PART = 417_000;
const WHOLE = FAMILY_PART + PRIVATE_PART;

interface Home {
  home: Household;
  owner: Device;
  partner: Device;
  family: string;
  business: string;
  card: string;
  groceries: string;
  dining: string;
  office: string;
}

/** Watches every change-set the device writes to its outbox from now on, drained or not. */
async function watchOutbox(database: Database): Promise<void> {
  await database.execScript(`
    CREATE TEMP TABLE IF NOT EXISTS seen_outbox (entry_json TEXT NOT NULL);
    CREATE TEMP TRIGGER IF NOT EXISTS seen_outbox_ins AFTER INSERT ON main.sync_outbox BEGIN INSERT INTO seen_outbox (entry_json) VALUES (NEW.entry_json); END;`);
}

async function seenOutbox(database: Database): Promise<string[]> {
  return (await database.db.values<[string]>(sql`SELECT entry_json FROM temp.seen_outbox`)).map(([json]) => json);
}

/** Nothing of the private part in any change-set the owner wrote: its category, its workspace, its figure, the whole. */
async function expectNothingPrivateSent(h: Home, figures: readonly number[] = [PRIVATE_PART, WHOLE]): Promise<void> {
  const sent = await seenOutbox(h.owner.database);
  expect(sent.length).toBeGreaterThan(0);
  for (const json of sent) {
    expect(json).not.toContain(h.office);
    expect(json).not.toContain(h.business);
    expect(json).not.toContain('Office supplies');
    for (const figure of figures) expect(json).not.toMatch(new RegExp(`:-?${figure}[,}\\]]`));
  }
}

/** The owner shares Family; Business stays private. The partner joins. Nothing purchased yet unless `before` posts it. */
async function household(before?: (h: Omit<Home, 'home' | 'partner'>) => Promise<void>): Promise<Home> {
  const home = new Household();
  const owner = await home.device('Fandri');
  const partner = await home.device('Dewi');
  const personal = (await personalBook(owner.database, owner.ws)).id;
  const family = await createBook(owner.database, owner.ws, { name: 'Family', kind: 'family', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const business = await createBook(owner.database, owner.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: personal });
  const card = (await createCardAccount(owner.database, owner.ws, { name: 'BCA Visa', subtype: 'credit_card', currency: 'IDR', last4: '4321' })).id;
  const office = (await createAccount(owner.database, inBook(owner.ws, business), { name: 'Office supplies', kind: 'expense', subtype: 'category', currency: null })).id;
  const groceries = await categoryOf(owner.database, family, 'Groceries');
  const dining = await categoryOf(owner.database, family, 'Restaurants');
  const partial = { owner, family, business, card, groceries, dining, office };
  await before?.(partial);
  await watchOutbox(owner.database);
  const { relayBookId } = await owner.engine.shareBook(family, { memberId: owner.memberId, memberName: 'Fandri', deviceName: 'Fandri’s phone' });
  home.bookId = family;
  home.relayBookId = relayBookId;
  await home.join(partner, owner);
  await home.settle();
  return { home, partner, ...partial };
}

const market = (h: Pick<Home, 'card' | 'groceries' | 'office'>, parts: { categoryAccountId: string; amountMinor: number }[] = [
  { categoryAccountId: h.groceries, amountMinor: FAMILY_PART },
  { categoryAccountId: h.office, amountMinor: PRIVATE_PART },
], occurredOn = '2026-09-12') => ({
  occurredOn,
  description: 'Toko Sumber Rejeki',
  lines: splitExpenseLines({ paymentAccountId: h.card, currency: 'IDR', splits: parts }),
});

/** Every line of a transaction: its account's name and kind, and its amount. */
async function linesOf(database: Database, transactionId: string): Promise<[string, string, number][]> {
  return (
    await database.db.values<[string, string, number]>(sql`
      SELECT a.name, a.kind, e.amount_minor FROM entries e JOIN accounts a ON a.id = e.account_id
      WHERE e.transaction_id = ${transactionId} ORDER BY a.kind, e.amount_minor`)
  ).map(([name, kind, amount]) => [name, kind, Number(amount)]);
}

async function filing(database: Database, transactionId: string) {
  return {
    one: (await database.db.values<[string]>(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${transactionId}`)).map(([b]) => b),
    split: (await database.db.values<[string]>(sql`SELECT book_id FROM book_transaction_splits WHERE transaction_id = ${transactionId} ORDER BY rowid`)).map(([b]) => b),
  };
}

const spent = async (d: Device, bookId: string) =>
  (await categoryTotalsIn(d.database, inBook(d.ws, bookId), 'expense', '2026-09-01', '2026-09-30')).rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);

/** The partner's copy of the purchase: its category lines, and what the money side reads as. */
async function partnerCopy(h: Home, lineage: string) {
  const head = await headOf(h.partner.database, lineage);
  if (!head) return null;
  const [view] = await listTransactions(h.partner.database, inBook(h.partner.ws, h.family), { id: head });
  return {
    description: view!.description,
    occurredOn: view!.occurredOn,
    categories: view!.entries.filter((e) => e.accountKind === 'expense').map((e) => [e.accountName, e.amountMinor]),
    money: view!.entries.filter((e) => e.accountKind !== 'expense').map((e) => e.amountMinor),
  };
}

/** The partner edits their copy as their edit form does: one line, on the money side it has. */
async function partnerEdits(h: Home, lineage: string, change: { amountMinor?: number; category?: string; description?: string; paidWith?: string }) {
  const head = (await headOf(h.partner.database, lineage))!;
  const rows = await h.partner.database.db.values<[string, number, string]>(
    sql`SELECT e.account_id, e.amount_minor, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${head}`,
  );
  const category = rows.find(([, , kind]) => kind === 'expense')!;
  const money = rows.find(([, , kind]) => kind !== 'expense')!;
  const [tx] = await h.partner.database.db.values<[string, string]>(sql`SELECT occurred_on, description FROM transactions WHERE id = ${head}`);
  await replaceTransaction(h.partner.database, inBook(h.partner.ws, h.family), head, {
    occurredOn: tx![0],
    description: change.description ?? tx![1],
    lines: expenseLines({
      categoryAccountId: change.category ?? category[0],
      paymentAccountId: change.paidWith ?? money[0],
      amountMinor: change.amountMinor ?? Number(category[1]),
      currency: 'IDR',
    }),
  });
}

async function expectConverged(h: Home): Promise<void> {
  expect(await projectBook(h.partner.database, h.family)).toEqual(await projectBook(h.owner.database, h.family));
  expect(await skipsOf(h.owner.database)).toEqual([]);
  expect(await skipsOf(h.partner.database)).toEqual([]);
}

describe('a purchase split with a shared workspace reaches the partner as its part there', () => {
  it('only the shared part, paid from the owner’s card; the private part never leaves the owner’s phone', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();

    expect(await partnerCopy(h, id)).toEqual({
      description: 'Toko Sumber Rejeki',
      occurredOn: '2026-09-12',
      categories: [['Groceries', FAMILY_PART]],
      money: [-FAMILY_PART],
    });
    // Paid by the owner, named by the card, as a household purchase on the owner's own card.
    const [lineage] = await h.partner.database.db.values<[string, string]>(sql`SELECT paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${id}`);
    expect(lineage).toEqual([h.owner.memberId, 'BCA Visa ···· 4321']);
    expect(await spent(h.partner, h.family)).toBe(FAMILY_PART);
    // Nothing of the other part anywhere on the partner's phone.
    expect(await h.partner.database.db.values(sql`SELECT 1 FROM accounts WHERE name = 'Office supplies'`)).toEqual([]);
    expect(await h.partner.database.db.values(sql`SELECT 1 FROM entries WHERE abs(amount_minor) IN (${PRIVATE_PART}, ${WHOLE})`)).toEqual([]);
    await expectNothingPrivateSent(h);

    // The owner's phone as built: the card has the whole charge, each workspace counts its part.
    expect(await filing(h.owner.database, id)).toEqual({ one: [], split: [h.family, h.business] });
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-WHOLE);
    expect(await spent(h.owner, h.family)).toBe(FAMILY_PART);
    expect(await spent(h.owner, h.business)).toBe(PRIVATE_PART);
    await expectConverged(h);
  });

  it('an owner’s edit of the parts re-sends the shared part alone, and the card keeps the sum of the parts', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    // New figures and another Family category: 905.000 restaurants, 342.000 office supplies.
    const edited = await replaceTransaction(
      h.owner.database,
      inBook(h.owner.ws, h.business),
      id,
      market(h, [
        { categoryAccountId: h.dining, amountMinor: 905_000 },
        { categoryAccountId: h.office, amountMinor: 342_000 },
      ]),
    );
    await h.home.settle();
    expect(await partnerCopy(h, id)).toMatchObject({ categories: [['Restaurants', 905_000]], money: [-905_000] });
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-WHOLE);
    expect(await filing(h.owner.database, edited)).toEqual({ one: [], split: [h.family, h.business] });
    await expectNothingPrivateSent(h, [PRIVATE_PART, WHOLE, 342_000]);
    await expectConverged(h);
  });

  it('folding the split back into the private workspace takes the partner’s copy away; into the shared one sends the whole', async () => {
    const h = await household();
    const toBusiness = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    const toFamily = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h, undefined, '2026-09-13'), acrossBooks: true });
    await h.home.settle();
    expect(await partnerCopy(h, toBusiness)).not.toBeNull();

    await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.business), toBusiness, market(h, [{ categoryAccountId: h.office, amountMinor: WHOLE }]));
    await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.family), toFamily, market(h, [{ categoryAccountId: h.groceries, amountMinor: WHOLE }], '2026-09-13'));
    await h.home.settle();

    // Business alone: the partner's copy is gone. Family alone: now the whole purchase is the household's.
    expect(await headOf(h.partner.database, toBusiness)).toBeNull();
    expect(await partnerCopy(h, toFamily)).toMatchObject({ categories: [['Groceries', WHOLE]], money: [-WHOLE] });
    // Only the fold into Family said the whole figure, and only as Family's.
    for (const json of await seenOutbox(h.owner.database)) {
      expect(json).not.toContain(h.office);
      expect(json).not.toContain(h.business);
    }
    await expectConverged(h);
  });

  it('a split again after it was folded into the private workspace reaches the partner as a new purchase', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    const folded = await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.business), id, market(h, [{ categoryAccountId: h.office, amountMinor: WHOLE }]));
    await h.home.settle();
    expect(await headOf(h.partner.database, id)).toBeNull();

    const again = await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.business), folded, { ...market(h), acrossBooks: true });
    await h.home.settle();
    // Its own lineage, rooted at the row that came back; the old one stays void.
    expect(await headOf(h.owner.database, again)).toBe(again);
    expect(await headOf(h.owner.database, id)).toBeNull();
    expect(await partnerCopy(h, again)).toMatchObject({ categories: [['Groceries', FAMILY_PART]], money: [-FAMILY_PART] });
    expect(await headOf(h.partner.database, id)).toBeNull();
    await expectNothingPrivateSent(h);
    await expectConverged(h);
  });

  it('deleting the split deletes the partner’s copy', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    await voidTransaction(h.owner.database, inBook(h.owner.ws, h.business), id);
    await h.home.settle();
    expect(await headOf(h.partner.database, id)).toBeNull();
    expect(await listTransactions(h.partner.database, inBook(h.partner.ws, h.family))).toEqual([]);
    await expectNothingPrivateSent(h);
    await expectConverged(h);
  });
});

describe('the partner’s changes to the shared part, on the owner’s phone', () => {
  it('an edit of the amount, category and note changes the shared part alone; the card charge is the sum of the parts', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    const partnerDining = await categoryOf(h.partner.database, h.family, 'Restaurants');
    await partnerEdits(h, id, { amountMinor: 702_000, category: partnerDining, description: 'Toko Sumber Rejeki, lunch' });
    await h.home.settle();

    const head = (await headOf(h.owner.database, id))!;
    expect(await linesOf(h.owner.database, head)).toEqual([
      ['Restaurants', 'expense', 702_000],
      ['Office supplies', 'expense', PRIVATE_PART],
      ['BCA Visa', 'liability', -(702_000 + PRIVATE_PART)],
    ].sort((a, b) => (a[1] as string).localeCompare(b[1] as string) || (a[2] as number) - (b[2] as number)));
    expect(await filing(h.owner.database, head)).toEqual({ one: [], split: [h.family, h.business] });
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-(702_000 + PRIVATE_PART));
    expect(await spent(h.owner, h.family)).toBe(702_000);
    expect(await spent(h.owner, h.business)).toBe(PRIVATE_PART);
    const [view] = await listTransactions(h.owner.database, inBook(h.owner.ws, h.family), { id: head });
    expect(view!.description).toBe('Toko Sumber Rejeki, lunch');
    // Still on the owner's card, as the purchase was.
    const [card] = await h.owner.database.db.values<[string | null]>(sql`SELECT card_id FROM transactions WHERE id = ${head}`);
    expect(card![0]).not.toBeNull();
    await expectNothingPrivateSent(h, [PRIVATE_PART, WHOLE, 702_000 + PRIVATE_PART]);
    await expectConverged(h);
  });

  it('deleting the shared part leaves the purchase as the private part alone, in the private workspace', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    await voidTransaction(h.partner.database, inBook(h.partner.ws, h.family), (await headOf(h.partner.database, id))!);
    await h.home.settle();

    expect(await headOf(h.owner.database, id)).toBeNull();
    const [left] = await listTransactions(h.owner.database, inBook(h.owner.ws, h.business), { from: '2026-09-01', to: '2026-09-30' });
    expect(left!.description).toBe('Toko Sumber Rejeki');
    expect(await linesOf(h.owner.database, left!.id)).toEqual([
      ['Office supplies', 'expense', PRIVATE_PART],
      ['BCA Visa', 'liability', -PRIVATE_PART],
    ]);
    expect(await filing(h.owner.database, left!.id)).toEqual({ one: [h.business], split: [] });
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-PRIVATE_PART);
    expect(await listTransactions(h.owner.database, inBook(h.owner.ws, h.family), { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
    expect(await spent(h.owner, h.family)).toBe(0);
    await expectNothingPrivateSent(h);
    await expectConverged(h);

    // What is left is the owner's own: editing it sends nothing, and splitting it again is a new purchase.
    const again = await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.business), left!.id, { ...market(h), acrossBooks: true });
    await h.home.settle();
    expect(await partnerCopy(h, again)).toMatchObject({ categories: [['Groceries', FAMILY_PART]] });
    await expectConverged(h);
  });

  it('a partner who says they paid the part takes it off the card; the private part stays on the card as a purchase of its own', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true });
    await h.home.settle();
    await partnerEdits(h, id, { paidWith: h.partner.bank });
    await h.home.settle();

    const head = (await headOf(h.owner.database, id))!;
    const shared = await linesOf(h.owner.database, head);
    expect(shared.filter(([, kind]) => kind === 'expense')).toEqual([['Groceries', 'expense', FAMILY_PART]]);
    expect(shared.filter(([, kind]) => kind !== 'expense').map(([, , amount]) => amount)).toEqual([-FAMILY_PART]);
    expect(await filing(h.owner.database, head)).toEqual({ one: [h.family], split: [] });
    const [rest] = await listTransactions(h.owner.database, inBook(h.owner.ws, h.business), { from: '2026-09-01', to: '2026-09-30' });
    expect(await linesOf(h.owner.database, rest!.id)).toEqual([
      ['Office supplies', 'expense', PRIVATE_PART],
      ['BCA Visa', 'liability', -PRIVATE_PART],
    ]);
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-PRIVATE_PART);
    await expectNothingPrivateSent(h);
    await expectConverged(h);
  });
});

describe('sharing a workspace that already holds splits', () => {
  it('the seed sends each split’s shared part, and the private split stays home', async () => {
    let first = '';
    let privateOnly = '';
    const h = await household(async (o) => {
      first = await postTransaction(o.owner.database, inBook(o.owner.ws, o.family), { ...market(o), acrossBooks: true });
      // A split between two private workspaces is no business of the share.
      const personal = (await personalBook(o.owner.database, o.owner.ws)).id;
      const own = await categoryOf(o.owner.database, personal, 'Groceries');
      privateOnly = await postTransaction(o.owner.database, inBook(o.owner.ws, personal), {
        ...market(o, [
          { categoryAccountId: own, amountMinor: 61_000 },
          { categoryAccountId: o.office, amountMinor: 29_000 },
        ]),
        acrossBooks: true,
      });
    });
    expect(await partnerCopy(h, first)).toMatchObject({ categories: [['Groceries', FAMILY_PART]], money: [-FAMILY_PART] });
    expect(await headOf(h.partner.database, privateOnly)).toBeNull();
    expect(await h.partner.database.db.values(sql`SELECT 1 FROM entries WHERE abs(amount_minor) IN (61000, 29000, 90000)`)).toEqual([]);
    await expectNothingPrivateSent(h, [PRIVATE_PART, WHOLE, 61_000, 29_000, 90_000]);
    await expectConverged(h);
  });

  it('a share stopped and made again catches up on what was split meanwhile', async () => {
    const h = await household();
    const whole = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), market(h, [{ categoryAccountId: h.groceries, amountMinor: WHOLE }]));
    await h.home.settle();
    expect(await partnerCopy(h, whole)).toMatchObject({ categories: [['Groceries', WHOLE]] });

    await h.owner.engine.stopSharing(h.family);
    expect((await h.partner.engine.syncOnce(h.family)).ended).toBe('unshared');
    await h.partner.engine.forgetSharing(h.family);
    // While nothing is shared: the purchase is split, and a new one is split from the start.
    await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.family), whole, { ...market(h), acrossBooks: true });
    const later = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), {
      ...market(h, [
        { categoryAccountId: h.groceries, amountMinor: 213_000 },
        { categoryAccountId: h.office, amountMinor: 127_000 },
      ], '2026-09-20'),
      acrossBooks: true,
    });

    const again = await h.owner.engine.shareBook(h.family, { memberName: 'Fandri', deviceName: 'Fandri’s phone' });
    h.home.relayBookId = again.relayBookId;
    await h.owner.engine.syncOnce(h.family);
    const { code } = await h.owner.engine.createInvite(h.family, { inviterName: 'Fandri', sameMember: true, memberId: h.partner.memberId });
    await h.partner.engine.joinBook(code, { ws: h.partner.ws, memberName: 'Dewi', deviceName: 'Dewi’s phone' });
    await h.home.settle();

    expect(await partnerCopy(h, whole)).toMatchObject({ categories: [['Groceries', FAMILY_PART]], money: [-FAMILY_PART] });
    expect(await partnerCopy(h, later)).toMatchObject({ categories: [['Groceries', 213_000]], money: [-213_000] });
    await expectNothingPrivateSent(h, [PRIVATE_PART, 127_000, 340_000]);
    await expectConverged(h);
  });
});

describe('what a split with a shared workspace may be', () => {
  it('the partner may split their own purchase between the shared workspace and their own; an owner’s edit keeps their private part', async () => {
    const h = await household();
    const partnerPersonal = (await personalBook(h.partner.database, h.partner.ws)).id;
    const own = await categoryOf(h.partner.database, partnerPersonal, 'Restaurants');
    const shared = await categoryOf(h.partner.database, h.family, 'Groceries');
    const id = await postTransaction(h.partner.database, inBook(h.partner.ws, h.family), {
      occurredOn: '2026-09-14',
      description: 'Pasar Minggu',
      lines: splitExpenseLines({
        paymentAccountId: h.partner.bank,
        currency: 'IDR',
        splits: [
          { categoryAccountId: shared, amountMinor: 154_000 },
          { categoryAccountId: own, amountMinor: 66_000 },
        ],
      }),
      acrossBooks: true,
    });
    await h.home.settle();
    const ownerHead = (await headOf(h.owner.database, id))!;
    expect((await linesOf(h.owner.database, ownerHead)).map(([, kind, amount]) => [kind, amount])).toEqual([
      ['asset', -154_000],
      ['expense', 154_000],
    ]);
    expect(await h.owner.database.db.values(sql`SELECT 1 FROM entries WHERE abs(amount_minor) IN (66000, 220000)`)).toEqual([]);

    // The owner corrects the shared part: the partner's private part and bank stay right.
    const ownerGroceries = await categoryOf(h.owner.database, h.family, 'Groceries');
    const [[placeholder]] = (await h.owner.database.db.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${ownerHead} AND a.kind = 'asset'`)) as [[string]];
    await replaceTransaction(h.owner.database, inBook(h.owner.ws, h.family), ownerHead, {
      occurredOn: '2026-09-14',
      description: 'Pasar Minggu',
      lines: expenseLines({ categoryAccountId: ownerGroceries, paymentAccountId: placeholder, amountMinor: 171_000, currency: 'IDR' }),
    });
    await h.home.settle();
    const partnerHead = (await headOf(h.partner.database, id))!;
    expect((await linesOf(h.partner.database, partnerHead)).map(([name, , amount]) => [name, amount])).toEqual([
      ['Dewi Bank', -(171_000 + 66_000)],
      ['Restaurants', 66_000],
      ['Groceries', 171_000],
    ]);
    const filed = await filing(h.partner.database, partnerHead);
    expect([filed.one, [...filed.split].sort()]).toEqual([[], [h.family, partnerPersonal].sort()]);
    await expectConverged(h);
  });

  it('a purchase paid with another member’s money stays whole in the shared workspace', async () => {
    const h = await household();
    const partnerGroceries = await categoryOf(h.partner.database, h.family, 'Groceries');
    const id = await postTransaction(h.partner.database, inBook(h.partner.ws, h.family), {
      occurredOn: '2026-09-15',
      description: 'Apotek',
      lines: expenseLines({ categoryAccountId: partnerGroceries, paymentAccountId: h.partner.bank, amountMinor: 88_000, currency: 'IDR' }),
    });
    await h.home.settle();
    const head = (await headOf(h.owner.database, id))!;
    const [placeholder] = await h.owner.database.db.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${head} AND a.kind = 'asset'`);
    await expect(
      replaceTransaction(h.owner.database, inBook(h.owner.ws, h.family), head, {
        occurredOn: '2026-09-15',
        description: 'Apotek',
        lines: splitExpenseLines({
          paymentAccountId: placeholder![0],
          currency: 'IDR',
          splits: [
            { categoryAccountId: h.groceries, amountMinor: 50_000 },
            { categoryAccountId: h.office, amountMinor: 38_000 },
          ],
        }),
        acrossBooks: true,
      }),
    ).rejects.toMatchObject({ code: 'SPLIT_SHARED', message: 'A purchase paid with another member’s money stays whole in the shared workspace.' });
    expect(await headOf(h.owner.database, id)).toBe(head);
  });
});

describe('a part of the split left out of reports (0090)', () => {
  /** The split's parts on the owner's phone and whether each is left out, Family first. */
  const partsOf = async (h: Home, lineage: string) => {
    const head = (await headOf(h.owner.database, lineage))!;
    return (await h.owner.database.db.values<[string, number]>(sql`SELECT book_id, excluded FROM book_transaction_splits WHERE transaction_id = ${head}`))
      .map(([book, excluded]) => [book === h.family ? 'Family' : 'Business', Number(excluded)] as const)
      .sort((x, y) => Number(y[0] === 'Family') - Number(x[0] === 'Family'));
  };
  const partnerExcluded = async (h: Home, lineage: string) => {
    const head = (await headOf(h.partner.database, lineage))!;
    return Number((await h.partner.database.db.values<[number]>(sql`SELECT excluded FROM transaction_flags WHERE transaction_id = ${head}`))[0]?.[0] ?? 0);
  };

  it('the private part left out stays the owner’s own business: the partner’s copy counts as it did', async () => {
    const h = await household();
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true, excludedParts: [h.office] });
    await h.home.settle();
    expect(await partsOf(h, id)).toEqual([
      ['Family', 0],
      ['Business', 1],
    ]);
    expect(await partnerExcluded(h, id)).toBe(0);
    expect(await spent(h.partner, h.family)).toBe(FAMILY_PART);
    expect(await spent(h.owner, h.family)).toBe(FAMILY_PART);
    expect(await spent(h.owner, h.business)).toBe(0);
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-WHOLE);
    await expectNothingPrivateSent(h);
    await expectConverged(h);
  });

  it('the shared part left out reaches the partner so; switched back on there, it counts again on both phones', async () => {
    const h = await household();
    // Both parts left out on the owner's phone: only Family's flag travels.
    const id = await postTransaction(h.owner.database, inBook(h.owner.ws, h.family), { ...market(h), acrossBooks: true, excludedParts: [h.groceries, h.office] });
    await h.home.settle();
    expect(await partnerExcluded(h, id)).toBe(1);
    expect(await spent(h.partner, h.family)).toBe(0);
    await expectConverged(h);

    // The partner switches Exclude from report off on their copy, as their edit form saves it.
    const head = (await headOf(h.partner.database, id))!;
    const rows = await h.partner.database.db.values<[string, number]>(sql`SELECT account_id, amount_minor FROM entries WHERE transaction_id = ${head} ORDER BY rowid`);
    await replaceTransaction(h.partner.database, inBook(h.partner.ws, h.family), head, {
      occurredOn: '2026-09-12',
      description: 'Toko Sumber Rejeki',
      lines: rows.map(([accountId, amountMinor]) => ({ accountId, amountMinor: Number(amountMinor), currency: 'IDR' })),
      excludedFromReport: false,
    });
    await h.home.settle();

    // Back on the owner's phone it is the Family part's flag that changed; Business's part stays left out, the card whole.
    expect(await partsOf(h, id)).toEqual([
      ['Family', 0],
      ['Business', 1],
    ]);
    expect(await spent(h.owner, h.family)).toBe(FAMILY_PART);
    expect(await spent(h.owner, h.business)).toBe(0);
    expect(await spent(h.partner, h.family)).toBe(FAMILY_PART);
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card]).toBe(-WHOLE);
    await expectNothingPrivateSent(h);
    await expectConverged(h);
  });

  it('a Not counted part beside the shared part is refused, and nothing is sent', async () => {
    const h = await household();
    await expect(
      postTransaction(h.owner.database, inBook(h.owner.ws, h.family), {
        ...market(h, [
          { categoryAccountId: h.groceries, amountMinor: FAMILY_PART },
          { categoryAccountId: NOT_COUNTED_LINE, amountMinor: PRIVATE_PART },
        ]),
        acrossBooks: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_COUNTED_SHARED' });
    await h.home.settle();
    expect(await listTransactions(h.partner.database, inBook(h.partner.ws, h.family))).toEqual([]);
    expect((await nativeBalances(h.owner.database, h.owner.ws))[h.card] ?? 0).toBe(0);
  });
});
