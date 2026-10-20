import { CURRENCIES, formatMinor, formatUnits, isoDate } from '@expanses/core';
import { type AccountRow, addHolding, type AddHoldingInput, type RecordTradeInput } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, rateLine, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { useHeldRates } from '../accounts/queries';
import { useGoals } from '../goals/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { usePositions } from '../networth/queries';
import { baseCostPreview, tradeRatesForSave } from '../networth/trade-money';
import type { FormConfirm } from '../networth/AddAssetForm';
import { MoneyRow } from '../networth/AssetRows';
import { emptyHoldingDraft, type HoldingDraft, landsOnNote, NEW_BROKER, NO_BROKER_CHOICE, OPENING, type Picked, planAddHolding, securityOf, totalOf } from './add-holding';
import { useBrokerlessHoldings } from './queries';

export function AddHoldingForm({ picked, accounts, brokers, heldAt, onConfirm, onTicker }: {
  /** The share chosen, or null before one is: every row is there from the start, and the ✓ waits for it. */
  picked: Picked | null;
  accounts: readonly AccountRow[];
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
  const goals = useGoals().data ?? [];
  const today = isoDate();
  // Until a ticker is chosen the rows read in the workspace's own currency, a share at a time.
  const security = picked ? securityOf(picked) : { ticker: null, name: '', market: '', currency: ws.baseCurrency, lotSize: null };
  const [draft, setDraft] = useState<HoldingDraft>(() => ({ ...emptyHoldingDraft(today, security.currency), brokerChoice: brokers[0]?.id ?? NEW_BROKER }));
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const change = (patch: Partial<HoldingDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // A buy with no broker lands on an existing holding of this stock with no broker named, when there is one: say which.
  // A stock already held reaches here as `held` however it was picked (`asHeld`), named by hand included.
  const brokerless = useBrokerlessHoldings(picked?.kind === 'held' ? picked.security.id : null).data ?? [];
  const positions = usePositions().data ?? {};
  const landsOn = picked ? landsOnNote(draft.brokerChoice, brokerless, accounts, positions, security.ticker ?? security.name) : null;

  // Every account money can come out of — never a pocket parent, which holds nothing (`moneyHolders`) — as Buy &
  // sell offers them. A broker's own cash is one of them: parking in the RDN and buying from it is the whole point.
  const money = moneyHolders(accounts).filter((a) => a.kind === 'asset' && MONEY_SUBTYPES.includes(a.subtype));
  const cash = money.find((a) => a.id === draft.paidFrom);
  const cashCurrency = cash ? (cash.currency ?? ws.baseCurrency) : security.currency;
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
  const input: RecordTradeInput | null = plan ? { ...plan.buy, accountId: '', kind: 'buy' } : null;
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
      const ratesToBase = await tradeRatesForSave({
        database, ws, input: { ...planned.buy, accountId: '', kind: 'buy' }, holdingCurrency: security.currency, cashCurrency,
        needsRate, manualRate, resolveRates, onMissing: setNeedsRate, where: 'Rate that day',
      });
      const result = await addHolding(database, ws, { ...planned, buy: { ...planned.buy, ratesToBase, setAside: setAside.choice } });
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

      <InsetGroup footer={landsOn ?? undefined}>
        <SelectRow label="Where is it kept" value={draft.brokerChoice} onChange={(e) => change({ brokerChoice: e.target.value })}>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>{`${b.name}${heldAt[b.id] ? ` · held ${formatUnits(heldAt[b.id]!)}` : ''}`}</option>
          ))}
          <option value={NEW_BROKER}>Another broker…</option>
          <option value={NO_BROKER_CHOICE}>No broker</option>
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

      <InsetGroup>
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
        <MoneyRow label="Fee" value={draft.fee} onChange={(fee) => change({ fee })} currency={security.currency} placeholder="Optional" />
        <TextRow label="Bought" type="date" value={draft.occurredOn} max={today} onChange={(e) => change({ occurredOn: e.target.value })} />
      </InsetGroup>

      <InsetGroup>
        <SelectRow label="Paid from" value={draft.paidFrom} onChange={(e) => change({ paidFrom: e.target.value, charged: '' })}>
          {money.map((a) => (
            <option key={a.id} value={a.id}>{`${a.name} (${a.currency ?? ws.baseCurrency})`}</option>
          ))}
          <option value={OPENING}>Owned before this app</option>
        </SelectRow>
        {cashCurrency !== security.currency ? (
          <MoneyRow label={`Charged in ${cashCurrency}`} value={draft.charged} onChange={(charged) => change({ charged })} currency={cashCurrency} />
        ) : null}
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

      {goals.length > 0 && (
        <InsetGroup footer="Each purchase can fund a different goal.">
          <SelectRow label="For goal" value={draft.goalId} onChange={(e) => change({ goalId: e.target.value })}>
            <option value="">No goal</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>
      )}
      {setAside.node}
      <ErrorBox error={error} />
    </form>
  );
}
