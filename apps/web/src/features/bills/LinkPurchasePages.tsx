import { dayMonth, formatMinor, isoDate, monthName } from '@expanses/core';
import { billLinkMonth, billLinkRefusal, eventPostingOf, linkPurchaseToBill, listTransactions, ownerScope, RecurringError, relinkPurchaseToBill, unlinkPurchaseFromBill } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { CalendarDays, Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { FROM_TRANSACTION, originHref, useFrom } from '../../app/from-search';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { GROUP_HEADER_CLASS, InsetGroup, InsetRow, PickerRow, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { classify } from '../transactions/classify';
import { Wheel } from '../networth/AssetRows';
import { billCurrencyOf } from './bill-view';
import { billsForPurchase, candidateLine, monthWithYear, purchaseCount, refusalText, repeatWords, wheelYears } from './bill-link-view';
import { returnToReceipt } from './receipt-return';
import { useBillDetail, useBillLinkCandidates, useBillLinkMonths, useBillLinkRefusal, useBillMonthsBefore, useBillOfPurchase, useBillTemplates } from './queries';

/* The two ways to link a purchase that is already recorded to a bill's month: from the bill (these first two pages) and from the purchase. */

const MONTHS_LONG = Array.from({ length: 12 }, (_, i) => monthName(`2026-${String(i + 1).padStart(2, '0')}`, 'long'));

/** A context line above the first group: which bill, which month. Drawn as a group header is, since it names what the list is for. */
function ContextLine({ children }: { children: string }) {
  return <p className={`${GROUP_HEADER_CLASS} px-[4px] pb-[6px]`}>{children}</p>;
}

/** The ‹ of these pages: one step back through where the person came from (the Pay sheet, the earlier months, a receipt). */
function useStepBack() {
  const router = useRouter();
  return () => router.history.back();
}

/* -------------------------------------------------- from the bill -------------------------------------------------- */

export function LinkPurchaseRoute() {
  const { billId } = useParams({ from: '/bills/$billId/link' });
  const { month, earlier } = useSearch({ from: '/bills/$billId/link' });
  return <LinkPurchasePage billId={billId} month={month} earlier={earlier === true} />;
}

/**
 * The purchases that could settle one month of a bill, newest first. A tap links one and steps back to the bill it was
 * opened from — past Earlier months too when it came through them (`earlier`) — rather than opening the bill again.
 */
export function LinkPurchasePage({ billId, month, earlier = false }: { billId: string; month: string; earlier?: boolean }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const back = useStepBack();
  const from = useFrom();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  const detail = useBillDetail(billId, today);
  const candidates = useBillLinkCandidates(billId, month);
  const refusal = useBillLinkRefusal(billId, month, today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const bill = detail.data?.bill;
  const currency = bill ? billCurrencyOf(bill, accounts, ws.baseCurrency) : ws.baseCurrency;

  async function link(transactionId: string) {
    setError(null);
    setBusy(true);
    try {
      await linkPurchaseToBill(database, ws, { templateId: billId, billMonth: month, transactionId, today });
      await invalidate();
      if (router.history.canGoBack()) router.history.go(earlier ? -2 : -1);
      else void navigate({ to: '/bills/$billId', params: { billId }, search: from, replace: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="Link a purchase" back={bill?.name ?? 'Bill'} onBack={back} />
      <ErrorBox error={error ?? candidates.error ?? detail.error} />
      {bill && month && <ContextLine>{`${bill.name} · ${monthWithYear(month)}`}</ContextLine>}
      {refusal.data && (
        <p role="alert" data-testid="link-refusal" className="px-[4px] pb-[10px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
          {refusalText(refusal.data.code, month, refusal.data.message)}
        </p>
      )}
      <InsetGroup header="In the bill's category, newest first">
        {candidates.data && candidates.data.length === 0 ? (
          <InsetRow title={<span className="font-normal text-[var(--ph-ink-3)]">No purchase found</span>} testId="no-purchase" />
        ) : (
          (candidates.data ?? []).map((c) => (
            <InsetRow
              key={c.transactionId}
              testId="link-candidate"
              icon={bill ? <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" /> : undefined}
              title={c.description || 'Purchase'}
              subtitle={candidateLine(c.occurredOn, accounts.find((a) => a.id === c.payerAccountId)?.name)}
              value={
                <span className="block text-right">
                  <Money minor={c.amountMinor} currency={c.currency || currency} tone="none" />
                  {c.isClose && <span className="block text-[12px] leading-[14px] text-[var(--ph-ink-3)]">close</span>}
                </span>
              }
              valueTone="ink-2"
              chevron={false}
              disabled={busy || refusal.data != null}
              onClick={() => void link(c.transactionId)}
            />
          ))
        )}
      </InsetGroup>
    </div>
  );
}

export function EarlierMonthsRoute() {
  const { billId } = useParams({ from: '/bills/$billId/earlier' });
  return <EarlierMonthsPage billId={billId} />;
}

/** The months before the bill started, with how many purchases each holds. A year more is loaded on request. */
export function EarlierMonthsPage({ billId }: { billId: string }) {
  const navigate = useNavigate();
  const back = useStepBack();
  const from = useFrom();
  const detail = useBillDetail(billId, isoDate());
  const [pages, setPages] = useState(1);
  const months = useBillMonthsBefore(billId, pages);
  const bill = detail.data?.bill;

  return (
    <div className={SCREEN}>
      <PushedTitle title="Earlier months" back={bill?.name ?? 'Bill'} onBack={back} />
      <ErrorBox error={months.error ?? detail.error} />
      {bill && months.data && (
        <InsetGroup header={`Before ${monthWithYear(bill.startsMonth)}`}>
          {[
            ...(months.data.months.length === 0
              ? [<InsetRow key="none" title={<span className="font-normal text-[var(--ph-ink-3)]">None found</span>} />]
              : months.data.months.map((m) => (
                  <InsetRow
                    key={m.month}
                    testId={`earlier-${m.month}`}
                    title={monthWithYear(m.month)}
                    plain
                    value={purchaseCount(m.count)}
                    valueTone="ink-3"
                    chevron={m.count > 0}
                    onClick={m.count > 0 ? () => void navigate({ to: '/bills/$billId/link', params: { billId }, search: { ...from, month: m.month, earlier: true } }) : undefined}
                  />
                ))),
            ...(months.data.nextFrom ? [<InsetRow key="more" action title="Show earlier months" onClick={() => setPages((p) => p + 1)} />] : []),
          ]}
        </InsetGroup>
      )}
    </div>
  );
}

/* ------------------------------------------------- from the purchase ------------------------------------------------- */

/** The purchase, read owner-wide as its receipt reads it, through the same cache entry. */
function usePurchase(transactionId: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
}

/**
 * The shared event a purchase was posted by, through the receipt's own cache entry. Such a purchase is changed on its
 * event: a link it already has can be opened or let go here, never moved to another bill or month.
 */
function useFromEvent(transactionId: string) {
  const { database } = useApp();
  return useQuery({ queryKey: ['event-posting', transactionId], queryFn: () => eventPostingOf(database, transactionId) });
}

export function LinkToBillRoute() {
  const { transactionId } = useParams({ from: '/transactions/$transactionId/bill' });
  return <LinkToBillPage transactionId={transactionId} />;
}

/** The list's title, and what the month page's ‹ is named for: "Bill" once the purchase has one, else "Link to a bill". */
const listTitle = (linked: boolean) => (linked ? 'Bill' : 'Link to a bill');

/**
 * The bills the purchase could settle: those in its own category first, then the rest. A tap on a bill links the
 * purchase at once, in the month the row names (`billLinkMonth`), and steps back to the receipt; a month that cannot
 * take it opens the month page instead, saying why. A swipe left offers Month, to choose another first. A purchase
 * already linked sees its bill with a ✓ — a tap on it opens its months, another bill moves the link — and, under the
 * list, Open this bill and Unlink.
 */
export function LinkToBillPage({ transactionId }: { transactionId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const back = useStepBack();
  const today = isoDate();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const tx = usePurchase(transactionId).data ?? null;
  const current = useBillOfPurchase(transactionId).data ?? null;
  // A shared event's purchase keeps the bill it has: Open this bill and Unlink only, the other bills inert.
  const locked = (useFromEvent(transactionId).data ?? null) !== null;
  const bills = useBillTemplates().data ?? [];
  const { same, others } = billsForPurchase(bills, tx ? classify(tx).categoryIds : []);
  // Linked to a bill no longer listed (paused or stopped): still named, with its ✓, in a row of its own.
  const unlisted = current !== null && !bills.some((bill) => bill.id === current.templateId) ? current : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The month a tap on each bill links to, named on its row.
  const linkMonths = useBillLinkMonths(
    bills.map((bill) => bill.id),
    tx?.occurredOn ?? null,
    today,
  ).data;

  const openMonths = (billId: string) => void navigate({ to: '/transactions/$transactionId/bill/$billId', params: { transactionId, billId } });

  /** Links the purchase to the bill's month at once and returns to the receipt, or opens the month page when it cannot. */
  async function quickLink(billId: string) {
    if (!tx) return;
    setError(null);
    setBusy(true);
    try {
      const { month, ask } = await billLinkMonth(database, ws, { templateId: billId, purchasedOn: tx.occurredOn, today });
      if (ask || (await billLinkRefusal(database, ws, { templateId: billId, billMonth: month, today }))) {
        // The month page reads the same refusal, or says when the month comes out, under the month, with the wheel to
        // choose another.
        openMonths(billId);
        return;
      }
      await relinkPurchaseToBill(database, ws, { templateId: billId, billMonth: month, transactionId, today });
      await invalidate();
      returnToReceipt(router.history, transactionId, originHref);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Lets the bill's month go: the purchase stays, the month is owed again, and the receipt reads None. */
  async function unlink() {
    setError(null);
    setBusy(true);
    try {
      await unlinkPurchaseFromBill(database, ws, { transactionId });
      await invalidate();
      back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const tick = (
    <span data-testid="bill-current" className="text-[var(--ph-tint)]">
      <Check size={20} aria-label="Linked" />
    </span>
  );
  const row = (bill: (typeof bills)[number]) => {
    const payer = accounts.find((a) => a.id === bill.moneyAccountId);
    const linked = current?.templateId === bill.id;
    const month = linked ? current.billMonth : (linkMonths?.[bill.id]?.month ?? null);
    return (
      <InsetRow
        key={bill.id}
        testId={`bill-choice-${bill.id}`}
        icon={<CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" />}
        title={bill.name}
        // Each bill names its month first: the one the current bill settles (a tap on it offers another), or the one a
        // tap links to.
        subtitle={[month ? monthWithYear(month) : null, repeatWords(bill), bill.repeat === 'monthly' ? payer?.name : null].filter(Boolean).join(' · ')}
        value={
          linked ? (
            tick
          ) : bill.amountMinor === null ? null : (
            <Money minor={bill.amountMinor} currency={bill.currency ?? payer?.currency ?? ws.baseCurrency} tone="none" />
          )
        }
        valueTone="ink-2"
        chevron={false}
        disabled={(locked && !linked) || (!locked && busy)}
        onClick={locked ? undefined : linked ? () => openMonths(bill.id) : () => void quickLink(bill.id)}
        leftActions={locked || linked ? undefined : [{ label: 'Month', name: `Choose the month for ${bill.name}`, icon: CalendarDays, tone: 'primary', onPress: () => openMonths(bill.id) }]}
      />
    );
  };

  return (
    <div className={SCREEN}>
      <PushedTitle title={listTitle(current !== null)} back="Transaction" onBack={back} />
      <ErrorBox error={error} />
      {unlisted && (
        <InsetGroup header="Linked to">
          <InsetRow testId={`bill-choice-${unlisted.templateId}`} title={unlisted.name} subtitle={monthWithYear(unlisted.billMonth)} value={tick} valueTone="ink-2" chevron={false} />
        </InsetGroup>
      )}
      {bills.length === 0 ? (
        <InsetGroup>
          <InsetRow title={<span className="font-normal text-[var(--ph-ink-3)]">No recurring bills</span>} />
        </InsetGroup>
      ) : (
        <>
          {same.length > 0 && <InsetGroup header="Bills in this category first">{same.map(row)}</InsetGroup>}
          {others.length > 0 && <InsetGroup header={same.length > 0 ? 'Other bills' : 'Bills in this category first'}>{others.map(row)}</InsetGroup>}
        </>
      )}
      {current?.linked && (
        <InsetGroup footer={locked ? 'From a shared event: changed on the event. It can be let go here, not moved.' : undefined}>
          <InsetRow
            title="Open this bill"
            plain
            testId="open-bill"
            onClick={() => void navigate({ to: '/bills/$billId', params: { billId: current.templateId }, search: FROM_TRANSACTION })}
          />
          <InsetRow action title="Unlink" disabled={busy} onClick={() => void unlink()} testId="unlink-bill" />
        </InsetGroup>
      )}
    </div>
  );
}

export function LinkBillMonthRoute() {
  const { transactionId, billId } = useParams({ from: '/transactions/$transactionId/bill/$billId' });
  return <LinkBillMonthPage transactionId={transactionId} billId={billId} />;
}

/** A month and year chosen on two wheels, as a date picker in a sheet draws them. */
function MonthYearSheet({ month, years, onClose, onPick }: { month: string; years: string[]; onClose: () => void; onPick: (month: string) => void }) {
  const [draft, setDraft] = useState({ year: month.slice(0, 4), month: month.slice(5, 7) });
  return (
    <Sheet title="Month" onClose={onClose} confirm={{ label: 'Done', run: () => onPick(`${draft.year}-${draft.month}`) }}>
      <div className="flex gap-[4px] px-[8px] pb-[16px]">
        <Wheel label="Month" items={MONTHS_LONG.map((name, i) => ({ value: String(i + 1).padStart(2, '0'), label: name }))} value={draft.month} onChange={(m) => setDraft((d) => ({ ...d, month: m }))} />
        <Wheel label="Year" items={years.map((y) => ({ value: y, label: y }))} value={draft.year} onChange={(y) => setDraft((d) => ({ ...d, year: y }))} />
      </div>
    </Sheet>
  );
}

/** Which month of the bill the purchase settles, starting at the one a tap on the list would link. The ✓ links it and returns to the receipt. */
export function LinkBillMonthPage({ transactionId, billId }: { transactionId: string; billId: string }) {
  const { database, ws } = useApp();
  const router = useRouter();
  const locked = (useFromEvent(transactionId).data ?? null) !== null;
  const back = useStepBack();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const tx = usePurchase(transactionId).data ?? null;
  const bill = useBillDetail(billId, today).data?.bill;
  // The bill the purchase settles a month of already, if any: its month is where this page starts, and ✓ moves the link.
  const currentQuery = useBillOfPurchase(transactionId);
  const current = currentQuery.data ?? null;
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Not linked to this bill yet: the month the bill list links to on a tap — the purchase's own for a monthly bill, the
  // nearest occurrence for a yearly or every-few-months one (a month it comes out in, so not refused for that).
  const startQuery = useBillLinkMonths([billId], tx?.occurredOn ?? null, today);
  const startChoice = startQuery.data?.[billId] ?? null;
  const start = startChoice?.month ?? null;
  const month = chosen ?? (current?.templateId === billId ? current.billMonth : null) ?? start ?? tx?.occurredOn.slice(0, 7) ?? today.slice(0, 7);
  // The month it already settles: ✓ changes nothing, and the month's "already settled" is this purchase itself.
  const unchanged = current?.templateId === billId && current.billMonth === month;
  const refusal = useBillLinkRefusal(billId, month, today);
  const refused = unchanged ? null : (refusal.data ?? null);
  // Started at a month the tap asked about because it is not out yet on the purchase date: said first.
  const notOutYet = chosen === null && current?.templateId !== billId && startChoice?.ask && tx && startChoice.opensOn > tx.occurredOn ? startChoice.opensOn : null;

  async function link() {
    setError(null);
    setBusy(true);
    try {
      // One step whether it links or moves: the old month is let go and the new one paid in the same write.
      if (!unchanged) await relinkPurchaseToBill(database, ws, { templateId: billId, billMonth: month, transactionId, today });
      await invalidate();
      // Back to the receipt's own entry, so its ‹ goes where it was opened from (Cashflow), however it was reached.
      returnToReceipt(router.history, transactionId, originHref);
    } catch (e) {
      setError(e instanceof RecurringError ? new Error(refusalText(e.code, month, e.message)) : e);
    } finally {
      setBusy(false);
    }
  }

  const kind = tx ? classify(tx) : null;
  return (
    <div className={SCREEN}>
      <PushedTitle
        title={bill?.name ?? 'Bill'}
        back={listTitle(current !== null)}
        onBack={back}
        actions={[
          {
            key: 'link',
            label: 'Link to bill',
            glyph: <Check size={20} aria-hidden />,
            disabled: busy || !tx || !bill || currentQuery.isPending || (chosen === null && start === null && startQuery.isPending) || (locked && !unchanged) || (!unchanged && (refusal.data != null || refusal.isPending)),
            run: () => void link(),
          },
        ]}
      />
      <ErrorBox error={error} />
      <InsetGroup>
        <PickerRow label="Month" value={monthWithYear(month)} onOpen={() => setPicking(true)} testId="link-month" />
        <ReadOnlyRow label="Purchase" value={tx && kind ? `${formatMinor(kind.amountMinor, kind.currency)} · ${tx.occurredOn.slice(8, 10).replace(/^0/, '')} ${monthName(tx.occurredOn.slice(0, 7), 'short')}` : ''} />
      </InsetGroup>
      {refused && (
        <p role="alert" data-testid="link-refusal" className="px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
          {refusalText(refused.code, month, refused.message)}
        </p>
      )}
      {!refused && notOutYet && (
        <p data-testid="link-not-out" className="px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
          {`${monthWithYear(month)} is not out until ${dayMonth(notOutYet)}`}
        </p>
      )}
      {picking && (
        <MonthYearSheet
          month={month}
          years={wheelYears(tx?.occurredOn.slice(0, 7) ?? today.slice(0, 7), today.slice(0, 7))}
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setChosen(picked);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
