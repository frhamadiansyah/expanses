import { CASH_ITEMS, isoDate, type MoneyAccountSubtype } from '@expanses/core';
import { editSharedExpense, linkSharedItem, ownerScope, recordSharedExpense, type SharedEventView, sharedEventView, voidSharedExpense } from '@expanses/db';
import { Check, CreditCard, Percent, Plane, Shapes, Split, Users } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { useAccounts, useInvalidateAll, useResolveRates, useStoredRates } from '../../lib/queries';
import { ErrorBox, RowHint } from '../../ui';
import { PushedTitle } from '../../ui/native';
import { useCards } from '../cards/card-queries';
import { moneyAccounts } from '../events/shared-view';
import { AmountRow } from './AmountRow';
import { DateRow, NoteRow } from './CardRows';
import { CategoryPicker, EventCategoryGlyph } from './CategoryPicker';
import { ChoiceSheet } from './ChoiceSheet';
import { FieldRow, FormRow, FormRows, RowGlyph } from './FormRow';
import { chosenPayment, PaymentSheet } from './PaymentSheet';
import { paymentOptions } from './quick-row';
import {
  draftFromExpense,
  emptySharedDraft,
  moneyLocked,
  payerChoices,
  type SharedExpenseDraft,
  sharedDraftToInput,
  sharedDraftToPatch,
  splitSummary,
  suggestedRate,
} from './shared-expense-form';
import { ShareSplitSheet } from './ShareSplitSheet';
import { emptyForm, type FormDraft } from './tx-form';
import { TwoTapDelete } from './TwoTapDelete';

/** What a plan item's "Buy it now" fills in: its name, its estimate in the event currency, its category. */
export interface SharedExpenseSeed {
  note: string;
  amount: string;
  categoryId: string | null;
  /** Carried from the workspace card (the Event row): its currency and date, when it had a figure or a day of its own. */
  currency?: string;
  occurredOn?: string;
}

/**
 * The Add screen in a shared event (shared events §6): the event filled in; Paid by this person (from one of their
 * accounts, with what a card in another currency was charged) or a person without the app; Split; the event's
 * categories; any currency, with its rate to the event currency suggested from the day's rates and editable. Opened on
 * an expense, it edits it — the money of what another member paid is greyed, saying whose it is (D8).
 *
 * R14's ruling: it is the Add screen, not a form of its own. It is drawn from the workspace card's own pieces — the
 * bar with ‹ and ✓, `AmountRow` with its keypad and currency sheet (so the "," key and the rounding of cents on a
 * whole-unit currency work as they do there), `FormRow`s, `CategoryPicker` (fed the event's categories), the Note and
 * Date rows — in the card's order: Paid by where Paid with sits, the amount, Category, Note, Date, then a second group
 * where Add more details opens, holding the Event and Split where the Event and With rows sit. Only the rows that are
 * a shared event's own (Paid by, the rate, Split) are new.
 *
 * `AmountRow` reads a `FormDraft`. Rather than teach it a second shape, the card hands it one made from this draft
 * (`amountForm`) and maps what it writes back: the amount, the currency and the charged figure, nothing else.
 */
export function SharedExpenseCard({
  view,
  expenseId,
  itemId,
  seed,
  title,
  onBack,
  onDone,
}: {
  view: SharedEventView;
  expenseId?: string;
  /** "Buy it now" on the shared plan: the new expense is the item, which takes the whole of it as its share (D7). */
  itemId?: string;
  seed?: SharedExpenseSeed;
  title?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const storedRates = useStoredRates();
  const accounts = useAccounts().data ?? [];
  const cards = useCards().data ?? [];
  const editing = expenseId ? (view.expenses.find((e) => e.expenseId === expenseId) ?? null) : null;
  const [draft, setDraft] = useState<SharedExpenseDraft>(() => {
    if (editing) return draftFromExpense(view, editing);
    const empty = emptySharedDraft(view, isoDate());
    return seed
      ? { ...empty, note: seed.note, amount: seed.amount, categoryId: seed.categoryId ?? '', ...(seed.currency ? { currency: seed.currency } : {}), ...(seed.occurredOn ? { occurredOn: seed.occurredOn } : {}) }
      : empty;
  });
  const [sheet, setSheet] = useState<null | 'payer' | 'money' | 'category' | 'split'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<SharedExpenseDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const locked = moneyLocked(editing);
  const mine = draft.payer === view.me;
  const money = moneyAccounts(accounts);
  const payable = paymentOptions(money, cards);
  const account = accounts.find((a) => a.id === draft.accountId) ?? null;

  /*
   * The rate to the event currency follows the currency on the flag: picking one suggests the day's rate through the
   * base currency — what this phone stored first, then what the rate service says — and the row stays editable. A
   * rate typed by hand is kept until the currency changes again; an expense opened for editing keeps its own.
   */
  // A new card opened on a carried currency starts from the event's own, so the first pass suggests that currency's rate.
  const lastCurrency = useRef(editing ? draft.currency : view.currency);
  useEffect(() => {
    if (draft.currency === lastCurrency.current) return;
    lastCurrency.current = draft.currency;
    const currency = draft.currency;
    if (currency === view.currency) {
      set({ rate: '1' });
      return;
    }
    set({ rate: '' });
    let stale = false;
    void (async () => {
      const wanted = [currency, view.currency];
      const stored = await storedRates(wanted, draft.occurredOn).catch(() => ({ rates: {} as Record<string, number> }));
      let suggested = suggestedRate(currency, view.currency, ws.baseCurrency, stored.rates);
      if (!suggested) {
        const fetched = await resolveRates(wanted, draft.occurredOn).catch(() => ({ rates: {} as Record<string, number> }));
        suggested = suggestedRate(currency, view.currency, ws.baseCurrency, fetched.rates);
      }
      if (!stale && suggested) setDraft((d) => (d.currency === currency && !d.rate ? { ...d, rate: suggested! } : d));
    })();
    return () => {
      stale = true;
    };
  }, [draft.currency]);

  // The workspace card's own draft, as the amount row reads it: the figure, the flag and the account that paid.
  const amountForm = useMemo<FormDraft>(
    () => ({
      ...emptyForm(''),
      mode: 'expense',
      occurredOn: draft.occurredOn,
      moneyId: mine ? draft.accountId : '',
      cardId: draft.cardId,
      amount: draft.amount,
      currency: draft.currency,
      chargedAmount: draft.charged,
      editing: !!editing,
    }),
    [draft.occurredOn, draft.accountId, draft.cardId, draft.amount, draft.currency, draft.charged, mine, editing],
  );
  const setAmount = (patch: Partial<FormDraft>) =>
    set({
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.chargedAmount !== undefined ? { charged: patch.chargedAmount } : {}),
    });

  // What the bar's ✓ answers: whether Save would send this as it stands — the same question Save asks, asked early.
  const ready = (() => {
    if (busy) return false;
    try {
      if (editing) sharedDraftToPatch(draft, view, editing.expenseId);
      else sharedDraftToInput(draft, view, accounts);
      return true;
    } catch {
      return false;
    }
  })();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The day's rates to the base currency, so this phone posts its share at once (§5).
      await resolveRates([...new Set([draft.currency, view.currency, ...(account?.currency ? [account.currency] : [])])], draft.occurredOn).catch(() => undefined);
      if (editing) {
        await editSharedExpense(database, ownerScope(ws), view.eventId, editing.expenseId, sharedDraftToPatch(draft, view, editing.expenseId));
      } else {
        const id = await recordSharedExpense(database, ownerScope(ws), view.eventId, sharedDraftToInput(draft, view, accounts));
        // Buy it now: the expense is the item, so the item takes the whole of it as its share (D7).
        if (itemId) {
          const fresh = await sharedEventView(database, ownerScope(ws), view.eventId);
          const share = fresh?.expenses.find((e) => e.expenseId === id)?.eventAmountMinor;
          if (share) await linkSharedItem(database, ownerScope(ws), view.eventId, itemId, { expenseId: id, shareMinor: share });
        }
      }
      await invalidate();
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setError(null);
    setBusy(true);
    try {
      await voidSharedExpense(database, ownerScope(ws), view.eventId, editing.expenseId);
      await invalidate();
      onDone();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const payerName = view.people.find((p) => p.personId === draft.payer)?.name ?? editing?.payerName ?? '';
  const paying = payable.find((option) => option.accountId === draft.accountId && (option.cardId ?? '') === draft.cardId);
  const category = view.categories.find((c) => c.categoryId === draft.categoryId) ?? null;
  const initials = (personId: string) => view.people.find((p) => p.personId === personId)?.initials ?? '?';

  return (
    <>
      <PushedTitle
        title={title ?? (editing ? 'Edit transaction' : 'New transaction')}
        back="Back"
        onBack={onBack}
        actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: !ready, run: () => formRef.current?.requestSubmit() }]}
      />
      <form ref={formRef} onSubmit={(event) => void save(event)} aria-label={editing ? 'Edit shared spending' : 'Add shared spending'} data-testid="shared-expense-card" className="flex flex-col gap-[10px]">
        <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)]">
          <FormRows className="rounded-none">
            {/* Paid by, where the workspace card's Paid with sits: who paid, and — when it was this person — with what. */}
            <FormRow
              lead="value"
              icon={
                <RowGlyph>
                  <Users size={15} />
                </RowGlyph>
              }
              label="Paid by"
              value={payerName}
              caption="Paid by"
              // R11/R13: who paid an expense is fixed once it is recorded; a wrong payer is deleted and recorded again.
              disabled={!!editing}
              chevron={!editing}
              onClick={() => setSheet('payer')}
            />
            {mine && (
              <FormRow
                lead="value"
                icon={
                  <RowGlyph>
                    <CreditCard size={15} />
                  </RowGlyph>
                }
                label="Paid with"
                value={paying?.cardId ? paying.accountName : editing ? (account?.name ?? '') : chosenPayment(payable, amountForm)}
                caption={paying?.cardId ? `···· ${paying.last4 ?? '????'}` : 'Paid with'}
                // The account a payment came from stays with it (R5): an edit changes the money, not where it came from.
                disabled={!!editing}
                chevron={!editing}
                onClick={() => setSheet('money')}
              />
            )}

            <AmountRow draft={amountForm} accounts={accounts} set={setAmount} noRefund anyCurrency locked={!!locked} />

            {draft.currency !== view.currency && (
              <FieldRow
                icon={
                  <RowGlyph>
                    <Percent size={15} />
                  </RowGlyph>
                }
                label={`Rate to ${view.currency}`}
                caption={`${view.currency} per 1 ${draft.currency}`}
                placeholder="Rate"
                inputMode="decimal"
                value={draft.rate}
                disabled={!!locked}
                onChange={(rate) => set({ rate })}
              />
            )}

            <FormRow
              lead="value"
              label="Category"
              placeholder="No category"
              icon={
                category ? (
                  <EventCategoryGlyph icon={category.icon} />
                ) : (
                  <RowGlyph>
                    <Shapes size={15} />
                  </RowGlyph>
                )
              }
              value={category?.name ?? ''}
              caption=""
              onClick={() => setSheet('category')}
            />

            <NoteRow value={draft.note} onChange={(note) => set({ note })} />
            <DateRow on={draft.occurredOn} onChange={(occurredOn) => set({ occurredOn })} disabled={!!locked} />
          </FormRows>
        </div>

        {/* Where Add more details opens on the workspace card, open: the Event row, filled in, and Split where With sits. */}
        <section aria-label="More details">
          <FormRows>
            <FormRow
              icon={
                <RowGlyph>
                  <Plane size={15} />
                </RowGlyph>
              }
              label="Event"
              value={view.name}
              chevron={false}
              disabled
              onClick={() => undefined}
            />
            <FormRow
              icon={
                <RowGlyph>
                  <Split size={15} />
                </RowGlyph>
              }
              label="Split"
              value={splitSummary(draft)}
              onClick={() => setSheet('split')}
            />
          </FormRows>
        </section>

        {locked && <RowHint>{locked}</RowHint>}
        <ErrorBox error={error} />
        {editing && !locked && <TwoTapDelete busy={busy} onConfirm={() => void remove()} className="self-center" />}
      </form>

      {sheet === 'payer' && (
        <ChoiceSheet
          title="Paid by"
          value={draft.payer}
          groups={[{ choices: payerChoices(view).map((p) => ({ value: p.personId, label: p.label, glyph: <span className="text-[12px] font-semibold">{initials(p.personId)}</span> })) }]}
          footer="Someone with the app records what they paid on their own phone."
          // Another person paid: none of this person's accounts did, and nothing was charged to one.
          onPick={(payer) => set(payer === view.me ? { payer } : { payer, accountId: '', cardId: '', charged: '' })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'money' && (
        <PaymentSheet
          title="Paid with"
          options={payable}
          accounts={accounts}
          chosenAccountId={draft.accountId}
          chosenCardId={draft.cardId}
          cards
          onPick={(option) => set({ accountId: option.accountId, cardId: option.cardId ?? '', charged: '' })}
          onClose={() => setSheet(null)}
          adding={{
            kinds: CASH_ITEMS.map((item) => item.id as MoneyAccountSubtype).filter((subtype) => canPayWith({ id: '', kind: 'asset', subtype }, '')),
            onAdded: (accountId) => set({ accountId, cardId: '', charged: '' }),
          }}
        />
      )}
      {sheet === 'category' && (
        <CategoryPicker kind="expense" value={draft.categoryId} eventCategories={view.categories} onPick={(categoryId) => set({ categoryId })} onClose={() => setSheet(null)} />
      )}
      {sheet === 'split' && <ShareSplitSheet view={view} draft={draft} set={set} onClose={() => setSheet(null)} />}
    </>
  );
}
