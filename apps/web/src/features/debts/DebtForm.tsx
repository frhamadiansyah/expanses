import { type DebtDirection, isoDate } from '@expanses/core';
import { recordLoan } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useHeldRates } from '../accounts/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, type Segment, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { CategoryOptions } from '../cards/options';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { type DebtDraft, DEFAULT_SUB_CATEGORY, debtDraftToInput, emptyDebtDraft, personSuggestions, subCategories, subCategoryGloss } from './debts-form';
import { useDebtProfiles, usePeopleDebts } from './queries';

/** The two ways money moves between people. A pair of pressed buttons was the shape the kit replaces. */
const DIRECTIONS: readonly Segment[] = [
  { key: 'lent', label: 'I lent money' },
  { key: 'borrowed', label: 'I borrowed money' },
];

/** Records money handed to a person, or taken from one. */
export function DebtForm({ onDone }: { onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const people = usePeopleDebts();
  const profiles = useDebtProfiles();
  const today = isoDate();
  const [draft, setDraft] = useState<DebtDraft>(() => emptyDebtDraft(today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [manualRate, setManualRate] = useState('');
  // The pair a Save came back without, so the rate row stays on screen even if the stored-rate read raced it.
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  const set = (patch: Partial<DebtDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // A loan comes from money you hold, or a card. Another person's account is not a source.
  const money = moneyHolders(accounts).filter((account) => WALLET_SUBTYPES.includes(account.subtype));
  const currency = money.find((account) => account.id === draft.moneyId)?.currency ?? ws.baseCurrency;
  const foreign = currency !== ws.baseCurrency;
  // Read from what this device holds, never fetched just because the form opened (see `useStoredRates`).
  const held = useHeldRates(foreign ? [currency] : [], draft.occurredOn > today ? today : draft.occurredOn);
  // Asked for when no rate is stored for the day, or when a Save found none; left out when one is known.
  const asksRate = foreign && (needsRate === currency || (held.data?.missing ?? []).includes(currency));
  const suggestions = people.data ? personSuggestions(people.data, draft.personName) : [];
  // Lending pays money out; borrowing brings it in and asks nothing. The figure is the one `submit` sends.
  const lentMinor = (() => {
    if (draft.direction !== 'lent') return 0;
    try {
      return debtDraftToInput(draft, currency, today).amountMinor;
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(draft.direction === 'lent' ? spendingDoor(draft.moneyId, lentMinor) : null);

  /** Typing a name the workspace already knows uses that account instead of opening a second one. */
  function nameTyped(personName: string) {
    const match = (profiles.data ?? []).find(
      (profile) => profile.direction === draft.direction && profile.personName.toLowerCase() === personName.trim().toLowerCase() && profile.status !== 'forgiven',
    );
    set({ personName, existingAccountId: match?.accountId ?? '' });
  }

  function directionChosen(direction: DebtDirection) {
    // The same name can exist on both sides, so the match is looked up again — and the sub-category belongs to the
    // side, so a piutang code is never left standing over money you borrowed.
    set({ direction, existingAccountId: '', subCategory: DEFAULT_SUB_CATEGORY[direction] });
    nameTyped(draft.personName);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    // The form submits on Enter too: the question is a condition on every way in.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const input = debtDraftToInput(draft, currency, today);
      const ratesToBase = await ratesForSave({
        database,
        ws,
        currency,
        occurredOn: input.occurredOn,
        amountMinor: input.amountMinor,
        typed: asksRate ? manualRate : '',
        resolveRates,
        onMissing: setNeedsRate,
      });
      await recordLoan(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit}>
      <SegmentedControl
        className="mb-[18px] md:max-w-2xl"
        label="Which way the money went"
        segments={DIRECTIONS}
        value={draft.direction}
        onChange={(key) => directionChosen(key as 'lent' | 'borrowed')}
      />

      <InsetGroup header={draft.direction === 'lent' ? 'Money you lent' : 'Money you borrowed'}>
        <TextRow
          label="Person"
          hint={draft.existingAccountId ? 'Adding to what they already owe.' : 'A new person gets their own account.'}
          value={draft.personName}
          onChange={(e) => nameTyped(e.target.value)}
          list="debt-people"
          placeholder="Andi"
          required
        />
        <TextRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
        <TextRow
          label={`Amount (${currency})`}
          value={draft.amount}
          inputMode="decimal"
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="10.000.000"
          required
        />
        <SelectRow
          label={draft.direction === 'lent' ? 'Paid from' : 'Received into'}
          hint={draft.direction === 'lent' ? 'A credit card works: the card owes more, and the purchase still earns points.' : undefined}
          value={draft.moneyId}
          onChange={(e) => set({ moneyId: e.target.value, moneyIsCard: money.find((account) => account.id === e.target.value)?.subtype === 'credit_card' })}
        >
          <option value="">Choose…</option>
          <optgroup label="Accounts">
            {money.filter((account) => account.kind === 'asset').map((account) => (
              <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
            ))}
          </optgroup>
          {draft.direction === 'lent' && (
            <optgroup label="Credit cards">
              {money.filter((account) => account.subtype === 'credit_card').map((account) => (
                <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
              ))}
            </optgroup>
          )}
        </SelectRow>
        {asksRate ? (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? `No ${currency} rate is stored for this day. Leave empty to fetch it.`}
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            inputMode="decimal"
            placeholder="16250"
          />
        ) : null}
      </InsetGroup>

      {/* The datalist belongs to the Person box above; it draws nothing of its own. */}
      <datalist id="debt-people">
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {draft.moneyIsCard && (
        <InsetGroup header="What the card paid for" footer="Not spending: it only tells the points engine what the card paid for.">
          <SelectRow label="Category for points" value={draft.spendCategoryId} onChange={(e) => set({ spendCategoryId: e.target.value })}>
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>
          <TextRow label="MCC" value={draft.mcc} inputMode="numeric" onChange={(e) => set({ mcc: e.target.value })} placeholder="5311" />
        </InsetGroup>
      )}

      <InsetGroup header="The rest of it">
        <SelectRow
          label="Sub category"
          hint={subCategoryGloss(draft.direction, draft.subCategory) || 'What it files as in your tax report.'}
          value={draft.subCategory}
          onChange={(e) => set({ subCategory: e.target.value })}
        >
          {subCategories(draft.direction).map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="What it is for"
          hint="Shown on their card, so you remember."
          value={draft.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="Motorcycle repair"
        />
        <TextRow label="Due by" hint="Optional. You are warned three weeks before." type="date" value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />
        {!draft.existingAccountId ? (
          <TextRow
            label="NIK or NPWP"
            hint="Optional, and only needed when this reaches your SPT."
            value={draft.personIdNumber}
            inputMode="numeric"
            onChange={(e) => set({ personIdNumber: e.target.value })}
          />
        ) : null}
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow
          title="Save"
          chevron={false}
          disabled={!setAside.ready}
          onClick={() => !busy && setAside.ready && form.current?.requestSubmit()}
          className={busy ? 'opacity-40' : undefined}
        />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
