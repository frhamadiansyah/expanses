/*
 * The combination walk (Task 14, step 1): every door, on every state an account can be in, with every answer the door
 * offers, in rupiah and in dollars. Each row posts through the door's own repository function and asserts figures:
 * the check the screen would make, the draw, every promise on both accounts, what the goal counts, and balances equal to
 * a twin world posted with no answer (a promise is never a balance, spec §8.1).
 *
 * Jenius holds Rp 42.500.000 and promises the Emergency fund (kind emergency, ranked first) Rp 30.000.000 and Umrah
 * (one stage) Rp 7.500.000: Rp 5.000.000 free. Wise holds US$500,03 and promises Education US$100,03: US$400,00 free.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { checkOutflow, exchangeLines, expenseLines, movedAmount, type SetAsideCheck, transferLines } from '@expanses/core';
import {
  type AccountRow,
  categoryIdsByKeyTx,
  createAccount,
  deleteTrade,
  createCardAccount,
  type Database,
  goalLinksFor,
  goalPlansFor,
  goalsSchema,
  listDraws,
  listEarmarks,
  nativeBalances,
  postTransaction,
  recordBillPayments,
  recordLoanPayment,
  recordTaggedTransfer,
  recordTrade,
  removeEarmark,
  replaceTrade,
  replaceTransaction,
  saveAssetProfile,
  saveEarmark,
  saveExpenseTemplate,
  saveGoal,
  saveLoanTerms,
  type SetAsideChoice,
  type SetAsideIntent,
  setAsideView,
  systemAccountId,
  voidTaggedTransfer,
  voidTransaction,
  type WorkspaceContext,
} from '../src/index';
import { entries } from '../src/schema';
import { setupDb } from './helpers';

const DAY = '2026-09-19';

interface World {
  database: Database;
  ws: WorkspaceContext;
  jenius: AccountRow;
  bca: AccountRow;
  wise: AccountRow;
  ibkr: AccountRow;
  card: AccountRow;
  gold: AccountRow;
  kpr: AccountRow;
  electronics: AccountRow;
  efId: string;
  umrahId: string;
  eduId: string;
}

async function world(): Promise<World> {
  const { database, ws } = await setupDb();
  const account = (name: string, subtype: AccountRow['subtype'], currency: string, openingBalanceMinor = 0, openingRateToBase?: number) =>
    createAccount(database, ws, { name, kind: 'asset', subtype, currency, ...(openingBalanceMinor ? { openingBalanceMinor, openedOn: '2026-01-01' } : {}), ...(openingRateToBase ? { openingRateToBase } : {}) });
  const jenius = await account('Jenius', 'savings', 'IDR', 42_500_000);
  const bca = await account('BCA', 'bank', 'IDR', 1_000_000);
  const wise = await account('Wise USD', 'bank', 'USD', 50_003, 16_000);
  const ibkr = await account('IBKR cash', 'bank', 'USD');
  const card = await createCardAccount(database, ws, { name: 'BCA Visa', subtype: 'credit_card', currency: 'IDR' });
  const gold = await account('Antam', 'investment', 'IDR');
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  const kpr = await createAccount(database, ws, { name: 'KPR', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  await saveLoanTerms(database, ws, { accountId: kpr.id, lenderName: 'BTN', originalMinor: 700_000_000, firstPaymentOn: '2026-01-25', tenorMonths: 180, method: 'annuity', paymentDay: 25, rateBps: 900 });
  const electronics = await createAccount(database, ws, { name: 'Electronics', kind: 'expense', subtype: 'category', currency: null });
  const oneStage = (name: string, kind: 'emergency' | 'umrah' | 'education', targetMinor: number) =>
    saveGoal(database, ws, { name, kind, growthBps: 0, returnBps: 0, stages: [{ name, targetMinor, targetMonths: null, dueOn: '2027-12-31' }] });
  const efId = await oneStage('Emergency fund', 'emergency', 30_000_000);
  const umrahId = await oneStage('Umrah 2027', 'umrah', 7_500_000);
  const eduId = await oneStage('Education', 'education', 1_600_480);
  await saveEarmark(database, ws, { goalId: efId, accountId: jenius.id, amountMinor: 30_000_000 });
  await saveEarmark(database, ws, { goalId: umrahId, accountId: jenius.id, amountMinor: 7_500_000 });
  await saveEarmark(database, ws, { goalId: eduId, accountId: wise.id, amountMinor: 10_003 });
  return { database, ws, jenius, bca, wise, ibkr, card, gold, kpr, electronics, efId, umrahId, eduId };
}

type Kind = 'spending' | 'moving' | 'own';

interface Door {
  name: string;
  kind: Kind;
  /** The account the money leaves. */
  from: (w: World) => AccountRow;
  /** A move's destination, and its name. */
  to?: (w: World) => AccountRow;
  toName?: 'BCA' | 'Wise USD';
  /** Posts `amount` (in the paying account's money) through the door's own repository function. */
  post: (w: World, amount: number, setAside: SetAsideChoice | null) => Promise<string | null>;
}

/** Rp 20.000.000 lands US$1.234,65; any other figure lands at the same rate, floored. */
const landedOnWise = (amount: number) => (amount === 20_000_000 ? 123_465 : Math.floor((amount * 123_465) / 20_000_000));
const expense = (w: World, from: AccountRow, amount: number, currency: string, setAside: SetAsideChoice | null) =>
  postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'Laptop', lines: expenseLines({ categoryAccountId: w.electronics.id, paymentAccountId: from.id, amountMinor: amount, currency }), ...(currency === 'USD' ? { ratesToBase: { USD: 16_000 } } : {}), setAside });

const IDR_DOORS: Door[] = [
  { name: 'expense', kind: 'spending', from: (w) => w.jenius, post: (w, amount, setAside) => expense(w, w.jenius, amount, 'IDR', setAside) },
  {
    name: 'transfer to BCA',
    kind: 'moving',
    from: (w) => w.jenius,
    to: (w) => w.bca,
    toName: 'BCA',
    post: (w, amount, setAside) => postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'To BCA', lines: transferLines({ fromAccountId: w.jenius.id, toAccountId: w.bca.id, amountMinor: amount, currency: 'IDR' }), setAside }),
  },
  {
    name: 'transfer to Wise, across currencies',
    kind: 'moving',
    from: (w) => w.jenius,
    to: (w) => w.wise,
    toName: 'Wise USD',
    post: async (w, amount, setAside) =>
      postTransaction(w.database, w.ws, {
        occurredOn: DAY,
        description: 'To Wise',
        lines: exchangeLines({
          fromAccountId: w.jenius.id,
          fromAmountMinor: amount,
          fromCurrency: 'IDR',
          toAccountId: w.wise.id,
          toAmountMinor: landedOnWise(amount),
          toCurrency: 'USD',
          exchangeAccountId: await systemAccountId(w.database.db, w.ws, 'currency_exchange'),
        }),
        ratesToBase: { USD: 16_200 },
        setAside,
      }),
  },
  {
    name: 'transfer to a card',
    kind: 'spending',
    from: (w) => w.jenius,
    post: (w, amount, setAside) => postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'Pay card', lines: transferLines({ fromAccountId: w.jenius.id, toAccountId: w.card.id, amountMinor: amount, currency: 'IDR' }), setAside }),
  },
  {
    name: 'tagged transfer for Umrah',
    kind: 'own',
    from: (w) => w.jenius,
    post: async (w, amount, setAside) =>
      (await recordTaggedTransfer(w.database, w.ws, { occurredOn: DAY, description: 'For Umrah', amountMinor: amount, fromAccountId: w.jenius.id, toAccountId: w.bca.id, goalId: w.umrahId, ...(setAside ? { setAside } : {}) })).transactionId,
  },
  {
    name: 'tagged buy for Umrah',
    kind: 'own',
    from: (w) => w.jenius,
    post: async (w, amount, setAside) =>
      (await recordTrade(w.database, w.ws, { accountId: w.gold.id, kind: 'buy', occurredOn: DAY, unitsMicro: 4_000_000, grossMinor: amount, feeMinor: 0, taxMinor: 0, cashAccountId: w.jenius.id, goalId: w.umrahId, setAside })).transactionId,
  },
  {
    name: 'untagged buy',
    kind: 'spending',
    from: (w) => w.jenius,
    post: async (w, amount, setAside) =>
      (await recordTrade(w.database, w.ws, { accountId: w.gold.id, kind: 'buy', occurredOn: DAY, unitsMicro: 4_000_000, grossMinor: amount, feeMinor: 0, taxMinor: 0, cashAccountId: w.jenius.id, goalId: null, setAside })).transactionId,
  },
  {
    name: 'bill',
    kind: 'spending',
    from: (w) => w.jenius,
    post: async (w, amount, setAside) => {
      const keys = await categoryIdsByKeyTx(w.database.db, w.ws);
      const bill = await saveExpenseTemplate(w.database, w.ws, { name: 'Rent', categoryAccountId: keys['household.groceries']!, moneyAccountId: w.jenius.id, amountMinor: amount, dayOfMonth: 1, startsMonth: '2026-09' });
      return (await recordBillPayments(w.database, w.ws, { paidOn: DAY, payments: [{ templateId: bill, billMonth: '2026-09', amountMinor: amount, setAside }] }))[0]!;
    },
  },
  {
    name: 'loan instalment',
    kind: 'spending',
    from: (w) => w.jenius,
    // A fifth of it interest, the rest principal: what leaves Jenius is the whole instalment.
    post: async (w, amount, setAside) => {
      const interestMinor = Math.floor(amount / 5);
      return (await recordLoanPayment(w.database, w.ws, { accountId: w.kpr.id, occurredOn: DAY, moneyAccountId: w.jenius.id, principalMinor: amount - interestMinor, interestMinor, setAside })).transactionId;
    },
  },
];

const OFFERS: Record<Kind, readonly SetAsideIntent[]> = { spending: ['borrow', 'spend'], moving: ['move', 'borrow'], own: ['borrow'] };

type State = 'nothing promised' | 'within free' | 'one rupiah over' | 'well over' | 'already short';
const STATES: State[] = ['nothing promised', 'within free', 'one rupiah over', 'well over', 'already short'];
const OUTFLOW: Record<State, number> = { 'nothing promised': 6_800_000, 'within free': 5_000_000, 'one rupiah over': 5_000_001, 'well over': 20_000_000, 'already short': 1_000_000 };

/** Puts Jenius in the state. Already short: a silent Rp 21.500.000 import-style posting, answered by nobody. */
async function enter(w: World, state: State) {
  if (state === 'nothing promised') {
    await removeEarmark(w.database, w.ws, w.efId, w.jenius.id);
    await removeEarmark(w.database, w.ws, w.umrahId, w.jenius.id);
  }
  if (state === 'already short') {
    await postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'Imported', source: 'csv', lines: expenseLines({ categoryAccountId: w.electronics.id, paymentAccountId: w.jenius.id, amountMinor: 21_500_000, currency: 'IDR' }) });
  }
}

async function checkOf(w: World, from: AccountRow, outflow: number, own: string | null): Promise<SetAsideCheck> {
  const view = await setAsideView(w.database, w.ws, from.id, { date: DAY });
  return view ? checkOutflow(view, outflow, own) : { kind: 'silent' };
}

const promisesOf = async (w: World) =>
  Object.fromEntries(
    (await listEarmarks(w.database, w.ws)).map((row) => [`${row.goalId === w.efId ? 'EF' : row.goalId === w.umrahId ? 'Umrah' : 'Education'}@${[w.jenius, w.bca, w.wise, w.ibkr].find((a) => a.id === row.accountId)?.name ?? '?'}`, row.amountMinor]),
  );
/** The answers an owner gave: a tagged transfer's own move (a move with no destination) is not one. */
const answerDraws = async (w: World) => (await listDraws(w.database, w.ws)).filter((draw) => draw.intent !== 'move' || draw.toAccountId !== null);
const current = async (w: World, goalId: string) => (await goalPlansFor(w.database, w.ws, DAY)).plans.find((plan) => plan.goalId === goalId)!.currentMinor;
const stagePaid = async (w: World, goalId: string) =>
  (await w.database.db.select().from(goalsSchema.goalStages).where(eq(goalsSchema.goalStages.goalId, goalId)))[0]!.paidOn;
/** Balances by account name, so a twin world's ids do not matter. */
const balancesByName = async (w: World) => {
  const balances = await nativeBalances(w.database, w.ws);
  return Object.fromEntries([w.jenius, w.bca, w.wise, w.ibkr, w.card, w.gold, w.kpr].map((a) => [a.name, balances[a.id] ?? 0]));
};

// ── Silent and already-short rows ─────────────────────────────────────────────────────────────────────────────────

const quiet = IDR_DOORS.flatMap((door) => (['nothing promised', 'within free', 'one rupiah over', 'already short'] as State[]).map((state) => [door.name, state, door] as const))
  // One rupiah over asks everywhere except where the goal's own money is room (§6.3): those rows are in `asking`.
  .filter(([, state, door]) => state !== 'one rupiah over' || door.kind === 'own');

describe('rows that never ask write no answer', () => {
  it.each(quiet)('%s, %s', async (_name, state, door) => {
    const w = await world();
    await enter(w, state);
    const own = door.kind === 'own' ? w.umrahId : null;
    const check = await checkOf(w, door.from(w), OUTFLOW[state], own);
    if (state === 'already short') {
      // Ruling A: 37.500.000 promised, 21.000.000 held — stated on the account page, never asked again.
      expect(check).toEqual({ kind: 'already-short', shortMinor: 16_500_000 });
    } else {
      // Nothing promised, within the 5.000.000 free, or — for the goal's own door — within 5.000.000 + Umrah's 7.500.000.
      expect(check).toEqual({ kind: 'silent' });
    }
    await door.post(w, OUTFLOW[state], null);
    expect(await answerDraws(w)).toEqual([]);
    // The other goal's promise is untouched by a door that asked nothing.
    if (state !== 'nothing promised') expect((await promisesOf(w))['EF@Jenius']).toBe(30_000_000);
  });
});

// ── Asking rows ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Expected {
  over: number;
  draw: { intent: SetAsideIntent; amountMinor: number; goal: 'EF' | 'Umrah'; toAmountMinor?: number | null };
  promises: Record<string, number>;
  /** What the goal counts after, in rupiah — omitted where a foreign promise needs a rate the test does not pin. */
  ef?: number;
  umrah?: number;
}

type Answer = { intent: SetAsideIntent; goal: 'EF' | 'Umrah' };

/** Every figure worked by hand from the fixture. */
function expected(door: Door, state: 'one rupiah over' | 'well over', answer: Answer): Expected {
  const outflow = OUTFLOW[state];
  const base = { 'EF@Jenius': 30_000_000, 'Umrah@Jenius': 7_500_000, 'Education@Wise USD': 10_003 };
  if (door.kind === 'own') {
    // Well over only: 20.000.000 − 5.000.000 free − Umrah's own 7.500.000 = 7.500.000 over, borrowed from the fund.
    const promises: Record<string, number> = { 'EF@Jenius': 30_000_000, 'Education@Wise USD': 10_003 };
    // A tagged transfer carries Umrah's promise to BCA and sets the whole 20.000.000 aside there; a buy spends it.
    if (door.name.startsWith('tagged transfer')) promises['Umrah@BCA'] = 20_000_000;
    return { over: 7_500_000, draw: { intent: 'borrow', amountMinor: 7_500_000, goal: 'EF' }, promises, ef: 22_500_000 };
  }
  const over = outflow - 5_000_000;
  if (answer.intent === 'borrow') {
    // A borrow is the part over the free money, and the shortfall it leaves falls on the fund it was taken from.
    return { over, draw: { intent: 'borrow', amountMinor: over, goal: 'EF' }, promises: base, ef: 30_000_000 - over, umrah: 7_500_000 };
  }
  if (answer.intent === 'spend' && answer.goal === 'EF') {
    // The whole payment, up to the promise: 30.000.000 − the payment. Only the part over would leave 30.000.000 − over.
    return { over, draw: { intent: 'spend', amountMinor: outflow, goal: 'EF' }, promises: { ...base, 'EF@Jenius': 30_000_000 - outflow }, ef: 30_000_000 - outflow, umrah: 7_500_000 };
  }
  if (answer.intent === 'spend') {
    const spent = Math.min(outflow, 7_500_000);
    const promises: Record<string, number> = { ...base };
    if (spent === 7_500_000) delete promises['Umrah@Jenius'];
    else promises['Umrah@Jenius'] = 7_500_000 - spent;
    // Well over: 22.500.000 held against the fund's 30.000.000 — 7.500.000 short, on the fund (nothing else is left).
    const ef = Math.min(30_000_000, 42_500_000 - outflow - (7_500_000 - spent));
    return { over, draw: { intent: 'spend', amountMinor: spent, goal: 'Umrah' }, promises, ef, umrah: 7_500_000 - spent };
  }
  // Move: the part over the free money, up to the promise, lands at the transfer's own rate, floored.
  const moved = Math.min(over, outflow, 30_000_000);
  const to = door.toName!;
  const landed = to === 'BCA' ? moved : movedAmount(moved, outflow, landedOnWise(outflow));
  const promises: Record<string, number> = { ...base, 'EF@Jenius': 30_000_000 - moved };
  if (landed > 0) promises[`EF@${to}`] = landed;
  return { over, draw: { intent: 'move', amountMinor: moved, goal: 'EF', toAmountMinor: landed }, promises, ...(to === 'BCA' ? { ef: 30_000_000 } : {}), umrah: 7_500_000 };
}

const asking = IDR_DOORS.flatMap((door) =>
  (['one rupiah over', 'well over'] as const)
    .filter((state) => door.kind !== 'own' || state === 'well over')
    .flatMap((state) =>
      OFFERS[door.kind].flatMap((intent) => (intent === 'spend' ? (['EF', 'Umrah'] as const) : (['EF'] as const)).map((goal) => [door.name, state, `${intent} ${goal}`, door, { intent, goal }] as const)),
    ),
);

describe('rows that ask, answered with every answer the door offers', () => {
  it.each(asking)('%s, %s, %s', async (_name, state, _label, door, answer) => {
    const w = await world();
    const want = expected(door, state, answer);
    const own = door.kind === 'own' ? w.umrahId : null;
    const goalId = answer.goal === 'EF' ? w.efId : w.umrahId;

    const check = await checkOf(w, door.from(w), OUTFLOW[state], own);
    expect(check.kind).toBe('ask');
    if (check.kind !== 'ask') return;
    expect(check.overMinor).toBe(want.over);
    // A goal's own door never offers that goal; every other door offers both, in priority order.
    expect(check.goals.map((goal) => goal.name)).toEqual(own ? ['Emergency fund'] : ['Emergency fund', 'Umrah 2027']);

    const choice: SetAsideChoice = { accountId: door.from(w).id, goalId, intent: answer.intent, overMinor: check.overMinor, toAccountId: answer.intent === 'move' ? door.to!(w).id : null };
    const id = await door.post(w, OUTFLOW[state], choice);

    expect(await answerDraws(w)).toEqual([
      expect.objectContaining({ transactionId: id, goalId, accountId: w.jenius.id, intent: want.draw.intent, amountMinor: want.draw.amountMinor, ...(want.draw.intent === 'move' ? { toAmountMinor: want.draw.toAmountMinor } : {}) }),
    ]);
    expect(await promisesOf(w)).toEqual(want.promises);
    if (want.ef !== undefined) expect(await current(w, w.efId)).toBe(want.ef);
    if (want.umrah !== undefined) expect(await current(w, w.umrahId)).toBe(want.umrah);

    // A promise is not a balance: the twin posted with no answer holds exactly the same money everywhere.
    const twin = await world();
    await door.post(twin, OUTFLOW[state], null);
    expect(await balancesByName(w)).toEqual(await balancesByName(twin));
  });
});

// ── The rules the table shows, one expect each ─────────────────────────────────────────────────────────────────────

describe('the rules the table shows', () => {
  it('spending the Emergency fund draws it down but marks no stage paid: a standing level never reads Done (Q3)', async () => {
    const w = await world();
    await IDR_DOORS[0]!.post(w, 20_000_000, { accountId: w.jenius.id, goalId: w.efId, intent: 'spend', overMinor: 15_000_000 });
    expect((await promisesOf(w))['EF@Jenius']).toBe(10_000_000);
    expect(await stagePaid(w, w.efId)).toBeNull();
    expect((await goalPlansFor(w.database, w.ws, DAY)).plans.find((plan) => plan.goalId === w.efId)!.stages.map((stage) => stage.state)).not.toContain('paid');
  });

  it('spending a one-stage goal that is not an emergency fund pays its stage, so it reads Done', async () => {
    const w = await world();
    await IDR_DOORS[0]!.post(w, 20_000_000, { accountId: w.jenius.id, goalId: w.umrahId, intent: 'spend', overMinor: 15_000_000 });
    expect(await stagePaid(w, w.umrahId)).toBe(DAY);
    expect((await goalPlansFor(w.database, w.ws, DAY)).plans.find((plan) => plan.goalId === w.umrahId)!.stages.map((stage) => stage.state)).toEqual(['paid']);
  });

  it('a card cannot take a moved promise: the door offers borrow and spend, and a move is refused', async () => {
    const w = await world();
    expect(OFFERS[IDR_DOORS.find((door) => door.name === 'transfer to a card')!.kind]).not.toContain('move');
    await expect(
      IDR_DOORS.find((door) => door.name === 'transfer to a card')!.post(w, 20_000_000, { accountId: w.jenius.id, goalId: w.efId, intent: 'move', overMinor: 15_000_000, toAccountId: w.card.id }),
    ).rejects.toThrow(/cannot hold/);
  });

  it('a tagged transfer or buy offers only borrow: taking another goal\'s money for this one is borrowing it', () => {
    for (const door of IDR_DOORS.filter((row) => row.kind === 'own')) expect(OFFERS[door.kind]).toEqual(['borrow']);
  });

  it('a move across currencies lands movedAmount(moved, out, landed): US$925,98, floored, not US$925,99', async () => {
    const w = await world();
    const door = IDR_DOORS.find((row) => row.name.startsWith('transfer to Wise'))!;
    await door.post(w, 20_000_000, { accountId: w.jenius.id, goalId: w.efId, intent: 'move', overMinor: 15_000_000, toAccountId: w.wise.id });
    // 15.000.000 × 123.465 ÷ 20.000.000 = 92.598,75 cents.
    expect((await promisesOf(w))['EF@Wise USD']).toBe(92_598);
    const link = (await goalLinksFor(w.database, w.ws, DAY)).find((row) => row.goalId === w.efId && row.accountId === w.wise.id)!;
    expect(link).toMatchObject({ currency: 'USD', promisedMinor: 92_598, shortMinor: 0 });
  });
});

// ── The dollar account ───────────────────────────────────────────────────────────────────────────────────────────

describe('the dollar account: its figures are cents on it, and no rupiah figure moves', () => {
  const usdDoors: [string, (w: World, setAside: SetAsideChoice | null) => Promise<string>, SetAsideIntent[]][] = [
    ['expense in dollars', (w, setAside) => expense(w, w.wise, 40_001, 'USD', setAside), ['borrow', 'spend']],
    [
      'transfer to IBKR in dollars',
      (w, setAside) => postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'To IBKR', lines: transferLines({ fromAccountId: w.wise.id, toAccountId: w.ibkr.id, amountMinor: 40_001, currency: 'USD' }), ratesToBase: { USD: 16_000 }, setAside }),
      ['move', 'borrow'],
    ],
  ];
  const rows = usdDoors.flatMap(([name, post, intents]) => intents.map((intent) => [name, intent, post] as const));

  it.each(rows)('%s, %s', async (_name, intent, post) => {
    const w = await world();
    const check = await checkOf(w, w.wise, 40_001, null);
    // US$400,01 out with US$400,00 free: one cent over, in cents.
    expect(check).toMatchObject({ kind: 'ask', overMinor: 1, freeMinor: 40_000 });
    const choice: SetAsideChoice = { accountId: w.wise.id, goalId: w.eduId, intent, overMinor: 1, toAccountId: intent === 'move' ? w.ibkr.id : null };
    await post(w, choice);

    const [draw] = await answerDraws(w);
    const promises = await promisesOf(w);
    if (intent === 'borrow') {
      expect(draw).toMatchObject({ intent: 'borrow', amountMinor: 1 });
      expect(promises['Education@Wise USD']).toBe(10_003);
    } else if (intent === 'spend') {
      // The whole payment up to the promise: US$100,03, not the one cent over.
      expect(draw).toMatchObject({ intent: 'spend', amountMinor: 10_003 });
      expect(promises['Education@Wise USD']).toBeUndefined();
      expect(await stagePaid(w, w.eduId)).toBe(DAY);
    } else {
      expect(draw).toMatchObject({ intent: 'move', amountMinor: 1, toAmountMinor: 1 });
      expect(promises['Education@Wise USD']).toBe(10_002);
      expect(promises['Education@IBKR cash']).toBe(1);
    }
    // No rupiah figure moved: the Jenius promises and balance are the fixture's.
    expect(promises['EF@Jenius']).toBe(30_000_000);
    expect(promises['Umrah@Jenius']).toBe(7_500_000);
    expect((await balancesByName(w)).Jenius).toBe(42_500_000);
    const twin = await world();
    await post(twin, null);
    expect(await balancesByName(w)).toEqual(await balancesByName(twin));
  });
});

// ── Post, edit, void — through each door's own edit and delete ─────────────────────────────────────────────────────

/**
 * Every door, posted with the answer that changes promises (a spend, a move, or — for a goal's own door — a borrow beside
 * its own move), then edited through its own edit path without mentioning the answer, then deleted. The edit carries the
 * answer and leaves every promise where the post left it; the delete puts every promise back where the fixture had it.
 */
const FIXTURE = { 'EF@Jenius': 30_000_000, 'Umrah@Jenius': 7_500_000, 'Education@Wise USD': 10_003 };

/** A plain transaction edited through replaceTransaction: its own lines again, a new note, no answer mentioned. */
async function refileTransaction(w: World, id: string): Promise<string> {
  const rows = await w.database.db.select({ accountId: entries.accountId, amountMinor: entries.amountMinor, currency: entries.currency }).from(entries).where(eq(entries.transactionId, id));
  return replaceTransaction(w.database, w.ws, id, { occurredOn: DAY, description: 'Edited', lines: rows, ratesToBase: { USD: 16_200 } });
}

interface Handle {
  transactionId: string;
  tradeId?: string;
}

interface Walk {
  name: string;
  answer: (w: World) => SetAsideChoice;
  post: (w: World, setAside: SetAsideChoice) => Promise<Handle>;
  edit: (w: World, handle: Handle) => Promise<Handle>;
  remove: (w: World, handle: Handle) => Promise<void>;
  /** Every promise after the post (and after the edit, which carries the answer). */
  after: Record<string, number>;
  /** A goal's stage paid by the answer: paid after the post and the edit, unpaid after the delete. */
  paysStage?: 'Umrah' | 'Education';
  /** Where the delete does not give a promise back (queued, out of scope): the promise it leaves. */
  leftAfterDelete?: Record<string, number>;
}

const byTransaction = (door: Door) => async (w: World, setAside: SetAsideChoice) => ({ transactionId: (await door.post(w, 20_000_000, setAside))! });
const door = (name: string) => IDR_DOORS.find((row) => row.name === name)!;
const spendUmrah = (w: World): SetAsideChoice => ({ accountId: w.jenius.id, goalId: w.umrahId, intent: 'spend', overMinor: 15_000_000 });
const moveEf = (to: 'bca' | 'wise') => (w: World): SetAsideChoice => ({ accountId: w.jenius.id, goalId: w.efId, intent: 'move', overMinor: 15_000_000, toAccountId: w[to].id });
const borrowEf = (w: World): SetAsideChoice => ({ accountId: w.jenius.id, goalId: w.efId, intent: 'borrow', overMinor: 7_500_000 });
const plainEdit = async (w: World, handle: Handle) => ({ transactionId: await refileTransaction(w, handle.transactionId) });
const plainVoid = (w: World, handle: Handle) => voidTransaction(w.database, w.ws, handle.transactionId);
const umrahSpent = { 'EF@Jenius': 30_000_000, 'Education@Wise USD': 10_003 };
const buyOf = (w: World, grossMinor: number, goalId: string | null, setAside?: SetAsideChoice | null) => ({
  accountId: w.gold.id, kind: 'buy' as const, occurredOn: DAY, unitsMicro: 4_000_000, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: w.jenius.id, goalId, ...(setAside === undefined ? {} : { setAside }),
});

const WALKS: Walk[] = [
  { name: 'expense, spent from Umrah', answer: spendUmrah, post: byTransaction(door('expense')), edit: plainEdit, remove: plainVoid, after: umrahSpent, paysStage: 'Umrah' },
  { name: 'transfer to BCA, promise moved', answer: moveEf('bca'), post: byTransaction(door('transfer to BCA')), edit: plainEdit, remove: plainVoid, after: { ...FIXTURE, 'EF@Jenius': 15_000_000, 'EF@BCA': 15_000_000 } },
  { name: 'transfer to Wise, promise moved across currencies', answer: moveEf('wise'), post: byTransaction(door('transfer to Wise, across currencies')), edit: plainEdit, remove: plainVoid, after: { ...FIXTURE, 'EF@Jenius': 15_000_000, 'EF@Wise USD': 92_598 } },
  { name: 'transfer to a card, spent from Umrah', answer: spendUmrah, post: byTransaction(door('transfer to a card')), edit: plainEdit, remove: plainVoid, after: umrahSpent, paysStage: 'Umrah' },
  {
    name: 'tagged transfer for Umrah, borrowing the rest from the fund',
    answer: borrowEf,
    post: byTransaction(door('tagged transfer for Umrah')),
    edit: plainEdit,
    remove: (w, handle) => voidTaggedTransfer(w.database, w.ws, handle.transactionId),
    // Umrah's own 7.500.000 followed its money to BCA, and the whole 20.000.000 is set aside there.
    after: { 'EF@Jenius': 30_000_000, 'Umrah@BCA': 20_000_000, 'Education@Wise USD': 10_003 },
  },
  {
    name: 'tagged buy for Umrah, borrowing the rest from the fund',
    answer: borrowEf,
    post: async (w, setAside) => {
      const result = await recordTrade(w.database, w.ws, buyOf(w, 20_000_000, w.umrahId, setAside));
      return { transactionId: result.transactionId!, tradeId: result.tradeId };
    },
    edit: async (w, handle) => {
      const result = await replaceTrade(w.database, w.ws, handle.tradeId!, buyOf(w, 20_000_000, w.umrahId));
      return { transactionId: result.transactionId!, tradeId: result.tradeId };
    },
    remove: async (w, handle) => void (await deleteTrade(w.database, w.ws, handle.tradeId!)),
    after: { 'EF@Jenius': 30_000_000, 'Education@Wise USD': 10_003 },
    // Pre-existing and queued (ledger, "not resolved here"): a deleted tagged buy does not give the goal its cash promise back.
    leftAfterDelete: { 'EF@Jenius': 30_000_000, 'Education@Wise USD': 10_003 },
  },
  {
    name: 'untagged buy, spent from Umrah',
    answer: spendUmrah,
    post: async (w, setAside) => {
      const result = await recordTrade(w.database, w.ws, buyOf(w, 20_000_000, null, setAside));
      return { transactionId: result.transactionId!, tradeId: result.tradeId };
    },
    edit: async (w, handle) => {
      const result = await replaceTrade(w.database, w.ws, handle.tradeId!, buyOf(w, 20_000_000, null));
      return { transactionId: result.transactionId!, tradeId: result.tradeId };
    },
    remove: async (w, handle) => void (await deleteTrade(w.database, w.ws, handle.tradeId!)),
    after: umrahSpent,
    paysStage: 'Umrah',
  },
  { name: 'bill, spent from Umrah', answer: spendUmrah, post: byTransaction(door('bill')), edit: plainEdit, remove: plainVoid, after: umrahSpent, paysStage: 'Umrah' },
  { name: 'loan instalment, spent from Umrah', answer: spendUmrah, post: byTransaction(door('loan instalment')), edit: plainEdit, remove: plainVoid, after: umrahSpent, paysStage: 'Umrah' },
  {
    name: 'expense in dollars, spent from Education',
    answer: (w) => ({ accountId: w.wise.id, goalId: w.eduId, intent: 'spend', overMinor: 1 }),
    post: async (w, setAside) => ({ transactionId: await expense(w, w.wise, 40_001, 'USD', setAside) }),
    edit: plainEdit,
    remove: plainVoid,
    after: { 'EF@Jenius': 30_000_000, 'Umrah@Jenius': 7_500_000 },
    paysStage: 'Education',
  },
  {
    name: 'transfer to IBKR in dollars, promise moved',
    answer: (w) => ({ accountId: w.wise.id, goalId: w.eduId, intent: 'move', overMinor: 1, toAccountId: w.ibkr.id }),
    post: async (w, setAside) => ({
      transactionId: await postTransaction(w.database, w.ws, { occurredOn: DAY, description: 'To IBKR', lines: transferLines({ fromAccountId: w.wise.id, toAccountId: w.ibkr.id, amountMinor: 40_001, currency: 'USD' }), ratesToBase: { USD: 16_000 }, setAside }),
    }),
    edit: plainEdit,
    remove: plainVoid,
    after: { ...FIXTURE, 'Education@Wise USD': 10_002, 'Education@IBKR cash': 1 },
  },
];

describe('post, edit and void through each door', () => {
  it.each(WALKS.map((walk) => [walk.name, walk] as const))('%s', async (_name, walk) => {
    const w = await world();
    const goalOf = (name: 'Umrah' | 'Education') => (name === 'Umrah' ? w.umrahId : w.eduId);

    const posted = await walk.post(w, walk.answer(w));
    expect(await promisesOf(w)).toEqual(walk.after);
    const [draw] = await answerDraws(w);
    expect(draw).toMatchObject({ transactionId: posted.transactionId, intent: walk.answer(w).intent });
    if (walk.paysStage) expect(await stagePaid(w, goalOf(walk.paysStage))).toBe(DAY);

    const edited = await walk.edit(w, posted);
    expect(edited.transactionId).not.toBe(posted.transactionId);
    // Carried: the same promises, the same stage, one answer — now on the edited transaction.
    expect(await promisesOf(w)).toEqual(walk.after);
    expect(await answerDraws(w)).toEqual([expect.objectContaining({ transactionId: edited.transactionId, intent: draw!.intent, amountMinor: draw!.amountMinor })]);
    if (walk.paysStage) expect(await stagePaid(w, goalOf(walk.paysStage))).toBe(DAY);

    await walk.remove(w, edited);
    expect(await promisesOf(w)).toEqual(walk.leftAfterDelete ?? FIXTURE);
    expect(await answerDraws(w)).toEqual([]);
    if (walk.paysStage) expect(await stagePaid(w, goalOf(walk.paysStage))).toBeNull();
  });
});
