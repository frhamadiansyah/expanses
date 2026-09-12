import { ASSET_PRESETS, type AssetKind, CORETAX_SECTIONS, CURRENCIES, isoDate, type ValuationBasis } from '@expanses/core';
import { createAccount, recordTrade, recordValuation, saveAssetProfile } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { emptyDraft, needsEstimate, needsPurchases, type NewAssetDraft, planNewAsset } from './add-asset';
import { BASIS_LABELS } from './labels';

const BASES: ValuationBasis[] = ['estimate', 'appraisal', 'listing', 'njop'];

export function AddAssetForm({ onDone }: { onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [draft, setDraft] = useState<NewAssetDraft>(() => emptyDraft('fund', ws.baseCurrency, today));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const change = (patch: Partial<NewAssetDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const pickKind = (kind: AssetKind) => setDraft((current) => ({ ...emptyDraft(kind, current.currency, today), name: current.name }));
  const section = ASSET_PRESETS.find((preset) => preset.kind === draft.kind)!.coretaxSection;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const plan = planNewAsset(draft, today);
      const account = await createAccount(database, ws, {
        name: plan.account.name,
        kind: 'asset',
        subtype: plan.account.subtype as 'investment' | 'property' | 'vehicle' | 'bank',
        currency: plan.account.currency,
        openingBalanceMinor: plan.account.openingBalanceMinor,
        openedOn: plan.account.openedOn,
      });
      await saveAssetProfile(database, ws, {
        accountId: account.id,
        assetKind: plan.profile.assetKind,
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
        });
      }
      if (plan.valuation) {
        await recordValuation(database, ws, { accountId: account.id, ...plan.valuation });
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
        <Field label="What is it?" hint="This sets how the value is worked out and which tax-report table it belongs to.">
          <Select value={draft.kind} onChange={(e) => pickKind(e.target.value as AssetKind)}>
            {ASSET_PRESETS.map((preset) => (
              <option key={preset.kind} value={preset.kind}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>

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
        </div>

        {needsPurchases(draft.kind) && (
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

        {!needsPurchases(draft.kind) && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={draft.kind === 'cash' ? 'Open date' : 'Bought on'}>
              <Input type="date" value={draft.purchasedOn} max={today} onChange={(e) => change({ purchasedOn: e.target.value })} />
            </Field>
            <Field label={draft.kind === 'cash' ? `Balance today (${draft.currency})` : `What it cost (${draft.currency})`}>
              <Input value={draft.cost} inputMode="decimal" onChange={(e) => change({ cost: e.target.value })} placeholder="1.150.000.000" />
            </Field>
          </div>
        )}

        {needsEstimate(draft.kind) && (
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
