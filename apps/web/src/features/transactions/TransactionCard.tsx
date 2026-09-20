import { isoDate, mccName, minorToMajorString, parseMajor, parseRate, type PaymentOption, resolveMcc } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  mccSourcesFor,
  postTransaction,
  recordTaggedTransfer,
  recordTrade,
  replaceTransaction,
  saveMerchantMcc,
  splitBill,
  type TransactionView,
  upsertRate,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { Button, Card, ErrorBox, Field, Input, InputRow, RowGroup, Select } from '../../ui';
import { useCards } from '../cards/card-queries';
import { CategoryOptions } from '../cards/options';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useGoals } from '../goals/queries';
import { MccPicker } from '../merchants/MccPicker';
import { suggestPattern } from '../merchants/mcc-search';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { useOpenBook } from '../workspaces/queries';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { AmountRow } from './AmountRow';
import { buyChoices, emptyPurchaseDraft, type PurchaseDraft, transferTargets } from './buy-in-form';
import { CategoryPicker } from './CategoryPicker';
import { FormRow, FormRows } from './FormRow';
import { paymentKey, paymentOptions } from './quick-row';
import { emptyForm, type FormDraft, type FormMode, formFromTransaction, formToMemory, type FormPost, formToPost } from './tx-form';

/**
 * The accounts a money field may name — the old form's own list, unchanged, for the rows Tasks 11 and 12 turn
 * into sheets of their own (a transfer's To, and what a purchase was paid with).
 */
function MoneyAccountOptions({ accounts, spendableOnly, keep }: { accounts: AccountRow[]; spendableOnly?: boolean; keep?: string }) {
  const money = accounts.filter((a) => isMoneyAccount(a) && (!spendableOnly || canPayWith(a, keep)));
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

/**
 * What one Paid with row is called.
 *
 * The digits are part of the name only when they are what tells two rows apart — an account carrying a
 * supplementary card offers one row per card, and "Mandiri Bonvoy" alone would name both. An account with a
 * single card is one choice, so its name is the account's: a name nobody has to read digits out of.
 */
export function paymentLabel(option: PaymentOption): string {
  return option.cardId ? `${option.accountName} ···· ${option.last4 ?? '????'}` : option.accountName;
}

/** What the Paid with row shows once something is chosen, or nothing when it is still empty. */
function chosenPayment(options: readonly PaymentOption[], draft: FormDraft): string {
  const found = options.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  return found ? paymentLabel(found) : (options.find((option) => option.accountId === draft.moneyId)?.accountName ?? '');
}

/** A day either side of the date, as the ‹ › buttons step it. */
export function stepDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/** Which currencies a save has to be able to convert before it can be posted. */
function currenciesOf(post: FormPost, accounts: readonly AccountRow[]): string[] {
  const currencyOf = (id: string) => accounts.find((a) => a.id === id)?.currency ?? '';
  if (post.kind === 'post') return [...new Set(post.input.lines.map((line) => line.currency))];
  if (post.kind === 'split') return [currencyOf(post.input.moneyAccountId)];
  if (post.kind === 'transfer-goal') return [currencyOf(post.input.fromAccountId), currencyOf(post.input.toAccountId)];
  return [];
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
  // The draft is built from the accounts once, so it must not be built before they are here: `formFromTransaction`
  // reads each account's currency, and a draft seeded from an empty list opens a foreign purchase with no currency.
  if (!accounts.isSuccess) return <Card>Loading…</Card>;
  return <CardBody {...props} accounts={accounts.data} />;
}

function CardBody({
  initial,
  mode,
  onDone,
  full,
  accounts,
}: {
  initial?: TransactionView;
  mode?: FormMode;
  onDone: () => void;
  full?: boolean;
  accounts: AccountRow[];
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
    initial ? formFromTransaction(initial, accounts, bookId) : { ...emptyForm(bookId), mode: mode ?? 'expense' },
  );
  const [sheet, setSheet] = useState<null | 'workspace' | 'money' | 'category' | 'details'>(null);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showCardDetails, setShowCardDetails] = useState(() => !!initial?.mcc);
  const noteId = useId();
  const dateId = useId();
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPurchase = (patch: Partial<PurchaseDraft>) => setDraft((d) => ({ ...d, purchase: { ...d.purchase, ...patch } }));

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const choices = useMemo(() => buyChoices(assetValues.data ?? [], assetProfiles.data ?? []), [assetValues.data, assetProfiles.data]);
  const money = accounts.filter(isMoneyAccount);
  const account = byId.get(draft.moneyId);
  const currency = account?.currency ?? ws.baseCurrency;
  const onCard = draft.mode === 'expense' && account?.subtype === 'credit_card';
  const purchase = draft.purchase;
  const chosen = [...choices.buys, ...choices.sells].find((option) => option.value === `${purchase.mode}:${purchase.accountId}`);
  const purchaseMoney = byId.get(purchase.moneyId);
  const purchaseCurrency = byId.get(purchase.accountId)?.currency ?? ws.baseCurrency;
  const toAccount = byId.get(draft.toId);
  const crossCurrency = draft.mode === 'transfer' && !!account && !!toAccount && account.currency !== toAccount.currency;

  // A transfer may move money between any two money accounts; everything else has to be paid from or into one.
  const payable: PaymentOption[] = paymentOptions(
    draft.mode === 'transfer' ? money : money.filter((a) => canPayWith(a, draft.moneyId)),
    allCards as CardRow[],
  );

  const mccSources = useQuery({ queryKey: ['mcc-sources', ws.workspaceId], queryFn: () => mccSourcesFor(database.db, ws), enabled: onCard });
  const guessCategory = draft.splits[0]?.categoryId || draft.categoryId;
  const guess = mccSources.data && guessCategory ? resolveMcc(draft.description, guessCategory, { typed: null, ...mccSources.data }) : null;
  const guessName = guess?.mcc ? mccName(guess.mcc) : null;
  const guessFrom =
    guess?.source === 'memory' ? 'you taught this merchant' : guess?.source === 'bundled' ? 'typical for this merchant' : `from ${byId.get(guessCategory)?.name ?? 'the category'}`;
  const guessHint = guess?.mcc ? `Empty uses ${guess.mcc}${guessName ? ` ${guessName}` : ''} (${guessFrom}).` : 'Empty: no MCC is known for this merchant or category yet.';
  const splitTotal = draft.splits.reduce((sum, row) => {
    try {
      return sum + (row.amount.trim() ? parseMajor(row.amount, currency) : 0);
    } catch {
      return sum;
    }
  }, 0);

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
    setError(null);
    setBusy(true);
    try {
      const post = formToPost(draft, accounts);
      const today = isoDate();
      // Rates are resolved no later than today, so a manual rate must be stored under the same date.
      const rateDate = draft.occurredOn > today ? today : draft.occurredOn;
      if (needsRate && draft.manualRate.trim()) {
        const rate = parseRate(draft.manualRate);
        await checkManualRate(database, needsRate, ws.baseCurrency, rateDate, rate);
        await upsertRate(database, { fromCurrency: needsRate, toCurrency: ws.baseCurrency, onDate: rateDate, rate, source: 'manual', sourceDate: rateDate });
      }
      if (post.kind === 'trade') {
        // Units are recorded, so this saves as a purchase and never touches spending.
        await recordTrade(database, ws, post.input);
      } else {
        const foreign = currenciesOf(post, accounts).filter((code) => code && code !== ws.baseCurrency);
        const resolved = await resolveRates([...new Set(foreign)], draft.occurredOn);
        if (resolved.missing.length > 0) {
          setNeedsRate(resolved.missing[0]!);
          throw new Error(`No ${resolved.missing[0]}→${ws.baseCurrency} rate for ${rateDate}. Enter it below.`);
        }
        if (post.kind === 'split') await splitBill(database, ws, { ...post.input, ratesToBase: resolved.rates });
        else if (post.kind === 'transfer-goal') await recordTaggedTransfer(database, ws, { ...post.input, ratesToBase: resolved.rates });
        else if (initial) await replaceTransaction(database, ws, initial.id, { ...post.input, ratesToBase: resolved.rates });
        else await postTransaction(database, ws, { ...post.input, ratesToBase: resolved.rates });
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

  const payLabel = draft.mode === 'income' ? 'Received into' : draft.mode === 'transfer' ? 'From' : 'Paid with';
  const categoryName = draft.categoryId ? (byId.get(draft.categoryId)?.name ?? '') : '';
  const shares = draft.with;

  const body = (
    <form onSubmit={submit} className="space-y-3">
      <div role="radiogroup" aria-label="What this is" className="flex flex-wrap gap-2">
        {([
          ['expense', 'Expense'],
          ['income', 'Income'],
          ['transfer', 'Transfer'],
          ...(choices.buys.length > 0 ? ([['trade', 'Buy or sell']] as const) : []),
        ] as const).map(([value, label]) => (
          <Button
            key={value}
            role="radio"
            aria-checked={draft.mode === value}
            variant={draft.mode === value ? 'primary' : 'secondary'}
            onClick={() => {
              if (value !== 'trade') return set({ mode: value, categoryId: '', splits: [] });
              const first = choices.buys[0]!;
              set({
                mode: 'trade',
                purchase: { ...emptyPurchaseDraft(first.accountId, draft.moneyId, isoDate()), lotSize: first.lotSize, useLots: (first.lotSize ?? 1) > 1 },
              });
            }}
          >
            {label}
          </Button>
        ))}
      </div>

      {draft.mode === 'trade' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="What you bought or sold" hint="Units are recorded, so this never counts as spending.">
            <Select
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
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={purchase.occurredOn} max={isoDate()} onChange={(e) => setPurchase({ occurredOn: e.target.value })} />
          </Field>
          {purchase.useLots ? (
            <Field label="Lots" hint={`${purchase.lotSize ?? 1} shares a lot.`}>
              <Input value={purchase.lots} inputMode="decimal" onChange={(e) => setPurchase({ lots: e.target.value })} placeholder="1" />
            </Field>
          ) : (
            <Field label={chosen?.unitLabel ?? 'Units'}>
              <Input value={purchase.units} inputMode="decimal" onChange={(e) => setPurchase({ units: e.target.value })} placeholder="2" />
            </Field>
          )}
          <Field label={purchase.mode === 'buy' ? `What it cost, before fees (${purchaseCurrency})` : `Proceeds, before fees (${purchaseCurrency})`}>
            <Input value={purchase.amount} inputMode="decimal" onChange={(e) => setPurchase({ amount: e.target.value })} placeholder="3.980.000" />
          </Field>
          <Field label={`Fee (${purchaseCurrency})`}>
            <Input value={purchase.fee} inputMode="decimal" onChange={(e) => setPurchase({ fee: e.target.value })} />
          </Field>
          <Field
            label={purchase.mode === 'buy' ? 'Paid with' : 'Proceeds into'}
            hint={purchase.mode === 'buy' ? 'A credit card works: the card owes more, and the purchase still earns points.' : undefined}
          >
            <Select value={purchase.moneyId} onChange={(e) => setPurchase({ moneyId: e.target.value, moneyIsCard: byId.get(e.target.value)?.subtype === 'credit_card' })}>
              <MoneyAccountOptions accounts={accounts} spendableOnly keep={purchase.moneyId} />
            </Select>
          </Field>
          {purchase.mode === 'buy' && purchaseMoney?.subtype === 'credit_card' && (
            <>
              <Field label="Category for points" hint="Not spending: it only tells the points engine what the card bought.">
                <Select value={purchase.spendCategoryId} onChange={(e) => setPurchase({ spendCategoryId: e.target.value })}>
                  <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
                </Select>
              </Field>
              <Field label="MCC" hint="Gold and jewellery shops are 5944.">
                <Input value={purchase.mcc} inputMode="numeric" onChange={(e) => setPurchase({ mcc: e.target.value })} placeholder="5944" />
              </Field>
            </>
          )}
          {goals.length > 0 && (
            <Field label={purchase.mode === 'buy' ? 'For goal' : 'Sell from goal'}>
              <Select value={purchase.goalId} onChange={(e) => setPurchase({ goalId: e.target.value })}>
                <option value="">No goal</option>
                {goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>{goal.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      ) : (
        <>
          <FormRows>
            {/*
              A correction stays in the workspace it was filed in. `replaceTransaction` refuses a write that
              crosses books, and a refusal met at Save is a choice that should never have been offered: the
              switch also clears the category on its way, so what it costs is the whole edit. The row stays,
              greyed, because which workspace this is in is still worth reading — it is the offer that goes.
            */}
            <FormRow
              label="Workspace"
              name="Workspace for this transaction"
              value={openBook?.name ?? ''}
              chevron={!initial}
              disabled={!!initial}
              onClick={() => setSheet('workspace')}
            />
            <FormRow label={payLabel} value={chosenPayment(payable, draft)} onClick={() => setSheet('money')} />
          </FormRows>

          <AmountRow draft={draft} accounts={accounts} set={set} />

          {draft.mode === 'transfer' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="To" hint="Buying a fund, shares or gold? Use Buy or sell, so units are counted.">
                <Select value={draft.toId} onChange={(e) => set({ toId: e.target.value })}>
                  <MoneyAccountOptions accounts={transferTargets(accounts, assetValues.data ?? [])} />
                </Select>
              </Field>
              {crossCurrency && (
                <Field label={`Received amount (${toAccount!.currency})`}>
                  <Input value={draft.toAmount} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
                </Field>
              )}
              {!initial && goals.length > 0 && (
                <Field label="For goal" hint="Money parked for a goal counts towards it while it waits.">
                  <Select value={draft.goalId} onChange={(e) => set({ goalId: e.target.value })}>
                    <option value="">No goal</option>
                    {goals.map((goal) => (
                      <option key={goal.id} value={goal.id}>{goal.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
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

          {/* Task 13 fills this with §4's rows. It is here already so the card is laid out as it will stand. */}
          <FormRows>
            <FormRow label="Add more details" tone="muted" onClick={() => setSheet('details')} />
          </FormRows>

          {draft.mode === 'expense' && !initial && (
            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={shares.length > 0}
                  onChange={(e) => set({ with: e.target.checked ? [{ debtAccountId: '', name: '', amount: '' }] : [] })}
                />
                Someone owes part of this
              </label>
              {shares.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Who owes you" hint="They get their own account under Lend & borrow.">
                    <Input value={shares[0]!.name} onChange={(e) => set({ with: [{ ...shares[0]!, name: e.target.value }] })} placeholder="Andi" />
                  </Field>
                  <Field label={`Their share (${currency})`} hint="The rest stays as your own spending.">
                    <Input
                      value={shares[0]!.amount}
                      inputMode="decimal"
                      onChange={(e) => set({ with: [{ ...shares[0]!, amount: e.target.value }] })}
                      placeholder="600.000"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {onCard && (
            <details open={showCardDetails} onToggle={(e) => setShowCardDetails(e.currentTarget.open)} className="rounded-lg border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-sm text-slate-600">Card purchase details</summary>
              {showCardDetails && (
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <MccPicker label="MCC" value={draft.mcc} onChange={(mcc) => set({ mcc })} hint={guessHint} />
                  <div className="space-y-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!draft.rememberPattern}
                        onChange={(e) => set({ rememberPattern: e.target.checked ? suggestPattern(draft.description) || draft.description.trim().toLowerCase() : '' })}
                      />
                      Remember this MCC for every purchase containing the merchant text
                    </label>
                    {draft.rememberPattern && (
                      <Field label="Merchant text" hint="Matched as whole words in descriptions, on every card, including past purchases.">
                        <Input value={draft.rememberPattern} onChange={(e) => set({ rememberPattern: e.target.value })} />
                      </Field>
                    )}
                  </div>
                </div>
              )}
            </details>
          )}

          {draft.mode === 'expense' && (
            <div className="space-y-2">
              {draft.splits.map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                  <Select
                    aria-label={`Split ${i + 1} category`}
                    value={row.categoryId}
                    onChange={(e) => set({ splits: draft.splits.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)) })}
                  >
                    <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
                  </Select>
                  <Input
                    aria-label={`Split ${i + 1} amount`}
                    value={row.amount}
                    inputMode="decimal"
                    onChange={(e) => set({ splits: draft.splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })}
                  />
                  <Button variant="ghost" onClick={() => set({ splits: draft.splits.filter((_, j) => j !== i) })} aria-label={`Remove split ${i + 1}`}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() =>
                    set({
                      splits: draft.splits.length
                        ? [...draft.splits, { categoryId: '', amount: '' }]
                        : [{ categoryId: draft.categoryId, amount: draft.amount }, { categoryId: '', amount: '' }],
                    })
                  }
                >
                  Split
                </Button>
                {draft.splits.length > 0 && (
                  <span className="tabular text-sm text-slate-600">
                    Total {minorToMajorString(splitTotal, currency)} {currency}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {needsRate && (
        <Field label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`} hint={ratePreview(draft.manualRate, needsRate, ws.baseCurrency) ?? 'Type the rate your bank used.'}>
          <Input value={draft.manualRate} onChange={(e) => set({ manualRate: e.target.value })} inputMode="decimal" />
        </Field>
      )}
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <>
      {full ? <div className="space-y-3">{body}</div> : <Card>{body}</Card>}

      {sheet === 'workspace' && <WorkspaceSheet onClose={() => setSheet(null)} />}
      {sheet === 'money' && (
        <Sheet title={payLabel} onClose={() => setSheet(null)}>
          <ul className="-mx-1 divide-y divide-slate-100">
            {payable.map((option) => (
              <li key={paymentKey(option.accountId, option.cardId)}>
                <button
                  type="button"
                  aria-label={paymentLabel(option)}
                  onClick={() => {
                    set({ moneyId: option.accountId, cardId: option.cardId ?? '' });
                    setSheet(null);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 px-1 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900"
                >
                  <span className="min-w-0 flex-1 truncate">{paymentLabel(option)}</span>
                  <span aria-hidden className="shrink-0 text-xs text-slate-400">
                    {[option.holderName, byId.get(option.accountId)?.currency].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
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
          {/* The empty card, so the row and the way in are already where they will stand. §4's rows —
              Event, Split, With, MCC, Channel, Photos, Exclude and the rate — arrive in Task 13. */}
          <p className="text-sm text-slate-500">Nothing here yet.</p>
        </Sheet>
      )}
    </>
  );
}
