import { ASSET_FAMILIES, ASSET_ITEMS, isoDate } from '@expanses/core';
import { createAccount, openDebtBalance, recordTrade, recordValuation, saveAcquired, saveAssetProfile } from '@expanses/db';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { byMoneyItem, chosenItem, emptyDraft, emptyPurchase, needsEstimate, needsPurchases, type NewAssetDraft, planNewAsset, type PurchaseDraft } from './add-asset';
import { AcquiredRow, MoneyRow } from './AssetRows';
import { useShareOnAdd } from '../sharing/ShareWithHousehold';

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

export function AddAssetForm({ onDone, itemId, onConfirm }: { onDone: () => void; itemId?: string; onConfirm?: (confirm: FormConfirm | null) => void }) {
  const { database, ws } = useApp();
  const household = useShareOnAdd();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const today = isoDate();
  const [draft, setDraft] = useState<NewAssetDraft>(() => emptyDraft(itemId ?? 'fund', ws.baseCurrency, today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

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

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planNewAsset(draft, today);
      // One rate for the whole opening, as before: typed (parseRate, checked, stored for that day) or resolved for the day.
      const openingRateToBase = await openingRateFor({ database, ws, currency: plan.account.currency, openedOn: plan.rateDate, openingBalanceMinor: plan.rateNeededMinor, typed: draft.openingRate, resolveRates });
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
      } else if (plan.profile) {
        const account = await createAccount(database, ws, {
          name: plan.account.name,
          kind: 'asset',
          subtype: plan.account.subtype as 'investment' | 'property' | 'vehicle' | 'bank',
          currency: plan.account.currency,
          openingBalanceMinor: plan.account.openingBalanceMinor,
          openedOn: plan.account.openedOn,
          openingRateToBase,
        });
        await saveAssetProfile(database, ws, {
          accountId: account.id,
          assetKind: plan.profile.assetKind,
          planGroup: plan.profile.planGroup,
          unitKind: plan.profile.unitKind,
          lotSize: plan.profile.lotSize,
          coretaxSection: plan.profile.coretaxSection,
          coretaxCode: plan.profile.coretaxCode,
          acquiredYear: plan.profile.acquiredYear,
        });
        if (plan.acquired) await saveAcquired(database, ws, account.id, plan.acquired);
        for (const trade of plan.trades) {
          await recordTrade(database, ws, {
            accountId: account.id,
            kind: 'buy',
            occurredOn: trade.occurredOn,
            unitsMicro: trade.unitsMicro,
            grossMinor: trade.grossMinor,
            feeMinor: 0,
            taxMinor: 0,
            cashAccountId: null,
            ratesToBase: openingRateToBase === undefined ? undefined : { [plan.account.currency]: openingRateToBase },
          });
        }
        if (plan.valuation) {
          await recordValuation(database, ws, { accountId: account.id, ...plan.valuation });
        }
        await household.save([account.id]);
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const estimated = needsEstimate(draft.itemId, draft.typedInstead);
  const byMoney = byMoneyItem(draft.itemId, draft.typedInstead);
  // Ready once it has a name and, where a year is asked, a year: the rest is optional or checked on save.
  const ready = draft.name.trim() !== '' && (!(estimated || legacyCash) || draft.acquired.year.trim() !== '');
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
        placeholder="16000"
      />
    ) : null;

  // A thing valued by its owner needs no footer: its own rows say what is optional.
  const footer = estimated
    ? undefined
    : itemId === undefined
      ? 'This sets how the value is worked out and which tax-report table it belongs to.'
      : item.sub;

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
        <TextRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Required" required />
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
      </InsetGroup>
      {draft.itemId === 'stock' && itemId === undefined && (
        <InsetGroup footer="Or type it in below, as before.">
          <InsetRow title="Find it by ticker" to="/net-worth/investments/new" />
        </InsetGroup>
      )}

      {buying && (
        <>
          {draft.purchases.map((purchase, index) => (
            <InsetGroup
              key={index}
              header={index === 0 ? 'Already own some?' : `Purchase ${index + 1}`}
              footer={index === draft.purchases.length - 1 ? 'Past purchases are recorded against Opening Balances, so bank balances do not move.' : undefined}
            >
              <AcquiredRow label="Bought" value={purchase.on} onChange={(on) => setPurchase(index, { on })} />
              {/* A fund tracked by money is bought by amount: its units only if the fund app shows them. */}
              <TextRow label={byMoney ? 'Units' : 'How much'} value={purchase.units} inputMode="decimal" placeholder={byMoney ? 'Optional' : '10'} onChange={(e) => setPurchase(index, { units: e.target.value })} />
              {/* One currency per holding: the first purchase sets it, the rest only say it. */}
              <MoneyRow
                label={byMoney ? 'Amount' : 'Total cost'}
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
            <InsetRow title="Add another purchase" chevron={false} onClick={() => change({ purchases: [...draft.purchases, emptyPurchase()] })} />
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

      {household.element}
      <ErrorBox error={error} />
    </form>
  );
}
