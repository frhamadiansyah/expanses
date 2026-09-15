import { findEntry } from '@expanses/catalog';
import { expenseLines, incomeLines, statementCycleFor, transferLines } from '@expanses/core';
import {
  addCard,
  applyCatalogEntry,
  billOnNextStatement,
  captureDrafts,
  cardStatement,
  createAccount,
  createCardAccount,
  createDraft,
  type Database,
  ensureCategoryKeys,
  ensureDefaultCategorySets,
  listAccounts,
  listCards,
  listCategorySets,
  listSetCategories,
  payCardPurchases,
  postTransaction,
  recordLoan,
  recordRepayment,
  recordTaggedTransfer,
  recordTrade,
  saveAssetProfile,
  saveBudget,
  saveCardTerms,
  saveEvent,
  saveExpectedIncome,
  saveExpenseTemplate,
  saveGoal,
  saveInstallment,
  saveMerchantMcc,
  setEventBudget,
  splitBill,
  tagTransaction,
  upsertPrice,
  upsertRate,
  type WorkspaceContext,
} from '../../src/index';

/**
 * A believable household to click around in: three months of a salaried life in Jakarta, paid by bank,
 * e-wallet and three credit cards (one with a supplementary card), with bills, budgets, a holiday, goals,
 * holdings, money lent, captures waiting to be recorded, and a card statement with a late posting and an
 * early payment. Every name here is made up.
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
  const bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 52_450_000, openedOn: start });
  const jenius = await createAccount(database, ws, { name: 'Jenius Maxi Saver', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 61_200_000, openedOn: start });
  const gopay = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 420_000, openedOn: start });
  const cash = await createAccount(database, ws, { name: 'Wallet cash', kind: 'asset', subtype: 'cash', currency: 'IDR', openingBalanceMinor: 850_000, openedOn: start });
  const USD = 16_280;
  await upsertRate(database, { fromCurrency: 'USD', toCurrency: 'IDR', onDate: start, rate: USD, source: 'manual', sourceDate: start });
  await upsertRate(database, { fromCurrency: 'SGD', toCurrency: 'IDR', onDate: start, rate: 12_540, source: 'manual', sourceDate: start });
  const wise = await createAccount(database, ws, { name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 184_050, openedOn: start, openingRateToBase: USD });

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
    { name: 'Apartment rent', key: 'property.housing_rent', money: bca.id, amount: 7_500_000, day: 1 },
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
  const gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  await recordTrade(database, ws, { accountId: gold.id, kind: 'buy', occurredOn: '2025-11-08', unitsMicro: 25_000_000, grossMinor: 39_250_000, feeMinor: 0, taxMinor: 0, cashAccountId: null });
  await upsertPrice(database, ws, { accountId: gold.id, onDate: addDays(today, -2), priceMicro: 1_968_000_000_000 });
  const bbri = await createAccount(database, ws, { name: 'BBRI shares', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: bbri.id, assetKind: 'stock', lotSize: 100 });
  await recordTrade(database, ws, { accountId: bbri.id, kind: 'buy', occurredOn: '2025-06-16', unitsMicro: 1_500_000_000, grossMinor: 6_525_000, feeMinor: 9_800, taxMinor: 0, cashAccountId: null });
  await upsertPrice(database, ws, { accountId: bbri.id, onDate: addDays(today, -1), priceMicro: 4_180_000_000 });

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
    await setEventBudget(database, ws, trip, { categoryAccountId: holiday.get(name)!, plannedMinor: planned });
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
  await saveEvent(database, ws, { name: 'Office end-of-year dinner', startsOn: addDays(today, 70), endsOn: addDays(today, 70), plannedMinor: 1_500_000 });

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
