import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkOutflow, expenseLines, transferLines } from '@expanses/core';
import {
  type AccountRow,
  createAccount,
  type Database,
  deleteTrade,
  goalsSchema,
  listEarmarks,
  listGoals,
  nativeBalances,
  postTransaction,
  recordTaggedTransfer,
  recordTrade,
  replaceTrade,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveGoal,
  type SetAsideChoice,
  setAsideChoiceOf,
  setAsideView,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { entries } from '../src/schema';
import { setupDb } from './helpers';

/**
 * Random sequences of post, edit and void over tagged transfers, "Move the promise" transfers, spends and tagged buys,
 * each answered the way the question would be (final-review.md I1–I3). Deterministic seeds, so a failure names its seed.
 *
 * After every step:
 *   (1) every promise is above nought, and an account's shortfall grows only by money that left it — a step never
 *       promises more than an account holds, except where the account already was short ("already short"), the
 *       step's own money left it, or the account was overdrawn (an arrival parked in full first fills the hole);
 *   (3) an edit that changes only the note changes no promise, no draw and no balance.
 * At the end:
 *   (2) voiding everything, newest first (an edited transaction stands where it was first posted), returns every promise
 *       exactly to where it started, and leaves no draw. In these runs an edit may shrink an amount but not grow it: a
 *       grown edit takes the growth from the promise as it stands now, which can hold money that arrived after the
 *       original was posted, so undoing it at the original's place cannot be exact. The any-order runs grow amounts too,
 *       and check (1), (3) and that no goal ends with more than it started with.
 */
const DAY = '2026-09-19';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface World {
  database: Database;
  ws: WorkspaceContext;
  money: AccountRow[];
  gold: AccountRow;
  electronics: AccountRow;
  goalIds: string[];
}

async function world(): Promise<World> {
  const { database, ws } = await setupDb();
  const account = (name: string, subtype: 'savings' | 'bank', opening: number) =>
    createAccount(database, ws, { name, kind: 'asset', subtype, currency: 'IDR', openingBalanceMinor: opening, openedOn: '2026-01-01' });
  const jenius = await account('Jenius', 'savings', 42_500_000);
  const bca = await account('BCA', 'bank', 6_000_000);
  const mandiri = await account('Mandiri', 'bank', 3_000_000);
  const gold = await createAccount(database, ws, { name: 'Antam', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  const electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  const stage = (name: string, targetMinor: number, dueOn: string) => ({ name, targetMinor, targetMonths: null, dueOn });
  const ef = await saveGoal(database, ws, { name: 'Emergency fund', kind: 'emergency', growthBps: 0, returnBps: 0, stages: [stage('Emergency fund', 30_000_000, '2027-12-31')] });
  const umrah = await saveGoal(database, ws, { name: 'Umrah', kind: 'umrah', growthBps: 0, returnBps: 0, stages: [stage('Tickets', 7_500_000, '2027-03-31'), stage('Hotel', 5_000_000, '2027-04-30')] });
  const car = await saveGoal(database, ws, { name: 'Car', kind: 'vehicle', growthBps: 0, returnBps: 0, stages: [stage('Deposit', 4_000_000, '2027-06-30')] });
  await saveEarmark(database, ws, { goalId: ef, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrah, accountId: jenius.id, amountMinor: 7_500_000 });
  await saveEarmark(database, ws, { goalId: car, accountId: bca.id, amountMinor: 4_000_000 });
  await saveEarmark(database, ws, { goalId: umrah, accountId: mandiri.id, amountMinor: 2_000_000 });
  return { database, ws, money: [jenius, bca, mandiri], gold, electronics, goalIds: [ef, umrah, car] };
}

type Item =
  | { kind: 'transaction'; root: number; transactionId: string; lines: () => { accountId: string; amountMinor: number; currency: string }[] }
  | { kind: 'trade'; root: number; transactionId: string; tradeId: string; input: Parameters<typeof recordTrade>[2] };

const promisesOf = async (w: World) => {
  const out: Record<string, number> = {};
  for (const row of await listEarmarks(w.database, w.ws)) out[`${row.goalId}@${row.accountId}`] = row.amountMinor;
  return out;
};
const drawsOf = async (w: World) =>
  (await w.database.db.select().from(goalsSchema.goalDraws).where(eq(goalsSchema.goalDraws.workspaceId, w.ws.workspaceId)))
    .map((draw) => `${draw.goalId}|${draw.accountId}|${draw.intent}|${draw.amountMinor}|${draw.toAccountId}|${draw.toAmountMinor}`)
    .sort();

/** Per money account: the balance the shortfall is measured against, and the shortfall (only active goals promise). */
async function shortfalls(w: World) {
  const balances = await nativeBalances(w.database, w.ws);
  const active = new Set((await listGoals(w.database, w.ws)).map((goal) => goal.id));
  const earmarks = await listEarmarks(w.database, w.ws);
  const out: Record<string, { held: number; short: number; overdrawn: number }> = {};
  for (const account of [...w.money, w.gold]) {
    const promised = earmarks.filter((row) => row.accountId === account.id && active.has(row.goalId)).reduce((sum, row) => sum + row.amountMinor, 0);
    const held = Math.max(0, balances[account.id] ?? 0);
    out[account.id] = { held, short: Math.max(0, promised - held), overdrawn: Math.max(0, -(balances[account.id] ?? 0)) };
  }
  return out;
}

async function answerFor(w: World, fromId: string, outflow: number, own: string | null, offers: readonly ('borrow' | 'spend' | 'move')[], rand: () => number, toId?: string): Promise<SetAsideChoice | null> {
  const view = await setAsideView(w.database, w.ws, fromId);
  if (!view) return null;
  const check = checkOutflow(view, outflow, own);
  if (check.kind !== 'ask') return null;
  const goal = check.goals[Math.floor(rand() * check.goals.length)]!;
  const intent = offers[Math.floor(rand() * offers.length)]!;
  return { accountId: fromId, goalId: goal.goalId, intent, overMinor: check.overMinor, ...(intent === 'move' ? { toAccountId: toId } : {}), ...(intent === 'borrow' ? { wasWhole: false } : {}) };
}

async function trace(w: World, label: string) {
  const names = new Map<string, string>([...w.money, w.gold].map((a) => [a.id, a.name]));
  w.goalIds.forEach((id, i) => names.set(id, ['EF', 'Umrah', 'Car'][i]!));
  const name = (id: string | null) => (id ? (names.get(id) ?? id.slice(-4)) : '-');
  const balances = await nativeBalances(w.database, w.ws);
  const draws = await w.database.db.select().from(goalsSchema.goalDraws);
  console.log(
    label,
    '\n  promises',
    (await listEarmarks(w.database, w.ws)).map((r) => `${name(r.goalId)}@${name(r.accountId)}=${r.amountMinor}`).join(' '),
    '\n  balances',
    w.money.map((a) => `${a.name}=${balances[a.id]}`).join(' '),
    '\n  draws',
    draws.map((d) => `${d.transactionId.slice(-4)}:${name(d.goalId)} ${d.intent} ${name(d.accountId)}->${name(d.toAccountId)} ${d.amountMinor}/${d.toAmountMinor}`).join(' | '),
  );
}

async function linesOf(w: World, transactionId: string) {
  return w.database.db.select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency }).from(entries).where(eq(entries.transactionId, transactionId));
}

async function run(seed: number, anyOrder: boolean) {
  const rand = mulberry32(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
  const amount = (max: number) => (1 + Math.floor(rand() * Math.max(1, max / 100_000))) * 100_000;
  const w = await world();
  const start = await promisesOf(w);
  const live: Item[] = [];
  let posted = 0;
  const steps = 8 + Math.floor(rand() * 10);
  const log: string[] = [];

  for (let step = 0; step < steps; step++) {
    const before = await shortfalls(w);
    const balances = await nativeBalances(w.database, w.ws);
    const roll = rand();
    const from = pick(w.money);
    const room = Math.max(100_000, balances[from.id] ?? 0);
    let action = '';

    if (live.length > 0 && roll < 0.2) {
      // A note-only edit: invariant (3).
      const item = pick(live);
      const promises = await promisesOf(w);
      const draws = await drawsOf(w);
      const held = await nativeBalances(w.database, w.ws);
      if (item.kind === 'trade') {
        const result = await replaceTrade(w.database, w.ws, item.tradeId, item.input);
        item.tradeId = result.tradeId;
        item.transactionId = result.transactionId!;
        action = `note-edit trade`;
      } else {
        const lines = await linesOf(w, item.transactionId);
        // Half the time the way a desktop re-file carries it, half the way an edit form gives the saved answer back.
        const explicit = rand() < 0.5 ? await setAsideChoiceOf(w.database, w.ws, item.transactionId) : undefined;
        item.transactionId = await replaceTransaction(w.database, w.ws, item.transactionId, { occurredOn: DAY, description: 'Edited note', lines, ...(explicit ? { setAside: explicit } : {}) });
        action = `note-edit ${explicit ? 'explicit' : 'carried'}`;
      }
      expect({ seed, step, action, promises: await promisesOf(w) }).toEqual({ seed, step, action, promises });
      expect({ seed, step, action, draws: await drawsOf(w) }).toEqual({ seed, step, action, draws });
      expect(await nativeBalances(w.database, w.ws)).toEqual(held);
    } else if (live.length > 0 && roll < 0.35) {
      // An amount edit, the answer carried.
      const item = pick(live);
      if (item.kind === 'trade') {
        item.input = { ...item.input, grossMinor: anyOrder ? amount(8_000_000) : amount(item.input.grossMinor) };
        const result = await replaceTrade(w.database, w.ws, item.tradeId, item.input);
        item.tradeId = result.tradeId;
        item.transactionId = result.transactionId!;
        action = `amount-edit trade ${item.input.grossMinor}`;
      } else {
        const lines = await linesOf(w, item.transactionId);
        const out = lines.find((line) => line.amountMinor < 0)!;
        const next = anyOrder ? amount(Math.max(-out.amountMinor * 2, 1_000_000)) : amount(-out.amountMinor);
        const scaled = lines.map((line) => ({ ...line, amountMinor: line.amountMinor < 0 ? -next : next }));
        item.transactionId = await replaceTransaction(w.database, w.ws, item.transactionId, { occurredOn: DAY, description: 'Edited amount', lines: scaled });
        action = `amount-edit ${next}`;
      }
    } else if (live.length > 0 && roll < 0.5) {
      // Newest first, as undo is; the any-order runs delete whichever.
      const index = anyOrder ? Math.floor(rand() * live.length) : live.reduce((best, item, at) => (item.root > live[best]!.root ? at : best), 0);
      const [item] = live.splice(index, 1);
      if (item!.kind === 'trade') await deleteTrade(w.database, w.ws, item!.tradeId);
      else await voidTransaction(w.database, w.ws, item!.transactionId);
      action = `void ${item!.kind}`;
    } else if (roll < 0.62) {
      // A transfer tagged to a goal, borrowing what goes beyond its own money and what is free.
      const to = pick(w.money.filter((account) => account.id !== from.id));
      const goalId = pick(w.goalIds);
      const value = amount(room);
      const setAside = await answerFor(w, from.id, value, goalId, ['borrow'], rand);
      const { transactionId } = await recordTaggedTransfer(w.database, w.ws, { occurredOn: DAY, description: 'Tagged', amountMinor: value, fromAccountId: from.id, toAccountId: to.id, goalId, setAside });
      live.push({ kind: 'transaction', root: posted++, transactionId, lines: () => [] });
      action = `tagged ${value}`;
    } else if (roll < 0.76) {
      // A plain transfer: "Move the promise" (or, now and then, a borrow).
      const to = pick(w.money.filter((account) => account.id !== from.id));
      const value = amount(room);
      const setAside = await answerFor(w, from.id, value, null, ['move', 'move', 'move', 'borrow'], rand, to.id);
      const transactionId = await postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'Transfer', lines: transferLines({ fromAccountId: from.id, toAccountId: to.id, amountMinor: value, currency: 'IDR' }), setAside });
      live.push({ kind: 'transaction', root: posted++, transactionId, lines: () => [] });
      action = `transfer ${value} ${setAside?.intent ?? '-'}`;
    } else if (roll < 0.9) {
      // A spend: "Yes — this is what I saved for" (or, now and then, a borrow).
      const value = amount(room);
      const setAside = await answerFor(w, from.id, value, null, ['spend', 'spend', 'borrow'], rand);
      const transactionId = await postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: w.electronics.id, paymentAccountId: from.id, amountMinor: value, currency: 'IDR' }), setAside });
      live.push({ kind: 'transaction', root: posted++, transactionId, lines: () => [] });
      action = `expense ${value} ${setAside?.intent ?? '-'}`;
    } else {
      // A buy tagged to a goal, paid from a money account.
      const goalId = pick(w.goalIds);
      const value = amount(Math.min(room, 8_000_000));
      const setAside = await answerFor(w, from.id, value, goalId, ['borrow'], rand);
      const input = { accountId: w.gold.id, kind: 'buy' as const, occurredOn: DAY, unitsMicro: 1_000_000, grossMinor: value, feeMinor: 0, taxMinor: 0, cashAccountId: from.id, goalId, ...(setAside ? { setAside } : {}) };
      const result = await recordTrade(w.database, w.ws, input);
      const { setAside: _answer, ...carried } = input;
      live.push({ kind: 'trade', root: posted++, transactionId: result.transactionId!, tradeId: result.tradeId, input: carried });
      action = `buy ${value}`;
    }
    log.push(action);
    if (process.env.SEQ_DEBUG === String(seed)) await trace(w, `${step} ${action}`);

    // (1) never below nought; a shortfall grows only by money that left the account.
    const promises = await promisesOf(w);
    for (const [key, value] of Object.entries(promises)) expect({ seed, step, key, positive: value > 0 }).toEqual({ seed, step, key, positive: true });
    const after = await shortfalls(w);
    for (const [accountId, now] of Object.entries(after)) {
      const was = before[accountId]!;
      // An overdrawn account's first arrivals fill the hole: a transfer parked in full on it reads short by that much.
      const allowed = was.short + Math.max(0, was.held - now.held) + was.overdrawn;
      expect({ seed, trail: log.join(' ; '), accountId, short: now.short <= allowed ? 'within' : `short ${now.short} > ${allowed}` }).toEqual({ seed, trail: log.join(' ; '), accountId, short: 'within' });
    }
  }

  // (2) void everything, newest first.
  for (const item of [...live].sort((a, b) => b.root - a.root)) {
    if (item.kind === 'trade') await deleteTrade(w.database, w.ws, item.tradeId);
    else await voidTransaction(w.database, w.ws, item.transactionId);
    if (process.env.SEQ_DEBUG === String(seed)) await trace(w, `void-all ${item.kind} root ${item.root}`);
  }
  expect(await drawsOf(w)).toEqual([]);
  const end = await promisesOf(w);
  if (!anyOrder) {
    expect({ seed, trail: log.join(' ; '), promises: end }).toEqual({ seed, trail: log.join(' ; '), promises: start });
    return;
  }
  // Deleted in any order, an undo cannot know where a spent promise first came from, so it can split a goal's promise
  // differently across accounts — but never give a goal more than it started with.
  const total = (promises: Record<string, number>, goalId: string) =>
    Object.entries(promises).filter(([key]) => key.startsWith(`${goalId}@`)).reduce((sum, [, value]) => sum + value, 0);
  for (const goalId of w.goalIds) expect({ seed, trail: log.join(' ; '), goalId, over: total(end, goalId) > total(start, goalId) }).toEqual({ seed, trail: log.join(' ; '), goalId, over: false });
}

describe('random sequences of post, edit and void keep every promise honest', () => {
  it.each(Array.from({ length: 120 }, (_, index) => index + 1))('seed %i, deletes newest first', async (seed) => {
    await run(seed, false);
  });
  it.each(Array.from({ length: 60 }, (_, index) => index + 1001))('seed %i, deletes in any order', async (seed) => {
    await run(seed, true);
  });
});
