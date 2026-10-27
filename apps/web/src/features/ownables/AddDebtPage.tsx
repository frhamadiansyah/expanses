import { CATALOG, type CatalogEntry } from '@expanses/catalog';
import { CURRENCIES, debtItem, isoDate } from '@expanses/core';
import { applyCatalogEntry, createAccount, createCardAccount, openDebtBalance, saveCardTerms, saveLoanTerms, setLoanItem } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PushedTitle, SCREEN, SelectRow, TAP, TextRow } from '../../ui/native';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { issuerChoices, useWorkspaceIssuers } from '../cards/card-queries';
import { memberLevelsOf } from '../cards/catalog-picker';
import { detailsToggleLabel } from '../transactions/tx-form';
import { catalogueOffers, entryOnRow } from './card-row';
import { CardSearch } from './CardSearch';
import { fieldsFor, handOverRows } from './catalogue-view';
import { cardAccountName, type DebtItemDraft, emptyDebtItemDraft, planNewCard, planNewDebt, splitCardName } from './debt-form';
import { OwnablePicker } from './OwnablePicker';
import { BankNameRow, type EmbeddedForm } from './CashAccountForm';
import { useShareOnAdd } from '../sharing/ShareWithHousehold';

/**
 * Adding a debt, named the way you would say it: a mortgage, a leasing, a paylater, money borrowed from family.
 *
 * Every row but one opens a liability here. A credit card does not: it is a statement, a bill, points and
 * instalments, and the card form already knows how to make one — so choosing it hands the screen over to that
 * form rather than opening half a card.
 */
export function AddDebtPage() {
  const [chosen, setChosen] = useState<string | null>(null);
  const card = chosen !== null && debtItem(chosen).behaviour.opens === 'card';
  return (
    <OwnablePicker
      flow="debt"
      title="New debt"
      searchPlaceholder="Search everything that can be owed"
      chosen={chosen}
      onChoose={setChosen}
      handOver={handOverRows('debt')}
    >
      {chosen && (card ? <NewCardForm key={chosen} /> : <DebtItemForm key={chosen} item={chosen} />)}
    </OwnablePicker>
  );
}

/**
 * A credit card, added straight from Wallet's + with no debt to choose first: the same card form the debt picker hands
 * over to, on a page of its own.
 */
export function AddCardPage() {
  return (
    <div className={SCREEN}>
      <PushedTitle title="New credit card" back="Wallet" backTo="/wallet" />
      <NewCardForm />
    </div>
  );
}

/**
 * The form behind every debt but a card: a loan with a lender, or money owed to a person.
 *
 * It asks only what its item needs — the catalogue decided that when the item was chosen — and `planNewDebt`
 * decides what the answers become. A loan opens a liability account and, when the months left are known, the
 * terms that give it a schedule; money owed to a person is opened by the Lend & borrow ledger instead, which
 * keeps both sides of it.
 */
function DebtItemForm({ item }: { item: string }) {
  const { database, ws } = useApp();
  const household = useShareOnAdd('debt-shared-switch');
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const [draft, setDraft] = useState<DebtItemDraft>(() => emptyDebtItemDraft(item, today));
  // A debt in another currency is ordinary — a dollar car loan is a dollar car loan — so the workspace's own is
  // only the answer already filled in. The figure is read in whichever currency is chosen.
  const [currency, setCurrency] = useState(ws.baseCurrency);
  // A debt in a currency the device holds no rate for: the same row the money accounts ask for, for the same
  // reason — the ledger converts with a rate, and a typed one is stored for the day it is owed from.
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  const set = (patch: Partial<DebtItemDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const chosen = debtItem(item);
  const asks = fieldsFor('debt', item);
  const owedToAPerson = asks.includes('person');
  const opensLoan = chosen.behaviour.opens === 'loan';
  const foreign = currency !== ws.baseCurrency;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planNewDebt(draft, currency, today);
      if (plan.person) {
        // Money owed to a person is the ledger's, which opens the account and its profile itself.
        const owed = await openDebtBalance(database, ws, {
          direction: plan.person.direction,
          personName: plan.person.personName,
          currency: plan.person.currency,
          balanceMinor: plan.person.balanceMinor,
          openedOn: plan.person.openedOn,
          coretaxCode: plan.person.coretaxCode,
        });
        await household.save([owed.id]);
        await invalidate();
        await navigate({ to: '/net-worth/lend-borrow' });
        return;
      }
      // Only a card leaves the account out, and a card never reaches this form.
      if (!plan.account) throw new Error(`“${chosen.label}” is not opened here`);
      const openingRateToBase = await openingRateFor({
        database,
        ws,
        currency,
        openedOn: draft.openedOn,
        openingBalanceMinor: plan.account.openingBalanceMinor,
        typed: manualRate,
        resolveRates,
      });
      const account = await createAccount(database, ws, {
        name: plan.account.name,
        kind: plan.account.kind,
        subtype: plan.account.subtype,
        currency: plan.account.currency,
        openingBalanceMinor: plan.account.openingBalanceMinor,
        openedOn: plan.account.openedOn,
        openingRateToBase,
      });
      if (plan.terms) await saveLoanTerms(database, ws, { accountId: account.id, ...plan.terms });
      // Which kind of loan it is, in the words of the item that was just chosen: what the Debts page folds by.
      await setLoanItem(database, ws, account.id, item);
      await household.save([account.id]);
      await invalidate();
      await navigate({ to: '/net-worth/loans' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    /* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */
    <form ref={form} onSubmit={submit}>
      <ErrorBox error={error} />
      <InsetGroup
        header={chosen.label}
        footer={
          <>
            {chosen.sub}. The picker chose what kind of debt this is. The name is what it's called here.
            {asks.includes('term') && ' Leave the months left empty if not known: the debt still opens at what is owed, and its terms can be added on Debts.'}
            {owedToAPerson && ' Money owed to a person is kept under Lend & borrow, and what is left there is what the tax report uses.'}
          </>
        }
      >
        {/* A person's debt is filed under their name, so there is nothing else to call it. */}
        {!owedToAPerson && <TextRow label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Loan name" />}
        <TextRow label="Owed now" value={draft.owed} onChange={(e) => set({ owed: e.target.value })} inputMode="decimal" placeholder="Amount" required />
        <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </SelectRow>
        {opensLoan && foreign && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            inputMode="decimal"
          />
        )}
        {asks.includes('lender') && <TextRow label="Lender" value={draft.lender} onChange={(e) => set({ lender: e.target.value })} placeholder="Bank or lender" required />}
        {asks.includes('person') && <TextRow label="Who" value={draft.person} onChange={(e) => set({ person: e.target.value })} placeholder="Name" required />}
        {asks.includes('rate') && <TextRow label="Interest rate" value={draft.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" placeholder="% a year" />}
        {asks.includes('term') && <TextRow label="Months left" value={draft.term} onChange={(e) => set({ term: e.target.value })} inputMode="numeric" placeholder="Months" />}
        {household.row}
        <TextRow label="Owed as of" type="date" value={draft.openedOn} max={today} onChange={(e) => set({ openedOn: e.target.value })} />
      </InsetGroup>
      <InsetGroup>
        {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
        <InsetRow title="Add debt" action onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
    </form>
  );
}

/** A step the card form moves to inside whatever holds it: what the holder's header says, and how it comes back. */
export interface FormStep {
  title: string;
  back: () => void;
}

/** The card form drawn in a sheet: the sheet's own ✓, and its header given over to the form's search step. */
export interface CardFormEmbedding extends EmbeddedForm {
  /** Told when the form moves to its search and back (null), so the sheet's header follows: ‹ and the step's title. */
  onStep?: (step: FormStep | null) => void;
}

/**
 * The card form, reached from the debt picker and from Paid with's Add credit card.
 *
 * Naming the card is the whole of the setup, on the New account form's own bank-and-name row: the bank where the
 * label would be, the card's name typed at the right. As the name is typed the catalogue's cards are offered over
 * the keyboard — that bank's, or any bank's while none is chosen — and picking one links it: the catalogue knows
 * what it earns, what the bank publishes as its annual fee and how the plastic is drawn. A name typed and not
 * picked is a card of its own. ⌕ at the row's end opens the whole catalogue as a search, for a screen with no
 * keyboard to carry the offers and for a card whose name is easier found than typed. The bank is saved as the
 * card's issuer and the name without the bank's words, so the two compose again wherever the card is named.
 *
 * The billing and due dates are details too, for every card: a card opens without them, and its own page asks for
 * them until they are given — with the published fee beside them for a card from the catalogue, since the fee is
 * kept on the terms the dates make. Last 4 digits and the current balance stay in sight: the digits are how a
 * statement or an alert names the card, and the balance — what it owes today — is the one figure it is opened at.
 */
export function NewCardForm({
  onCreated,
  embedded,
}: {
  /** Where saving goes instead of the card's own page, given the card account just made. */
  onCreated?: (accountId: string) => void;
  /** Drawn in a sheet: no heading line and no button — the sheet's ✓ saves it (see `CashAccountForm`). */
  embedded?: CardFormEmbedding;
}) {
  const { database, ws } = useApp();
  const household = useShareOnAdd('debt-shared-switch');
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  // The bank half of the row: the card's issuer, a catalogue card's own bank once one is picked.
  const [bank, setBank] = useState('');
  // A hand-typed card in another currency is ordinary, and the figure is read in whichever currency is chosen.
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [manualRate, setManualRate] = useState('');
  const [last4, setLast4] = useState('');
  const [owed, setOwed] = useState('');
  const [memberLevel, setMemberLevel] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [searching, setSearching] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const canSave = !busy && name.trim() !== '';
  const onCanSave = embedded?.onCanSave;
  useEffect(() => onCanSave?.(canSave), [onCanSave, canSave]);
  // In a sheet the search is the sheet's next step, so its header follows the form there and back.
  const onStep = embedded?.onStep;
  useEffect(() => {
    if (!onStep) return;
    onStep(searching ? { title: 'Find a card', back: () => setSearching(false) } : null);
    return () => onStep(null);
  }, [onStep, searching]);

  const credit = CATALOG.filter((candidate) => candidate.cardType !== 'debit');
  const entry = credit.find((candidate) => candidate.id === entryId) ?? null;
  const levels = entry ? memberLevelsOf(entry) : [];
  const banks = issuerChoices(useWorkspaceIssuers().data ?? []);
  const foreign = currency !== ws.baseCurrency;
  const fixedDay = entry?.program.fixedStatementDay;
  /** A product picked from the catalogue — offered over the keyboard or found by ⌕ — fills both halves of the row. */
  function pick(picked: CatalogEntry) {
    const row = entryOnRow(picked);
    setEntryId(picked.id);
    setBank(row.bank);
    setName(row.name);
    setMemberLevel('');
    setSearching(false);
  }

  /** Changing either half of a picked card's row makes it a card of its own: the product is no longer the one named. */
  const unlink = () => {
    setEntryId('');
    setMemberLevel('');
  };
  const typeBank = (typed: string) => {
    if (entry && typed.trim() !== bank.trim()) unlink();
    setBank(typed);
  };
  const typeCardName = (typed: string) => {
    if (entry && typed.trim() !== name.trim()) unlink();
    setName(typed);
  };

  /**
   * A card the catalogue does not carry: the words searched for, split the way the bank-and-name row reads them —
   * a leading bank's name in the bank's place, still editable, and the rest as the card's own name.
   */
  function typeName(typed: string) {
    const split = splitCardName(typed, banks);
    setEntryId('');
    setBank(split.bank);
    setName(split.name);
    setMemberLevel('');
    setSearching(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Everything that can be refused is refused before the account exists: a card opened and then turned away
      // cannot be finished, since pressing the button again either opens a second one or hits the duplicate check.
      const plan = planNewCard(
        { name, issuer: bank, last4, owed, memberLevel, statementDay, dueDay },
        entry,
        ws.baseCurrency,
        currency,
      );
      const openingRateToBase = await openingRateFor({
        database,
        ws,
        currency: plan.currency,
        openedOn: today,
        openingBalanceMinor: plan.openingBalanceMinor,
        typed: manualRate,
        resolveRates,
      });
      const account = await createCardAccount(database, ws, {
        name: plan.name,
        subtype: 'credit_card',
        currency: plan.currency,
        // The catalogue knows the bank; a card typed by hand is told it.
        issuer: plan.issuer,
        last4: plan.last4,
        openingBalanceMinor: plan.openingBalanceMinor,
        openedOn: today,
        openingRateToBase,
      });
      // The terms row has to exist before the catalogue can write the published fee onto it. With no dates there is
      // no row: the earn rules are applied all the same, and the card's page offers the fee beside the dates it asks for.
      if (plan.terms) {
        await saveCardTerms(database, ws, { accountId: account.id, ...plan.terms, creditLimitMinor: null, annualFeeMinor: null });
      }
      if (entry) {
        await applyCatalogEntry(database, ws, { cardAccountId: account.id, entry, today, replaceManual: false, memberLevel: plan.memberLevel });
      }
      await household.save([account.id]);
      await invalidate();
      if (onCreated) onCreated(account.id);
      else await navigate({ to: '/cards/$cardId', params: { cardId: account.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const search = <CardSearch entries={credit} chosenId={entry?.id ?? null} initialQuery={entry ? '' : cardAccountName(bank, name)} onPick={pick} onTyped={typeName} />;
  // Inside a sheet the search takes the form's place, as the sheet's own step; the form's answers wait in state.
  if (searching && onStep) return search;

  return (
    <>
      {/* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */}
      <form ref={form} id={embedded?.formId} onSubmit={submit}>
        <ErrorBox error={error} />
        <InsetGroup header={embedded ? undefined : 'Credit card · filed as a debt, kept as a card'}>
          {/* One row for which card it is, the New account form's own: the bank, then the name, offered the catalogue. */}
          <CardRow
            bank={bank}
            onBank={typeBank}
            name={name}
            onName={typeCardName}
            offersBanks={ws.baseCurrency === 'IDR'}
            // A card already picked is answered; editing either half unlinks it, and the offers come back.
            offers={entry ? [] : catalogueOffers(credit, bank, name)}
            onPick={pick}
            onSearch={() => setSearching(true)}
          />
          {levels.length > 0 && (
            <SelectRow label={`${entry?.program.name} level`} value={memberLevel} onChange={(e) => setMemberLevel(e.target.value)}>
              <option value="">Choose a level</option>
              {levels.map((level) => (
                <option key={level.key} value={level.key}>
                  {level.name} — {level.condition}
                </option>
              ))}
            </SelectRow>
          )}
          <TextRow label="Last 4 digits" value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="••••" />
          <TextRow label="Current balance" value={owed} onChange={(e) => setOwed(e.target.value)} inputMode="decimal" placeholder="Amount" />
          {household.row}
        </InsetGroup>
        {/*
          The rest is the fold's, as on the transaction form: a catalogue card already knows its currency, so only a
          card typed by hand is asked it, and the dates can wait for the card's page.
        */}
        {detailsOpen && (
          <InsetGroup>
            {!entry && (
              <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </SelectRow>
            )}
            {!entry && foreign && (
              <TextRow
                label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
                hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}
                value={manualRate}
                onChange={(e) => setManualRate(e.target.value)}
                inputMode="decimal"
              />
            )}
            {/* The card's own page calls these the billing and due dates; the same words here, so nothing is renamed halfway. */}
            <TextRow
              label="Billing date"
              hint={fixedDay && !statementDay.trim() ? `Every statement of this card closes on day ${fixedDay}.` : undefined}
              value={statementDay}
              onChange={(e) => setStatementDay(e.target.value)}
              inputMode="numeric"
              placeholder="Day of month"
            />
            <TextRow label="Due date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="Day of month" />
          </InsetGroup>
        )}
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
          className="ph-focus mb-[18px] flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
        >
          {detailsToggleLabel(detailsOpen)}
        </button>
          {!embedded && (
          <InsetGroup>
            {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
            <InsetRow title="Add card" action onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
          </InsetGroup>
        )}
      </form>
      {/* On its own page the search opens over the form, outside it, so Enter in the search never saves the card. */}
      {searching && (
        <Sheet title="Find a card" grouped tall expanded onClose={() => setSearching(false)}>
          {search}
        </Sheet>
      )}
    </>
  );
}

/** How long the cards over the keyboard outlast the name field's focus: long enough for the tap that took it to land. */
const STRIP_GRACE_MS = 300;

/**
 * The card's row: the New account form's bank-and-name row as it is, the catalogue's cards over the keyboard while
 * its name is typed — the same strip the bank's offers ride — and ⌕ after it, which opens the whole catalogue as a
 * search. The strip is a phone's only (a desktop has no keyboard for it to ride), so ⌕ is how a wider screen, and
 * anyone who would rather look than type, reaches a listed card. The row is a group's child, so the separator the
 * group gives it is handed on to the bank row.
 */
function CardRow({
  offers,
  onPick,
  onSearch,
  position,
  ...row
}: GroupChild & {
  bank: string;
  onBank: (bank: string) => void;
  name: string;
  onName: (name: string) => void;
  offersBanks: boolean;
  /** The catalogue cards to offer for what is typed now. */
  offers: readonly CatalogEntry[];
  onPick: (entry: CatalogEntry) => void;
  onSearch: () => void;
}) {
  // Which half is being typed in, read off the field that has the focus: the bank row offers banks, this the cards.
  const [typingName, setTypingName] = useState(false);
  const isName = (target: EventTarget) => target instanceof HTMLInputElement && target.getAttribute('aria-label') === 'Name';
  return (
    <div
      className="flex items-center"
      onFocus={(event) => isName(event.target) && setTypingName(true)}
      onBlur={(event) => isName(event.target) && window.setTimeout(() => setTypingName(false), STRIP_GRACE_MS)}
    >
      <div className="min-w-0 flex-1">
        <BankNameRow {...row} namePlaceholder="Card name" position={position} />
      </div>
      <button
        type="button"
        onClick={onSearch}
        aria-label="Find in the catalogue"
        className="ph-focus-inset flex shrink-0 items-center justify-center text-[var(--ph-ink-3)]"
        style={{ width: TAP, height: TAP }}
      >
        <Search size={17} strokeWidth={1.7} absoluteStrokeWidth aria-hidden />
      </button>
      <KeyboardStrip
        label="Catalogue cards"
        cells={(typingName ? offers : []).map((entry) => ({
          key: entry.id,
          label: entry.name,
          title: entryOnRow(entry).name,
          detail: entry.bank,
          onPick: () => onPick(entry),
        }))}
      />
    </div>
  );
}
