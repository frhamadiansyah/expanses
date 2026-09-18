import { CATALOG, type CatalogEntry } from '@expanses/catalog';
import { debtItem, isoDate, parseMajor } from '@expanses/core';
import { applyCatalogEntry, createAccount, createCardAccount, openDebtBalance, saveCardTerms, saveLoanTerms } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, InputRow, RowGroup, RowHint, SelectRow } from '../../ui';
import { issuerChoices, useWorkspaceIssuers } from '../cards/card-queries';
import { memberLevelsOf, searchCatalog } from '../cards/catalog-picker';
import { fieldsFor, handOverRows } from './catalogue-view';
import { type DebtItemDraft, emptyDebtItemDraft, planNewDebt } from './debt-form';
import { OwnablePicker } from './OwnablePicker';

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
      searchPlaceholder="Search everything you can owe"
      hint={<>A credit card keeps everything it has today: statement, bill, points and instalments.</>}
      chosen={chosen}
      onChoose={setChosen}
      handOver={handOverRows('debt')}
    >
      {chosen && (card ? <NewCardForm key={chosen} /> : <DebtItemForm key={chosen} item={chosen} />)}
    </OwnablePicker>
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
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [draft, setDraft] = useState<DebtItemDraft>(() => emptyDebtItemDraft(item, today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<DebtItemDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const chosen = debtItem(item);
  const asks = fieldsFor('debt', item);
  const owedToAPerson = asks.includes('person');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planNewDebt(draft, ws.baseCurrency, today);
      if (plan.person) {
        // Money owed to a person is the ledger's, which opens the account and its profile itself.
        await openDebtBalance(database, ws, {
          direction: plan.person.direction,
          personName: plan.person.personName,
          currency: plan.person.currency,
          balanceMinor: plan.person.balanceMinor,
          openedOn: plan.person.openedOn,
          coretaxCode: plan.person.coretaxCode,
        });
        await invalidate();
        await navigate({ to: '/net-worth/debts' });
        return;
      }
      if (!plan.account) return;
      const account = await createAccount(database, ws, {
        name: plan.account.name,
        kind: plan.account.kind,
        subtype: plan.account.subtype,
        currency: plan.account.currency,
        openingBalanceMinor: plan.account.openingBalanceMinor,
        openedOn: plan.account.openedOn,
      });
      if (plan.terms) await saveLoanTerms(database, ws, { accountId: account.id, ...plan.terms });
      await invalidate();
      await navigate({ to: '/net-worth/loans' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <RowHint>
        {chosen.label} · {chosen.sub}
      </RowHint>
      <ErrorBox error={error} />
      <RowGroup>
        {/* A person's debt is filed under their name, so there is nothing else to call it. */}
        {!owedToAPerson && <InputRow label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="KPR BTN Bintaro" />}
        <InputRow label="Owed now" value={draft.owed} onChange={(e) => set({ owed: e.target.value })} inputMode="decimal" placeholder="0" required />
        {asks.includes('lender') && <InputRow label="Lender" value={draft.lender} onChange={(e) => set({ lender: e.target.value })} placeholder="Bank BTN" required />}
        {asks.includes('person') && <InputRow label="Who" value={draft.person} onChange={(e) => set({ person: e.target.value })} placeholder="Ibu" required />}
        {asks.includes('rate') && <InputRow label="Interest rate" value={draft.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" placeholder="9,25" />}
        {asks.includes('term') && <InputRow label="Months left" value={draft.term} onChange={(e) => set({ term: e.target.value })} inputMode="numeric" placeholder="168" />}
        <InputRow label="Owed as of" type="date" value={draft.openedOn} max={today} onChange={(e) => set({ openedOn: e.target.value })} />
      </RowGroup>
      <RowHint>The picker chose what kind of debt this is. Name is what you call yours.</RowHint>
      {asks.includes('term') && <RowHint>Leave the months left empty if you do not know them: the debt still opens at what is owed, and its terms can be added on Loans.</RowHint>}
      {owedToAPerson && <RowHint>Money you owe a person is kept under Lend &amp; borrow, and what is left there is what the tax report uses.</RowHint>}
      <Button type="submit" disabled={busy}>
        Add debt
      </Button>
    </form>
  );
}

/** The bank a card can be given when the catalogue has never heard of it. Mirrors the Accounts page's own sentinel. */
const OTHER = '__other';

/** Every bundled credit card, grouped by the bank that issues it, so a dropdown reads the way a wallet does. */
function byIssuer(entries: readonly CatalogEntry[]): [string, CatalogEntry[]][] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) groups.set(entry.bank, [...(groups.get(entry.bank) ?? []), entry]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The card form, reached from the debt picker.
 *
 * Naming the card is the whole of the setup: the catalogue knows which bank issued it, what it earns, what the
 * bank publishes as its annual fee, and how the plastic is drawn — so picking the product from the list fills all
 * of that in, and the card's own page is where any of it is corrected. "Not listed" keeps the manual path the
 * Accounts page has always had: a name, a bank and the last four digits.
 *
 * A card from the catalogue is asked for its billing and due dates, because the published fee is kept with the
 * card's terms and the terms are what a cycle is counted from. A card typed by hand may leave both for later,
 * exactly as it may on the Accounts page.
 */
function NewCardForm() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [query, setQuery] = useState('');
  const [entryId, setEntryId] = useState('');
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [otherIssuer, setOtherIssuer] = useState('');
  const [last4, setLast4] = useState('');
  const [owed, setOwed] = useState('');
  const [memberLevel, setMemberLevel] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const credit = CATALOG.filter((entry) => entry.cardType !== 'debit');
  const matches = searchCatalog(credit, query);
  const entry = credit.find((candidate) => candidate.id === entryId) ?? null;
  const levels = entry ? memberLevelsOf(entry) : [];
  const banks = issuerChoices(useWorkspaceIssuers().data ?? []);

  /** Picking a product names the card. Some issuers close every cardholder's statement on the same day. */
  function choose(id: string) {
    setEntryId(id);
    setMemberLevel('');
    const picked = credit.find((candidate) => candidate.id === id);
    if (!picked) return;
    setName(picked.name);
    if (picked.program.fixedStatementDay) setStatementDay(String(picked.program.fixedStatementDay));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const currency = entry?.currency ?? ws.baseCurrency;
      const days = statementDay.trim() !== '' && dueDay.trim() !== '';
      if (entry && !days) throw new Error('A card from the catalogue needs its billing date and due date: that is where its fee and its cycle are kept');
      const account = await createCardAccount(database, ws, {
        name,
        subtype: 'credit_card',
        currency,
        // The catalogue knows the bank; a card typed by hand is told it.
        issuer: entry ? entry.bank : issuer === OTHER ? otherIssuer : issuer,
        last4,
        openingBalanceMinor: owed.trim() ? parseMajor(owed, currency) : 0,
        openedOn: today,
      });
      // The terms row has to exist before the catalogue can write the published fee onto it.
      if (days) {
        await saveCardTerms(database, ws, { accountId: account.id, statementDay: Number(statementDay), dueDay: Number(dueDay), creditLimitMinor: null, annualFeeMinor: null });
      }
      if (entry) {
        await applyCatalogEntry(database, ws, { cardAccountId: account.id, entry, today, replaceManual: false, memberLevel: memberLevel || null });
      }
      await invalidate();
      await navigate({ to: '/cards/$cardId', params: { cardId: account.id } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <RowHint>Credit card · filed as a debt, kept as a card</RowHint>
      <ErrorBox error={error} />
      <RowGroup>
        <InputRow label="Find a card" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BCA, KrisFlyer, Mandiri" />
        <SelectRow label="Which card" value={entryId} onChange={(e) => choose(e.target.value)}>
          <option value="">Not listed — type the name</option>
          {byIssuer(matches).map(([bank, entries]) => (
            <optgroup key={bank} label={bank}>
              {entries.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectRow>
        <InputRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA KrisFlyer" required />
        {/* Applying a catalogue entry fills the bank in, so it is only asked for when the card is typed by hand. */}
        {!entry && (
          <SelectRow label="Bank" value={issuer} onChange={(e) => setIssuer(e.target.value)}>
            <option value="">Not saying</option>
            {banks.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </SelectRow>
        )}
        {!entry && issuer === OTHER && <InputRow label="Bank name" value={otherIssuer} onChange={(e) => setOtherIssuer(e.target.value)} placeholder="Bank Mega" />}
        {levels.length > 0 && (
          <SelectRow label={`${entry?.program.name} level`} value={memberLevel} onChange={(e) => setMemberLevel(e.target.value)}>
            <option value="">Choose your level</option>
            {levels.map((level) => (
              <option key={level.key} value={level.key}>
                {level.name} — {level.condition}
              </option>
            ))}
          </SelectRow>
        )}
        <InputRow label="Last 4 digits" value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="1467" />
        <InputRow label="Owed now" value={owed} onChange={(e) => setOwed(e.target.value)} inputMode="decimal" placeholder="0" />
        {/* The card's own page calls these the billing and due dates; the same words here, so nothing is renamed halfway. */}
        <InputRow label="Billing date" value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" placeholder="25" required={Boolean(entry)} />
        <InputRow label="Due date" value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="12" required={Boolean(entry)} />
      </RowGroup>
      <RowHint>A card keeps its statement, bill, points and instalments.</RowHint>
      {entry ? (
        <RowHint>
          Its earn rules and the {entry.bank} published annual fee are filled in from the catalogue, verified {entry.verifiedOn}. Both can be corrected on the
          card's own page.
        </RowHint>
      ) : (
        <RowHint>Not in the list is fine: name it yourself and set up what it earns on the card's own page.</RowHint>
      )}
      <Button type="submit" disabled={busy}>
        Add card
      </Button>
    </form>
  );
}
