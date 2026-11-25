import { ASSET_FAMILIES, ASSET_ITEMS, goldBrandMatches, isoDate, tradeRateNeeds } from '@expanses/core';
import { type OpenAssetInput, openAsset, openDebtBalance, type RecordTradeInput } from '@expanses/db';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, SegmentedControl, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { tradeMoneyChoices } from '../transactions/buy-in-form';
import { PaymentSheet } from '../transactions/PaymentSheet';
import {
  byMoneyItem, type BuyPayment, chosenItem, emptyDraft, emptyPurchase, type NewAssetDraft, type NewAssetPlan, type NewBuyDraft, needsEstimate, needsPurchases, planNewAsset,
  type PurchaseDraft, type PurchaseWhen,
} from './add-asset';
import { AcquiredRow, MoneyRow } from './AssetRows';
import { CardPointsBox } from './trade-sheet-parts';
import { tradeRatesForSave } from './trade-money';
import { useShareOnAdd } from '../sharing/ShareWithHousehold';
import { SuggestRow } from '../ownables/CashAccountForm';
import { brokerChoices } from '../investments/add-holding';
import { type InstitutionChoice, InstitutionSheet } from './InstitutionSheet';
import { institutionChoices } from './institutions';
import { useAssetProfiles } from './queries';

/** Everything the five families name, so what is left over in `ASSET_ITEMS` is the legacy entry alone. */
const IN_A_FAMILY = new Set(ASSET_FAMILIES.flatMap((family) => family.items.map((item) => item.id)));
const LEGACY_ITEMS = ASSET_ITEMS.filter((item) => !IN_A_FAMILY.has(item.id));

/**
 * The form behind both ways of adding an asset: the inline one on the Assets page, which still asks "What is it?"
 * itself, and the picker at /net-worth/assets/new, which has already chosen and passes the item in.
 *
 * The catalogue decides everything that follows the choice — how it is valued, which fields appear, which tax
 * table it files under — so this form only draws what the chosen item asks for. What the tax report's table asks of
 * it (make, plate, ownership…) waits for the asset's Edit screen: adding something only asks what it is worth.
 */
/** What the screen's ✓ needs from the form: whether it can save yet, and how to. */
export interface FormConfirm {
  disabled: boolean;
  run: () => void;
}

/** New purchase or Past purchase, at the top of a holding's purchase part. */
const WHEN_SEGMENTS: readonly { key: PurchaseWhen; label: string }[] = [
  { key: 'new', label: 'New purchase' },
  { key: 'past', label: 'Past purchase' },
];

export function AddAssetForm({ onDone, itemId, onConfirm }: {
  /** Saved: handed the new asset's account, so a screen may open it. */
  onDone: (accountId: string | null) => void;
  itemId?: string;
  onConfirm?: (confirm: FormConfirm | null) => void;
}) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const household = useShareOnAdd();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const [draft, setDraft] = useState<NewAssetDraft>(() => emptyDraft(itemId ?? 'fund', ws.baseCurrency, today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // New purchase's Paid with sheet, and the day rates typed for its buy — each kept under its own currency.
  const [paying, setPaying] = useState(false);
  const [dayRates, setDayRates] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  // A fund's or bond's Institution, picked as on its page (owner, 25 Nov 2026): a broker's cash it links to, a place
  // typed by name, or none — and the sheet it is picked in.
  const [held, setHeld] = useState<InstitutionChoice>(null);
  const [pickingPlace, setPickingPlace] = useState(false);
  const profiles = useAssetProfiles();
  const brokers = brokerChoices(accounts);
  const heldAccount = held && 'accountId' in held ? accounts.find((account) => account.id === held.accountId) : undefined;
  const heldName = held === null ? '' : 'accountId' in held ? (heldAccount?.name ?? '') : held.name;

  const change = (patch: Partial<NewAssetDraft>) => setDraft((current) => ({ ...current, ...patch }));
  /** A different thing, or the same thing valued the other way: either one starts its own fields over. */
  const retarget = (id: string, typedInstead: boolean) =>
    setDraft((current) => ({ ...emptyDraft(id, current.currency, today, typedInstead), name: current.name }));

  const item = chosenItem(draft.itemId, draft.typedInstead);
  const owed = item.behaviour.opens === 'person';
  // Read off the catalogue, not the swapped item: the offer to type a value stands whichever way it is valued.
  const rawBehaviour = chosenItem(draft.itemId).behaviour;
  const canType = rawBehaviour.opens === 'holding' && rawBehaviour.orTyped === true;
  const buying = needsPurchases(draft.itemId, draft.typedInstead);
  const legacyCash = draft.itemId === 'cash';
  const buyingNow = buying && draft.when === 'new';
  const heldItem = item.behaviour.opens === 'holding' && (item.behaviour.assetKind === 'fund' || item.behaviour.assetKind === 'bond');

  // New purchase: what paid, as Trade's Buy offers it — the same list, cards included — and what that asks of the buy.
  const moneyOptions = tradeMoneyChoices(accounts, 'buy', draft.buy.moneyId);
  const paidWith = accounts.find((account) => account.id === draft.buy.moneyId);
  const pay: BuyPayment = { cashCurrency: paidWith?.currency ?? draft.currency, isCard: paidWith?.subtype === 'credit_card' };
  const needs = tradeRateNeeds(draft.currency, pay.cashCurrency, ws.baseCurrency);
  /*
   * A new purchase asks one row per day rate its buy needs — two when neither the holding nor what paid is in the base
   * — each typed under its own currency, so a rate typed for one is never filed as another's (fix round 1). Left
   * empty, a row's rate is looked up for the day.
   */
  const rateLabel = (currency: string) => (needs.dayRates.length > 1 ? `${currency} rate to ${ws.baseCurrency}` : `Rate to ${ws.baseCurrency}`);
  /** The plan Save would send, or null while it cannot be read yet: the buy's set-aside door reads it. */
  const planned = ((): NewAssetPlan | null => {
    try {
      return planNewAsset(draft, today, pay);
    } catch {
      return null;
    }
  })();
  const buyInput: RecordTradeInput | null = planned?.buy ? { ...planned.buy, accountId: '' } : null;
  // A buy is a set-aside door, as on Trade: one taking more than is free asks which goal paid.
  const setAside = useSetAside(buyInput ? tradeDoor(buyInput) : null);
  const setBuy = (patch: Partial<NewBuyDraft>) => setDraft((current) => ({ ...current, buy: { ...current.buy, ...patch } }));

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (!setAside.ready) return;
      const plan = planNewAsset(draft, today, pay);
      // One rate for the whole opening, as before: typed (parseRate, checked, stored for that day) or resolved for the day.
      // A new purchase opens nothing against Opening Balances, so it asks none here: its buy's rates come below.
      const openingRateToBase = await openingRateFor({ database, ws, currency: plan.account.currency, openedOn: plan.rateDate, openingBalanceMinor: plan.rateNeededMinor, typed: draft.openingRate, resolveRates });
      let opened: string | null = null;
      if (plan.person) {
        // Money owed is kept by the Lend & borrow ledger, which opens the account and its profile itself.
        const owed = await openDebtBalance(database, ws, {
          direction: plan.person.direction,
          personName: plan.person.personName,
          currency: plan.account.currency,
          balanceMinor: plan.person.balanceMinor,
          openedOn: plan.account.openedOn,
          coretaxCode: plan.person.coretaxCode,
          openingRateToBase,
        });
        await household.save([owed.id]);
        opened = owed.id;
      } else if (plan.profile) {
        // The buy made now, with the rates Trade works out for it (spec §5.2) and the set-aside answer; else the past ones.
        const trades: OpenAssetInput['trades'] = plan.buy
          ? [
              {
                ...plan.buy,
                ratesToBase: await tradeRatesForSave({
                  database, ws, input: { ...plan.buy, accountId: '' }, holdingCurrency: plan.account.currency, cashCurrency: pay.cashCurrency,
                  needsRate: null, manualRate: '', typedRates: dayRates, resolveRates, onMissing: () => undefined, where: rateLabel,
                }),
                setAside: setAside.choice,
              },
            ]
          : plan.trades.map((trade) => ({
              kind: 'buy' as const,
              occurredOn: trade.occurredOn,
              unitsMicro: trade.unitsMicro,
              grossMinor: trade.grossMinor,
              feeMinor: 0,
              taxMinor: 0,
              cashAccountId: null,
              ratesToBase: openingRateToBase === undefined ? undefined : { [plan.account.currency]: openingRateToBase },
            }));
        // All or nothing: a buy that cannot be recorded leaves no half-made holding behind.
        const asset = await openAsset(database, ws, {
          account: {
            name: plan.account.name,
            kind: 'asset',
            subtype: plan.account.subtype as 'investment' | 'property' | 'vehicle' | 'bank',
            currency: plan.account.currency,
            openingBalanceMinor: plan.account.openingBalanceMinor,
            openedOn: plan.account.openedOn,
            openingRateToBase,
          },
          // The Institution's name is the tax report's Nama institusi; a broker's cash picked is linked too.
          profile: heldItem && heldName ? { ...plan.profile, coretaxFields: { inst: heldName } } : plan.profile,
          heldAtAccountId: heldItem ? (heldAccount?.id ?? null) : null,
          acquired: plan.acquired,
          trades,
          valuation: plan.valuation,
        });
        await household.save([asset.accountId]);
        opened = asset.accountId;
      }
      await invalidate();
      onDone(opened);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const estimated = needsEstimate(draft.itemId, draft.typedInstead);
  const byMoney = byMoneyItem(draft.itemId, draft.typedInstead);
  // A bond is bought by its par value, at a price that is a share of it: its rows say so.
  const chosenBehaviour = chosenItem(draft.itemId, draft.typedInstead).behaviour;
  const byPar = chosenBehaviour.opens === 'holding' && chosenBehaviour.valuedBy === 'face';
  // Ready once it has a name and, where a year is asked, a year: the rest is optional or checked on save.
  // A new purchase also waits on the set-aside question, when its buy asks one.
  const ready = draft.name.trim() !== '' && (!(estimated || legacyCash) || draft.acquired.year.trim() !== '') && setAside.ready;
  useEffect(() => {
    // `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first.
    onConfirm?.({ disabled: busy || !ready, run: () => form.current?.requestSubmit() });
  }, [busy, ready, onConfirm]);
  useEffect(() => () => onConfirm?.(null), [onConfirm]);
  const setPurchase = (index: number, patch: Partial<PurchaseDraft>) =>
    change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const setCurrency = (currency: string) => change({ currency });

  // A currency other than the workspace's asks what it was worth when this was got, under the row that set it.
  const rateRow =
    draft.currency !== ws.baseCurrency ? (
      <TextRow
        label={`Rate to ${ws.baseCurrency}`}
        aria-label="Opening rate"
        hint={
          ratePreview(draft.openingRate, draft.currency, ws.baseCurrency) ??
          `What one ${draft.currency} was worth when this was acquired. The ledger needs it to hold one running total; the tax report uses the KMK rate instead.`
        }
        value={draft.openingRate}
        onChange={(e) => change({ openingRate: e.target.value })}
        inputMode="decimal"
        placeholder="Rate"
      />
    ) : null;

  const newRateRows = buyingNow
    ? needs.dayRates.map((currency) => (
        <TextRow
          key={currency}
          label={rateLabel(currency)}
          hint={ratePreview(dayRates[currency] ?? '', currency, ws.baseCurrency) ?? `What one ${currency} was worth that day. Left empty, it is looked up.`}
          value={dayRates[currency] ?? ''}
          onChange={(e) => setDayRates((typed) => ({ ...typed, [currency]: e.target.value }))}
          inputMode="decimal"
          placeholder="Rate"
        />
      ))
    : null;

  /* No note under a chosen kind: how it is valued showed in the form as words like "par value × price" that only
     got in the way. Only the open picker, before a kind is chosen, says what choosing one does. */
  const footer = estimated || itemId !== undefined ? undefined : 'This sets how the value is worked out and which tax-report table it belongs to.';

  return (
    /* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */
    <form ref={form} onSubmit={submit}>
      <InsetGroup header={itemId === undefined ? 'What is being added' : item.label} footer={footer}>
        {/* The picker route has already chosen; the Assets page asks here, as it always has. */}
        {itemId === undefined ? (
          <SelectRow label="What is it?" value={draft.itemId} onChange={(e) => retarget(e.target.value, false)}>
            {ASSET_FAMILIES.map((family) => (
              <optgroup key={family.id} label={family.label}>
                {family.items.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Money — better added as an account">
              {LEGACY_ITEMS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          </SelectRow>
        ) : null}
        {/* "Required" beside Current value's "Optional", as iOS's own label-left rows say it; the header names the kind. */}
        {/* Gold bullion offers its makers over the keyboard as the name is typed, as a bank account offers banks. */}
        {draft.itemId === 'gold' ? (
          <SuggestRow
            label="Name"
            stripLabel="Gold makers"
            value={draft.name}
            onChange={(name) => change({ name })}
            placeholder="Required"
            offers={(typed) => goldBrandMatches(typed, ws.baseCurrency === 'IDR')}
          />
        ) : (
          <TextRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Required" required />
        )}
        {heldItem ? (
          <PickerRow label="Institution" value={heldName || null} placeholder="Not set" onOpen={() => setPickingPlace(true)} testId="institution-row" />
        ) : null}
        {canType ? (
          <SwitchRow label="I'd rather type what it is worth" checked={draft.typedInstead} onChange={(checked) => retarget(draft.itemId, checked)} />
        ) : null}
        {/* Something valued by what its owner says: when, what it cost, and what it is worth now, all here. */}
        {estimated ? <AcquiredRow value={draft.acquired} onChange={(acquired) => change({ acquired })} /> : null}
        {estimated ? (
          <MoneyRow label="Original cost" value={draft.cost} onChange={(cost) => change({ cost })} currency={draft.currency} base={ws.baseCurrency} onCurrency={setCurrency} placeholder="Amount" />
        ) : null}
        {estimated ? rateRow : null}
        {estimated || byMoney ? (
          <MoneyRow label="Current value" value={draft.estimate} onChange={(estimate) => change({ estimate })} currency={draft.currency} placeholder="Optional" />
        ) : null}
        {household.row}
      </InsetGroup>
      {draft.itemId === 'stock' && itemId === undefined && (
        <InsetGroup footer="Or type it in below, as before.">
          <InsetRow title="Find it by ticker" to="/net-worth/investments/new" />
        </InsetGroup>
      )}

      {buying && (
        /* New purchase records the buy made now, paid from an account, as Trade's Buy would; Past purchase is what was
           owned before, which moves no account (owner, 13 Nov 2026). */
        <div className="px-[4px] pb-[12px]">
          <SegmentedControl
            label="New or past purchase"
            segments={WHEN_SEGMENTS}
            value={draft.when}
            onChange={(key) => change({ when: key as PurchaseWhen })}
            className="w-full"
          />
        </div>
      )}

      {buyingNow && (
        <>
          <InsetGroup header="Purchase" footer={pay.isCard ? 'Paid with a card: the card owes it now; paying the card later is a transfer.' : undefined}>
            <TextRow label="Date" type="date" value={draft.buy.on} max={today} onChange={(e) => setBuy({ on: e.target.value })} />
            <TextRow
              label={byMoney ? 'Units' : byPar ? 'Par value' : 'How much'}
              value={draft.buy.units}
              inputMode="decimal"
              placeholder={byMoney ? 'Optional' : byPar ? 'Amount' : 'Quantity'}
              suffix={item.behaviour.opens === 'holding' && item.behaviour.unitKind === 'grams' ? 'g' : undefined}
              info={byPar ? 'Usually the same as the purchase value; it differs when bought on the secondary market.' : undefined}
              onChange={(e) => setBuy({ units: e.target.value })}
            />
            {/* Before fees, as Trade asks it: the fee has a row of its own. */}
            <MoneyRow
              label={byMoney ? 'Amount' : byPar ? 'Purchase value' : 'Cost'}
              value={draft.buy.cost}
              onChange={(cost) => setBuy({ cost })}
              currency={draft.currency}
              base={ws.baseCurrency}
              onCurrency={(currency) => {
                setBuy({ charged: '' });
                setCurrency(currency);
              }}
            />
            <MoneyRow label="Fee" value={draft.buy.fee} onChange={(fee) => setBuy({ fee })} currency={draft.currency} placeholder="None" />
            <PickerRow label="Payment method" value={paidWith?.name ?? null} placeholder="Account" onOpen={() => setPaying(true)} />
            {needs.charged && paidWith ? (
              <MoneyRow
                label={`Charged in ${pay.cashCurrency}`}
                value={draft.buy.charged}
                onChange={(charged) => setBuy({ charged })}
                currency={pay.cashCurrency}
                placeholder="Amount"
              />
            ) : null}
            {newRateRows}
          </InsetGroup>
          <CardPointsBox details={{ draft: draft.buy, change: setBuy }} accounts={accounts} show={pay.isCard} />
          {setAside.node}
        </>
      )}

      {buying && !buyingNow && (
        <>
          {draft.purchases.map((purchase, index) => (
            <InsetGroup
              key={index}
              header={index === 0 ? 'Past purchase' : `Purchase ${index + 1}`}
              footer={index === draft.purchases.length - 1 ? "Bought earlier, so no account's balance moves." : undefined}
            >
              <AcquiredRow label="Bought" value={purchase.on} onChange={(on) => setPurchase(index, { on })} />
              {/* A fund tracked by money is bought by amount: its units only if the fund app shows them. */}
              <TextRow
                label={byMoney ? 'Units' : byPar ? 'Par value' : 'How much'}
                value={purchase.units}
                inputMode="decimal"
                placeholder={byMoney ? 'Optional' : byPar ? 'Amount' : 'Quantity'}
                suffix={item.behaviour.opens === 'holding' && item.behaviour.unitKind === 'grams' ? 'g' : undefined}
                info={byPar ? 'Usually the same as the purchase value; it differs when bought on the secondary market.' : undefined}
                onChange={(e) => setPurchase(index, { units: e.target.value })}
              />
              {/* One currency per holding: the first purchase sets it, the rest only say it. */}
              <MoneyRow
                label={byMoney ? 'Amount' : byPar ? 'Purchase value' : 'Total cost'}
                value={purchase.cost}
                onChange={(cost) => setPurchase(index, { cost })}
                currency={draft.currency}
                base={ws.baseCurrency}
                onCurrency={index === 0 ? setCurrency : undefined}
              />
              {index === 0 ? rateRow : null}
            </InsetGroup>
          ))}
          <InsetGroup>
            <InsetRow title="Add another purchase" action onClick={() => change({ purchases: [...draft.purchases, emptyPurchase()] })} />
          </InsetGroup>
        </>
      )}

      {/* Money owed leads with the person: what it is worth is whatever the ledger says they still owe. */}
      {owed && (
        <InsetGroup header="Who owes it">
          <TextRow label="Who" value={draft.personName} onChange={(e) => change({ personName: e.target.value })} placeholder="Name" />
          <MoneyRow label="Owed now" value={draft.cost} onChange={(cost) => change({ cost })} currency={draft.currency} base={ws.baseCurrency} onCurrency={setCurrency} />
          {rateRow}
        </InsetGroup>
      )}

      {legacyCash && (
        <InsetGroup header="The account">
          <AcquiredRow label="Opened" value={draft.acquired} onChange={(acquired) => change({ acquired })} />
          <MoneyRow label="Balance today" value={draft.cost} onChange={(cost) => change({ cost })} currency={draft.currency} base={ws.baseCurrency} onCurrency={setCurrency} />
          {rateRow}
        </InsetGroup>
      )}

      {owed ? (
        <p className="px-[4px] pb-[18px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Owed money is kept under Lend &amp; borrow; its balance is what the report uses.
        </p>
      ) : null}

      <ErrorBox error={error} />
      {pickingPlace && (
        <InstitutionSheet
          brokers={brokers}
          linkedId={heldAccount?.id ?? null}
          bankOf={(id) => (profiles.data ?? []).find((row) => row.accountId === id)?.coretaxFields.inst?.trim() || null}
          typedName={held && 'name' in held ? held.name : ''}
          places={institutionChoices(accounts, profiles.data ?? [])}
          local={ws.baseCurrency === 'IDR'}
          onPick={(choice) => {
            setPickingPlace(false);
            setHeld(choice);
            // A broker's cash picked is where a new purchase is paid from, unless an account was already picked. It is
            // offered then even when it is not kept for spending, as an account already chosen always is (`canPayWith`).
            if (choice && 'accountId' in choice && !draft.buy.moneyId) {
              setBuy({ moneyId: choice.accountId, charged: '', spendCategoryId: '', mcc: '' });
            }
          }}
          onClose={() => setPickingPlace(false)}
        />
      )}
      {paying && (
        <PaymentSheet
          title="Payment method"
          options={moneyOptions}
          accounts={accounts}
          chosenAccountId={draft.buy.moneyId}
          // Another account starts its charged figure and its card facts over, as Trade's Paid with does.
          onPick={(option) => {
            setBuy({ moneyId: option.accountId, charged: '', ...(accounts.find((a) => a.id === option.accountId)?.subtype === 'credit_card' ? {} : { spendCategoryId: '', mcc: '' }) });
          }}
          onClose={() => setPaying(false)}
        />
      )}
    </form>
  );
}
