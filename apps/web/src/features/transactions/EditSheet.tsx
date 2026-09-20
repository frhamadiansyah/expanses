import { isoDate, type PaymentOption } from '@expanses/core';
import { type AccountRow, type CardRow, replaceTransaction, type TransactionView, voidTransaction } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Button, ErrorBox, InputRow, RowGroup } from '../../ui';
import { useCards } from '../cards/card-queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useGoals } from '../goals/queries';
import { useAssetValues } from '../networth/queries';
import { AmountRow } from './AmountRow';
import { CategoryPicker } from './CategoryPicker';
import { ConvertForm } from './ConvertForm';
import { FormRow, FormRows } from './FormRow';
import { MoreDetails } from './MoreDetails';
import { PaymentSheet, chosenPayment } from './PaymentSheet';
import { useChangeable } from './queries';
import { paymentOptions } from './quick-row';
import { currenciesOf } from './TransactionCard';
import { TwoTapDelete } from './TwoTapDelete';
import { type FormDraft, formFromTransaction, formToPost } from './tx-form';

/**
 * Correcting a transaction on a phone: one sheet, the five things usually wrong, and the rarer actions behind ⋯.
 *
 * Both of the phone's ways into an edit open this — the receipt's Edit and the row's swipe — so a correction is
 * the same screen however it was reached. The desktop is untouched: a click there still edits in place through
 * `QuickRowEditor`, which is faster than any sheet and is not to be taken away.
 *
 * It is a **new entry point**, so it inherits the refusals the old ones carry rather than restating them:
 * `useChangeable` is the one place that knows a trade is corrected on Buy & sell, that an opening balance and a
 * deleted row have no form, and that another workspace's row is read-only until that workspace is open. Three
 * defects on this branch were a new way in that skipped exactly that hook. `canEditInSheet` is the caller's
 * question rather than this component's: what the sheet cannot hold — a split, a transfer, a foreign purchase —
 * has to open the full form instead, and only the caller knows how to open it.
 *
 * Nothing here reads a typed figure and nothing here re-states a row: `AmountRow` owns the amount, `formToPost`
 * owns what is posted, `PaymentSheet` owns the account list, `CategoryPicker` owns the categories and
 * `MoreDetails` owns §4's extras — the very same component, with the very same props, the card opens.
 */
export function EditSheet({ tx, onClose }: { tx: TransactionView; onClose: () => void }) {
  const accounts = useAccounts();
  // The draft is read off the accounts, so it must not be built before they are here — the same bargain
  // `TransactionCard` makes, and for the same reason: a draft seeded from an empty list has no currency.
  if (!accounts.isSuccess) {
    return (
      <Sheet title="Edit" onClose={onClose}>
        <p className="text-sm text-slate-500">Loading…</p>
      </Sheet>
    );
  }
  return <SheetBody tx={tx} onClose={onClose} accounts={accounts.data} />;
}

function SheetBody({ tx, onClose, accounts }: { tx: TransactionView; onClose: () => void; accounts: AccountRow[] }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const goals = useGoals().data ?? [];
  const allCards = useCards().data ?? [];
  const holdings = (useAssetValues().data ?? []).filter((row) => row.mode === 'market');
  const { changeable } = useChangeable(tx);

  const [draft, setDraft] = useState<FormDraft>(() => formFromTransaction(tx, accounts, ws.bookId ?? ''));
  const [sheet, setSheet] = useState<null | 'money' | 'category' | 'details' | 'more-actions' | 'convert'>(null);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // The same list the card offers, built the same way: every money account this one could be paid from, one row
  // per card on it. `canPayWith` keeps the account already chosen even when it is no longer spendable.
  const payable: PaymentOption[] = paymentOptions(
    accounts.filter((a) => isMoneyAccount(a) && canPayWith(a, draft.moneyId)),
    allCards as CardRow[],
  );
  const categoryName = draft.categoryId ? (accounts.find((a) => a.id === draft.categoryId)?.name ?? '') : '';
  // Rates are resolved no later than today, exactly as the card resolves them.
  const rateDate = draft.occurredOn > isoDate() ? isoDate() : draft.occurredOn;
  const missingRate = needsRate ? { from: needsRate, to: ws.baseCurrency, onDate: rateDate } : null;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const post = formToPost(draft, accounts);
      // `canEditInSheet` keeps a split, a transfer and a foreign purchase out of here, so what is left is a
      // plain posting. Said in words rather than assumed: a draft that slipped past that gate must not be
      // silently dropped on the floor by a branch that does nothing.
      if (post.kind !== 'post') throw new Error('Open this in the full form to change it.');
      const foreign = currenciesOf(post, accounts).filter((code) => code && code !== ws.baseCurrency);
      const resolved = await resolveRates([...new Set(foreign)], draft.occurredOn);
      if (resolved.missing.length > 0) {
        setNeedsRate(resolved.missing[0]!);
        throw new Error(`No ${resolved.missing[0]}→${ws.baseCurrency} rate for ${rateDate}. Add it under “More”.`);
      }
      // The original stays under Show deleted: `replaceTransaction` voids it and posts a new id, as every
      // other edit on this app does.
      await replaceTransaction(database, ws, tx.id, { ...post.input, ratesToBase: resolved.rates });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await voidTransaction(database, ws, tx.id);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Edit" onClose={onClose}>
      <div className="space-y-3">
        {/* The ⋯ of §F3's header. `Sheet` draws the ✕ and the title; this is the third corner. */}
        <div className="flex justify-end">
          <button
            type="button"
            aria-label="More actions"
            onClick={() => setSheet('more-actions')}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
          >
            <Ellipsis size={18} aria-hidden />
          </button>
        </div>

        <AmountRow draft={draft} accounts={accounts} set={set} />

        <RowGroup>
          <InputRow label="Note" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Superindo" />
          <InputRow label="Date" type="date" required value={draft.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} />
        </RowGroup>

        <FormRows>
          <FormRow label="Paid with" value={chosenPayment(payable, draft)} onClick={() => setSheet('money')} />
          <FormRow
            label="Category"
            icon={draft.categoryId ? <CategoryIcon categoryId={draft.categoryId} accounts={accounts} size="xs" /> : undefined}
            value={categoryName}
            onClick={() => setSheet('category')}
          />
          <FormRow label="More" value="Event, With, Photos…" onClick={() => setSheet('details')} />
        </FormRows>

        <ErrorBox error={error} />
        {/* Gated on the hook, not on a copy of its reasons: what the receipt and the list refuse to change, this
            refuses to change too, and says why rather than offering a Save that cannot work. */}
        {changeable ? (
          <Button type="button" className="w-full justify-center" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-slate-500">This one cannot be corrected here.</p>
        )}
      </div>

      {sheet === 'money' && (
        <PaymentSheet
          title="Paid with"
          options={payable}
          accounts={accounts}
          onPick={(option) => set({ moneyId: option.accountId, cardId: option.cardId ?? '' })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'category' && (
        <CategoryPicker
          kind={draft.mode === 'income' ? 'income' : 'expense'}
          value={draft.categoryId}
          onPick={(categoryId) => set({ categoryId })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'details' && (
        <Sheet title="More details" onClose={() => setSheet(null)}>
          {/* The same component, with the same props, the card opens — §4's rows in one implementation, so a
              field cannot be present on one way in and missing from the other. */}
          <MoreDetails draft={draft} onChange={setDraft} accounts={accounts} missingRate={missingRate} />
        </Sheet>
      )}

      {sheet === 'more-actions' && (
        <Sheet title="More actions" onClose={() => setSheet(null)}>
          <div className="flex flex-col items-stretch gap-2">
            <Button
              variant="ghost"
              className="justify-center"
              onClick={() => void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: tx.id } })}
            >
              Open in full form
            </Button>
            {/* The receipt's own gate, word for word: a conversion with nothing to convert into is a form whose
                Save can never be pressed. */}
            {tx.status === 'posted' && draft.mode === 'expense' && holdings.length > 0 && (
              <Button variant="ghost" className="justify-center" onClick={() => setSheet('convert')}>
                This was a purchase
              </Button>
            )}
            {changeable && <TwoTapDelete busy={busy} onConfirm={() => void remove()} />}
          </div>
        </Sheet>
      )}
      {sheet === 'convert' && (
        <Sheet title="This was a purchase" onClose={() => setSheet(null)}>
          <ConvertForm
            tx={tx}
            holdings={holdings.map((holding) => ({ accountId: holding.accountId, name: holding.name }))}
            goals={goals.map((goal) => ({ id: goal.id, name: goal.name }))}
            onDone={onClose}
          />
        </Sheet>
      )}
    </Sheet>
  );
}
