import { type DebtDirection, isoDate } from '@expanses/core';
import { recordLoan } from '@expanses/db';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useHeldRates } from '../accounts/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SelectRow, TextRow } from '../../ui/native';
import { CategoryOptions } from '../cards/options';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { type DebtDraft, debtDraftFor, debtDraftReady, debtDraftToInput, lentOutflowMinor, loanMoneyAccounts, personSuggestions, subCategories } from './debts-form';
import { useDebtProfiles, usePeopleDebts } from './queries';

/**
 * Records money handed to a person, or taken from one — which of the two is the screen's to say, not the form's:
 * New receivable and New payable each open it on their own side. A toggle here as well would let the title and the
 * form disagree about what is being recorded.
 */
export function DebtForm({
  direction,
  initialPerson = '',
  backSearch,
  onDone,
}: {
  direction: DebtDirection;
  initialPerson?: string;
  /** Where back lands on Lend & borrow: the side being added to, and the person being shown. */
  backSearch: { side: 'owed' | 'owe'; person?: string };
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const people = usePeopleDebts();
  const profiles = useDebtProfiles();
  const today = isoDate();
  const [draft, setDraft] = useState<DebtDraft>(() => debtDraftFor(direction, today, initialPerson));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [manualRate, setManualRate] = useState('');
  // The pair a Save came back without, so the rate row stays on screen even if the stored-rate read raced it.
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  const set = (patch: Partial<DebtDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // A loan comes from money you hold, or a card. Another person's account is not a source.
  const money = loanMoneyAccounts(moneyHolders(accounts).filter((account) => WALLET_SUBTYPES.includes(account.subtype)), draft.direction);
  const currency = money.find((account) => account.id === draft.moneyId)?.currency ?? ws.baseCurrency;
  const foreign = currency !== ws.baseCurrency;
  // Read from what this device holds, never fetched just because the form opened (see `useStoredRates`).
  const held = useHeldRates(foreign ? [currency] : [], draft.occurredOn > today ? today : draft.occurredOn);
  // Asked for when no rate is stored for the day, or when a Save found none; left out when one is known.
  const asksRate = foreign && (needsRate === currency || (held.data?.missing ?? []).includes(currency));
  const suggestions = people.data ? personSuggestions(people.data, draft.personName) : [];
  // Lending pays money out — the loan and its fee; borrowing brings it in and asks nothing.
  const lentMinor = lentOutflowMinor(draft, currency, today);
  // The fee is filed under Fees & charges until the reader picks another category.
  const feesCategoryId = accounts.find((account) => account.kind === 'expense' && account.systemKey === 'miscellaneous.fees_charges')?.id ?? '';
  const feeCategoryId = draft.feeCategoryId || feesCategoryId;
  // The ✓ is dim until the draft is one Save would take, as New transaction's is.
  const complete = debtDraftReady({ ...draft, feeCategoryId }, currency, today);
  const setAside = useSetAside(draft.direction === 'lent' ? spendingDoor(draft.moneyId, lentMinor) : null);

  /** Typing a name the workspace already knows uses that account instead of opening a second one. */
  function nameTyped(personName: string) {
    const match = (profiles.data ?? []).find(
      (profile) => profile.direction === draft.direction && profile.personName.toLowerCase() === personName.trim().toLowerCase() && profile.status !== 'forgiven',
    );
    set({ personName, existingAccountId: match?.accountId ?? '' });
  }

  // A person named on the way in is matched against the people already on this side once they have loaded, so their
  // debt is added to rather than a second account opened for the same name. Typing afterwards matches as it goes.
  useEffect(() => {
    if (draft.personName && profiles.data) nameTyped(draft.personName);
    // Once, when the profiles arrive: every later change of name goes through `nameTyped` itself.
  }, [profiles.data]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    // The form submits on Enter too: the question is a condition on every way in.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const input = debtDraftToInput({ ...draft, feeCategoryId }, currency, today);
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
      {/*
       * The title bar is the form's own, as New transaction's is: its ✓ is the save, top right, and it has to submit
       * this form and dim while the set-aside question is unanswered, which only the form knows.
       */}
      <PushedTitle
        title={direction === 'lent' ? 'New receivable' : 'New payable'}
        back="Lend & borrow"
        backTo="/net-worth/lend-borrow"
        backSearch={backSearch}
        actions={[
          { key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: busy || !complete || !setAside.ready, run: () => form.current?.requestSubmit() },
        ]}
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
        <SelectRow
          label={draft.direction === 'lent' ? 'Paid from' : 'Received into'}
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
        {/* After the account, which decides the currency the figure is read in. */}
        <TextRow
          label={`Amount (${currency})`}
          value={draft.amount}
          inputMode="decimal"
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="10.000.000"
          required
        />
        {/* A fee on the money moved is the owner's cost, filed as spending; what the person owes stays the loan. */}
        <TextRow
          label={`Fee (${currency})`}
          info={
            draft.direction === 'lent'
              ? 'Optional. A card or bank charge for sending it. It is your cost, counted as spending; what they owe stays the loan.'
              : 'Optional. A charge taken from what arrived. It is your cost, counted as spending; you still owe the whole loan.'
          }
          value={draft.fee}
          inputMode="decimal"
          onChange={(e) => set({ fee: e.target.value })}
          placeholder="0"
        />
        {draft.fee.trim() !== '' && draft.fee.trim() !== '0' ? (
          <SelectRow label="Fee category" value={feeCategoryId} onChange={(e) => set({ feeCategoryId: e.target.value })}>
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>
        ) : null}
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
          info="Shown on their card, so you remember."
          value={draft.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="Motorcycle repair"
        />
        <TextRow label="Due by" info="Optional. You are warned three weeks before." type="date" value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />
        {!draft.existingAccountId ? (
          <TextRow
            label="Tax ID"
            info="Their national or tax ID number. Optional, and only needed when this reaches your tax report."
            value={draft.personIdNumber}
            inputMode="numeric"
            onChange={(e) => set({ personIdNumber: e.target.value })}
          />
        ) : null}
      </InsetGroup>

      {setAside.node}
      <ErrorBox error={error} />
    </form>
  );
}
