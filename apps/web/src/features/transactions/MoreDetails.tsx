import type { AccountRow } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { ratePreview } from '../../lib/rates';
import { InputRow, RowHint } from '../../ui';
import { useEvents } from '../events/queries';
import { ChannelSheet } from './ChannelSheet';
import { FormRow, FormRows, SwitchRow } from './FormRow';
import { McSheet } from './McSheet';
import { PhotosSheet, photosSummary } from './PhotosSheet';
import { SplitSheet, splitSummary } from './SplitSheet';
import { EventSheet } from './EventSheet';
import { WithSheet, withSummary } from './WithSheet';
import { extraRows, type FormDraft } from './tx-form';

/** The pair a rate is missing for, as `resolveRates` reported it, and the day it is wanted for. */
export interface MissingRate {
  from: string;
  to: string;
  onDate: string;
}

/**
 * §4's second card: one row per extra, each showing what it holds and opening its own screen.
 *
 * It takes a draft and gives back a changed one, and knows nothing about where it is drawn — the full card opens
 * it in a sheet, and Task 14's edit sheet opens the very same component with the very same props. One
 * implementation, two ways in: a second copy of these rows is a second place for a field to be dropped, and the
 * four fields this screen holds were dropped in silence once already.
 *
 * Which rows appear is `extraRows`'s decision, not this component's, and every row in that list is drawn here.
 * With and Photos were the last two missing: With replaces the card's old single-person "Someone owes part of
 * this" — which never caught up with the several people `splitBill` has taken since Task 5 — and Photos is the
 * first thing in the app to put a picture on a transaction while it is being recorded.
 */
export function MoreDetails({
  draft,
  onChange,
  accounts,
  missingRate,
}: {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  accounts: readonly AccountRow[];
  missingRate: MissingRate | null;
}) {
  const { ws } = useApp();
  const [sheet, setSheet] = useState<null | 'event' | 'split' | 'with' | 'mcc' | 'channel' | 'photos'>(null);
  const set = (patch: Partial<FormDraft>) => onChange({ ...draft, ...patch });
  const rows = extraRows(draft, accounts, { missingRate });
  const events = useEvents().data ?? [];
  const eventName = draft.eventId ? (events.find((event) => event.id === draft.eventId)?.name ?? '') : '';
  // A split is typed, read and posted in the paying account's own currency — `formToPost` refuses any other — so
  // the row's total is read in that one, never in the currency the amount row happens to be showing.
  const currency = accounts.find((a) => a.id === draft.moneyId)?.currency ?? ws.baseCurrency;

  return (
    <>
      <FormRows>
        {rows.includes('event') && <FormRow label="Event" value={eventName} onClick={() => setSheet('event')} />}
        {rows.includes('split') && <FormRow label="Split" value={splitSummary(draft.splits, currency)} onClick={() => setSheet('split')} />}
        {rows.includes('with') && <FormRow label="With" value={withSummary(draft, accounts, currency)} onClick={() => setSheet('with')} />}
        {rows.includes('mcc') && <FormRow label="MCC" value={draft.mcc} onClick={() => setSheet('mcc')} />}
        {rows.includes('channel') && (
          <FormRow label="Channel" value={draft.channel === 'online' ? 'Online' : draft.channel === 'offline' ? 'Offline' : ''} onClick={() => setSheet('channel')} />
        )}
        {rows.includes('photos') && <FormRow label="Photos" value={photosSummary(draft)} onClick={() => setSheet('photos')} />}
        {rows.includes('exclude') && (
          <SwitchRow
            label="Exclude from report"
            hint="Out of the chart and the budgets. Still counted in balances, statements, points and net worth."
            checked={draft.excluded}
            onChange={(excluded) => set({ excluded })}
          />
        )}
      </FormRows>

      {/*
        §3.3: the manual rate lives here and only here, and only when `resolveRates` came back without one for the
        workspace's own currency. `checkManualRate` still runs on Save, where it always has.
      */}
      {missingRate && (
        <div className="space-y-1">
          <FormRows>
            <InputRow
              label={`Rate: ${missingRate.to} per 1 ${missingRate.from}`}
              value={draft.manualRate}
              inputMode="decimal"
              onChange={(e) => set({ manualRate: e.target.value })}
            />
          </FormRows>
          <RowHint>{ratePreview(draft.manualRate, missingRate.from, missingRate.to) ?? `Type the rate your bank used for ${missingRate.onDate}.`}</RowHint>
        </div>
      )}

      {sheet === 'event' && <EventSheet value={draft.eventId} onPick={(eventId) => set({ eventId })} onClose={() => setSheet(null)} />}
      {sheet === 'split' && <SplitSheet draft={draft} onChange={onChange} accounts={accounts} currency={currency} onClose={() => setSheet(null)} />}
      {sheet === 'with' && <WithSheet draft={draft} onChange={onChange} accounts={accounts} currency={currency} onClose={() => setSheet(null)} />}
      {sheet === 'photos' && <PhotosSheet draft={draft} onChange={onChange} onClose={() => setSheet(null)} />}
      {sheet === 'mcc' && <McSheet draft={draft} onChange={onChange} accounts={accounts} onClose={() => setSheet(null)} />}
      {sheet === 'channel' && <ChannelSheet value={draft.channel} onPick={(channel) => set({ channel })} onClose={() => setSheet(null)} />}
    </>
  );
}
