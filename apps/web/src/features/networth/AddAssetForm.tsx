import { ASSET_FAMILIES, ASSET_ITEMS, CORETAX_SECTIONS, CURRENCIES, isoDate, type ValuationBasis } from '@expanses/core';
import { createAccount, openDebtBalance, recordTrade, recordValuation, saveAssetProfile } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { chosenItem, emptyDraft, needsEstimate, needsPurchases, type NewAssetDraft, planNewAsset } from './add-asset';
import { BASIS_LABELS } from './labels';

const BASES: ValuationBasis[] = ['estimate', 'appraisal', 'listing', 'njop'];

/** Everything the five families name, so what is left over in `ASSET_ITEMS` is the legacy entry alone. */
const IN_A_FAMILY = new Set(ASSET_FAMILIES.flatMap((family) => family.items.map((item) => item.id)));
const LEGACY_ITEMS = ASSET_ITEMS.filter((item) => !IN_A_FAMILY.has(item.id));

/**
 * The form behind both ways of adding an asset: the inline one on the Assets page, which still asks "What is it?"
 * itself, and the picker at /net-worth/assets/new, which has already chosen and passes the item in.
 *
 * The catalogue decides everything that follows the choice — how it is valued, which fields appear, which tax
 * table it files under — so this form only draws what the chosen item asks for.
 */
export function AddAssetForm({ onDone, itemId }: { onDone: () => void; itemId?: string }) {
  const { database, ws } = useApp();
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
  const section = item.section ?? 'lainnya';
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
        await openDebtBalance(database, ws, {
          direction: plan.person.direction,
          personName: plan.person.personName,
          currency: plan.account.currency,
          balanceMinor: plan.person.balanceMinor,
          openedOn: plan.account.openedOn,
          coretaxCode: plan.person.coretaxCode,
          openingRateToBase,
        });
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
          coretaxFields: plan.profile.coretaxFields,
          acquiredYear: plan.profile.acquiredYear,
        });
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
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    /* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */
    <form ref={form} onSubmit={submit}>
      <InsetGroup
        header={itemId === undefined ? 'What you are adding' : item.label}
        footer={itemId === undefined ? 'This sets how the value is worked out and which tax-report table it belongs to.' : item.sub}
      >
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
        <TextRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Antam gold bars" required />
        <SelectRow label="Currency" value={draft.currency} onChange={(e) => change({ currency: e.target.value })}>
          {CURRENCIES.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code}
            </option>
          ))}
        </SelectRow>
        {draft.currency !== ws.baseCurrency ? (
          <TextRow
            label={`Rate to ${ws.baseCurrency}`}
            aria-label="Opening rate"
            hint={
              ratePreview(draft.openingRate, draft.currency, ws.baseCurrency) ??
              `What one ${draft.currency} was worth when you got this. Your ledger needs it to hold one running total; the tax report uses the KMK rate instead.`
            }
            value={draft.openingRate}
            onChange={(e) => change({ openingRate: e.target.value })}
            inputMode="decimal"
            placeholder="16000"
          />
        ) : null}
        {canType ? (
          <SwitchRow label="I'd rather type what it is worth" checked={draft.typedInstead} onChange={(checked) => retarget(draft.itemId, checked)} />
        ) : null}
      </InsetGroup>

      {buying && (
        <>
          {draft.purchases.map((purchase, index) => (
            <InsetGroup
              key={index}
              header={index === 0 ? 'Already own some?' : `Purchase ${index + 1}`}
              footer={index === draft.purchases.length - 1 ? 'Past purchases are recorded against Opening Balances, so your bank balances do not move.' : undefined}
            >
              <TextRow
                label="Bought on"
                type="date"
                value={purchase.occurredOn}
                max={today}
                onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, occurredOn: e.target.value } : row)) })}
              />
              <TextRow
                label="How much"
                value={purchase.units}
                inputMode="decimal"
                placeholder="10"
                onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, units: e.target.value } : row)) })}
              />
              <TextRow
                label={`Total cost (${draft.currency})`}
                value={purchase.cost}
                inputMode="decimal"
                placeholder="13.100.000"
                onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, cost: e.target.value } : row)) })}
              />
            </InsetGroup>
          ))}
          <InsetGroup>
            <InsetRow
              title="Add another purchase"
              chevron={false}
              onClick={() => change({ purchases: [...draft.purchases, { occurredOn: today, units: '', cost: '' }] })}
            />
          </InsetGroup>
        </>
      )}

      {/* Money owed leads with the person: what it is worth is whatever the ledger says they still owe. */}
      {owed && (
        <InsetGroup header="Who owes it">
          <TextRow label="Who" value={draft.personName} onChange={(e) => change({ personName: e.target.value })} placeholder="Andi" />
          <TextRow
            label={`Owed now (${draft.currency})`}
            value={draft.cost}
            inputMode="decimal"
            onChange={(e) => change({ cost: e.target.value })}
            placeholder="25.000.000"
          />
        </InsetGroup>
      )}

      {!buying && !owed && (
        <InsetGroup header={legacyCash ? 'The account' : 'What it cost'}>
          <TextRow
            label={legacyCash ? 'Open date' : 'Bought on'}
            type="date"
            value={draft.purchasedOn}
            max={today}
            onChange={(e) => change({ purchasedOn: e.target.value })}
          />
          <TextRow
            label={legacyCash ? `Balance today (${draft.currency})` : `What it cost (${draft.currency})`}
            value={draft.cost}
            inputMode="decimal"
            onChange={(e) => change({ cost: e.target.value })}
            placeholder="1.150.000.000"
          />
        </InsetGroup>
      )}

      {needsEstimate(draft.itemId, draft.typedInstead) && (
        <InsetGroup header="What it is worth now" footer="Leave empty to use what you paid until you estimate it.">
          <TextRow
            label={`What it is worth now (${draft.currency})`}
            value={draft.estimate}
            inputMode="decimal"
            onChange={(e) => change({ estimate: e.target.value })}
            placeholder="1.420.000.000"
          />
          <SelectRow label="Where that came from" value={draft.estimateBasis} onChange={(e) => change({ estimateBasis: e.target.value as ValuationBasis })}>
            {BASES.map((basis) => (
              <option key={basis} value={basis}>
                {BASIS_LABELS[basis]}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>
      )}

      {owed ? (
        <p className="px-[4px] pb-[18px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Money owed to you is kept under Lend &amp; borrow; its balance is what the report uses.
        </p>
      ) : (
        <InsetGroup
          header={`For the tax report: ${CORETAX_SECTIONS[section].label}`}
          footer="Fill these in once and every yearly report reuses them. You can leave them for later."
        >
          {CORETAX_SECTIONS[section].fields.map((field) => (
            <TextRow
              key={field.key}
              label={field.label}
              value={draft.coretaxFields[field.key] ?? ''}
              onChange={(e) => change({ coretaxFields: { ...draft.coretaxFields, [field.key]: e.target.value } })}
            />
          ))}
        </InsetGroup>
      )}

      <ErrorBox error={error} />
      <InsetGroup>
        {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
        <InsetRow title="Add asset" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
        <InsetRow title="Cancel" chevron={false} onClick={onDone} />
      </InsetGroup>
    </form>
  );
}
