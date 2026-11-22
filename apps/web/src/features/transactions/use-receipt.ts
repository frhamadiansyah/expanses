import { isoDate } from '@expanses/core';
import {
  eventPostingOf,
  eventTransferOf,
  jointRowNote,
  listPhotos,
  listTransactions,
  ownerScope,
  paidOffMarkOf,
  removeTransferFromSharedEvent,
  setSettledBeforeApp,
  standingTransaction,
  tagTransactions,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { FROM_TRANSACTION } from '../../app/from-search';
import { useApp } from '../../app/context';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { useWithdrawalsUsed } from '../../lib/withdrawal-queries';
import { usePhotoUrls } from '../../photos/use-photo-urls';
import { showToast } from '../../ui/Toast';
import { useHeldRates } from '../accounts/queries';
import { useBillOfPurchase } from '../bills/queries';
import { historyIndex, markReceiptAt } from '../bills/receipt-return';
import { useCardsWithArchived } from '../cards/card-queries';
import { isCardPayment } from '../cards/card-pay';
import { usePeopleDebts } from '../debts/queries';
import { useEvents } from '../events/queries';
import { useGoals } from '../goals/queries';
import { useInstallments } from '../loans/queries';
import { usePurchasePayers } from '../sharing/queries';
import { useWorkspaceBadges } from '../workspaces/queries';
import { classify } from './classify';
import { pastMoveRow } from './tx-form';
import { isCorrection } from './draft';
import { useDuplicable } from './duplicable';
import { deleteTransaction } from './member-transfer';
import { useChangeable } from './queries';
import { heroCaption, receiptLines, splitParts } from './receipt-view';
import { instalmentCardOf, spreadCaption } from './turn-into';

/** What a receipt does when its transaction is gone from under it: deleted, or replaced by the row it went back onto. */
export interface ReceiptExits {
  /** Deleted from the receipt. The page goes back where it came from; a peek closes. */
  onDeleted: () => void;
  /** Taken off a shared event, the transfer went back onto the one it was split from: the receipt follows that row. */
  onReplaced: (transactionId: string) => void;
}

/**
 * One transaction's receipt, read and worked out once for every screen that shows it: the phone's receipt page and the
 * Mac's receipt peek ask this hook, so the two read the same queries, take the same refusals and say the same lines.
 * What is shown, and how, is the screen's; what there is to show, and what may be done about it, is decided here.
 *
 * It reads owner-wide on purpose. An account's history is the owner's, not a workspace's, so a receipt must open
 * whatever workspace its transaction was filed in — and `includeVoid` so a deleted row, which the list still
 * shows under Show deleted, can still be opened and read.
 */
export function useReceipt(transactionId: string, exits: ReceiptExits) {
  const { database, ws } = useApp();
  const router = useRouter();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  // Removed cards too: a purchase made on one still names it, by its digits.
  const cards = useCardsWithArchived().data ?? [];
  const goals = useGoals().data ?? [];
  const today = isoDate();

  const plans = useInstallments();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const receipt = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = receipt.data ?? null;

  const points = useQuery({
    queryKey: ['receipt-points', ws.workspaceId, transactionId],
    enabled: tx !== null && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, [tx!], accounts),
  });
  // Both through the hooks that already own these cache keys. A second `useQuery` on ['events', …] here would
  // be the same key holding a workspace-narrowed list, and whichever screen mounted first would decide what the
  // other one saw — an event read owner-wide, as `useEvents` reads it, is the one that is right.
  const debts = usePeopleDebts(today);
  const events = useEvents();
  const photoRows = useQuery({ queryKey: ['photos', ws.workspaceId, transactionId], queryFn: () => listPhotos(database, ws, transactionId) });
  const badges = useWorkspaceBadges(tx ? [tx.id] : []);
  // A purchase in a shared workspace (spec §11): who paid, and with what, as the payer's device named it.
  const payerOf = usePurchasePayers(tx ? [tx.id] : [], true);
  const duplicable = useDuplicable(tx ? [tx] : []);
  const urls = usePhotoUrls(photoRows.data ?? []);
  /*
   * The three refusals, asked once for the whole app rather than copied onto every way in: a trade is
   * corrected on its holding's page so its units stay in step, an opening balance and a deleted row have no form that
   * could represent them, and another workspace's row is read-only until that workspace is open. The form
   * route asks the same hook, so the two can never answer differently.
   */
  const { changeable, elsewhere, isTrade, holdingId } = useChangeable(tx);
  // A row of a joint account or card: who recorded it and who changed it.
  const jointNote = useQuery({ queryKey: ['joint-row-note', transactionId], queryFn: () => jointRowNote(database, transactionId) }).data ?? null;
  /*
   * A transaction a shared event put here follows its record (shared events §5, §7): it is changed on the event — Edit
   * opens the expense's own card, or the event for a settle-up — never deleted or copied on its own (the ledger refuses
   * it: EVENT_POSTING), and it says who last changed the record when that was not this phone's person.
   */
  const fromEvent = useQuery({ queryKey: ['event-posting', transactionId], queryFn: () => eventPostingOf(database, transactionId) }).data ?? null;
  // A shared workspace's transfer listed on a shared event instead of the workspace (an ATM withdrawal for a trip): the
  // event it is on, and Remove from event to put it back.
  const onEvent = useQuery({ queryKey: ['event-transfer', transactionId], queryFn: () => eventTransferOf(database, transactionId) }).data ?? null;
  // Withdrawal rate §7: the withdrawals a spend from foreign money came from.
  const withdrawal = useWithdrawalsUsed(tx?.id ?? null).data ?? null;
  // The market rates held for the day, for a transfer between currencies' Rate row (owner, 17 Nov 2026). Only the
  // currencies its money moved in; the base is never asked for.
  const moneyCurrencies = (tx?.entries ?? []).filter((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability').map((entry) => entry.currency);
  const heldRates = useHeldRates(new Set(moneyCurrencies).size > 1 ? moneyCurrencies : [], tx?.occurredOn ?? today).data?.rates ?? {};
  // The recurring bill this purchase settles a month of, when it does (linked afterwards, or paid from the bill).
  const bill = useBillOfPurchase(transactionId).data ?? null;
  /*
   * A credit card purchase or refund that can carry the paid-off mark — the same answer the card's statement gives
   * before it offers Paid off — switches it here too, where a tap on the row lands. Null for everything else.
   */
  const paidOffMark = useQuery({ queryKey: ['paid-off-mark', ws.workspaceId, transactionId], queryFn: () => paidOffMarkOf(database, ws, transactionId) }).data ?? null;

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await deleteTransaction(database, ws, transactionId);
      await invalidate();
      exits.onDeleted();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes the purchase out of its event: it comes back to Cashflow, and the event no longer counts it. A transfer listed
   * on a shared event comes back to its workspace's list, on every phone in it, and off the event.
   */
  async function removeFromEvent() {
    setError(null);
    setBusy(true);
    try {
      if (onEvent) await removeTransferFromSharedEvent(database, ws, transactionId);
      else await tagTransactions(database, ws, [transactionId], null);
      await invalidate();
      // A fee split off the transfer for the trip goes back onto it, which replaces it: the receipt follows the row.
      const standing = onEvent ? await standingTransaction(database, transactionId) : transactionId;
      if (standing !== transactionId) exits.onReplaced(standing);
      showToast(`Removed from ${onEvent ? (onEvent.eventName ?? 'the event') : ((events.data ?? []).find((event) => event.id === tx?.eventId)?.name ?? 'the event')}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** The paid-off mark, on or off: a balancing settlement beside the purchase, so the card still owes what it owed. */
  async function markPaidOff(on: boolean) {
    setError(null);
    setBusy(true);
    try {
      await setSettledBeforeApp(database, ws, transactionId, on);
      // The statement and this receipt both read the mark: every query hears.
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const base = { receipt, tx, accounts, busy, error, setError, remove, removeFromEvent, markPaidOff, photos: photoRows.data ?? [], urls, jointNote, fromEvent, onEvent, paidOffMark, bill, changeable, elsewhere, isTrade, holdingId };
  if (!tx) return { ...base, view: null };

  const kind = classify(tx);
  // A transfer or a card's payment whose pair keeps an account unchanged names that account; the other side moved.
  const pastMove =
    tx.past && kind.type === 'transfer'
      ? pastMoveRow((tx.pastAccountIds ?? []).map((id) => accounts.find((account) => account.id === id)?.name ?? '').filter(Boolean), isCardPayment(tx))
      : null;
  const categoryNames = kind.categoryIds.map((id) => accounts.find((account) => account.id === id)?.name).filter(Boolean);
  const book = badges.of(tx.id);
  // Who owes what on *this* transaction: its own debt entries, named by the person each debt account belongs to.
  const personByAccount = new Map(
    [...(debts.data?.owedToYou ?? []), ...(debts.data?.settled ?? [])].flatMap((person) => person.loans.map((loan) => [loan.accountId, person.personName] as const)),
  );
  const owed = tx.entries
    .filter((entry) => entry.amountMinor > 0 && personByAccount.has(entry.accountId))
    .map((entry) => ({ personName: personByAccount.get(entry.accountId)!, totalMinor: entry.amountMinor }));

  const lines = receiptLines({
    tx,
    accounts,
    cards,
    currency: ws.baseCurrency,
    points: points.data?.[tx.id] ?? null,
    owed,
    eventName: (events.data ?? []).find((event) => event.id === tx.eventId)?.name,
    goalName: goals.find((goal) => goal.id === tx.goalId)?.name,
    payer: payerOf(tx.id),
    withdrawal,
    today,
    ratesToBase: heldRates,
  });

  /*
   * What this purchase may do with a bill, by the same refusals the old "Link to a bill" and Unlink rows asked: a
   * purchase still posted and filed here, not a trade (changed on its holding) nor a shared event's (changed there).
   */
  const mayChange = !(isTrade && holdingId) && (changeable || (isCorrection(tx) && !isTrade)) && !fromEvent;
  const billRow = tx.status === 'posted' && !elsewhere && (bill !== null || (kind.type === 'expense' && mayChange));
  // None, or a link this purchase may move or let go: the bill list, its ✓ on the current one. Pay's own payment, or a
  // link it may not change, opens the bill itself.
  const openBill = () => {
    // A purchase that settles several bills (0127) opens the first of them: its parts' bills are changed in its Split.
    if (!bill || (bill.linked && changeable && bill.count < 2)) {
      // Linking from the list comes back to this very entry (`stepsBackToReceipt`), not a second receipt on top.
      markReceiptAt(transactionId, historyIndex(router.history));
      void navigate({ to: '/transactions/$transactionId/bill', params: { transactionId } });
    } else {
      void navigate({ to: '/bills/$billId', params: { billId: bill.templateId }, search: FROM_TRANSACTION });
    }
  };

  const caption = heroCaption(tx, kind.amountMinor);
  // A credit card purchase of this phone's own card can be turned into instalments; one already is reads its plan.
  const plan = (plans.data ?? []).find((row) => row.transactionId === tx.id) ?? null;
  // An investment bought with the card can be turned too (TF 139): never spending, so its plan counts At purchase.
  const instalmentCard = instalmentCardOf(tx, accounts, { trade: isTrade });
  const spread = spreadCaption(plan, kind.currency);
  // One purchase split across workspaces, or with a part Not counted: each part, with the workspace it is counted in.
  const parts = splitParts(tx, accounts, book);
  // Delete, by the receipt's own refusals: not a trade, not a shared event's (deleted there), changeable or a correction.
  const deletable = !(isTrade && holdingId) && (changeable || (isCorrection(tx) && !isTrade && !elsewhere)) && !fromEvent;
  // A shared event's copy that was deleted there has no event left to change it on, and the ledger refuses it alone.
  const editable = changeable && !fromEvent?.deletedHere;

  return {
    ...base,
    view: {
      kind,
      pastMove,
      categoryNames,
      book,
      lines,
      billRow,
      openBill,
      caption,
      plan,
      instalmentCard,
      spread,
      parts,
      deletable,
      editable,
      duplicable: changeable && duplicable(tx) && !fromEvent,
      // A payment into a credit card opens as "Edit payment", in the Pay screen's layout (FormPage).
      cardPayment: isCardPayment(tx),
    },
  };
}

export type Receipt = ReturnType<typeof useReceipt>;
export type ReceiptView = NonNullable<Receipt['view']>;
