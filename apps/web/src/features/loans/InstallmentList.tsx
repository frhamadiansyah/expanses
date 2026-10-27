import { formatMinor, installmentSplit, isoDate } from '@expanses/core';
import { type CardInstallmentRow, deleteInstallment, saveInstallment, updateInstallment } from '@expanses/db';
import { ChevronRight } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, ProgressBar, SwitchRow, TextRow } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { ActionRow, Line, SUBTITLE, TextLine, TITLE } from '../cards/rows';
import { blankPlanForm, type PlanForm, planFields, planFormOf } from './plan-form';
import { useInstallments } from './queries';

/**
 * One plan on the card page: its name, how far through its months it is, what it bills a month and what it still
 * holds. The whole row is the tap target; it opens the plan to edit.
 */
function InstallmentRow({ plan, currency, today, position, onOpen }: GroupChild & { plan: CardInstallmentRow; currency: string; today: string; onOpen: () => void }) {
  const split = installmentSplit(plan, today);
  const paid = plan.months - split.monthsLeft;
  return (
    // Every figure of a plan is worth reading whole, so its lines wrap rather than truncate beside a figure.
    <Line position={position} testId="card-instalment" pad="0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Edit ${plan.description}`}
        className="ph-focus-inset flex w-full items-center gap-[8px] bg-transparent text-left"
        style={{ padding: '11px 8px 11px 13px' }}
      >
        <span className="min-w-0 flex-1">
          <span className={`block ${TITLE}`}>{plan.description}</span>
          <ProgressBar className="my-[4px] w-full" currentMinor={paid} targetMinor={plan.months} label={`${plan.description}: ${paid} of ${plan.months} paid`} />
          <span className={`block ${SUBTITLE}`}>
            {paid} of {plan.months} paid · {formatMinor(plan.monthlyMinor, currency)} a month
          </span>
          <span className={`block ${SUBTITLE}`}>
            Billed {formatMinor(split.billedMinor, currency)} · ends {split.lastMonth}
            {!plan.earnsPoints && ' · earns no points'}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-[15px] leading-[20px] text-[var(--ph-ink)]">{formatMinor(split.unbilledMinor, currency)}</span>
          <span className="block text-[12px] leading-[16px] text-[var(--ph-ink-3)]">still held</span>
        </span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
      </button>
    </Line>
  );
}

/**
 * Instalment plans on one card, on its page under this statement's points. The purchase was spending on the day it
 * happened; these rows only say how much of it the card has billed so far, how much it still holds of the limit, and
 * how far through its months it is — with the way to add a plan the issuer made, to change one, and to remove one.
 */
export function InstallmentList({ cardAccountId, currency }: { cardAccountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const plans = useInstallments(cardAccountId);
  const today = isoDate();
  const formEl = useRef<HTMLFormElement>(null);
  /** The sheet: closed, a new plan, or the plan being edited. */
  const [sheet, setSheet] = useState<'new' | CardInstallmentRow | null>(null);
  const [form, setForm] = useState<PlanForm>(() => blankPlanForm(today));
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const patch = (change: Partial<PlanForm>) => setForm((was) => ({ ...was, ...change }));

  const open = (target: 'new' | CardInstallmentRow) => {
    setError(null);
    setForm(target === 'new' ? blankPlanForm(today) : planFormOf(target));
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
      if (sheet === 'new') await saveInstallment(database, ws, { cardAccountId, ...planFields(form) });
      else await updateInstallment(database, ws, { id: sheet.id, ...planFields(form) });
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
    } catch (e) {
      setRemoving(false);
      setError(e);
    }
  }

  const list = plans.data ?? [];
  const held = list.reduce((sum, plan) => sum + installmentSplit(plan, today).unbilledMinor, 0);
  const editing = sheet !== null && sheet !== 'new';
  return (
    <div data-testid="card-instalments">
      <InsetGroup header="Instalments" trailing={held > 0 ? `${formatMinor(held, currency)} held` : undefined}>
        {list.length === 0 && (
          <TextLine tone="ink-3">None yet. A purchase the issuer turns into cicilan is recorded here, so the card's debt splits into billed and unbilled.</TextLine>
        )}
        {list.map((plan) => (
          <InstallmentRow key={plan.id} plan={plan} currency={currency} today={today} onOpen={() => open(plan)} />
        ))}
        <ActionRow label="Add a plan" onClick={() => open('new')} />
      </InsetGroup>

      {sheet && (
        <Sheet grouped title={editing ? 'Edit instalment plan' : 'New instalment plan'} onClose={close}>
          <form ref={formEl} onSubmit={save}>
            <InsetGroup>
              <TextRow label="What it was" value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Name" />
              <TextRow label={`Total (${currency})`} value={form.total} inputMode="decimal" onChange={(e) => patch({ total: e.target.value })} placeholder="Amount" required />
              <TextRow label="Months" value={form.months} inputMode="numeric" onChange={(e) => patch({ months: e.target.value })} />
              <TextRow label="First billed" type="month" value={form.firstBilledMonth} onChange={(e) => patch({ firstBilledMonth: e.target.value })} />
              <SwitchRow label="Earns points" checked={form.earnsPoints} onChange={(earnsPoints) => patch({ earnsPoints })} />
            </InsetGroup>
            <ErrorBox error={error} />
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
    </div>
  );
}
