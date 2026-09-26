import { findEntry } from '@expanses/catalog';
import { assetItem, expenseLines, incomeLines, statementCycleFor, transferLines } from '@expanses/core';
import {
  addCard,
  addHolding,
  applyCatalogEntry,
  billOnNextStatement,
  captureDrafts,
  cardStatement,
  createAccount,
  createCardAccount,
  createDraft,
  type Database,
  databaseVersion,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  listAccounts,
  listCards,
  listCategorySets,
  listSetCategories,
  openCashAccount,
  openDebtBalance,
  openPocketedAccount,
  payCardPurchases,
  postTransaction,
  recordLoan,
  recordLoanPayment,
  recordRepayment,
  recordTaggedTransfer,
  recordTrade,
  recordValuation,
  saveAssetProfile,
  saveBudget,
  saveCardTerms,
  saveEvent,
  saveEventItem,
  saveExpectedIncome,
  saveExpenseTemplate,
  saveGoal,
  saveInstallment,
  saveLoanTerms,
  saveMerchantMcc,
  setLoanItem,
  splitBill,
  tagTransaction,
  upsertPrice,
  upsertRate,
  upsertSecurityPrice,
  type WorkspaceContext,
} from '../../src/index';

/**
 * A believable household to click around in: three months of a salaried life in Jakarta, paid by bank,
 * e-wallet and three credit cards (one with a supplementary card), with bills, budgets, a holiday, goals,
 * holdings, money lent, captures waiting to be recorded, and a card statement with a late posting and an
 * early payment. Every name here is made up.
 *
 * It owns one of every kind the pickers offer a drawing for — each of the seven money accounts, something in
 * each of the five asset families, and each kind of debt — so every screen and every row's tile has something
 * to show. What it owns outweighs what it owes, as it would for a household with a mortgage twenty years in.
 *
 * Built only through the app's own functions, so the data is exactly what the app would have written.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
};
const monthStart = (date: string, back: number) => {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return ymd(d);
};
const withDay = (date: string, day: number) => `${date.slice(0, 8)}${pad(day)}`;

/** Deterministic, so the same day gives the same sample. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pay = 'card' | 'wallet' | 'bank' | 'any';

/** Where the money goes on an ordinary day: description, category key, lowest and highest amount, how it is paid, chance per day. */
const EVERYDAY: [string, string, number, number, Pay, number][] = [
  ['Kopi Kenangan', 'food_beverage.cafe_dessert', 28_000, 58_000, 'wallet', 0.45],
  ['Starbucks Senopati', 'food_beverage.cafe_dessert', 55_000, 120_000, 'card', 0.15],
  ['GrabCar', 'transportation.ride_hailing', 22_000, 95_000, 'wallet', 0.5],
  ['Gojek GoRide', 'transportation.ride_hailing', 12_000, 35_000, 'wallet', 0.25],
  ['GrabFood', 'food_beverage.takeaways', 45_000, 160_000, 'wallet', 0.3],
  ['Superindo Kebayoran', 'household.groceries', 180_000, 850_000, 'card', 0.18],
  ['Ranch Market Pondok Indah', 'household.groceries', 250_000, 1_200_000, 'card', 0.08],
  ['Alfamart', 'household.supplies', 25_000, 140_000, 'any', 0.25],
  ['Warung Padang Sederhana', 'food_beverage.restaurants', 35_000, 90_000, 'wallet', 0.15],
  ['Sushi Tei Plaza Senayan', 'food_beverage.restaurants', 280_000, 750_000, 'card', 0.06],
  ['Pertamina SPBU Fatmawati', 'transportation.fuel_cost', 250_000, 450_000, 'card', 0.1],
  ['Parkir Plaza Senayan', 'transportation.parking_tolls', 5_000, 25_000, 'wallet', 0.2],
  ['Tokopedia', 'shopping.clothing', 120_000, 650_000, 'card', 0.07],
  ['Shopee', 'household.supplies', 60_000, 320_000, 'card', 0.08],
  ['Guardian Pharmacy', 'health_care.pharmacy', 45_000, 260_000, 'any', 0.05],
  ['Laundry Kiloan Bersih', 'personal_care.dry_clean_laundry', 40_000, 95_000, 'wallet', 0.08],
  ['MRT Jakarta', 'transportation.public_transport', 7_000, 14_000, 'wallet', 0.2],
  ['Gramedia', 'shopping.books', 95_000, 280_000, 'card', 0.03],
  ['CGV Grand Indonesia', 'entertainment.movies', 60_000, 150_000, 'card', 0.04],
];

export async function seedSampleData(database: Database, ws: WorkspaceContext, today: string): Promise<void> {
  const rand = random(Number(today.replaceAll('-', '')));
  const between = (low: number, high: number, step = 1_000) => Math.round((low + rand() * (high - low)) / step) * step;
  const start = monthStart(today, 3);

  /*
   * The sample also stands in for a real household on an older schema, where a migration test seeds it before
   * upgrading. What a schema cannot hold yet is left out there, or opened the way that schema could: the kinds of
   * money after 47, tickers and brokers after 51, and a loan's kind after 55.
   */
  const version = await databaseVersion(database);
  const has = (migration: number) => version >= migration;

  await ensureCategoryKeys(database, ws);
  await ensureDefaultCategorySets(database, ws);
  const category = async (key: string) => {
    const found = (await listAccounts(database, ws)).find((a) => a.systemKey === key);
    if (!found) throw new Error(`No category ${key}`);
    return found.id;
  };
  const categoryIds = new Map<string, string>();
  const cat = async (key: string) => {
    if (!categoryIds.has(key)) categoryIds.set(key, await category(key));
    return categoryIds.get(key)!;
  };

  // ---- Money ----
  // Opened through the same call the Add account screen makes, so each carries the code and behaviour its kind fixes.
  // Dated a year before the record starts: money the household already had is not money that arrived on day one,
  // and a net-worth chart that counted it that way would show a jump nobody earned.
  const held = monthStart(today, 15);
  const bca = await openCashAccount(database, ws, { item: 'bank', name: 'BCA Tahapan', bank: 'BCA', currency: 'IDR', openingBalanceMinor: 68_450_000, openedOn: held });
  const jenius = await openCashAccount(database, ws, { item: 'savings', name: 'Jenius Maxi Saver', bank: 'Bank SMBC Indonesia', currency: 'IDR', openingBalanceMinor: 111_200_000, openedOn: held });
  const gopay = await openCashAccount(database, ws, { item: has(47) ? 'ewallet' : 'cash', name: 'GoPay', currency: 'IDR', openingBalanceMinor: 420_000, openedOn: held });
  const cash = await openCashAccount(database, ws, { item: 'cash', name: 'Wallet cash', currency: 'IDR', openingBalanceMinor: 850_000, openedOn: held });
  const USD = 16_280;
  const SGD = 12_540;
  await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: held, rate: USD, source: 'manual', sourceDate: held });
  await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: held, rate: SGD, source: 'manual', sourceDate: held });
  // One account holding two currencies, as Wise does: a row on Assets at their total, opening to its pockets.
  const { pockets: wisePockets } = await openPocketedAccount(database, ws, {
    item: 'bank',
    name: 'Wise',
    bank: 'Wise',
    openedOn: held,
    pockets: [
      { currency: 'USD', openingBalanceMinor: 184_050, openingRateToBase: USD },
      { currency: 'SGD', openingBalanceMinor: 42_000, openingRateToBase: SGD },
    ],
  });
  const wise = wisePockets.find((pocket) => pocket.currency === 'USD')!;
  // A deposit that matures next month, so its page has a maturity to propose on — moved out of savings, not new money.
  if (has(47)) await openCashAccount(database, ws, { item: 'time_deposit', name: 'Deposito BCA 3 months', bank: 'BCA', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: addDays(today, -65), maturesOn: addDays(today, 26), rateBps: 425, sourceAccountId: jenius.id });
  // A client's cheque not yet cleared: money, but not money that can be spent from.
  if (has(47)) await openCashAccount(database, ws, { item: 'other_cash', name: 'Cheque from PT Sinar Kreatif', currency: 'IDR', openingBalanceMinor: 4_500_000, openedOn: addDays(today, -6) });

  // ---- Cards ----
  const krisflyer = await createCardAccount(database, ws, { name: 'BCA KrisFlyer Visa Signature', subtype: 'credit_card', currency: 'IDR', issuer: 'BCA', last4: '4417' });
  await saveCardTerms(database, ws, { accountId: krisflyer.id, statementDay: 18, dueDay: 3, creditLimitMinor: 60_000_000, annualFeeMinor: 1_000_000 });
  await applyCatalogEntry(database, ws, { cardAccountId: krisflyer.id, entry: findEntry('bca-sq-krisflyer-visa-signature')!, today: start, replaceManual: false });

  const bonvoy = await createCardAccount(database, ws, { name: 'Mandiri Marriott Bonvoy', subtype: 'credit_card', currency: 'IDR', issuer: 'Mandiri', last4: '1467', holderName: 'Rizky' });
  const spouseCard = await addCard(database, ws, { accountId: bonvoy.id, last4: '8802', holderName: 'Dewi', isPrimary: false });
  const primaryCard = (await listCards(database, ws, bonvoy.id)).find((c) => c.isPrimary)!.id;
  await saveCardTerms(database, ws, { accountId: bonvoy.id, statementDay: 20, dueDay: 5, creditLimitMinor: 80_000_000, annualFeeMinor: 1_500_000 });
  await applyCatalogEntry(database, ws, { cardAccountId: bonvoy.id, entry: findEntry('mandiri-marriott-bonvoy')!, today: start, replaceManual: false });

  const accor = await createCardAccount(database, ws, { name: 'CIMB Niaga World ALL Accor', subtype: 'credit_card', currency: 'IDR', issuer: 'CIMB Niaga', last4: '3091' });
  await saveCardTerms(database, ws, { accountId: accor.id, statementDay: 22, dueDay: 7, creditLimitMinor: 40_000_000, annualFeeMinor: null });
  await applyCatalogEntry(database, ws, { cardAccountId: accor.id, entry: findEntry('cimb-niaga-world-all-accor')!, today: start, replaceManual: false });
  const bonvoyPlastic = [primaryCard, spouseCard];

  await saveMerchantMcc(database, ws, { pattern: 'kopi kenangan', mcc: '5814' });

  const buy = async (occurredOn: string, description: string, key: string, amountMinor: number, payWith: string, extra: { cardId?: string | null; originalCurrency?: string; originalAmountMinor?: number } = {}) =>
    postTransaction(database, ws, {
      occurredOn,
      description,
      lines: expenseLines({ categoryAccountId: await cat(key), paymentAccountId: payWith, amountMinor, currency: 'IDR' }),
      cardId: extra.cardId ?? null,
      originalCurrency: extra.originalCurrency ?? null,
      originalAmountMinor: extra.originalAmountMinor ?? null,
    });

  const cardFor = () => {
    const r = rand();
    if (r < 0.45) return { account: krisflyer.id, cardId: null };
    if (r < 0.8) return { account: bonvoy.id, cardId: bonvoyPlastic[rand() < 0.6 ? 0 : 1]! };
    return { account: accor.id, cardId: null };
  };
  const payer = (pay: Pay) => {
    const kind = pay === 'any' ? (['card', 'wallet', 'bank'] as const)[Math.floor(rand() * 3)]! : pay;
    if (kind === 'card') return cardFor();
    if (kind === 'wallet') return { account: rand() < 0.8 ? gopay.id : cash.id, cardId: null };
    return { account: bca.id, cardId: null };
  };

  // ---- Bills ----
  const bills = [
    { name: 'IPL Bintaro Jaya', key: 'property.community_security', money: bca.id, amount: 650_000, day: 1 },
    { name: 'Telkomsel Halo', key: 'utilities.mobile_phone', money: jenius.id, amount: 185_000, day: 5 },
    { name: 'Biznet Home', key: 'utilities.internet_provider', money: krisflyer.id, amount: 395_000, day: 10 },
    { name: 'PLN electricity', key: 'utilities.electricity', money: bca.id, amount: null, day: 20 },
    { name: 'Netflix', key: 'entertainment.subscriptions', money: accor.id, amount: 186_000, day: 12 },
    { name: 'Fitness First membership', key: 'personal_care.sports_fitness', money: bonvoy.id, amount: 850_000, day: 3 },
  ];
  const billIds = new Map<string, string>();
  for (const bill of bills) {
    billIds.set(bill.name, await saveExpenseTemplate(database, ws, { name: bill.name, categoryAccountId: await cat(bill.key), moneyAccountId: bill.money, amountMinor: bill.amount, dayOfMonth: bill.day }));
  }

  // ---- Budgets ----
  await saveExpectedIncome(database, ws, 41_500_000);
  for (const [key, amount] of [
    ['household.groceries', 4_500_000],
    ['food_beverage.restaurants', 2_000_000],
    ['food_beverage.cafe_dessert', 900_000],
    ['food_beverage.takeaways', 1_800_000],
    ['transportation.ride_hailing', 1_500_000],
    ['transportation.fuel_cost', 1_200_000],
    ['shopping.clothing', 1_500_000],
    ['entertainment.subscriptions', 400_000],
  ] as const) {
    await saveBudget(database, ws, { categoryAccountId: await cat(key), amountMinor: amount });
  }

  // ---- Goals ----
  const emergency = await saveGoal(database, ws, {
    name: 'Emergency fund',
    kind: 'emergency',
    growthBps: 0,
    returnBps: 450,
    standingMonthlyMinor: 5_000_000,
    stages: [{ name: 'Six months of spending', targetMinor: 120_000_000, targetMonths: null, dueOn: `${Number(today.slice(0, 4)) + 2}-06-30` }],
  });
  const japan = await saveGoal(database, ws, {
    name: 'Japan in spring',
    kind: 'holiday',
    growthBps: 300,
    returnBps: 400,
    standingMonthlyMinor: 3_000_000,
    stages: [{ name: 'Flights and ryokan', targetMinor: 38_000_000, targetMonths: null, dueOn: `${Number(today.slice(0, 4)) + 1}-09-15` }],
  });

  // ---- Holdings, owned before the app ----
  /*
   * Each opened the way the Add asset form opens the item it names: the account and profile the catalogue item
   * fixes, then either its buys (anything counted in units, grams or face value) or what it cost and what it is
   * worth now (anything whose value is typed).
   */
  /*
   * A figure's path from what was paid to what it is worth now, marked once a quarter over the last year: the way
   * a house is revalued now and then, not once, the week the app was opened. One mark drawn three days ago moved
   * the whole difference onto the chart's last month; a quarterly mark lets it climb, or fall, as it did.
   */
  const drift = (from: string, then: number, now: number, step: number): { on: string; value: number }[] => {
    const heldDays = Math.max(1, (Date.parse(today) - Date.parse(from)) / 86_400_000);
    return [12, 9, 6, 3, 0].flatMap((monthsBack) => {
      const on = monthsBack === 0 ? addDays(today, -2) : monthStart(today, monthsBack);
      const back = (Date.parse(today) - Date.parse(on)) / 86_400_000;
      if (on <= from) return [];
      const value = then + (now - then) * (1 - back / heldDays);
      return [{ on, value: Math.max(step, Math.round(value / step) * step) }];
    });
  };
  const own = async (
    itemId: string,
    name: string,
    how: { buys: { on: string; unitsMicro: number; costMinor: number }[]; priceMicro: number } | { boughtOn: string; costMinor: number; worthMinor: number },
  ) => {
    const item = assetItem(itemId);
    if (item.behaviour.opens !== 'holding') throw new Error(`${itemId} is not a holding`);
    const { behaviour } = item;
    const typed = 'boughtOn' in how;
    const account = await createAccount(database, ws, {
      name,
      kind: 'asset',
      subtype: behaviour.subtype as 'investment' | 'property' | 'vehicle',
      currency: 'IDR',
      openingBalanceMinor: typed ? how.costMinor : 0,
      openedOn: typed ? how.boughtOn : undefined,
    });
    const years = typed ? [how.boughtOn] : how.buys.map((buy) => buy.on);
    await saveAssetProfile(database, ws, {
      accountId: account.id,
      assetKind: behaviour.assetKind,
      planGroup: behaviour.planGroup,
      unitKind: behaviour.unitKind,
      lotSize: behaviour.lotSize,
      coretaxSection: item.section ?? 'lainnya',
      coretaxCode: item.code,
      acquiredYear: Math.min(...years.map((on) => Number(on.slice(0, 4)))),
    });
    if (typed) {
      for (const mark of drift(how.boughtOn, how.costMinor, how.worthMinor, 100_000)) {
        await recordValuation(database, ws, { accountId: account.id, asOf: mark.on, valueMinor: mark.value, basis: 'estimate' });
      }
    } else {
      for (const buy of how.buys) {
        await recordTrade(database, ws, { accountId: account.id, kind: 'buy', occurredOn: buy.on, unitsMicro: buy.unitsMicro, grossMinor: buy.costMinor, feeMinor: 0, taxMinor: 0, cashAccountId: null });
      }
      const first = how.buys[0]!;
      for (const mark of drift(first.on, Math.round((first.costMinor * 1_000_000 * 1_000_000) / first.unitsMicro), how.priceMicro, 1)) {
        await upsertPrice(database, ws, { accountId: account.id, onDate: mark.on, priceMicro: mark.value });
      }
    }
    return account;
  };
  const year = (back: number) => Number(today.slice(0, 4)) - back;
  const units = (n: number) => Math.round(n * 1_000_000);

  // Immovable: the house the mortgage bought, and a plot outside the city.
  await own('property', 'Rumah Bintaro Sektor 9', { boughtOn: `${year(2)}-08-14`, costMinor: 1_150_000_000, worthMinor: 1_420_000_000 });
  await own('empty_land', 'Tanah kavling Sentul', { boughtOn: `${year(5)}-03-02`, costMinor: 210_000_000, worthMinor: 345_000_000 });
  // Movable: the car the lease is paying for, and a scooter.
  await own('vehicle', 'Toyota Veloz 2024', { boughtOn: `${year(2)}-09-20`, costMinor: 318_000_000, worthMinor: 262_000_000 });
  await own('motorcycle', 'Honda Vario 160', { boughtOn: `${year(3)}-01-11`, costMinor: 27_500_000, worthMinor: 19_000_000 });
  // Investments: a money-market fund, a retail government bond and a unit-linked policy, beside the shares below.
  await own('fund', 'Sucorinvest Money Market Fund', { buys: [{ on: `${year(1)}-02-10`, unitsMicro: units(12_480.5521), costMinor: 22_000_000 }, { on: `${year(1)}-10-03`, unitsMicro: units(4_802.1144), costMinor: 8_600_000 }], priceMicro: units(1_812.4467) });
  await own('bond', 'ORI025T3', { buys: [{ on: `${year(1)}-02-21`, unitsMicro: units(25_000_000), costMinor: 25_000_000 }], priceMicro: units(1.0125) });
  await own('unit_link', 'Prudential PRULink', { boughtOn: `${year(4)}-05-01`, costMinor: 36_000_000, worthMinor: 41_800_000 });
  // Intangible and other: gold bars and jewellery by the gram, and the laptop that earns the living.
  const gold = await own('gold', 'Antam gold bars', { buys: [{ on: `${year(1)}-11-08`, unitsMicro: units(25), costMinor: 39_250_000 }], priceMicro: units(1_968_000) });
  void gold;
  await own('gold_jewellery', 'Wedding jewellery', { buys: [{ on: `${year(6)}-06-18`, unitsMicro: units(18.5), costMinor: 14_800_000 }], priceMicro: units(1_710_000) });
  await own('electronics', 'MacBook Pro 14"', { boughtOn: `${year(1)}-04-05`, costMinor: 32_999_000, worthMinor: 24_500_000 });

  if (has(51)) {
    // Listed shares, held at a broker whose cash account (RDN) is money of its own: the By stock and broker page.
    const bbca = await addHolding(database, ws, {
      security: { ticker: 'BBCA', name: 'Bank Central Asia Tbk', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' },
      broker: { name: 'Stockbit RDN', currency: 'IDR' },
      buy: { occurredOn: `${year(1)}-03-17`, unitsMicro: units(1_500), grossMinor: 13_725_000, feeMinor: 20_588, taxMinor: 0, cashAccountId: null },
    });
    const rdn = bbca.brokerAccountId!;
    const bbri = await addHolding(database, ws, {
      security: { ticker: 'BBRI', name: 'Bank Rakyat Indonesia Tbk', market: 'IDX', currency: 'IDR', lotSize: 100, kind: 'share', source: 'catalogue' },
      broker: { accountId: rdn },
      buy: { occurredOn: `${year(1)}-06-16`, unitsMicro: units(1_500), grossMinor: 6_525_000, feeMinor: 9_800, taxMinor: 0, cashAccountId: null },
    });
    for (const [holding, boughtOn, paid, now] of [
      [bbca, `${year(1)}-03-17`, 9_150, 9_875],
      [bbri, `${year(1)}-06-16`, 4_350, 4_180],
    ] as const) {
      for (const mark of drift(boughtOn, units(paid), units(now), 1)) await upsertSecurityPrice(database, ws, { securityId: holding.securityId, onDate: mark.on, priceMicro: mark.value });
    }
    // Cash waiting at the broker for the next buy.
    await postTransaction(database, ws, { occurredOn: addDays(start, 2), description: 'Top up Stockbit RDN', lines: transferLines({ fromAccountId: bca.id, toAccountId: rdn, amountMinor: 3_500_000, currency: 'IDR' }) });
  } else {
    // Before tickers: the shares as a holding of their own, priced by hand.
    const shares = await own('stock', 'BBRI shares', { buys: [{ on: `${year(1)}-06-16`, unitsMicro: units(1_500), costMinor: 6_525_000 }], priceMicro: units(4_180) });
    void shares;
  }

  // ---- Month by month ----
  const cardPurchases: { id: string; account: string; on: string }[] = [];
  for (let back = 3; back >= 0; back -= 1) {
    const month = monthStart(today, back);
    const salaryDay = withDay(month, 1);
    if (salaryDay <= today) {
      await postTransaction(database, ws, { occurredOn: salaryDay, description: 'Salary PT Nusantara Digital', lines: incomeLines({ incomeAccountId: await cat('income.salary'), depositAccountId: bca.id, amountMinor: 41_500_000, currency: 'IDR' }) });
      await recordTaggedTransfer(database, ws, { occurredOn: addDays(salaryDay, 1), description: 'Emergency fund top-up', amountMinor: 5_000_000, fromAccountId: bca.id, toAccountId: jenius.id, goalId: emergency });
      await recordTaggedTransfer(database, ws, { occurredOn: addDays(salaryDay, 1), description: 'Japan savings', amountMinor: 3_000_000, fromAccountId: bca.id, toAccountId: jenius.id, goalId: japan });
    }
    for (const bill of bills) {
      const due = withDay(month, bill.day);
      // This month's internet is left unpaid, so the page has a bill to offer.
      if (due > today || (back === 0 && bill.name === 'Biznet Home')) continue;
      const amount = bill.amount ?? between(820_000, 1_150_000);
      await postTransaction(database, ws, {
        occurredOn: due,
        description: bill.name,
        lines: expenseLines({ categoryAccountId: await cat(bill.key), paymentAccountId: bill.money, amountMinor: amount, currency: 'IDR' }),
        templateId: billIds.get(bill.name)!,
        cardId: bill.money === bonvoy.id ? bonvoyPlastic[0]! : null,
      });
    }
    await postTransaction(database, ws, {
      occurredOn: withDay(month, 9),
      description: 'Spotify Premium',
      lines: expenseLines({ categoryAccountId: await cat('entertainment.subscriptions'), paymentAccountId: wise.id, amountMinor: 599, currency: 'USD' }),
      ratesToBase: { USD },
    });
  }

  // What the e-wallet and the purse hold, so they are topped up from the bank before they run dry.
  const wallets = new Map([
    [gopay.id, { balance: 420_000, refill: 1_000_000, description: 'GoPay top-up' }],
    [cash.id, { balance: 850_000, refill: 1_500_000, description: 'ATM BCA withdrawal' }],
  ]);
  for (let date = start; date <= today; date = addDays(date, 1)) {
    for (const [description, key, low, high, pay, chance] of EVERYDAY) {
      if (rand() > chance) continue;
      const { account, cardId } = payer(pay);
      const amount = between(low, high, low < 50_000 ? 500 : 1_000);
      const wallet = wallets.get(account);
      if (wallet) {
        if (wallet.balance < amount) {
          await postTransaction(database, ws, { occurredOn: date, description: wallet.description, lines: transferLines({ fromAccountId: bca.id, toAccountId: account, amountMinor: wallet.refill, currency: 'IDR' }) });
          wallet.balance += wallet.refill;
        }
        wallet.balance -= amount;
      }
      const id = await buy(date, description, key, amount, account, { cardId });
      if (account === krisflyer.id || account === bonvoy.id || account === accor.id) cardPurchases.push({ id, account, on: date });
    }
  }

  // ---- A holiday, planned as an event from the Holiday set ----
  const holidaySet = (await listCategorySets(database, ws)).find((set) => set.name === 'Holiday')!;
  const holiday = new Map((await listSetCategories(database, ws, holidaySet.id)).map((c) => [c.name, c.id]));
  const tripStart = addDays(monthStart(today, 1), 13);
  const tripEnd = addDays(tripStart, 4);
  const trip = await saveEvent(database, ws, { name: 'Singapore long weekend', startsOn: tripStart, endsOn: tripEnd, setId: holidaySet.id });
  for (const [name, planned] of [
    ['Flights', 4_800_000],
    ['Lodging', 7_500_000],
    ['Meals', 3_000_000],
    ['Transport', 900_000],
    ['Activities', 2_500_000],
    ['Souvenirs', 1_000_000],
  ] as const) {
    await saveEventItem(database, ws, trip, { name, unitPriceMinor: planned, categoryAccountId: holiday.get(name)! });
  }
  const tripSpend: [string, string, number, string, number | null, number][] = [
    [addDays(tripStart, -30), 'Singapore Airlines CGK-SIN return', 5_140_000, 'Flights', null, 0],
    [tripStart, 'Hotel Jen Orchardgateway', 7_210_000, 'Lodging', 57_500, 1],
    [tripStart, 'Jumbo Seafood Clarke Quay', 1_630_000, 'Meals', 13_000, 1],
    [addDays(tripStart, 1), 'Universal Studios Singapore', 2_280_000, 'Activities', 18_200, 1],
    [addDays(tripStart, 1), 'Grab Singapore', 385_000, 'Transport', 3_070, 1],
    [addDays(tripStart, 2), 'Din Tai Fung Paragon', 890_000, 'Meals', 7_100, 1],
    [addDays(tripStart, 3), 'Bengawan Solo Changi', 610_000, 'Souvenirs', 4_860, 1],
  ];
  for (const [on, description, amount, name, sgd] of tripSpend) {
    const id = await postTransaction(database, ws, {
      occurredOn: on,
      description,
      lines: expenseLines({ categoryAccountId: holiday.get(name)!, paymentAccountId: krisflyer.id, amountMinor: amount, currency: 'IDR' }),
      originalCurrency: sgd ? 'SGD' : null,
      originalAmountMinor: sgd,
    });
    await tagTransaction(database, ws, id, trip);
    cardPurchases.push({ id, account: krisflyer.id, on });
  }
  await saveEvent(database, ws, { name: 'Office end-of-year dinner', startsOn: addDays(today, 70), endsOn: addDays(today, 70) });

  // ---- A phone on 12 months at 0% ----
  const phoneOn = withDay(monthStart(today, 2), 6);
  const phone = await buy(phoneOn, 'iBox iPhone 16 Pro', 'shopping.electronics', 20_999_000, bonvoy.id, { cardId: bonvoyPlastic[0]! });
  await saveInstallment(database, ws, { cardAccountId: bonvoy.id, description: 'iBox iPhone 16 Pro', totalMinor: 20_999_000, months: 12, firstBilledMonth: monthStart(today, 1).slice(0, 7), transactionId: phone, earnsPoints: false });

  // ---- People ----
  const dinner = await splitBill(database, ws, {
    occurredOn: addDays(today, -19),
    description: 'Birthday dinner at Plataran',
    totalMinor: 2_340_000,
    moneyAccountId: accor.id,
    ownCategoryId: await cat('food_beverage.restaurants'),
    ownShareMinor: 1_170_000,
    shares: [{ person: { name: 'Sari', currency: 'IDR' }, amountMinor: 1_170_000 }],
    spendCategoryId: await cat('food_beverage.restaurants'),
  });
  const loan = await recordLoan(database, ws, { person: { name: 'Budi', direction: 'lent', currency: 'IDR', reason: 'Motorbike repair' }, occurredOn: addDays(today, -52), amountMinor: 3_000_000, moneyAccountId: bca.id });
  await recordRepayment(database, ws, { debtAccountId: loan.debtAccountId, occurredOn: addDays(today, -21), amountMinor: 1_000_000, moneyAccountId: bca.id });
  void dinner;

  // ---- What is owed ----
  /*
   * Three bank loans and the other direction of the people ledger, so the Debts screen has its whole range: a
   * mortgage with twenty years left, a car loan past the halfway mark, one opened this quarter — and people the
   * household borrowed from, one repaid in part and one that came with it from before the app existed.
   *
   * Every loan is opened at what was owed when it was taken on, then paid down through `recordLoanPayment`, which
   * is the same call the Loan page's Pay makes — so what the screen shows is a real schedule, not a number typed
   * to look like one.
   */
  const openLoan = async (input: {
    name: string;
    lender: string;
    purpose: string;
    /** The debt picker's item: what the Liabilities page folds the loan under. */
    item: string;
    method?: 'annuity' | 'zero';
    owedThenMinor: number;
    originalMinor: number;
    monthsIn: number;
    tenorMonths: number;
    rateBps: number;
    paymentDay: number;
    principalMinor: number;
    interestMinor: number;
    /** Left out for the loan whose bank named no figure, which the schedule then works out itself. */
    namedPaymentMinor?: number;
  }) => {
    /*
     * Only the instalments since the household's bank account was opened are paid through the app; paying two years
     * of a mortgage out of a current account three months old is what overdrew it. A loan older than that is still
     * dated from when it was taken on — so net worth never shows the debt arriving months after the house it bought —
     * but opens at what was still owed when the app's own record begins.
     */
    const paidHere = Math.min(input.monthsIn, 3);
    const account = await createAccount(database, ws, {
      name: input.name,
      kind: 'liability',
      subtype: 'loan',
      currency: 'IDR',
      openingBalanceMinor: input.owedThenMinor - input.principalMinor * (input.monthsIn - paidHere),
      openedOn: addDays(withDay(monthStart(today, input.monthsIn + 1), input.paymentDay), -1),
    });
    await saveLoanTerms(database, ws, {
      accountId: account.id,
      lenderName: input.lender,
      purpose: input.purpose,
      originalMinor: input.originalMinor,
      firstPaymentOn: withDay(monthStart(today, input.monthsIn), input.paymentDay),
      tenorMonths: input.tenorMonths,
      method: input.method ?? 'annuity',
      paymentDay: input.paymentDay,
      rateBps: input.rateBps,
      paymentMinor: input.namedPaymentMinor,
    });
    if (has(55)) await setLoanItem(database, ws, account.id, input.item);
    for (let back = paidHere; back >= 1; back -= 1) {
      await recordLoanPayment(database, ws, {
        accountId: account.id,
        occurredOn: withDay(monthStart(today, back), input.paymentDay),
        moneyAccountId: bca.id,
        principalMinor: input.principalMinor,
        interestMinor: input.interestMinor,
      });
    }
    return account;
  };

  await openLoan({ name: 'KPR BCA', lender: 'BCA', purpose: 'house', item: 'home_mortgage', owedThenMinor: 728_400_000, originalMinor: 900_000_000, monthsIn: 24, tenorMonths: 180, rateBps: 475, paymentDay: 5, principalMinor: 3_100_000, interestMinor: 2_850_000, namedPaymentMinor: 5_950_000 });
  await openLoan({ name: 'Car loan Adira', lender: 'Adira Finance', purpose: 'car', item: 'vehicle_leasing', owedThenMinor: 260_400_000, originalMinor: 320_000_000, monthsIn: 24, tenorMonths: 36, rateBps: 690, paymentDay: 12, principalMinor: 4_600_000, interestMinor: 1_150_000, namedPaymentMinor: 5_750_000 });
  // The one with nothing named by the bank: the app's own schedule supplies the instalment it will ask for.
  await openLoan({ name: 'KTA Mandiri', lender: 'Mandiri', purpose: 'personal', item: 'multi_purpose_loan', owedThenMinor: 56_600_000, originalMinor: 60_000_000, monthsIn: 2, tenorMonths: 24, rateBps: 1_080, paymentDay: 20, principalMinor: 1_900_000, interestMinor: 650_000 });
  // A paylater for the new sofa: six months at no interest, which is why it is never asked for a rate.
  await openLoan({ name: 'Kredivo 6 months', lender: 'Kredivo', purpose: 'personal', item: 'online_loan', method: 'zero', owedThenMinor: 9_000_000, originalMinor: 9_000_000, monthsIn: 2, tenorMonths: 6, rateBps: 0, paymentDay: 25, principalMinor: 1_500_000, interestMinor: 0 });

  const dewi = await recordLoan(database, ws, { person: { name: 'Dewi', direction: 'borrowed', currency: 'IDR', reason: 'Motorbike down payment' }, occurredOn: addDays(today, -40), amountMinor: 4_500_000, moneyAccountId: bca.id });
  await recordRepayment(database, ws, { debtAccountId: dewi.debtAccountId, occurredOn: addDays(today, -12), amountMinor: 1_500_000, moneyAccountId: bca.id });
  // Came with the household from before the app: opened at what is still owed, the way Add a debt opens one.
  await openDebtBalance(database, ws, { direction: 'borrowed', personName: 'Kadek', currency: 'IDR', balanceMinor: 2_000_000, openedOn: addDays(today, -120), reason: 'Bali villa share' });
  // Family: owed to a parent, which the tax report files as affiliate debt.
  await openDebtBalance(database, ws, { direction: 'borrowed', personName: 'Ibu Ratna', currency: 'IDR', balanceMinor: 15_000_000, openedOn: addDays(today, -200), coretaxCode: '103', reason: 'Help with the house down payment' });
  // Owed to the household: a client's unpaid invoice, and a brother's loan — a trade and an affiliate receivable.
  await openDebtBalance(database, ws, { direction: 'lent', personName: 'PT Sinar Kreatif', currency: 'IDR', balanceMinor: 12_500_000, openedOn: addDays(today, -34), coretaxCode: '0201', reason: 'Invoice INV-0917 brand design' });
  await openDebtBalance(database, ws, { direction: 'lent', personName: 'Andi', currency: 'IDR', balanceMinor: 5_000_000, openedOn: addDays(today, -95), coretaxCode: '0202', reason: 'Laptop for college' });

  // ---- Card statements ----
  // Bought on the KrisFlyer statement day itself, but the bank posted it a day later: billed on the next statement.
  const lastKrisflyerStatement = statementCycleFor(addDays(statementCycleFor(today, 18).start, -1), 18).end;
  const late = await buy(lastKrisflyerStatement, 'Uniqlo Grand Indonesia', 'shopping.clothing', 899_000, krisflyer.id);
  await billOnNextStatement(database, ws, krisflyer.id, late);

  const firstDueAfter = (statementOn: string, dueDay: number) => {
    const sameMonth = withDay(statementOn, dueDay);
    return sameMonth > statementOn ? sameMonth : withDay(addDays(withDay(statementOn, 28), 7), dueDay);
  };
  for (const card of [
    { id: krisflyer.id, statementDay: 18, dueDay: 3 },
    { id: bonvoy.id, statementDay: 20, dueDay: 5 },
    { id: accor.id, statementDay: 22, dueDay: 7 },
  ]) {
    const current = statementCycleFor(today, card.statementDay);
    for (let cycle = statementCycleFor(start, card.statementDay); cycle.end < current.start; cycle = statementCycleFor(addDays(cycle.end, 1), card.statementDay)) {
      const dueOn = firstDueAfter(cycle.end, card.dueDay);
      if (dueOn > today) continue;
      // Statements bill an instalment plan a month at a time, so this is what the bank would ask for.
      const { closingMinor } = await cardStatement(database, ws, card.id, cycle, dueOn);
      if (closingMinor <= 0) continue;
      // Paid in full on the due day, except the Bonvoy card's latest statement, paid in part so something is left to pay.
      const latest = addDays(cycle.end, 1) === current.start;
      const amountMinor = card.id === bonvoy.id && latest ? Math.round((closingMinor * 0.6) / 1_000) * 1_000 : closingMinor;
      await postTransaction(database, ws, { occurredOn: dueOn, description: `${card.id === krisflyer.id ? 'BCA' : card.id === bonvoy.id ? 'Mandiri' : 'CIMB'} card payment`, lines: transferLines({ fromAccountId: bca.id, toAccountId: card.id, amountMinor, currency: 'IDR' }) });
    }
  }

  // Two purchases on the Accor card paid early, before their statement is out.
  const open = cardPurchases.filter((p) => p.account === accor.id && p.on > statementCycleFor(today, 22).start && p.on < today).slice(0, 2);
  if (open.length > 0) await payCardPurchases(database, ws, { cardAccountId: accor.id, fromAccountId: bca.id, occurredOn: addDays(today, -1), purchaseTransactionIds: open.map((p) => p.id) });

  // ---- Waiting to be recorded ----
  await captureDrafts(database, ws, [
    { source: 'csv', occurredOn: addDays(today, -2), description: 'APOTEK K24 KEMANG', amountMinor: 186_500, currency: 'IDR', accountId: bca.id, externalRef: 'sample:k24', categoryAccountId: null },
    { source: 'csv', occurredOn: addDays(today, -1), description: 'SUPERINDO KEBAYORAN 0912', amountMinor: 412_300, currency: 'IDR', accountId: bca.id, externalRef: 'sample:superindo', categoryAccountId: await cat('household.groceries') },
    { source: 'email', occurredOn: today, description: 'TIKET.COM KAI JKT-BDG', amountMinor: 320_000, currency: 'IDR', accountId: krisflyer.id, externalRef: 'sample:kai', categoryAccountId: null },
  ]);
  await createDraft(database, ws, { source: 'manual', occurredOn: today, description: 'Pak Joko car wash', amountMinor: 0, currency: 'IDR', accountId: cash.id });
}
