import { isoDate, type PaymentOption } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  postTransaction,
  recordTaggedTransfer,
  recordTrade,
  replaceTransaction,
  saveMerchantMcc,
  splitBill,
  type TransactionView,
} from '@expanses/db';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Button, Card, ErrorBox, InputRow, RowGroup, Select, SelectRow } from '../../ui';
import { InsetGroup, InsetRow, SegmentedControl, SubmitRow } from '../../ui/native';
import { useCards } from '../cards/card-queries';
import { CategoryOptions } from '../cards/options';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCanHold, useGoals, useSetAsideChoiceOf } from '../goals/queries';
import { doorOfForm, postForDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { useOpenBook } from '../workspaces/queries';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { AmountRow } from './AmountRow';
import { buyChoices, emptyPurchaseDraft, type PurchaseDraft, transferTargets } from './buy-in-form';
import { CategoryPicker } from './CategoryPicker';
import { FormRow, FormRows } from './FormRow';
import { MoreDetails } from './MoreDetails';
import { PaymentSheet, chosenPayment } from './PaymentSheet';
import { useTransactionPhotoIds } from './queries';
import { paymentOptions } from './quick-row';
import { currencyChoosable, emptyForm, type FormDraft, type FormMode, formFromTransaction, formToMemory, formToPost, receivedField } from './tx-form';
import { ratesForSave } from './tx-save';

/**
 * The accounts a money field may name — the old form's own list, unchanged, for the rows Tasks 11 and 12 turn
 * into sheets of their own (a transfer's To, and what a purchase was paid with).
 */
function MoneyAccountOptions({ accounts, spendableOnly, keep }: { accounts: AccountRow[]; spendableOnly?: boolean; keep?: string }) {
  const money = moneyHolders(accounts).filter((a) => !spendableOnly || canPayWith(a, keep));
  return (
    <>
      <option value="">Choose…</option>
      <optgroup label="Accounts">
        {money.filter((a) => a.kind === 'asset').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
      <optgroup label="Credit cards & debts">
        {money.filter((a) => a.kind === 'liability').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
    </>
  );
}

/** A day either side of the date, as the ‹ › buttons step it. */
export function stepDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/**
 * Add Transaction, as one card.
 *
 * It replaces the old `TransactionForm` wholesale, so it has to carry everything that form carried: it is the
 * only way into a transaction, and an entry point that quietly drops a field is a field nobody can record any
 * more. §B2's rows — Workspace, Paid with, Amount, Category, Note, Date — are built from Task 8's kit; the
 * remaining fields keep the shapes they have today until Tasks 11–15 turn each into a row of its own.
 *
 * Nothing here reads a typed figure: `AmountRow` owns the amount and `formToPost` owns what is posted, so the
 * card never gets a second opinion about what a number means.
 */
export function TransactionCard(props: { initial?: TransactionView; mode?: FormMode; onDone: () => void; full?: boolean }) {
  const accounts = useAccounts();
  // The pictures this transaction already has, so reopening one that has a receipt does not say "Photos: None".
  // The very same reader the phone's edit sheet uses, and `ready` is its own answer about when it may be read.
  const photos = useTransactionPhotoIds(props.initial?.id ?? null);
  // The draft is built from the accounts once, so it must not be built before they are here: `formFromTransaction`
  // reads each account's currency, and a draft seeded from an empty list opens a foreign purchase with no currency.
  // The same holds for the photo rows: a draft seeded before they arrive opens an edit with none of them.
  if (!accounts.isSuccess || !photos.ready) return <Card>Loading…</Card>;
  return <CardBody {...props} accounts={accounts.data} photoIds={photos.ids} />;
}

function CardBody({
  initial,
  mode,
  onDone,
  full,
  accounts,
  photoIds,
}: {
  initial?: TransactionView;
  mode?: FormMode;
  onDone: () => void;
  full?: boolean;
  accounts: AccountRow[];
  photoIds: string[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const openBook = useOpenBook();
  const bookId = ws.bookId ?? '';
  const allCards = useCards().data ?? [];
  const goals = useGoals().data ?? [];
  const assetValues = useAssetValues();
  const assetProfiles = useAssetProfiles();
  const [draft, setDraft] = useState<FormDraft>(() =>
    initial ? formFromTransaction(initial, accounts, bookId, photoIds) : { ...emptyForm(bookId), mode: mode ?? 'expense' },
  );
  const [sheet, setSheet] = useState<null | 'workspace' | 'money' | 'category' | 'details'>(null);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const dateId = useId();
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPurchase = (patch: Partial<PurchaseDraft>) => setDraft((d) => ({ ...d, purchase: { ...d.purchase, ...patch } }));

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const choices = useMemo(() => buyChoices(assetValues.data ?? [], assetProfiles.data ?? []), [assetValues.data, assetProfiles.data]);
  const money = moneyHolders(accounts);
  const account = byId.get(draft.moneyId);
  const purchase = draft.purchase;
  const chosen = [...choices.buys, ...choices.sells].find((option) => option.value === `${purchase.mode}:${purchase.accountId}`);
  const purchaseMoney = byId.get(purchase.moneyId);
  const purchaseCurrency = byId.get(purchase.accountId)?.currency ?? ws.baseCurrency;
  const toAccount = byId.get(draft.toId);
  // The Received row reads the same record the save reads (`receivedField`), so the two cannot disagree on its currency.
  const received = receivedField(draft, accounts);
  const crossCurrency = received !== null;
  const canHold = useCanHold();
  // What Save would send, read by the function that builds it (a category not chosen yet does not hide the door).
  const post = useMemo(() => postForDoor(draft, accounts), [draft, accounts]);
  const door = post ? doorOfForm(draft, post, accounts, canHold) : null;
  const saved = useSetAsideChoiceOf(initial?.id ?? null);
  const setAside = useSetAside(door, { excludeTransactionId: initial?.id ?? null, initial: saved.data ?? null, toName: toAccount?.name });

  // A transfer may move money between any two money accounts; everything else has to be paid from or into one.
  const payable: PaymentOption[] = paymentOptions(
    draft.mode === 'transfer' ? money : money.filter((a) => canPayWith(a, draft.moneyId)),
    allCards as CardRow[],
  );

  /*
   * The workspace row and the open workspace are the same fact, so the row follows the app rather than keeping a
   * second answer. Changing it clears the category: two workspaces hold copies of the same category under
   * different ids, and a category chosen in one of them would file this spending in the other.
   */
  useEffect(() => {
    if (draft.bookId === bookId) return;
    setDraft((d) => ({ ...d, bookId, categoryId: '', splits: [] }));
  }, [bookId, draft.bookId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Enter submits too: the question is a condition on Save however Save is reached.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      const post = formToPost(draft, accounts);
      if (post.kind === 'trade') {
        // Units are recorded, so this saves as a purchase and never touches spending.
        await recordTrade(database, ws, { ...post.input, setAside: setAside.choice });
      } else {
        // The manual rate, the rates the posting needs and the message asking for a missing one, all in the
        // one place both ways into a save go through. The rate field lives under Add more details and only
        // there (§3.3), so that is the name this screen gives it.
        const ratesToBase = await ratesForSave({
          database, ws, draft, post, accounts, rateDate, needsRate, resolveRates, onMissing: setNeedsRate, where: 'Add more details',
        });
        // Every branch sends the answer — an edit explicitly, so a question no longer asked clears the old answer.
        if (post.kind === 'split') await splitBill(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        else if (post.kind === 'transfer-goal') await recordTaggedTransfer(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        else if (initial) await replaceTransaction(database, ws, initial.id, { ...post.input, ratesToBase, setAside: setAside.choice });
        else await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        const memory = formToMemory(draft, accounts);
        if (memory) await saveMerchantMcc(database, ws, memory);
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  // Rates are resolved no later than today, so the row asks for the rate under the date the save will store it.
  const rateDate = draft.occurredOn > isoDate() ? isoDate() : draft.occurredOn;
  const missingRate = needsRate ? { from: needsRate, to: ws.baseCurrency, onDate: rateDate } : null;

  const payLabel = draft.mode === 'income' ? 'Received into' : draft.mode === 'transfer' ? 'From' : 'Paid with';
  const categoryName = draft.categoryId ? (byId.get(draft.categoryId)?.name ?? '') : '';

  const modes = [
    ['expense', 'Expense'],
    ['income', 'Income'],
    ['transfer', 'Transfer'],
    ...(choices.buys.length > 0 ? ([['trade', 'Buy or sell']] as const) : []),
  ] as const;
  const chooseMode = (value: FormMode) => {
    if (value !== 'trade') {
      // A tab that offers no flag must not carry one. The currency and the "Charged in …" row belong
      // to the tab they were chosen on: leaving USD on the draft while moving to Transfer left the
      // save reading a figure in a currency the screen no longer showed. `currencyChoosable` is the
      // one question about that, asked here too rather than restated.
      const flag = currencyChoosable({ ...draft, mode: value }) ? {} : { currency: '', chargedAmount: '' };
      return set({ mode: value, categoryId: '', splits: [], ...flag });
    }
    const first = choices.buys[0]!;
    set({
      mode: 'trade',
      purchase: { ...emptyPurchaseDraft(first.accountId, draft.moneyId, isoDate()), lotSize: first.lotSize, useLots: (first.lotSize ?? 1) > 1 },
    });
  };

  const body = (
    <form onSubmit={submit} className="space-y-3">
      {full ? (
        /* The page's own form: the four kinds as the kit's segmented control, a radio group under the same name. */
        <SegmentedControl label="What this is" segments={modes.map(([key, label]) => ({ key, label }))} value={draft.mode} onChange={(key) => chooseMode(key as FormMode)} />
      ) : (
        <div role="radiogroup" aria-label="What this is" className="flex flex-wrap gap-2">
          {modes.map(([value, label]) => (
            <Button key={value} role="radio" aria-checked={draft.mode === value} variant={draft.mode === value ? 'primary' : 'secondary'} onClick={() => chooseMode(value)}>
              {label}
            </Button>
          ))}
        </div>
      )}

      {draft.mode === 'trade' ? (
        /*
         * §3.6, as rows: what · amount · units or lots · fee · Paid with / Proceeds into · Date, then a second
         * card for the goal and — only on a credit card — the two facts the points engine needs. There is no
         * workspace row here either: a trade posts through `recordTrade`, whose money half touches no category.
         *
         * `purchaseDraftToInput` and `recordTrade` are called exactly as before; only the layout moved. Every
         * message they throw still arrives in the `ErrorBox` above Save, which is the whole of this tab's
         * validation — nothing here reads a figure for itself.
         */
        <>
          <RowGroup>
            <SelectRow
              label="What you bought or sold"
              hint="Units are recorded, so this never counts as spending."
              value={`${purchase.mode}:${purchase.accountId}`}
              onChange={(e) => {
                const option = [...choices.buys, ...choices.sells].find((row) => row.value === e.target.value)!;
                setPurchase({ mode: option.mode, accountId: option.accountId, lotSize: option.lotSize, useLots: (option.lotSize ?? 1) > 1 });
              }}
            >
              <optgroup label="Investments">
                {choices.buys.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
              {choices.sells.length > 0 && (
                <optgroup label="Selling">
                  {choices.sells.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
            </SelectRow>
            <InputRow
              label={purchase.mode === 'buy' ? `What it cost, before fees (${purchaseCurrency})` : `Proceeds, before fees (${purchaseCurrency})`}
              value={purchase.amount}
              inputMode="decimal"
              onChange={(e) => setPurchase({ amount: e.target.value })}
              placeholder="3.980.000"
            />
            {purchase.useLots ? (
              <InputRow
                label="Lots"
                hint={`${purchase.lotSize ?? 1} shares a lot.`}
                value={purchase.lots}
                inputMode="decimal"
                onChange={(e) => setPurchase({ lots: e.target.value })}
                placeholder="1"
              />
            ) : (
              <InputRow
                label={chosen?.unitLabel ?? 'Units'}
                value={purchase.units}
                inputMode="decimal"
                onChange={(e) => setPurchase({ units: e.target.value })}
                placeholder="2"
              />
            )}
            <InputRow
              label={`Fee (${purchaseCurrency})`}
              value={purchase.fee}
              inputMode="decimal"
              onChange={(e) => setPurchase({ fee: e.target.value })}
            />
            <SelectRow
              label={purchase.mode === 'buy' ? 'Paid with' : 'Proceeds into'}
              hint={purchase.mode === 'buy' ? 'A credit card works: the card owes more, and the purchase still earns points.' : undefined}
              value={purchase.moneyId}
              onChange={(e) => setPurchase({ moneyId: e.target.value, moneyIsCard: byId.get(e.target.value)?.subtype === 'credit_card' })}
            >
              <MoneyAccountOptions accounts={accounts} spendableOnly keep={purchase.moneyId} />
            </SelectRow>
            <InputRow label="Date" type="date" value={purchase.occurredOn} max={isoDate()} onChange={(e) => setPurchase({ occurredOn: e.target.value })} />
          </RowGroup>

          {(goals.length > 0 || (purchase.mode === 'buy' && purchaseMoney?.subtype === 'credit_card')) && (
            <RowGroup>
              {goals.length > 0 && (
                <SelectRow
                  label={purchase.mode === 'buy' ? 'For goal' : 'Sell from goal'}
                  value={purchase.goalId}
                  onChange={(e) => setPurchase({ goalId: e.target.value })}
                >
                  <option value="">No goal</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>{goal.name}</option>
                  ))}
                </SelectRow>
              )}
              {purchase.mode === 'buy' && purchaseMoney?.subtype === 'credit_card' && (
                <>
                  <SelectRow
                    label="Category for points"
                    hint="Not spending: it only tells the points engine what the card bought."
                    value={purchase.spendCategoryId}
                    onChange={(e) => setPurchase({ spendCategoryId: e.target.value })}
                  >
                    <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
                  </SelectRow>
                  <InputRow
                    label="MCC"
                    hint="Gold and jewellery shops are 5944."
                    value={purchase.mcc}
                    inputMode="numeric"
                    onChange={(e) => setPurchase({ mcc: e.target.value })}
                    placeholder="5944"
                  />
                </>
              )}
            </RowGroup>
          )}
        </>
      ) : (
        <>
          <FormRows>
            {/*
              A correction stays in the workspace it was filed in. `replaceTransaction` refuses a write that
              crosses books, and a refusal met at Save is a choice that should never have been offered: the
              switch also clears the category on its way, so what it costs is the whole edit. The row stays,
              greyed, because which workspace this is in is still worth reading — it is the offer that goes.
            */}
            {/*
              §3.5: a transfer has **no workspace row**. Moving your own money belongs to no workspace — the ledger
              files by the categories a transaction touches, and a transfer touches none — so a row offering to file
              it would be offering something the save cannot honour.
            */}
            {draft.mode !== 'transfer' && (
              <FormRow
                label="Workspace"
                name="Workspace for this transaction"
                value={openBook?.name ?? ''}
                chevron={!initial}
                disabled={!!initial}
                onClick={() => setSheet('workspace')}
              />
            )}
            <FormRow label={payLabel} value={chosenPayment(payable, draft)} onClick={() => setSheet('money')} />
          </FormRows>

          <AmountRow draft={draft} accounts={accounts} set={set} />

          {draft.mode === 'transfer' ? (
            <RowGroup>
              {/*
                The hint is the To row's own second line rather than the group's: it is about where this money may
                land, and a fund bought by transfer is the one mistake this row exists to head off.
              */}
              <SelectRow
                label="To"
                hint="Buying a fund, shares or gold? Use Buy or sell, so units are counted."
                value={draft.toId}
                onChange={(e) => set({ toId: e.target.value })}
              >
                <MoneyAccountOptions accounts={transferTargets(accounts, assetValues.data ?? [])} />
              </SelectRow>
            </RowGroup>
          ) : (
            draft.splits.length === 0 && (
              <FormRows>
                <FormRow
                  label="Category"
                  icon={draft.categoryId ? <CategoryIcon categoryId={draft.categoryId} accounts={accounts} size="xs" /> : undefined}
                  value={categoryName}
                  onClick={() => setSheet('category')}
                />
              </FormRows>
            )
          )}

          <RowGroup>
            <InputRow
              id={noteId}
              label="Note"
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder={draft.mode === 'transfer' ? 'Transfer' : 'Superindo'}
            />
            {/* ‹ and › step a day, which is nearly always what a correction is; the middle is the date itself. */}
            <div className="flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 px-3">
              <label htmlFor={dateId} className="shrink-0 text-sm text-slate-900">
                Date
              </label>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="A day earlier"
                  onClick={() => set({ occurredOn: stepDay(draft.occurredOn, -1) })}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <input
                  id={dateId}
                  type="date"
                  required
                  value={draft.occurredOn}
                  onChange={(e) => set({ occurredOn: e.target.value })}
                  className="min-w-0 rounded-lg bg-transparent py-2 text-right text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900 md:text-sm"
                />
                <button
                  type="button"
                  aria-label="A day later"
                  onClick={() => set({ occurredOn: stepDay(draft.occurredOn, 1) })}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              </span>
            </div>
          </RowGroup>

          {/*
            §3.5's second card. For goal is offered only while adding — `formToPost` refuses to tag an edit, and a
            row that cannot be honoured is worse than no row. Received amount appears only when the two accounts
            settle in different currencies, because that is the only time the figure that lands is not the figure
            that left; `exchangeLines` reads it in the To account's own currency, which is what the label names.
          */}
          {draft.mode === 'transfer' && (crossCurrency || (!initial && goals.length > 0)) && (
            <RowGroup>
              {!initial && goals.length > 0 && (
                <SelectRow
                  label="For goal"
                  hint="Money parked for a goal counts towards it while it waits."
                  value={draft.goalId}
                  onChange={(e) => set({ goalId: e.target.value })}
                >
                  <option value="">No goal</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>{goal.name}</option>
                  ))}
                </SelectRow>
              )}
              {received && (
                <InputRow label={received.label} value={received.value} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
              )}
            </RowGroup>
          )}

        </>
      )}

      {/*
        §4's rows, every one of them, behind one way in. The card used to carry "Someone owes part of this"
        here as well — one name, one figure, the shape the form had before `splitBill` learned to take
        several people. It is now the With row inside this sheet, where a dinner for four can be recorded.

        Outside the tab branch, because Buy or sell has extras too: `extraRows` answers Photos and Exclude for
        every mode, and this row used to be drawn in the expense branch alone — so a trade computed two rows
        that nothing drew, and a contract note could not be kept with the purchase it belongs to.
      */}
      <FormRows>
        <FormRow label="Add more details" tone="muted" onClick={() => setSheet('details')} />
      </FormRows>

      {setAside.node}
      <ErrorBox error={error} />
      {full ? (
        /* The page's primary action is a row of its own, and still a real submit: Enter and `required` hold. */
        <InsetGroup wide>
          <SubmitRow label="Save" disabled={busy || !setAside.ready} />
          <InsetRow title={<span className="font-normal text-[var(--ph-ink-2)]">Cancel</span>} label="Cancel" onClick={onDone} chevron={false} />
        </InsetGroup>
      ) : (
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !setAside.ready}>
            Save
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );

  return (
    <>
      {/* On its own page the card's groups lie flat on the kit's ground, as a group does: the ring is a sheet's
          edge, drawn so the rows read against the card they float on, and a page has no card under them. */}
      {full ? <div className="space-y-3 [&_.ring-1]:ring-0">{body}</div> : <Card>{body}</Card>}

      {sheet === 'workspace' && <WorkspaceSheet onClose={() => setSheet(null)} />}
      {sheet === 'money' && (
        <PaymentSheet
          title={payLabel}
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
          {/* The same component, with the same props, that Task 14's edit sheet opens: one implementation of
              §4's rows, so a field cannot be present on one way in and missing from the other. */}
          <MoreDetails draft={draft} onChange={setDraft} accounts={accounts} missingRate={missingRate} />
        </Sheet>
      )}
    </>
  );
}
