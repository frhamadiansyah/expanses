import { CURRENCIES, formatMinor, formatUnits, isoDate } from '@expanses/core';
import { type AccountRow, addHolding, type AddHoldingInput, type RecordTradeInput } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, rateLine, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { baseCostPreview, tradeRatesForSave } from '../networth/trade-money';
import type { FormConfirm } from '../networth/AddAssetForm';
import { type AcquiredParts, acquiredOn, NO_DATE } from '../networth/acquired';
import { AcquiredRow, MoneyRow } from '../networth/AssetRows';
import { emptyHoldingDraft, type HoldingDraft, NEW_BROKER, OPENING, type Picked, planAddHolding, securityOf, totalOf } from './add-holding';

export function AddHoldingForm({ picked, brokers, heldAt, onConfirm, onTicker }: {
  /** The share chosen, or null before one is: every row is there from the start, and the ✓ waits for it. */
  picked: Picked | null;
  /** `brokerChoices(accounts)`: fund accounts that are not pockets. */
  brokers: readonly AccountRow[];
  /** Units of this security already held at each broker account id. */
  heldAt: Readonly<Record<string, number>>;
  /** The screen's ✓, as Add asset draws it: whether it can save yet, and how to. */
  onConfirm: (confirm: FormConfirm | null) => void;
  /** Its first row opens the search again, to pick another ticker. */
  onTicker: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const resolveRates = useResolveRates();
  const today = isoDate();
  // Until a ticker is chosen the rows read in the workspace's own currency, a share at a time.
  const security = picked ? securityOf(picked) : { ticker: null, name: '', market: '', currency: ws.baseCurrency, lotSize: null };
  /* What is already owned, as Add asset adds it (spec: Add a holding is past-only): a purchase from before the app,
     recorded against Opening Balances so no bank moves, on a day picked as Add asset's Bought is — or nothing bought
     yet, its buys recorded with Buy on its page after. */
  const [draft, setDraft] = useState<HoldingDraft>(() => ({ ...emptyHoldingDraft('', security.currency), brokerChoice: brokers[0]?.id ?? NEW_BROKER, paidFrom: OPENING }));
  const [bought, setBought] = useState<AcquiredParts>(NO_DATE);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const change = (patch: Partial<HoldingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const cashCurrency = security.currency;
  const total = totalOf(draft, security.lotSize, security.currency);
  const lotted = (security.lotSize ?? 1) > 1;
  const foreign = security.currency !== ws.baseCurrency;

  /** The plan the save sends, or null while it is incomplete: the one input the preview, the door and the save read. */
  const plan = ((): AddHoldingInput | null => {
    try {
      return picked ? planAddHolding(picked, draft, today, cashCurrency) : null;
    } catch {
      return null;
    }
  })();
  const input: RecordTradeInput | null = plan?.buy ? { ...plan.buy, accountId: '', kind: 'buy' } : null;
  // A buy is a set-aside door (spec §4.6 of set-aside): it asks which goal paid when it takes more than is free.
  const setAside = useSetAside(input ? tradeDoor(input) : null);
  const held = useHeldRates(foreign ? [security.currency] : [], draft.occurredOn);
  const preview = baseCostPreview({ input, holdingCurrency: security.currency, cashCurrency, baseCurrency: ws.baseCurrency, heldRates: held.data?.rates ?? {} });

  // The ✓ in the bar saves, as Add asset's does; it waits for a whole plan and the set-aside question.
  const ready = plan !== null && setAside.ready && !busy;
  useEffect(() => {
    onConfirm({ disabled: !ready, run: () => form.current?.requestSubmit() });
    return () => onConfirm(null);
  }, [ready, onConfirm]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      if (!picked) throw new Error('Choose a ticker');
      const planned = planAddHolding(picked, draft, today, cashCurrency);
      const buy = planned.buy;
      const ratesToBase = buy
        ? await tradeRatesForSave({
            database, ws, input: { ...buy, accountId: '', kind: 'buy' }, holdingCurrency: security.currency, cashCurrency,
            needsRate, manualRate, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
          })
        : undefined;
      const result = await addHolding(database, ws, { ...planned, buy: buy ? { ...buy, ratesToBase, setAside: setAside.choice } : null });
      await invalidate();
      await navigate({ to: '/net-worth/investments/security/$securityId', params: { securityId: result.securityId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const label = security.ticker ?? security.name;
  return (
    // Still a real `<form>`: Enter in any box saves, as the ✓ does.
    <form ref={form} onSubmit={submit}>
      <InsetGroup>
        <InsetRow
          title="Ticker"
          value={picked ? label : 'Choose'}
          subtitle={picked ? [security.ticker ? security.name : null, security.market || null, security.currency].filter(Boolean).join(' · ') : undefined}
          onClick={onTicker}
        />
      </InsetGroup>

      <InsetGroup>
        <SelectRow
          label="Broker"
          value={draft.brokerChoice}
          onChange={(e) => change({ brokerChoice: e.target.value })}
        >
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>{`${b.name}${heldAt[b.id] ? ` · held ${formatUnits(heldAt[b.id]!)}` : ''}`}</option>
          ))}
          <option value={NEW_BROKER}>Another broker…</option>
        </SelectRow>
        {draft.brokerChoice === NEW_BROKER ? (
          <TextRow label="Broker name" value={draft.brokerName} onChange={(e) => change({ brokerName: e.target.value })} placeholder="Required" required />
        ) : null}
        {draft.brokerChoice === NEW_BROKER ? (
          <SelectRow label="Its currency" value={draft.brokerCurrency} onChange={(e) => change({ brokerCurrency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </SelectRow>
        ) : null}
      </InsetGroup>

      <InsetGroup header="Already own some?" footer="Past purchases are recorded against Opening Balances, so bank balances do not move.">
        <AcquiredRow
          label="Bought"
          value={bought}
          onChange={(next) => {
            setBought(next);
            let occurredOn = '';
            try {
              occurredOn = acquiredOn(next, today).on;
            } catch {
              // No year yet: no day to buy on.
            }
            change({ occurredOn });
          }}
        />
        <TextRow
          label={lotted ? 'Lots' : 'Shares'}
          info={lotted ? `${security.lotSize} shares a lot.` : undefined}
          value={draft.quantity}
          onChange={(e) => change({ quantity: e.target.value })}
          inputMode="decimal"
          placeholder="Quantity"
        />
        <MoneyRow label="Price per share" value={draft.price} onChange={(price) => change({ price })} currency={security.currency} />
        <ReadOnlyRow label="Total" value={total === null ? null : formatMinor(total, security.currency)} />
      </InsetGroup>

      {/* A share in another currency: the rate its cost is filed at, in the workspace's money, for the tax report. */}
      {needsRate || foreign ? (
      <InsetGroup>
          {needsRate ? (
            <TextRow
              label="Rate that day"
              hint={ratePreview(manualRate, needsRate, ws.baseCurrency) ?? `${ws.baseCurrency} per 1 ${needsRate}`}
              value={manualRate}
              onChange={(e) => setManualRate(e.target.value)}
              inputMode="decimal"
              placeholder="Rate"
            />
          ) : foreign ? (
            <ReadOnlyRow label="Rate that day" value={preview.rate === null ? null : rateLine(preview.rate, security.currency, ws.baseCurrency)} />
          ) : null}
          {foreign ? <ReadOnlyRow label={`Cost in ${ws.baseCurrency}`} value={preview.baseMinor === null ? null : formatMinor(preview.baseMinor, ws.baseCurrency)} /> : null}
        </InsetGroup>
      ) : null}

      {setAside.node}
      <ErrorBox error={error} />
    </form>
  );
}
