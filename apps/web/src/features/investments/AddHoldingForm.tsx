import { formatMinor, formatUnits, isoDate } from '@expanses/core';
import { type AccountRow, addHolding, type AddHoldingInput, type RecordTradeInput } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, rateLine, PickerRow, ReadOnlyRow, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { CurrencySheet } from '../currency/CurrencySheet';
import { useHeldRates } from '../accounts/queries';
import { tradeDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { baseCostPreview, tradeRatesForSave } from '../networth/trade-money';
import type { FormConfirm } from '../networth/AddAssetForm';
import { type AcquiredParts, acquiredOn, NO_DATE } from '../networth/acquired';
import { AcquiredRow, MoneyRow } from '../networth/AssetRows';
import { tradeMoneyChoices } from '../transactions/buy-in-form';
import { PaymentSheet } from '../transactions/PaymentSheet';
import { CardPointsBox } from '../networth/trade-sheet-parts';
import type { PurchaseWhen } from '../networth/add-asset';
import { emptyHoldingDraft, type HoldingDraft, NEW_BROKER, newPurchaseMoney, OPENING, type Picked, planAddHolding, securityOf, totalOf } from './add-holding';

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
  const [draft, setDraft] = useState<HoldingDraft>(() => ({ ...emptyHoldingDraft(today, security.currency), brokerChoice: brokers[0]?.id ?? NEW_BROKER, paidFrom: OPENING }));
  /* New purchase (the default, owner 13 Nov 2026) records the buy made now, paid from the broker's cash unless another
     account or a card is picked, as Trade's Buy does; Past purchase is what was owned before, which moves no account. */
  const [when, setWhen] = useState<PurchaseWhen>('new');
  const [pickedMoney, setPickedMoney] = useState('');
  const [paying, setPaying] = useState(false);
  const accounts = useAccounts().data ?? [];
  const [bought, setBought] = useState<AcquiredParts>(NO_DATE);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const change = (patch: Partial<HoldingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const paidFrom = when === 'past' ? OPENING : newPurchaseMoney(draft.brokerChoice, brokers, pickedMoney);
  const paidWith = when === 'past' ? undefined : accounts.find((account) => account.id === paidFrom);
  const isCard = paidWith?.subtype === 'credit_card';
  // A past purchase moves no money, so it is in the share's own currency throughout; a new one is in what paid.
  const cashCurrency = paidWith?.currency ?? security.currency;
  const sent: HoldingDraft = { ...draft, paidFrom };
  const total = totalOf(draft, security.lotSize, security.currency);
  const lotted = (security.lotSize ?? 1) > 1;
  const foreign = security.currency !== ws.baseCurrency;

  /** The plan the save sends, or null while it is incomplete: the one input the preview, the door and the save read. */
  const plan = ((): AddHoldingInput | null => {
    try {
      return picked ? planAddHolding(picked, sent, today, cashCurrency, isCard) : null;
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
      const planned = planAddHolding(picked, sent, today, cashCurrency, isCard);
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
          <PickerRow label="Its currency" value={draft.brokerCurrency} onOpen={() => setPickingCurrency(true)} />
        ) : null}
      </InsetGroup>

      <div className="px-[4px] pb-[12px]">
        <SegmentedControl
          label="New or past purchase"
          segments={[
            { key: 'new', label: 'New purchase' },
            { key: 'past', label: 'Past purchase' },
          ]}
          value={when}
          onChange={(key) => {
            setWhen(key as PurchaseWhen);
            setNeedsRate(null);
            // Each opens on its own day: today for a purchase made now, nothing picked yet for one made before.
            setBought(NO_DATE);
            change({ occurredOn: key === 'new' ? today : '', charged: '' });
          }}
          className="w-full"
        />
      </div>

      {when === 'new' ? (
        <>
          <InsetGroup header="Purchase" footer={isCard ? 'Paid with a card: the card owes it now; paying the card later is a transfer.' : undefined}>
            <TextRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => change({ occurredOn: e.target.value })} />
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
            <MoneyRow label="Fee" value={draft.fee} onChange={(fee) => change({ fee })} currency={security.currency} placeholder="None" />
            <PickerRow label="Paid with" value={paidWith?.name ?? null} placeholder="Account" onOpen={() => setPaying(true)} />
            {paidWith && cashCurrency !== security.currency ? (
              <MoneyRow label={`Charged in ${cashCurrency}`} value={draft.charged} onChange={(charged) => change({ charged })} currency={cashCurrency} placeholder="Amount" />
            ) : null}
          </InsetGroup>
          <CardPointsBox details={{ draft, change }} accounts={accounts} show={isCard} />
        </>
      ) : (
        <InsetGroup header="Past purchase" footer="Bought earlier, so no account's balance moves.">
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
      )}

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
      {paying && (
        <PaymentSheet
          title="Paid with"
          options={tradeMoneyChoices(accounts, 'buy', paidFrom)}
          accounts={accounts}
          chosenAccountId={paidFrom}
          onPick={(option) => {
            setPickedMoney(option.accountId);
            setNeedsRate(null);
            change({ charged: '' });
          }}
          onClose={() => setPaying(false)}
        />
      )}
      {pickingCurrency && <CurrencySheet value={draft.brokerCurrency} baseCurrency={ws.baseCurrency} onPick={(brokerCurrency) => change({ brokerCurrency })} onClose={() => setPickingCurrency(false)} />}
    </form>
  );
}
