import { type DebtDirection, isoDate } from '@expanses/core';
import { recordLoan } from '@expanses/db';
import { Check } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useHeldRates } from '../accounts/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SelectRow, TextRow } from '../../ui/native';
import { detailsToggleLabel } from '../transactions/tx-form';
import { CategoryOptions } from '../cards/options';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { type DebtDraft, debtDraftFor, debtDetailsFilled, debtDraftReady, debtDraftToInput, lentOutflowMinor, loanMoneyAccounts, loanNamed, openLoansWith, personSuggestions, subCategories } from './debts-form';
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
  // Folded until asked for — but never over something already filled in, which would be typed and then hidden.
  const [detailsOpen, setDetailsOpen] = useState(() => debtDetailsFilled(draft));

  const set = (patch: Partial<DebtDraft>) => setDraft((current) => ({ ...current, ...patch }));
  // A loan comes from money you hold, or a card. Another person's account is not a source.
  const money = loanMoneyAccounts(moneyHolders(accounts).filter((account) => WALLET_SUBTYPES.includes(account.subtype)), draft.direction);
  const currency = money.find((account) => account.id === draft.moneyId)?.currency ?? ws.baseCurrency;
  const foreign = currency !== ws.baseCurrency;
  // The account decides the currency, so the figures name it only once there is an account: "(IDR)" before one is
  // picked would be a guess the reader has to unlearn when they choose a dollar account.
  const codeShown = draft.moneyId ? ` (${currency})` : '';
  // Read from what this device holds, never fetched just because the form opened (see `useStoredRates`).
  const held = useHeldRates(foreign ? [currency] : [], draft.occurredOn > today ? today : draft.occurredOn);
  // Asked for when no rate is stored for the day, or when a Save found none; left out when one is known.
  const asksRate = foreign && (needsRate === currency || (held.data?.missing ?? []).includes(currency));
  /*
   * Names already on the list that match what is typed, as chips under Person. The browser's own suggestions (a
   * datalist) cost the field a dropdown arrow's width on iOS whatever CSS says, so Person's text stopped short of
   * every other row's value; these are drawn by the app, and the field lines up.
   */
  const offered = (people.data ? personSuggestions(people.data, draft.personName) : [])
    .filter((name) => name.toLowerCase() !== draft.personName.trim().toLowerCase())
    .slice(0, 4);
  // Lending pays money out — the loan and its fee; borrowing brings it in and asks nothing.
  const lentMinor = lentOutflowMinor(draft, currency, today);
  // The fee is filed under Fees & charges until the reader picks another category.
  const feesCategoryId = accounts.find((account) => account.kind === 'expense' && account.systemKey === 'miscellaneous.fees_charges')?.id ?? '';
  const feeCategoryId = draft.feeCategoryId || feesCategoryId;
  const setAside = useSetAside(draft.direction === 'lent' ? spendingDoor(draft.moneyId, lentMinor) : null);

  /*
   * A name the workspace already knows is not one loan to add to: one person can owe for two things, each its own
   * loan with its own reason and due date. So the Loan row says which: their open loans are chips under it, and
   * picking one — or typing its reason — puts the money on that loan, as picking or typing a name picks the person.
   * Changing the name picks again, among the new person's loans.
   */
  const loansOf = (personName: string) => openLoansWith(people.data, draft.direction, personName);
  function nameTyped(personName: string) {
    set({ personName, existingAccountId: loanNamed(loansOf(personName), draft.reason) });
  }
  function purposeTyped(reason: string) {
    set({ reason, existingAccountId: loanNamed(loans, reason) });
  }
  const loans = loansOf(draft.personName);
  const picked = loans.find((loan) => loan.accountId === draft.existingAccountId);
  // Offered only once something is typed, as names are under Person: a reason that matches, or "No reason noted".
  const needle = draft.reason.trim().toLowerCase();
  const loanChips = needle
    ? loans.filter((loan) => loan !== picked && (loan.reason || 'No reason noted').toLowerCase().includes(needle))
    : [];
  const pickedCode = (profiles.data ?? []).find((profile) => profile.accountId === picked?.accountId)?.coretaxCode ?? '';
  const known = (profiles.data ?? []).find(
    (profile) => profile.direction === draft.direction && profile.personName.trim().toLowerCase() === draft.personName.trim().toLowerCase(),
  );
  // A person's tax ID is theirs, not one loan's: a new loan for someone already on the list carries it over.
  const withKnownId = (current: DebtDraft): DebtDraft => (current.personIdNumber || !known?.personIdNumber ? current : { ...current, personIdNumber: known.personIdNumber });
  // The ✓ is dim until the draft is one Save would take, as New transaction's is.
  const complete = debtDraftReady(withKnownId({ ...draft, feeCategoryId }), currency, today);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    // The form submits on Enter too: the question is a condition on every way in.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const input = debtDraftToInput(withKnownId({ ...draft, feeCategoryId }), currency, today);
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
      {/* No header over the box: the title says which side, and the amount row says which way the money went. */}
      <InsetGroup>
        <TextRow
          label="Person"
          value={draft.personName}
          onChange={(e) => nameTyped(e.target.value)}
          autoComplete="off"
          hint={
            offered.length > 0 ? (
              <span className="flex flex-wrap gap-[6px]" aria-label="People already on your list">
                {offered.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => nameTyped(name)}
                    className="ph-focus rounded-full bg-[var(--ph-fill)] px-[10px] py-[4px] text-[13px] leading-[18px] text-[var(--ph-ink)]"
                  >
                    {name}
                  </button>
                ))}
              </span>
            ) : undefined
          }
          placeholder="Name"
          required
        />
        {/*
          What a new loan files as — chosen, never assumed, and needed before ✓. Money added to one of their open loans
          files as that loan does, so the row shows the loan's own and is not asked.
        */}
        <SelectRow
          label="Sub category"
          value={picked ? pickedCode : draft.subCategory}
          disabled={Boolean(picked)}
          onChange={(e) => set({ subCategory: e.target.value })}
        >
          <option value="">Choose…</option>
          {subCategories(draft.direction).map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="Loan"
          value={draft.reason}
          onChange={(e) => purposeTyped(e.target.value)}
          autoComplete="off"
          hint={
            picked || loanChips.length > 0 ? (
              <span className="flex flex-col gap-[6px]">
                {picked ? <span>{`Adds to this open loan · ${picked.label.split(' · ').pop()}`}</span> : null}
                {loanChips.length > 0 ? (
                  <span className="flex flex-wrap gap-[6px]" aria-label="Open loans with this person">
                    {loanChips.map((loan) => (
                      <button
                        key={loan.accountId}
                        type="button"
                        onClick={() => set({ reason: loan.reason, existingAccountId: loan.accountId })}
                        className="ph-focus rounded-full bg-[var(--ph-fill)] px-[10px] py-[4px] text-[13px] leading-[18px] text-[var(--ph-ink)]"
                      >
                        {loan.label}
                      </button>
                    ))}
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
          placeholder="Purpose"
        />
        {/* Named in the account's currency once there is an account: it decides what the figure is read in. */}
        <TextRow
          label={`${draft.direction === 'lent' ? 'Money lent' : 'Money borrowed'}${codeShown}`}
          value={draft.amount}
          inputMode="decimal"
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="Amount"
          required
        />
        {/* A fee on the money moved is the owner's cost, filed as spending; what the person owes stays the loan. */}
        <TextRow
          label={`Fee${codeShown}`}
          info={
            draft.direction === 'lent'
              ? 'Optional. A card or bank charge for sending the money. Counted as spending; the amount owed stays the loan.'
              : 'Optional. A charge taken from the money received. Counted as spending; the whole loan is still owed.'
          }
          value={draft.fee}
          inputMode="decimal"
          onChange={(e) => set({ fee: e.target.value })}
          placeholder="Amount"
        />
        {draft.fee.trim() !== '' && draft.fee.trim() !== '0' ? (
          <SelectRow label="Fee category" value={feeCategoryId} onChange={(e) => set({ feeCategoryId: e.target.value })}>
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>
        ) : null}
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
        <TextRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
        {/*
          The rest of it, folded into this box behind the toggle under it, as New transaction folds its details. Every
          row is its own child of the group — never wrapped — so the group still draws the line between each.
        */}
        {/*
          A due date belongs to a loan: adding to one of theirs, it is that loan's, changed from the loan's page. Each is its own child of the group, never wrapped together — the group draws the line between rows by
          counting its children, and a wrapper around two rows reads to it as one.
        */}
        {detailsOpen && !draft.existingAccountId ? (
          <TextRow label="Due by" type="date" value={draft.dueOn} onChange={(e) => set({ dueOn: e.target.value })} />
        ) : null}
        {/* Asked once per person: a new loan for someone already on the list keeps the ID they have. */}
        {detailsOpen && !draft.existingAccountId && !known ? (
          <TextRow
            label="Tax ID"
            info="A national or tax identification number. Optional; needed only when this loan appears in a tax report."
            value={draft.personIdNumber}
            inputMode="numeric"
            onChange={(e) => set({ personIdNumber: e.target.value })}
          />
        ) : null}
      </InsetGroup>
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        className="ph-focus mb-[18px] flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
      >
        {detailsToggleLabel(detailsOpen)}
      </button>


      {draft.moneyIsCard && (
        <InsetGroup header="What the card paid for" footer="Not spending: it only tells the points engine what the card paid for.">
          <SelectRow label="Category for points" value={draft.spendCategoryId} onChange={(e) => set({ spendCategoryId: e.target.value })}>
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>
          <TextRow label="MCC" value={draft.mcc} inputMode="numeric" onChange={(e) => set({ mcc: e.target.value })} placeholder="5311" />
        </InsetGroup>
      )}


      {setAside.node}
      <ErrorBox error={error} />
    </form>
  );
}
