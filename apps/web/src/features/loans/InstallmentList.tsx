import { installmentSplit, isoDate } from '@expanses/core';
import { deleteInstallment, saveInstallment } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Trash2 } from 'lucide-react';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, SwitchRow, TextRow } from '../../ui/native';
import { ActionRow, GlyphButton, Line, SubmitRow, SUBTITLE, TextLine, TITLE } from '../cards/rows';
import { useInstallments } from './queries';

/**
 * Instalment plans on one card. The purchase was spending on the day it happened; these rows only
 * say how much of it the card has billed so far, and how much is still to come.
 */
export function InstallmentList({ cardAccountId, currency }: { cardAccountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const plans = useInstallments(cardAccountId);
  const today = isoDate();
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

  const plansNow = plans.data ?? [];
  return (
    <>
      <InsetGroup header="Instalment plans">
        {plansNow.length === 0 && !adding && (
          <TextLine tone="ink-3">None yet. A purchase the issuer turns into cicilan is recorded here, so the card's debt splits into billed and unbilled.</TextLine>
        )}
        {plansNow.map((plan) => {
          const split = installmentSplit(plan, today);
          return (
            // Every figure of a plan is worth reading whole, so its lines wrap rather than truncate beside a figure.
            <Line key={plan.id} testId="instalment-plan" pad="11px 4px 11px 13px" className="flex items-center gap-[8px]">
              <span className="min-w-0 flex-1">
                <span className={`block ${TITLE}`}>{plan.description}</span>
                <span className={`mt-[2px] block ${SUBTITLE}`}>
                  {plan.months} months · <Money minor={plan.monthlyMinor} currency={currency} /> a month · ends {split.lastMonth}
                  {!plan.earnsPoints && ' · earns no points'}
                </span>
                <span className={`block ${SUBTITLE}`}>
                  Billed <Money minor={split.billedMinor} currency={currency} /> · Still to come <Money minor={split.unbilledMinor} currency={currency} />
                </span>
              </span>
              <GlyphButton label={`Remove ${plan.description}`} glyph={<Trash2 size={17} aria-hidden />} destructive onClick={() => void remove(plan.id)} />
            </Line>
          );
        })}
        {!adding && <ActionRow label="Add a plan" onClick={() => setAdding(true)} />}
      </InsetGroup>

      {adding && (
        <form onSubmit={add}>
          <InsetGroup header="New instalment plan">
            <TextRow label="What it was" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="iBox Grand Indonesia" />
            <TextRow label={`Total (${currency})`} value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} placeholder="12.000.000" required />
            <TextRow label="Over how many months" value={months} inputMode="numeric" onChange={(e) => setMonths(e.target.value)} />
            <TextRow label="First billed" type="month" value={firstBilledMonth} onChange={(e) => setFirstBilledMonth(e.target.value)} />
            <SwitchRow label="This still earns points" checked={earnsPoints} onChange={setEarnsPoints} />
          </InsetGroup>
          <ErrorBox error={error} />
          <InsetGroup>
            <SubmitRow label="Save plan" disabled={busy} />
            <ActionRow label="Cancel" quiet onClick={() => setAdding(false)} />
          </InsetGroup>
        </form>
      )}
      {!adding && <ErrorBox error={error} />}
    </>
  );
}
