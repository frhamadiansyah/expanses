import { ASSET_FAMILIES, ASSET_ITEMS, CORETAX_SECTIONS, CURRENCIES, isoDate, type ValuationBasis } from '@expanses/core';
import { createAccount, openDebtBalance, recordTrade, recordValuation, saveAssetProfile } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
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
  const today = isoDate();
  const [draft, setDraft] = useState<NewAssetDraft>(() => emptyDraft(itemId ?? 'fund', ws.baseCurrency, today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planNewAsset(draft, today);
      if (plan.person) {
        // Money owed is kept by the Lend & borrow ledger, which opens the account and its profile itself.
        await openDebtBalance(database, ws, {
          direction: plan.person.direction,
          personName: plan.person.personName,
          currency: plan.account.currency,
          balanceMinor: plan.person.balanceMinor,
          openedOn: plan.account.openedOn,
          coretaxCode: plan.person.coretaxCode,
          openingRateToBase: plan.openingRateToBase,
        });
      } else if (plan.profile) {
        const account = await createAccount(database, ws, {
          name: plan.account.name,
          kind: 'asset',
          subtype: plan.account.subtype as 'investment' | 'property' | 'vehicle' | 'bank',
          currency: plan.account.currency,
          openingBalanceMinor: plan.account.openingBalanceMinor,
          openedOn: plan.account.openedOn,
          openingRateToBase: plan.openingRateToBase,
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
            ratesToBase: plan.openingRateToBase === undefined ? undefined : { [plan.account.currency]: plan.openingRateToBase },
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
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {/* The picker route has already chosen; the Assets page asks here, as it always has. */}
        {itemId === undefined && (
          <Field label="What is it?" hint="This sets how the value is worked out and which tax-report table it belongs to.">
            <Select value={draft.itemId} onChange={(e) => retarget(e.target.value, false)}>
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
            </Select>
          </Field>
        )}
        {itemId !== undefined && (
          <p className="text-sm text-slate-600">
            <b>{item.label}</b> · {item.sub}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Name">
            <Input value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Antam gold bars" required />
          </Field>
          <Field label="Currency">
            <Select value={draft.currency} onChange={(e) => change({ currency: e.target.value })}>
              {CURRENCIES.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}
                </option>
              ))}
            </Select>
          </Field>
          {draft.currency !== ws.baseCurrency && (
            <Field
              label={`Rate to ${ws.baseCurrency}`}
              hint={`What one ${draft.currency} was worth when you got this. Your ledger needs it to hold one running total; the tax report uses the KMK rate instead.`}
            >
              <Input
                aria-label="Opening rate"
                value={draft.openingRate}
                onChange={(e) => change({ openingRate: e.target.value })}
                inputMode="decimal"
                placeholder="16000"
              />
            </Field>
          )}
        </div>

        {canType && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.typedInstead} onChange={(e) => retarget(draft.itemId, e.target.checked)} />
            I'd rather type what it is worth
          </label>
        )}

        {buying && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Already own some?</div>
            <p className="text-xs text-slate-500">Past purchases are recorded against Opening Balances, so your bank balances do not move.</p>
            {draft.purchases.map((purchase, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-3">
                <Field label="Bought on">
                  <Input
                    type="date"
                    value={purchase.occurredOn}
                    max={today}
                    onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, occurredOn: e.target.value } : row)) })}
                  />
                </Field>
                <Field label="How much">
                  <Input
                    value={purchase.units}
                    inputMode="decimal"
                    placeholder="10"
                    onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, units: e.target.value } : row)) })}
                  />
                </Field>
                <Field label={`Total cost (${draft.currency})`}>
                  <Input
                    value={purchase.cost}
                    inputMode="decimal"
                    placeholder="13.100.000"
                    onChange={(e) => change({ purchases: draft.purchases.map((row, i) => (i === index ? { ...row, cost: e.target.value } : row)) })}
                  />
                </Field>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => change({ purchases: [...draft.purchases, { occurredOn: today, units: '', cost: '' }] })}>
              Add another purchase
            </Button>
          </div>
        )}

        {/* Money owed leads with the person: what it is worth is whatever the ledger says they still owe. */}
        {owed && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Who">
              <Input value={draft.personName} onChange={(e) => change({ personName: e.target.value })} placeholder="Andi" />
            </Field>
            <Field label={`Owed now (${draft.currency})`}>
              <Input value={draft.cost} inputMode="decimal" onChange={(e) => change({ cost: e.target.value })} placeholder="25.000.000" />
            </Field>
          </div>
        )}

        {!buying && !owed && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={legacyCash ? 'Open date' : 'Bought on'}>
              <Input type="date" value={draft.purchasedOn} max={today} onChange={(e) => change({ purchasedOn: e.target.value })} />
            </Field>
            <Field label={legacyCash ? `Balance today (${draft.currency})` : `What it cost (${draft.currency})`}>
              <Input value={draft.cost} inputMode="decimal" onChange={(e) => change({ cost: e.target.value })} placeholder="1.150.000.000" />
            </Field>
          </div>
        )}

        {needsEstimate(draft.itemId, draft.typedInstead) && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={`What it is worth now (${draft.currency})`} hint="Leave empty to use what you paid until you estimate it.">
              <Input value={draft.estimate} inputMode="decimal" onChange={(e) => change({ estimate: e.target.value })} placeholder="1.420.000.000" />
            </Field>
            <Field label="Where that came from">
              <Select value={draft.estimateBasis} onChange={(e) => change({ estimateBasis: e.target.value as ValuationBasis })}>
                {BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {BASIS_LABELS[basis]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {owed ? (
          <p className="text-xs text-slate-500">Money owed to you is kept under Lend &amp; borrow; its balance is what the report uses.</p>
        ) : (
          <div className="space-y-2">
            <div className="text-sm font-medium">For the tax report: {CORETAX_SECTIONS[section].label}</div>
            <p className="text-xs text-slate-500">Fill these in once and every yearly report reuses them. You can leave them for later.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {CORETAX_SECTIONS[section].fields.map((field) => (
                <Field key={field.key} label={field.label}>
                  <Input
                    value={draft.coretaxFields[field.key] ?? ''}
                    onChange={(e) => change({ coretaxFields: { ...draft.coretaxFields, [field.key]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
          </div>
        )}

        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Add asset
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
