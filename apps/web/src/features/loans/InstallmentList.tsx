import { formatMinor, installmentSplit, isoDate } from '@expanses/core';
import { deleteInstallment, saveInstallment } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { Trash2 } from 'lucide-react';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, SwitchRow, TextRow } from '../../ui/native';
import { ActionRow, GlyphButton, Line, SUBTITLE, TextLine, TITLE } from '../cards/rows';
import { useInstallments } from './queries';

/**
 * Instalment plans on one card, on its page under this statement's points. The purchase was spending on the day it
 * happened; these rows only say how much of it the card has billed so far, how much it still holds of the limit, and
 * how far through its months it is — with the way to add a plan the issuer made and to remove one.
 */
export function InstallmentList({ cardAccountId, currency }: { cardAccountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const plans = useInstallments(cardAccountId);
  const today = isoDate();
  const form = useRef<HTMLFormElement>(null);
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [months, setMonths] = useState('12');
  const [firstBilledMonth, setFirstBilledMonth] = useState(today.slice(0, 7));
  const [earnsPoints, setEarnsPoints] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await saveInstallment(database, ws, {
        cardAccountId,
        description: description.trim() || 'Instalment plan',
        totalMinor: Number(total.replace(/\./g, '')),
        months: Number(months),
        firstBilledMonth,
        earnsPoints,
      });
      await invalidate();
      setDescription('');
      setTotal('');
      setAdding(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this plan? The purchase it came from stays as it is.')) return;
    setError(null);
    try {
      await deleteInstallment(database, ws, id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const plansNow = (plans.data ?? []).map((plan) => ({ plan, split: installmentSplit(plan, today) }));
  const held = plansNow.reduce((sum, { split }) => sum + split.unbilledMinor, 0);
  return (
    <div data-testid="card-instalments">
      <InsetGroup header="Instalments" trailing={held > 0 ? `${formatMinor(held, currency)} held` : undefined}>
        {plansNow.length === 0 && (
          <TextLine tone="ink-3">None yet. A purchase the issuer turns into cicilan is recorded here, so the card's debt splits into billed and unbilled.</TextLine>
        )}
        {plansNow.map(({ plan, split }) => {
          const paid = plan.months - split.monthsLeft;
          return (
            // Every figure of a plan is worth reading whole, so its lines wrap rather than truncate beside a figure.
            <Line key={plan.id} testId="card-instalment" pad="11px 4px 11px 13px" className="flex items-center gap-[8px]">
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
              <GlyphButton label={`Remove ${plan.description}`} glyph={<Trash2 size={17} aria-hidden />} destructive onClick={() => void remove(plan.id)} />
            </Line>
          );
        })}
        <ActionRow label="Add a plan" onClick={() => setAdding(true)} />
      </InsetGroup>

      {adding && (
        <Sheet grouped title="New instalment plan" onClose={() => setAdding(false)}>
          <form ref={form} onSubmit={add}>
            <InsetGroup>
              <TextRow label="What it was" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Name" />
              <TextRow label={`Total (${currency})`} value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} placeholder="Amount" required />
              <TextRow label="Months" value={months} inputMode="numeric" onChange={(e) => setMonths(e.target.value)} />
              <TextRow label="First billed" type="month" value={firstBilledMonth} onChange={(e) => setFirstBilledMonth(e.target.value)} />
              <SwitchRow label="Earns points" checked={earnsPoints} onChange={setEarnsPoints} />
            </InsetGroup>
            <ErrorBox error={error} />
            <input type="submit" hidden disabled={busy} />
            <InsetGroup>
              <InsetRow action title="Save plan" disabled={busy} onClick={() => form.current?.requestSubmit()} />
            </InsetGroup>
          </form>
        </Sheet>
      )}
      {!adding && <ErrorBox error={error} />}
    </div>
  );
}
