import { useOpenBookReadOnly } from '../sharing/queries';
import { minorToMajorString } from '@expanses/core';
import { eventPostingOf, linkEventItem, listTransactions, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { Card, RowHint } from '../../ui';
import { PushedTitle, SCREEN } from '../../ui/native';
import { buyRefusal, buySeed, coverTarget, eventOpening, isNothingLeft } from '../events/buy-item';
import { useEventPlan, useEvents } from '../events/queries';
import { useSharedEventPlan, useSharedEventView } from '../events/shared-queries';
import { isEditable } from './draft';
import { useChangeable } from './queries';
import { SharedExpenseCard } from './SharedExpenseCard';
import { type CardFollowUp, TransactionCard } from './TransactionCard';
import { useDuplicable } from './duplicable';

/**
 * `/transactions/new` — the card as a screen.
 *
 * A static segment outranks a dynamic one in this router, so this is matched before `/transactions/$transactionId`
 * and "new" is never read as an id. `add-transaction.spec.ts` asserts exactly that rather than trusting it.
 */
const newRoute = getRouteApi('/transactions/new');

export function NewTransactionRoute() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions');
  const readOnly = useOpenBookReadOnly();
  // An account's page opens the form already knowing the mode and the account; the tab bar's ＋ says neither. An
  // event's Add spending names the event, and a plan item's "Buy it now" the item and the tab the plan was read in.
  const { mode, account, to, event, item, expense, ws: tab, amount, currency, note, date } = newRoute.useSearch();
  const events = useEvents();
  /*
   * A shared event is recorded on its own card (shared events §6, R14): Paid by, Split, its categories, its rate. Read
   * before anything is drawn, because which card opens is the answer; an event that is not shared reads null here and
   * opens the workspace card exactly as before (D10). Its plan is the shared plan, for "Buy it now".
   */
  const shared = useSharedEventView(event ?? null);
  const sharedPlan = useSharedEventPlan(event && item && shared.data ? event : null);
  // Owner-wide, as the plan screens read it: the item is the plan's, whichever workspace's tab it was opened from.
  const plan = useEventPlan(item ? (event ?? null) : null);
  // The seed is read once, when the card opens, so the card waits for what it is checked against.
  const waiting = (!!event && events.isPending) || (!!item && plan.isPending);
  const opening = waiting
    ? null
    : eventOpening({ event, item }, events.data ?? [], (plan.data?.lines ?? []).flatMap((line) => line.items));
  const buying = opening?.item ?? null;

  /*
   * "Buy it now": the payment is also the item, so Save ties the two together with the id it posted. The payment it
   * just made is this item and nothing else, so the item takes the whole of it as its share.
   *
   * A receipt already spoken for is the one refusal with somewhere to go — ticking an item off claims what is left
   * of its receipt, so a receipt answering several items is settled on "What it covers" and not by a second tick.
   * The payment is posted and tagged by now either way, so carrying the user to that screen loses nothing and asks
   * them for exactly what the app could not know. Both ways out replace this screen, so Back from them does not
   * open the same purchase again.
   */
  const followUp: CardFollowUp | undefined =
    opening && buying
      ? {
          refuse: (draft) => buyRefusal(draft, opening.eventId),
          posted: async (transactionId) => {
            try {
              await linkEventItem(database, ws, buying.id, transactionId);
            } catch (e) {
              if (!isNothingLeft(e)) throw e;
              await navigate({ ...coverTarget(opening.eventId, transactionId, { item: buying.id, ws: tab }), replace: true });
              return;
            }
            await navigate({ to: '/events/$eventId/plan', params: { eventId: opening.eventId }, search: { ws: tab }, replace: true });
          },
          header: <RowHint>Filled in from the estimate. Change it to what the receipt really says.</RowHint>,
        }
      : undefined;

  if (event && (shared.isPending || (item && shared.data && sharedPlan.isPending))) {
    return (
      <div className={SCREEN}>
        <Card>Loading…</Card>
      </div>
    );
  }
  if (event && shared.data) {
    const view = shared.data;
    // Save and Back land on the event, which is where a shared expense is read; Save takes this screen's place.
    const toEvent = () => void navigate({ to: '/events/$eventId', params: { eventId: event }, replace: true });
    const bought = item ? (sharedPlan.data?.lines ?? []).flatMap((line) => line.items).find((row) => row.id === item) : undefined;
    // An expense deleted meanwhile — on this phone or another — is not opened as a new one: it says so, and Back leaves.
    if (expense && !view.expenses.some((e) => e.expenseId === expense && !e.voided)) {
      return (
        <div className={SCREEN}>
          <PushedTitle title="Edit transaction" back="Back" onBack={back} />
          <Card>That expense was deleted.</Card>
        </div>
      );
    }
    return (
      <div className={SCREEN}>
        <SharedExpenseCard
          view={view}
          {...(expense ? { expenseId: expense } : {})}
          {...(bought ? { itemId: bought.id, title: `Buy ${bought.name}`, seed: { note: bought.name, amount: minorToMajorString(bought.estimateMinor, view.currency), categoryId: bought.categoryId } } : {})}
          {...(!bought && !expense && (amount || note || date) ? { seed: { note: note ?? '', amount: amount ?? '', categoryId: null, ...(currency ? { currency } : {}), ...(date ? { occurredOn: date } : {}) } } : {})}
          onBack={back}
          onDone={toEvent}
        />
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      {/*
       * A subpage's bar, as New asset and New debt draw theirs: the circle back, the name centred. Back goes wherever
       * the form was opened from — the tab bar's ＋ works from every screen — and so do Save and Cancel, as the
       * sheet this page replaced closed onto the screen underneath. An event's Add spending is one more opener:
       * Back and Save land on the event again.
       */}
      {/* A share that ended here takes nothing new (§8.6): the notice above says why, and there is no form to fill. */}
      {readOnly ? null : waiting ? (
        <Card>Loading…</Card>
      ) : (
        <TransactionCard
          full
          title={buying ? `Buy ${buying.name}` : 'New transaction'}
          label="Add a transaction"
          // Spending into an event is spending: Expense, whatever the address asked.
          mode={opening ? 'expense' : mode}
          seed={{
            moneyId: account,
            toId: to,
            ...(opening ? { eventId: opening.eventId } : {}),
            ...(buying ? buySeed(buying, ws.baseCurrency) : {}),
          }}
          followUp={followUp}
          onBack={back}
          onDone={back}
        />
      )}
    </div>
  );
}

const route = getRouteApi('/transactions/$transactionId/edit');

/**
 * `/transactions/$transactionId/edit` — the same card, opened on one transaction.
 *
 * Task 10 deleted a route of this name and said why: it was written, nothing ever linked to it, and a surface
 * re-stating the three refusals that no user could reach and no test ran looks like protection and is not. The
 * condition it left behind was "when something needs a route to edit on, it brings the route and the tests with
 * it". A phone's Edit is that something — the receipt's Edit and the row's swipe both open this, for every kind
 * of transaction, so a correction is the Add screen again rather than a second screen to learn — and
 * `phone-transaction-gestures.spec.ts` walks it.
 *
 * The refusals are not re-stated here either. `useChangeable` answers them, and what it refuses is sent to the
 * receipt, which already says in words which workspace to open, or that a trade is corrected on Buy & sell.
 */
export function EditTransactionRoute() {
  const { transactionId } = route.useParams();
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions');
  // The receipt's own key and the receipt's own read: owner-wide, because an account's history is the owner's
  // and a deep link may name a transaction filed in another workspace.
  const receipt = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = receipt.data ?? null;
  const { changeable, elsewhere, isTrade } = useChangeable(tx);
  /*
   * A transaction a shared event put here follows its record (shared events §5): it is changed on the event's own card,
   * never as a transaction of its own — the ledger refuses that (EVENT_POSTING). The swipe's Edit lands here as the
   * receipt's does, so both are sent on: an expense to its card, a settle-up to its event.
   */
  const fromEvent = useQuery({ queryKey: ['event-posting', transactionId], queryFn: () => eventPostingOf(database, transactionId) });
  useEffect(() => {
    const record = fromEvent.data;
    if (!record) return;
    void navigate(
      record.kind === 'expense'
        ? { to: '/transactions/new', search: { event: record.eventId, expense: record.recordId }, replace: true }
        : { to: '/events/$eventId', params: { eventId: record.eventId }, replace: true },
    );
  }, [fromEvent.data]);
  // Only the settled refusals send anyone away. `changeable` is also false while the trades are still being
  // read, and redirecting on that would bounce a perfectly editable transaction out of its own form.
  const refused = receipt.isSuccess && (!tx || elsewhere !== null || isTrade || !isEditable(tx));
  /*
   * A save voids the transaction this screen reads, and the refetch after it reads it back void — "refused" — before
   * the card's way out runs. Redirecting then pushed the receipt of the voided original, and the list on top of it,
   * so a swipe back landed on a deleted transaction. Once a save has begun the redirect is the card's to make.
   */
  const saving = useRef(false);

  useEffect(() => {
    if (refused && !saving.current) void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  }, [refused, transactionId]);

  if (!tx || !changeable || !fromEvent.isSuccess || fromEvent.data) return <Card>Loading…</Card>;
  return (
    <div className={SCREEN}>
      {/* An edit voids the original and posts a new id, so the transaction this URL names is gone once it
          saves. The list is where to land — this address would only 404 into its own redirect — and it takes this
          screen's place in the history, so Back from the list does not open an edit of a transaction now void. */}
      <TransactionCard
        full
        title="Edit transaction"
        label="Edit a transaction"
        initial={tx}
        onBack={back}
        onSaveStart={() => {
          saving.current = true;
        }}
        onDone={() => void navigate({ to: '/transactions', replace: true })}
      />
    </div>
  );
}

const duplicateRoute = getRouteApi('/transactions/$transactionId/duplicate');

/**
 * `/transactions/$transactionId/duplicate` — the Add screen, started from one transaction.
 *
 * It asks `useChangeable` the very same question the edit route asks, so a trade, an opening balance, a deleted
 * row and a purchase filed in another workspace are sent to the receipt rather than copied. Saving posts a new
 * transaction and leaves the original alone, so Back and Save both land on the list.
 */
export function DuplicateTransactionRoute() {
  const { transactionId } = duplicateRoute.useParams();
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions');
  const receipt = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = receipt.data ?? null;
  const { changeable, elsewhere, isTrade } = useChangeable(tx);
  const duplicable = useDuplicable(tx ? [tx] : []);
  const refused = receipt.isSuccess && (!tx || elsewhere !== null || isTrade || (duplicable.ready && !duplicable(tx)));

  useEffect(() => {
    if (refused) void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  }, [refused, transactionId]);

  if (!tx || !changeable || !duplicable.ready || !duplicable(tx)) return <Card>Loading…</Card>;
  return (
    <div className={SCREEN}>
      <TransactionCard full title="Duplicate" label="Duplicate a transaction" duplicateOf={tx} onBack={back} onDone={() => void navigate({ to: '/transactions' })} />
    </div>
  );
}
