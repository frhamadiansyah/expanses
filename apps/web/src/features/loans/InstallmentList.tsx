import { clampPaidSoFar, formatMinor, groupTypedAmount, installmentSchedule, installmentSplit, isoDate, monthYear, paidSoFarOn } from '@expanses/core';
import { type CardInstallmentRow, deleteInstallment, saveInstallment, updateInstallment } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, ProgressBar, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native/metrics';
import { useMonthStart } from '../workspaces/queries';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { Line, SUBTITLE, TextLine, TITLE } from '../cards/rows';
import { blankPlanForm, type PlanForm, planFields, planFormOf, purchaseChoices, shownPurchase } from './plan-form';
import { PaidList } from './PaidList';
import { countingLine, firstBilledDate, mayCountTwice, noPurchaseWarning, owedFooter, paidListRows, planProgress } from './plan-view';
import { useAllPlanInstalments, useCardDays, useCardHasOpening, useCardLines, useInstallments, usePlanCategoryChoices } from './queries';

/** The line a plan with no purchase chosen shows, above Save and on its page (`noPurchaseWarning`). */
export function NoPurchaseWarning({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p data-testid="no-purchase-warning" className="mx-[4px] mb-[14px] rounded-[9px] bg-[var(--ph-warn-panel)] px-[12px] py-[9px] text-[13px] leading-[18px] text-[var(--ph-warn-ink)]">
      {text}
    </p>
  );
}

/**
 * "Family · Food & drink › Restaurants": a category's workspace, its parent's name and its own, for a flat list of
 * choices across workspaces (0123: the plan counts in that workspace).
 */
export function categoryLabel(id: string, all: readonly { id: string; name: string; parentId: string | null; bookName?: string | null }[]): string {
  const row = all.find((c) => c.id === id);
  if (!row) return '';
  const parent = row.parentId ? all.find((c) => c.id === row.parentId) : undefined;
  const name = parent ? `${parent.name} › ${row.name}` : row.name;
  return row.bookName ? `${row.bookName} · ${name}` : name;
}

/** The Category row's value for Investment (not spending): no category, kept At purchase. */
export const INVESTMENT_CHOICE = '__investment';

/**
 * One plan on the card page: its name and what is left to pay on the top line, then how many are paid and when it ends,
 * and the bar under them across the whole row. Paid is what the plan's own page says (`planInstalmentStatuses`): ticked,
 * or covered by the card's payments — never the calendar. The whole row is the tap target; it opens the plan's own page.
 */
export function InstallmentRow({ plan, currency, today, position, onOpen }: GroupChild & { plan: CardInstallmentRow; currency: string; today: string; onOpen: () => void }) {
  const progress = planProgress(plan.totalMinor, useAllPlanInstalments(today).data?.[plan.id] ?? []);
  const paid = progress.paid;
  const ends = progress.endsMonth ?? installmentSplit(plan, today).lastMonth;
  return (
    // Every figure of a plan is worth reading whole, so its lines wrap rather than truncate beside a figure.
    <Line position={position} testId="card-instalment" pad="0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${plan.description}`}
        className="ph-focus-inset block w-full bg-transparent text-left"
        style={{ padding: '11px 12px 11px 13px' }}
      >
        <span className="flex w-full items-center gap-[6px]">
          <span className={`min-w-0 flex-1 ${TITLE}`}>{plan.description}</span>
          <span className="tabular shrink-0 text-[15px] leading-[20px] text-[var(--ph-ink)]">{formatMinor(progress.leftMinor, currency)} left</span>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
        </span>
        <ProgressBar className="my-[4px] w-full" currentMinor={paid} targetMinor={plan.months} label={`${plan.description}: ${paid} of ${plan.months} paid`} />
        <span className={`block w-full ${SUBTITLE}`}>
          {paid} of {plan.months} paid · ends {monthYear(ends)}
        </span>
      </button>
    </Line>
  );
}

/**
 * First billed, as the full date the card bills it on (owner, 17 Nov 2026: "13 March 2025", on the card's statement
 * day): a month is chosen, the day follows from the card. The month field lies over the row, as the date row's does.
 */
function FirstBilledRow({ month, shown, onChange, position }: GroupChild & { month: string; shown: string | null; onChange: (month: string) => void }) {
  return (
    <div className="relative" data-testid="plan-first-billed">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div aria-hidden className="flex w-full items-center gap-3" style={{ minHeight: rowHeight(false), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="shrink-0 text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">First billed</span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-[6px]">
          <span className="truncate text-right text-[17px] leading-[22px] text-[var(--ph-ink-3)] md:text-[15px] md:leading-[20px]">{shown ?? 'Month'}</span>
          <span className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
        </span>
      </div>
      <input
        type="month"
        aria-label="First billed"
        value={month}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // A browser that will not show its picker on a click still takes the keyboard.
          }
        }}
        className="ph-focus-inset absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

/**
 * The sheet that adds, edits and removes a card's instalment plans, shared by the card page's box and the Instalments
 * page: `open` shows it for a new plan or an existing one, `node` is what to draw once, anywhere in the page.
 */
export function usePlanEditor(cardAccountId: string, currency: string, opts: { onRemoved?: () => void } = {}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const formEl = useRef<HTMLFormElement>(null);
  const monthStart = useMonthStart();
  const days = useCardDays(cardAccountId).data;
  const statementDay = days?.statementDay ?? 1;
  /** The sheet: closed, a new plan, or the plan being edited. */
  const [sheet, setSheet] = useState<'new' | CardInstallmentRow | null>(null);
  const lines = useCardLines(cardAccountId, sheet !== null);
  const accounts = useAccounts().data ?? [];
  const hasOpening = useCardHasOpening(cardAccountId, sheet === 'new').data ?? false;
  const cardName = accounts.find((account) => account.id === cardAccountId)?.name ?? 'the card';
  /** A new plan with no purchase: how many its Paid list is ticked to, once touched; until then what was due before today. */
  const [paidTouched, setPaidTouched] = useState<number | null>(null);
  const [paidOpen, setPaidOpen] = useState(false);
  const categories = usePlanCategoryChoices(sheet !== null).data ?? [];
  // A new plan's Purchase follows the typed total until the owner touches it; an existing plan's is its own.
  const [purchaseTouched, setPurchaseTouched] = useState(false);
  const [form, setForm] = useState<PlanForm>(() => blankPlanForm(today));
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const patch = (change: Partial<PlanForm>) => setForm((was) => ({ ...was, ...change }));

  const open = (target: 'new' | CardInstallmentRow) => {
    setError(null);
    setForm(target === 'new' ? blankPlanForm(today) : planFormOf(target, currency));
    setPurchaseTouched(target !== 'new');
    setPaidTouched(null);
    setPaidOpen(false);
    setSheet(target);
  };
  const close = () => {
    setSheet(null);
    setRemoving(false);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!sheet) return;
    setError(null);
    setBusy(true);
    try {
      const fields = planFields({ ...form, transactionId: purchase }, currency, { trade });
      // With no purchase, what the Paid list says is paid; the rest goes on the card's balance.
      if (sheet === 'new') await saveInstallment(database, ws, { cardAccountId, ...fields, ...(paid ? { paidSoFar: paid.paidSoFar } : {}) });
      else await updateInstallment(database, ws, { id: sheet.id, ...fields });
      await invalidate();
      close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!sheet || sheet === 'new') return;
    setError(null);
    try {
      await deleteInstallment(database, ws, sheet.id);
      await invalidate();
      close();
      opts.onRemoved?.();
    } catch (e) {
      setRemoving(false);
      setError(e);
    }
  }

  const editing = sheet !== null && sheet !== 'new';
  const editSplit = sheet !== null && sheet !== 'new' ? installmentSplit(sheet, today) : null;
  // The purchase the plan came from: the card's own charges, the one charging the plan's total first.
  const typedTotal = (() => {
    try {
      return planFields(form, currency).totalMinor;
    } catch {
      return 0;
    }
  })();
  const planId = sheet && sheet !== 'new' ? sheet.id : null;
  // A purchase counts in its own category: what the sheet's line names.
  const purchaseCategoryName = (() => {
    const id = (lines.data ?? []).find((line) => line.instalment?.planId === planId && line.instalment.categoryId)?.instalment?.categoryId;
    return id ? (accounts.find((account) => account.id === id)?.name ?? null) : null;
  })();
  const choices = purchaseChoices(lines.data ?? [], planId, typedTotal);
  const purchase = shownPurchase(form, typedTotal, lines.data ?? [], purchaseTouched);
  // How it counts is the app's (TF 139): an investment buy, or Investment chosen with no purchase, is saving.
  const trade = purchase !== null && (lines.data ?? []).some((line) => line.transactionId === purchase && line.trade);
  const investment = purchase ? trade : form.investment;
  const categoryName = form.categoryAccountId ? categoryLabel(form.categoryAccountId, categories) || null : null;
  const warning = noPurchaseWarning(mayCountTwice({ id: planId, transactionId: purchase, totalMinor: typedTotal }, lines.data ?? []), investment, categoryName);
  // The plan as typed: its months follow the card's statement day.
  const typed = (() => {
    const months = Number(form.months);
    if (!Number.isInteger(months) || months < 1 || months > 600 || !(typedTotal > 0) || !/^\d{4}-\d{2}$/.test(form.firstBilledMonth)) return null;
    return { totalMinor: typedTotal, months, monthlyMinor: Math.round(typedTotal / months), firstBilledMonth: form.firstBilledMonth, rateBps: 0, conversionFeeMinor: 0, earnsPoints: form.earnsPoints };
  })();
  const typedSchedule = typed ? installmentSchedule(typed, statementDay) : [];
  // A new plan with no purchase (owner, 17 Nov 2026, mockup 1b): its instalments under Paid, those due before today ticked.
  const paid = (() => {
    if (sheet !== 'new' || purchase || !typed) return null;
    const dueDay = days?.dueDay ?? null;
    const paidSoFar = clampPaidSoFar(paidTouched ?? paidSoFarOn(typed, statementDay, dueDay, today), typed.months);
    return { paidSoFar, rows: paidListRows({ schedule: typedSchedule, paidSoFar, dueDay, open: 2, expanded: paidOpen }), footer: owedFooter(typed, paidSoFar, currency, cardName, hasOpening) };
  })();
  // What the footer reads for the plan as typed: its months follow the card's statement day and the workspace's months.
  const footer = typed
    ? countingLine({ investment, monthlyMinor: typed.monthlyMinor, transactionId: purchase }, typedSchedule, currency, monthStart, {
        categoryName: purchase ? purchaseCategoryName : categoryName,
        paidSoFar: paid?.paidSoFar ?? (sheet !== null && sheet !== 'new' ? sheet.paidSoFar : 0),
      })
    : undefined;
  const node = (
    <>
      {sheet && (
        <Sheet grouped title={editing ? 'Edit instalment plan' : 'New instalment plan'} onClose={close}>
          <form ref={formEl} onSubmit={save}>
            <InsetGroup>
              <TextRow label="What it was" value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Name" />
              <TextRow label="Total" prefix={currency} value={form.total} inputMode="decimal" onChange={(e) => patch({ total: groupTypedAmount(e.target.value, currency) })} placeholder="Amount" required />
              <TextRow label="Months" value={form.months} inputMode="numeric" onChange={(e) => patch({ months: e.target.value })} />
              <FirstBilledRow month={form.firstBilledMonth} shown={firstBilledDate(typedSchedule)} onChange={(firstBilledMonth) => patch({ firstBilledMonth })} />
              <SwitchRow label="Earns points" checked={form.earnsPoints} onChange={(earnsPoints) => patch({ earnsPoints })} />
              <SelectRow
                label="Purchase"
                value={purchase ?? ''}
                onChange={(e) => {
                  setPurchaseTouched(true);
                  patch({ transactionId: e.target.value || null });
                }}
              >
                <option value="">None</option>
                {/* A purchase no longer offered (deleted since) still shows while it is the plan's. */}
                {purchase && !choices.some((choice) => choice.transactionId === purchase) && <option value={purchase}>The purchase it came from</option>}
                {choices.map((choice) => (
                  <option key={choice.transactionId} value={choice.transactionId}>
                    {`${choice.description} · ${choice.occurredOn} · ${formatMinor(choice.amountMinor, currency)}`}
                  </option>
                ))}
              </SelectRow>
              {/* With no purchase there is no category to take: the plan's own (0122, 0123), or Investment (not spending). */}
              {!purchase && (
                <SelectRow
                  label="Category"
                  value={form.investment ? INVESTMENT_CHOICE : (form.categoryAccountId ?? '')}
                  onChange={(e) =>
                    patch(e.target.value === INVESTMENT_CHOICE ? { investment: true, categoryAccountId: null } : { investment: false, categoryAccountId: e.target.value || null })
                  }
                >
                  <option value={INVESTMENT_CHOICE}>Investment (not spending)</option>
                  <option value="">Personal · Uncategorised</option>
                  {categories
                    .map((category) => ({ id: category.id, label: categoryLabel(category.id, categories) }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                </SelectRow>
              )}
            </InsetGroup>
            {/* How it counts, said plainly: the app decides it from the purchase or the category. */}
            {footer && (
              <p data-testid="plan-counting" className="mx-[16px] mb-[18px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
                {footer}
              </p>
            )}
            {paid && (
              <PaidList
                header="Paid"
                rows={paid.rows}
                currency={currency}
                footer={<span data-testid="plan-owed">{paid.footer}</span>}
                disabled={busy}
                onTap={setPaidTouched}
                onExpand={() => setPaidOpen(true)}
              />
            )}
            {editSplit && (
              // What the row no longer spells out: how much is billed, what is still held and when it ends.
              <InsetGroup header="So far">
                <ReadOnlyRow label="Billed" value={formatMinor(editSplit.billedMinor, currency)} />
                <ReadOnlyRow label="Still held" value={formatMinor(editSplit.unbilledMinor, currency)} />
                <ReadOnlyRow label="Ends" value={monthYear(editSplit.lastMonth)} />
              </InsetGroup>
            )}
            <ErrorBox error={error} />
            <NoPurchaseWarning text={warning} />
            <input type="submit" hidden disabled={busy} />
            <InsetGroup>
              <InsetRow action title={editing ? 'Save' : 'Save plan'} disabled={busy} onClick={() => formEl.current?.requestSubmit()} />
            </InsetGroup>
          </form>
          {editing && (
            <InsetGroup>
              <InsetRow destructive title="Remove plan" testId="instalment-remove" onClick={() => setRemoving(true)} />
            </InsetGroup>
          )}
        </Sheet>
      )}
      {removing && (
        <NoticeAlert
          title="Remove plan"
          text="The purchase it came from stays as it is."
          actions={
            <button type="button" onClick={() => void remove()} className={`${ALERT_ROW} font-semibold`}>
              Remove plan
            </button>
          }
          closeLabel="Not now"
          onClose={() => setRemoving(false)}
        />
      )}
      {!sheet && <ErrorBox error={error} />}
    </>
  );
  return { open, node };
}

/**
 * Instalment plans on one card, on its page under this statement's points. The purchase was spending on the day it
 * happened; these rows only say how much of it the card has billed so far, how much it still holds of the limit, and
 * how far through its months it is — with the way to change one and to remove one. A plan is added from the card's Settings, under Instalments.
 */
export function InstallmentList({ cardAccountId, currency }: { cardAccountId: string; currency: string }) {
  const plans = useInstallments(cardAccountId);
  const today = isoDate();
  const navigate = useNavigate();
  const editor = usePlanEditor(cardAccountId, currency);
  const list = plans.data ?? [];
  return (
    <div data-testid="card-instalments">
      <InsetGroup header="Instalments">
        {list.length === 0 && (
          <TextLine tone="ink-3">None yet. A purchase the issuer turns into cicilan is recorded here, so the card's debt splits into billed and unbilled.</TextLine>
        )}
        {list.map((plan) => (
          <InstallmentRow
            key={plan.id}
            plan={plan}
            currency={currency}
            today={today}
            onOpen={() => void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: cardAccountId, planId: plan.id } })}
          />
        ))}
      </InsetGroup>
      {editor.node}
    </div>
  );
}
