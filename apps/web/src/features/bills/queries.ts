import { billChoicesForPurchase, billDetail, billLinkCandidates, billLinkMonths, billLinkRefusal, billMonthsBefore, billOfPurchase, bookMoneyFor, listExpenseTemplates, monthlyBills, sinkingFundViews, yearlyBills } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useMonthlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => monthlyBills(database, ws, today) });
}

export function useYearlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', 'yearly', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => yearlyBills(database, ws, today) });
}

export function useBillDetail(billId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-detail', ws.workspaceId, ws.bookId ?? null, billId, today], queryFn: () => billDetail(database, ws, billId, today) });
}

/**
 * The workspace's money for adding bills up: `useBookMoney`, with a foreign conversion on top so a bill written in
 * another currency than the money its workspace reads in (an SGD bill in a rupiah workspace) can be brought across.
 */
export function useBillMoney() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['book-money-bills', ws.workspaceId, ws.bookId ?? null], queryFn: () => bookMoneyFor(database, ws, { foreign: true }) });
}

/** Every yearly bill saving up, with what is set aside today. Local to the owner: never part of a shared workspace. */
export function useSinkingFunds(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['sinking-funds', ws.workspaceId, today], queryFn: () => sinkingFundViews(database, ws, today) });
}

/** The purchases that could settle one month of a bill (see `billLinkCandidates`). */
export function useBillLinkCandidates(billId: string, month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-link-candidates', ws.workspaceId, ws.bookId ?? null, billId, month], queryFn: () => billLinkCandidates(database, ws, { templateId: billId, billMonth: month }), enabled: month !== '' });
}

/** The months before a bill started that hold purchases to link, `pages` years' worth of them (see `billMonthsBefore`). */
export function useBillMonthsBefore(billId: string, pages: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-months-before', ws.workspaceId, ws.bookId ?? null, billId, pages], queryFn: () => billMonthsBefore(database, ws, { templateId: billId, limitMonths: 12 * pages }) });
}

/** Why a month of a bill cannot take a purchase, or null (see `billLinkRefusal`). */
export function useBillLinkRefusal(billId: string, month: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-link-refusal', ws.workspaceId, ws.bookId ?? null, billId, month, today], queryFn: () => billLinkRefusal(database, ws, { templateId: billId, billMonth: month, today }) });
}

/**
 * The month of each bill a purchase dated `purchasedOn` links to when none is picked, whether a tap asks first, and
 * the day that month comes out (see `billLinkMonth`). Keyed by bill id.
 */
export function useBillLinkMonths(billIds: readonly string[], purchasedOn: string | null, today: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['bill-link-month', ws.workspaceId, ws.bookId ?? null, [...billIds], purchasedOn, today],
    queryFn: () => billLinkMonths(database, ws, { templateIds: billIds, purchasedOn: purchasedOn!, today }),
    enabled: purchasedOn !== null && billIds.length > 0,
  });
}

/** The bills a split's part may pay, for a purchase on that day (see `billChoicesForPurchase`). */
export function useBillChoices(purchasedOn: string, transactionId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['bill-choices', ws.workspaceId, purchasedOn, transactionId],
    queryFn: () => billChoicesForPurchase(database, ws, { purchasedOn, transactionId }),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(purchasedOn),
  });
}

/** The bill a purchase is linked to, if any (see `billOfPurchase`). */
export function useBillOfPurchase(transactionId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-of-purchase', ws.workspaceId, transactionId], queryFn: () => billOfPurchase(database, ws, transactionId) });
}

/** Every active recurring bill the workspace holds, whether or not it is listed this month. */
export function useBillTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-templates', ws.workspaceId, ws.bookId ?? null], queryFn: async () => (await listExpenseTemplates(database, ws)).filter((t) => t.active) });
}
