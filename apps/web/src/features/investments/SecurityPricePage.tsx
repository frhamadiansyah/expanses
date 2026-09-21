import { formatPriceMicro, isoDate } from '@expanses/core';
import { upsertSecurityPrice } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, TextRow } from '../../ui/native';
import { dayLabel, priceChangeLines } from './portfolio-view';
import { usePortfolio, useSecurityPrices } from './queries';
import { changeText, lastPriceOnOrBefore, planPriceSave, typedPrice } from './security-price';

/** One price per security: typed once here, it values every broker that holds it (spec §3.1, §7.3). */
export function SecurityPricePage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { securityId = '' } = useParams({ strict: false }) as { securityId?: string };
  const { view, securities } = usePortfolio();
  const prices = useSecurityPrices(securityId);
  const security = securities.find((s) => s.id === securityId);
  const stock = view?.stocks.find((s) => s.securityId === securityId);
  const [price, setPrice] = useState('');
  const [onDate, setOnDate] = useState(isoDate());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const currency = security?.currency ?? ws.baseCurrency;
  const label = security ? (security.ticker ?? security.name) : 'Price';
  const last = lastPriceOnOrBefore(prices.data ?? [], onDate);
  // Null until the security has loaded, so Save waits for the currency the price is read in.
  const typed = typedPrice(price, security);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await upsertSecurityPrice(database, ws, planPriceSave({ security, price, onDate, today: isoDate() }));
      await invalidate();
      await navigate({ to: '/net-worth/investments/security/$securityId', params: { securityId } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={SCREEN} onSubmit={save}>
      <LargeTitle title={`${label} · price per share`} back={label} backTo="/net-worth/investments/security/$securityId" backParams={{ securityId }} oneLine />
      <InsetGroup footer={last ? `Last set ${dayLabel(last.onDate)} at ${formatPriceMicro(last.priceMicro, currency)}.` : undefined}>
        <TextRow label={`Price (${currency})`} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
        <TextRow label="As of" type="date" value={onDate} max={isoDate()} onChange={(e) => setOnDate(e.target.value)} required />
      </InsetGroup>
      {stock && typed !== null && (
        <InsetGroup header="This changes" footer={`One price values every broker that holds ${label}. A price in ${currency} is converted at the day’s rate; you never type a converted price.`}>
          {priceChangeLines(stock.holdings, last?.priceMicro ?? null, typed).map((line) => (
            <InsetRow
              key={line.holding.accountId}
              testId="price-change-row"
              // Two holdings kept with no broker are two lines, each named, never one.
              title={line.holding.brokerAccountId ? line.holding.brokerName : `${line.holding.brokerName} · ${line.holding.name}`}
              subtitle={line.changeMinor === null ? undefined : changeText(line.changeMinor, currency)}
              value={<Money minor={line.valueMinor} currency={currency} />}
              valueTone="ink"
            />
          ))}
        </InsetGroup>
      )}
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Save price" onClick={() => void save()} chevron={false} disabled={busy || typed === null} />
      </InsetGroup>
      {/* Enter in either box saves, as it would with one box: the form's default button, never drawn. */}
      <button type="submit" className="sr-only" tabIndex={-1} aria-hidden disabled={busy || typed === null} />
    </form>
  );
}
