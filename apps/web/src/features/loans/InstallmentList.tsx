import { formatMinor, groupTypedAmount, installmentSchedule, installmentSplit, isoDate, monthYear } from '@expanses/core';
import { type CardInstallmentRow, deleteInstallment, saveInstallment, updateInstallment } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, ProgressBar, ReadOnlyRow, ROW_PAD_X, SegmentedControl, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useMonthStart } from '../workspaces/queries';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { Line, SUBTITLE, TextLine, TITLE } from '../cards/rows';
import { blankPlanForm, type PlanForm, planFields, planFormOf, purchaseChoices, shownPurchase } from './plan-form';
import { COUNT_SEGMENTS, countSpendingFooter, noPurchaseWarning, purchaseStateOf } from './plan-view';
import { useCardLines, useCardRecordsFrom, useInstallments, usePlanCategoryChoices, useStatementDay } from './queries';

/** The line a plan with no purchase chosen shows, above Save and on its page (`noPurchaseWarning`). */
export function NoPurchaseWarning({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p data-testid="no-purchase-warning" className="mx-[4px] mb-[14px] rounded-[9px] bg-[var(--ph-warn-panel)] px-[12px] py-[9px] text-[13px] leading-[18px] text-[var(--ph-warn-ink)]">
      {text}
    </p>
  );
}

/** "Food & drink › Restaurants": a category's name with its parent's, for a flat list of choices. */
export function categoryLabel(id: string, all: readonly { id: string; name: string; parentId: string | null }[]): string {
  const row = all.find((c) => c.id === id);
  if (!row) return '';
  const parent = row.parentId ? all.find((c) => c.id === row.parentId) : undefined;
  return parent ? `${parent.name} › ${row.name}` : row.name;
}

/** The Count spending control in a row of its own, with the hairline a row above it draws. */
export function CountSpendingRow({ position, value, onChange, disabled }: GroupChild & { value: string; onChange: (mode: 'at_purchase' | 'each_month') => void; disabled?: boolean }) {
  return (
    <div className="relative" style={{ padding: `8px ${ROW_PAD_X}px` }} data-testid="count-spending">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X }} />}
      <fieldset disabled={disabled} className="contents">
        <SegmentedControl segments={COUNT_SEGMENTS} value={value} onChange={(key) => onChange(key as 'at_purchase' | 'each_month')} label="Count spending" className="w-full" />
      </fieldset>
    </div>
  );
}

/**
 * One plan on the card page: its name and what it still holds on the top line, then how far through its months it is and
 * what it bills a month, and the bar under them across the whole row. The whole row is the tap target; it opens the plan's own page.
 */
export function InstallmentRow({ plan, currency, today, position, onOpen }: GroupChild & { plan: CardInstallmentRow; currency: string; today: string; onOpen: () => void }) {
  const split = installmentSplit(plan, today);
  const paid = plan.months - split.monthsLeft;
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
          <span className="tabular shrink-0 text-[15px] leading-[20px] text-[var(--ph-ink)]">{formatMinor(split.unbilledMinor, currency)}</span>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
        </span>
        <ProgressBar className="my-[4px] w-full" currentMinor={paid} targetMinor={plan.months} label={`${plan.description}: ${paid} of ${plan.months} paid`} />
        <span className={`flex w-full justify-between gap-[8px] ${SUBTITLE}`}>
          <span>
            {paid} of {plan.months} paid
          </span>
          <span className="shrink-0">{formatMinor(plan.monthlyMinor, currency)} a month</span>
        </span>
      </button>
    </Line>
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
  const statementDay = useStatementDay(cardAccountId).data ?? 1;
  /** The sheet: closed, a new plan, or the plan being edited. */
  const [sheet, setSheet] = useState<'new' | CardInstallmentRow | null>(null);
  const lines = useCardLines(cardAccountId, sheet !== null);
  const recordsFrom = useCardRecordsFrom(cardAccountId).data ?? null;
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
      const fields = planFields({ ...form, transactionId: purchase }, currency);
      if (sheet === 'new') await saveInstallment(database, ws, { cardAccountId, ...fields });
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
  const choices = purchaseChoices(lines.data ?? [], planId, typedTotal);
  const purchase = shownPurchase(form, typedTotal, lines.data ?? [], purchaseTouched);
  const categoryName = form.categoryAccountId ? categoryLabel(form.categoryAccountId, categories) || null : null;
  const warning = noPurchaseWarning(
    purchaseStateOf({ id: planId, transactionId: purchase, totalMinor: typedTotal, firstBilledMonth: form.firstBilledMonth }, lines.data ?? [], recordsFrom),
    form.countMode,
    categoryName,
  );
  // What the footer reads for the plan as typed: its months follow the card's statement day and the workspace's months.
  const footer = (() => {
    const months = Number(form.months);
    if (!Number.isInteger(months) || months < 1 || !(typedTotal > 0) || !/^\d{4}-\d{2}$/.test(form.firstBilledMonth)) return undefined;
    const typed = { totalMinor: typedTotal, months, monthlyMinor: Math.round(typedTotal / months), firstBilledMonth: form.firstBilledMonth, rateBps: 0, conversionFeeMinor: 0, earnsPoints: form.earnsPoints };
    return countSpendingFooter({ ...typed, countMode: form.countMode, transactionId: purchase }, installmentSchedule(typed, statementDay), currency, monthStart, { categoryName, recordsFrom });
  })();
  const node = (
    <>
      {sheet && (
        <Sheet grouped title={editing ? 'Edit instalment plan' : 'New instalment plan'} onClose={close}>
          <form ref={formEl} onSubmit={save}>
            <InsetGroup>
              <TextRow label="What it was" value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Name" />
              <TextRow label="Total" prefix={currency} value={form.total} inputMode="decimal" onChange={(e) => patch({ total: groupTypedAmount(e.target.value, currency) })} placeholder="Amount" required />
              <TextRow label="Months" value={form.months} inputMode="numeric" onChange={(e) => patch({ months: e.target.value })} />
              <TextRow label="First billed" type="month" value={form.firstBilledMonth} onChange={(e) => patch({ firstBilledMonth: e.target.value })} />
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
              {/* With no purchase there is no category to take: the plan's own, in Personal (0122). */}
              {!purchase && (
                <SelectRow label="Category" value={form.categoryAccountId ?? ''} onChange={(e) => patch({ categoryAccountId: e.target.value || null })}>
                  <option value="">Uncategorised</option>
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
            <InsetGroup header="Count spending" footer={footer}>
              <CountSpendingRow value={form.countMode} onChange={(countMode) => patch({ countMode })} />
            </InsetGroup>
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
