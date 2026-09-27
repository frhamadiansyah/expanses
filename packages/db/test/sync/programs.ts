import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import {
  clearBudgetOverride,
  clearCategoryNeed,
  clearIncomeOverride,
  createAccount,
  inBook,
  personalBook,
  postTransaction,
  removeBudget,
  renameAccount,
  renameBook,
  replaceTransaction,
  saveBudget,
  saveCategoryNeed,
  saveExpectedIncome,
  saveExpenseTemplate,
  setBudgetOverride,
  setIncomeOverride,
  skipBill,
  unskipBill,
  voidTransaction,
} from '../../src/index';
import type { Device, Household } from './household';

/*
 * Random local programs over a shared book, for the convergence and money-atom properties (spec §13): post, correct,
 * void, budgets and their overrides, bills and their skips, categories and their needs, the book's income, and syncs —
 * each on a device chosen at random, so devices stay offline for stretches and meet the relay in random orders.
 */

export type Step =
  | { kind: 'post'; device: number; category: number; amount: number; usd: boolean; day: number }
  | { kind: 'correct'; device: number; pick: number; what: 'description' | 'amount' | 'category' | 'payer'; amount: number; category: number }
  | { kind: 'void'; device: number; pick: number }
  | { kind: 'budget'; device: number; category: number; amount: number; remove: boolean }
  | { kind: 'override'; device: number; category: number; month: number; amount: number; clear: boolean }
  | { kind: 'bill'; device: number; pick: number; category: number; amount: number }
  | { kind: 'skip'; device: number; pick: number; month: number; undo: boolean }
  | { kind: 'need'; device: number; category: number; need: 'essential' | 'lifestyle' | null }
  | { kind: 'category'; device: number; pick: number; name: number }
  | { kind: 'income'; device: number; month: number | null; amount: number; clear: boolean }
  | { kind: 'book'; device: number; name: number }
  | { kind: 'sync'; device: number };

export interface Program {
  devices: number;
  /** The owner's history before the book is shared: seeded (§6.5). */
  history: Step[];
  steps: Step[];
  /** For each joiner (device 1, 2, …): the step before which it joins. */
  joinAt: number[];
}

const USD_RATE = 16_123.45;
const small = fc.nat({ max: 3 });

function stepArb(devices: number): fc.Arbitrary<Step> {
  const device = fc.nat({ max: devices - 1 });
  return fc.oneof(
    { weight: 5, arbitrary: fc.record({ kind: fc.constant('post' as const), device, category: small, amount: fc.integer({ min: 1, max: 900 }), usd: fc.boolean(), day: fc.integer({ min: 1, max: 28 }) }) },
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('correct' as const), device, pick: small, what: fc.constantFrom('description' as const, 'amount' as const, 'category' as const, 'payer' as const), amount: fc.integer({ min: 1, max: 900 }), category: small }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('void' as const), device, pick: small }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('budget' as const), device, category: small, amount: fc.integer({ min: 1, max: 50 }), remove: fc.boolean() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('override' as const), device, category: small, month: fc.nat({ max: 1 }), amount: fc.integer({ min: 1, max: 50 }), clear: fc.boolean() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('bill' as const), device, pick: small, category: small, amount: fc.integer({ min: 1, max: 50 }) }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('skip' as const), device, pick: small, month: fc.nat({ max: 1 }), undo: fc.boolean() }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('need' as const), device, category: small, need: fc.constantFrom('essential' as const, 'lifestyle' as const, null) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('category' as const), device, pick: small, name: fc.nat({ max: 99 }) }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('income' as const), device, month: fc.option(fc.nat({ max: 1 })), amount: fc.integer({ min: 1, max: 99 }), clear: fc.boolean() }) },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('book' as const), device, name: fc.nat({ max: 9 }) }) },
    { weight: 5, arbitrary: fc.record({ kind: fc.constant('sync' as const), device }) },
  );
}

export function programArb(opts: { maxSteps: number; maxHistory: number }): fc.Arbitrary<Program> {
  return fc.integer({ min: 2, max: 3 }).chain((devices) =>
    fc
      .record({
        history: fc.array(stepArb(1), { minLength: 1, maxLength: opts.maxHistory, size: 'max' }),
        steps: fc.array(stepArb(devices), { minLength: Math.min(8, opts.maxSteps), maxLength: opts.maxSteps, size: 'max' }),
      })
      .chain(({ history, steps }) =>
        fc.array(fc.nat({ max: steps.length }), { minLength: devices - 1, maxLength: devices - 1 }).map((joinAt) => ({ devices, history, steps, joinAt })),
      ),
  );
}

const FIXED = ['Groceries', 'Supplies', 'Takeaways', 'Restaurants', 'Fuel cost'];
const MONTHS = ['2026-09', '2026-10', '2026-11'];

/** The categories a program picks from on this device: a few defaults, and every one a program made. */
async function pool(d: Device, bookId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id
    WHERE bc.book_id = ${bookId} AND a.kind = 'expense' AND a.archived_at IS NULL
      AND (a.name IN (${sql.join(FIXED.map((n) => sql`${n}`), sql`, `)}) OR a.name LIKE 'Cat %')
    ORDER BY a.id`);
  return rows.map((r) => r[0]);
}

async function heads(d: Device, bookId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(
    sql`SELECT head_transaction_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NOT NULL ORDER BY lineage_id`,
  );
  return rows.map((r) => r[0]);
}

async function bills(d: Device, bookId: string): Promise<string[]> {
  const rows = await d.database.db.values<[string]>(sql`
    SELECT x.id FROM expense_templates x JOIN book_categories bc ON bc.category_account_id = x.category_account_id
    WHERE bc.book_id = ${bookId} ORDER BY x.id`);
  return rows.map((r) => r[0]);
}

const at = <T>(list: readonly T[], i: number): T | undefined => (list.length ? list[i % list.length] : undefined);

/** A refusal a user could meet (a budget needs a category, a skip needs a bill…) is a step that did nothing. */
function refused(error: unknown): boolean {
  const name = (error as Error)?.name ?? '';
  return ['BudgetError', 'RecurringError', 'LedgerError', 'PostingError', 'AccountError', 'BookError', 'CategoryNeedError'].includes(name);
}

/** Runs one local step on a device. Returns false when the step was refused or had nothing to act on. */
export async function runStep(home: Household, d: Device, step: Step): Promise<boolean> {
  const bookId = home.bookId;
  const ws = inBook(d.ws, bookId);
  const { database } = d;
  try {
    switch (step.kind) {
      case 'sync':
        await d.engine.syncOnce(bookId);
        return true;
      case 'post': {
        const category = at(await pool(d, bookId), step.category);
        if (!category) return false;
        const usd = step.usd ? d.usd : null;
        await postTransaction(database, d.ws, {
          occurredOn: `2026-09-${String(step.day).padStart(2, '0')}`,
          description: `Bought ${step.amount}`,
          lines: expenseLines({ categoryAccountId: category, paymentAccountId: usd ?? d.bank, amountMinor: usd ? step.amount * 7 : step.amount * 1_000, currency: usd ? 'USD' : 'IDR' }),
          ...(usd ? { ratesToBase: { USD: USD_RATE } } : {}),
        });
        return true;
      }
      case 'correct':
      case 'void': {
        const head = at(await heads(d, bookId), step.pick);
        if (!head) return false;
        if (step.kind === 'void') {
          await voidTransaction(database, d.ws, head);
          return true;
        }
        const [tx] = await database.db.values<[string, string]>(sql`SELECT occurred_on, description FROM transactions WHERE id = ${head}`);
        const entries = await database.db.values<[string, number, string, string | null, string]>(sql`
          SELECT e.account_id, e.amount_minor, e.currency, e.memo, a.kind FROM entries e JOIN accounts a ON a.id = e.account_id
          WHERE e.transaction_id = ${head} ORDER BY e.rowid`);
        const lines = entries.map(([accountId, amountMinor, currency, memo]) => ({ accountId, amountMinor: Number(amountMinor), currency, memo }));
        let description = tx![1];
        if (step.what === 'description') description = `Edited ${step.amount}`;
        if (step.what === 'category') {
          const category = at(await pool(d, bookId), step.category);
          const line = lines.find((_, i) => entries[i]![4] === 'expense');
          if (!category || !line) return false;
          line.accountId = category;
        }
        if (step.what === 'payer') {
          // "I paid that, actually": the money side moves to this device's own account (§7.3, any member may).
          const side = lines.filter((_, i) => entries[i]![4] !== 'expense' && entries[i]![4] !== 'income');
          if (side.length !== 1 || side[0]!.currency !== 'IDR') return false;
          side[0]!.accountId = d.bank;
        }
        if (step.what === 'amount') {
          if (lines.length !== 2 || lines[0]!.currency !== lines[1]!.currency) return false;
          const sign = Math.sign(lines[0]!.amountMinor);
          const amount = lines[0]!.currency === 'USD' ? step.amount * 7 : step.amount * 1_000;
          lines[0]!.amountMinor = sign * amount;
          lines[1]!.amountMinor = -sign * amount;
        }
        const usd = lines.some((l) => l.currency === 'USD');
        await replaceTransaction(database, d.ws, head, { occurredOn: tx![0], description, lines, ...(usd ? { ratesToBase: { USD: USD_RATE } } : {}) });
        return true;
      }
      case 'budget': {
        const category = at(await pool(d, bookId), step.category);
        if (!category) return false;
        if (step.remove) await removeBudget(database, ws, category);
        else await saveBudget(database, ws, { categoryAccountId: category, amountMinor: step.amount * 100_000 });
        return true;
      }
      case 'override': {
        const category = at(await pool(d, bookId), step.category);
        if (!category) return false;
        if (step.clear) await clearBudgetOverride(database, ws, category, MONTHS[step.month]!);
        else await setBudgetOverride(database, ws, { categoryAccountId: category, month: MONTHS[step.month]!, amountMinor: step.amount * 100_000 });
        return true;
      }
      case 'bill': {
        const category = at(await pool(d, bookId), step.category);
        if (!category) return false;
        const existing = await bills(d, bookId);
        const id = step.pick < existing.length ? existing[step.pick] : undefined;
        await saveExpenseTemplate(database, ws, { ...(id ? { id } : {}), name: `Bill ${step.pick}`, categoryAccountId: category, moneyAccountId: d.bank, amountMinor: step.amount * 10_000, dayOfMonth: 5, startsMonth: '2026-09' });
        return true;
      }
      case 'skip': {
        // A toggle, so a program skips, takes back and skips again: a row keyed by its natural key made again.
        const bill = at(await bills(d, bookId), step.pick);
        if (!bill) return false;
        const month = MONTHS[step.month]!;
        const skipped = await database.db.values(sql`SELECT 1 FROM bill_skips WHERE template_id = ${bill} AND month = ${month}`);
        if (skipped.length) await unskipBill(database, ws, bill, month);
        else await skipBill(database, ws, bill, month);
        return true;
      }
      case 'need': {
        const category = at(await pool(d, bookId), step.category);
        if (!category) return false;
        const marked = await database.db.values(sql`SELECT 1 FROM category_needs WHERE category_account_id = ${category}`);
        if (marked.length && step.need !== null) await clearCategoryNeed(database, ws, category);
        else if (step.need === null) await clearCategoryNeed(database, ws, category);
        else await saveCategoryNeed(database, ws, category, step.need);
        return true;
      }
      case 'category': {
        const mine = await d.database.db.values<[string]>(sql`
          SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id
          WHERE bc.book_id = ${bookId} AND a.name LIKE 'Cat %' ORDER BY a.id`);
        if (step.pick < mine.length) {
          await renameAccount(database, ws, mine[step.pick]![0], `Cat ${step.name}`);
        } else {
          const [parent] = await d.database.db.values<[string]>(sql`
            SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id
            WHERE bc.book_id = ${bookId} AND a.name = 'Household' AND a.parent_id IS NULL`);
          await createAccount(database, ws, { name: `Cat ${step.name}`, kind: 'expense', subtype: 'category', currency: null, parentId: parent?.[0] ?? null });
        }
        return true;
      }
      case 'income':
        if (step.month === null) await saveExpectedIncome(database, ws, step.amount * 1_000_000);
        else if (step.clear) await clearIncomeOverride(database, ws, MONTHS[step.month]!);
        else await setIncomeOverride(database, ws, { month: MONTHS[step.month]!, amountMinor: step.amount * 1_000_000 });
        return true;
      case 'book':
        await renameBook(database, d.ws, bookId, `Rumah ${step.name}`);
        return true;
    }
  } catch (error) {
    if (refused(error)) return false;
    throw error;
  }
}

/**
 * Plays a program: the owner's history, Share, then the steps, each joiner arriving at its turn (it pulls the whole
 * log on joining). `after` runs after every step that synced, on that device (the money-atom checks).
 */
export async function play(home: Household, program: Program, after?: (d: Device) => Promise<void>): Promise<Device[]> {
  const devices: Device[] = [];
  for (let i = 0; i < program.devices; i += 1) devices.push(await home.device(['Fandri', 'Dewi', 'Sari'][i]!));
  const owner = devices[0]!;
  home.bookId = (await personalBook(owner.database, owner.ws)).id;
  for (const step of program.history) if (step.kind !== 'sync') await runStep(home, owner, step);
  await home.share(owner);
  const joined = new Set<number>([0]);
  const joinAll = async (index: number) => {
    for (let j = 1; j < program.devices; j += 1) {
      if (joined.has(j) || program.joinAt[j - 1]! > index) continue;
      await home.join(devices[j]!, owner);
      await devices[j]!.engine.syncOnce(home.bookId);
      joined.add(j);
      if (after) await after(devices[j]!);
    }
  };
  for (const [index, step] of program.steps.entries()) {
    await joinAll(index);
    if (!joined.has(step.device)) continue;
    const d = devices[step.device]!;
    await runStep(home, d, step);
    if (step.kind === 'sync' && after) await after(d);
  }
  await joinAll(program.steps.length);
  await home.settle(devices);
  if (after) for (const d of devices) await after(d);
  return devices;
}
