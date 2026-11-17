import { periodMonthOf } from '@expanses/core';
import { useHeldRates } from '../accounts/queries';
import { billCurrencyOf } from '../bills/bill-view';
import { useBillsInMonth } from '../debt-plan/queries';
import { useSetAsideViews } from '../goals/queries';
import { useMonthStart } from '../workspaces/queries';
import { useApp } from '../../app/context';
import { useWalletCards } from './useWalletCards';
import { walletBox } from './wallet-balance';

/**
 * Wallet's Balance box, read the way WalletPage reads it — money kept for spending, less what goals set aside of it,
 * less what is due now on the cards, less this month's bills still to pay — for a page that shows the figure without
 * the cards (the wide screen's Overview, "Money on hand"). `ready` once every input is read.
 */
export function useMoneyOnHand() {
  const { ws } = useApp();
  const wallet = useWalletCards();
  const { accounts, balances, everything, all, book, credit, joint, rates, held, today, laterOnCards, plansRead } = wallet;
  const setAsides = useSetAsideViews();
  const month = periodMonthOf(today, useMonthStart());
  const monthBills = useBillsInMonth(month, { workspaceMonth: true });
  const billRows = (monthBills.data ?? []).map((row) => ({
    id: row.bill.id,
    name: row.bill.name,
    categoryAccountId: row.bill.categoryAccountId,
    month,
    state: row.state,
    payBy: row.window.payBy,
    amountMinor: row.bill.amountMinor,
    estimateMinor: row.estimateMinor,
    currency: billCurrencyOf(row.bill, everything, ws.baseCurrency),
  }));
  const billRates = useHeldRates(billRows.map((row) => row.currency));
  const box = walletBox({
    book,
    balances: all,
    credit,
    baseCurrency: ws.baseCurrency,
    rates: { ...held, ...(billRates.data?.rates ?? {}) },
    setAsides: Object.values(setAsides.data ?? {}),
    bills: billRows,
    month,
    joint,
    laterOnCards,
  });
  const ready = accounts.isSuccess && balances.isSuccess && rates.isSuccess && plansRead && setAsides.isSuccess && !billRates.isPending && !monthBills.isPending;
  // With the cards themselves, for Mac Wallet, which draws them under the same box (`DesktopWallet`).
  return { box, ready, everything, all, book, held, today, currency: ws.baseCurrency, wallet, month };
}
