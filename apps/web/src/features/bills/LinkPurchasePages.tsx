import { formatMinor, isoDate, monthName } from '@expanses/core';
import { linkPurchaseToBill, listTransactions, ownerScope, RecurringError } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { GROUP_HEADER_CLASS, InsetGroup, InsetRow, PickerRow, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { classify } from '../transactions/classify';
import { Wheel } from '../networth/AssetRows';
import { billCurrencyOf } from './bill-view';
import { billsForPurchase, candidateLine, monthWithYear, purchaseCount, refusalText, repeatWords, wheelYears } from './bill-link-view';
import { useBillDetail, useBillLinkCandidates, useBillLinkRefusal, useBillMonthsBefore, useBillTemplates } from './queries';

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
  const { month } = useSearch({ from: '/bills/$billId/link' });
  return <LinkPurchasePage billId={billId} month={month} />;
}

/** The purchases that could settle one month of a bill, newest first. A tap links one and returns to the bill. */
export function LinkPurchasePage({ billId, month }: { billId: string; month: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
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
      void navigate({ to: '/bills/$billId', params: { billId }, search: from });
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
                    onClick={m.count > 0 ? () => void navigate({ to: '/bills/$billId/link', params: { billId }, search: { ...from, month: m.month } }) : undefined}
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

export function LinkToBillRoute() {
  const { transactionId } = useParams({ from: '/transactions/$transactionId/bill' });
  return <LinkToBillPage transactionId={transactionId} />;
}

/** The bills the purchase could settle: those in its own category first, then the rest. */
export function LinkToBillPage({ transactionId }: { transactionId: string }) {
  const navigate = useNavigate();
  const back = useStepBack();
  const accounts = useAccounts().data ?? [];
  const { ws } = useApp();
  const tx = usePurchase(transactionId).data ?? null;
  const bills = useBillTemplates().data ?? [];
  const { same, others } = billsForPurchase(bills, tx ? classify(tx).categoryIds : []);

  const row = (bill: (typeof bills)[number]) => {
    const payer = accounts.find((a) => a.id === bill.moneyAccountId);
    return (
      <InsetRow
        key={bill.id}
        testId={`bill-choice-${bill.id}`}
        icon={<CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" />}
        title={bill.name}
        subtitle={[repeatWords(bill), bill.repeat === 'monthly' ? payer?.name : null].filter(Boolean).join(' · ')}
        value={
          bill.amountMinor === null ? null : (
            <Money minor={bill.amountMinor} currency={bill.currency ?? payer?.currency ?? ws.baseCurrency} tone="none" />
          )
        }
        valueTone="ink-2"
        onClick={() => void navigate({ to: '/transactions/$transactionId/bill/$billId', params: { transactionId, billId: bill.id } })}
      />
    );
  };

  return (
    <div className={SCREEN}>
      <PushedTitle title="Link to a bill" back="Receipt" onBack={back} />
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

/** Which month of the bill the purchase settles, starting at the purchase's own. The ✓ links it and returns to the receipt. */
export function LinkBillMonthPage({ transactionId, billId }: { transactionId: string; billId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useStepBack();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const tx = usePurchase(transactionId).data ?? null;
  const bill = useBillDetail(billId, today).data?.bill;
  const [chosen, setChosen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const month = chosen ?? tx?.occurredOn.slice(0, 7) ?? today.slice(0, 7);
  const refusal = useBillLinkRefusal(billId, month, today);

  async function link() {
    setError(null);
    setBusy(true);
    try {
      await linkPurchaseToBill(database, ws, { templateId: billId, billMonth: month, transactionId, today });
      await invalidate();
      void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
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
        back="Link to a bill"
        onBack={back}
        actions={[{ key: 'link', label: 'Link to bill', glyph: <Check size={20} aria-hidden />, disabled: busy || !tx || !bill || refusal.data != null || refusal.isPending, run: () => void link() }]}
      />
      <ErrorBox error={error} />
      <InsetGroup>
        <PickerRow label="Month" value={monthWithYear(month)} onOpen={() => setPicking(true)} testId="link-month" />
        <ReadOnlyRow label="Purchase" value={tx && kind ? `${formatMinor(kind.amountMinor, kind.currency)} · ${tx.occurredOn.slice(8, 10).replace(/^0/, '')} ${monthName(tx.occurredOn.slice(0, 7), 'short')}` : ''} />
      </InsetGroup>
      {refusal.data && (
        <p role="alert" data-testid="link-refusal" className="px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
          {refusalText(refusal.data.code, month, refusal.data.message)}
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
