import { averagePriceMicro, formatPriceMicro, formatUnits, isoDate, lastNMonths, monthOf, presetFor } from '@expanses/core';
import { archiveAccount } from '@expanses/db';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { useGoalLinks, useGoals } from '../goals/queries';
import { CoretaxFieldsForm } from './CoretaxFieldsForm';
import { METHOD_LABELS, UNIT_LABELS } from './labels';
import { PriceForm } from './PriceForm';
import { useAssetProfile, useAssetValues, useMonthEndValues, usePositions, usePrices, useTrades, useValuations } from './queries';
import { ValuationForm } from './ValuationForm';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

export function AssetDetailPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const months = lastNMonths(monthOf(isoDate()), 12);

  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const positions = usePositions();
  const prices = usePrices(accountId);
  const valuations = useValuations(accountId);
  const trades = useTrades(accountId);
  const history = useMonthEndValues(accountId, months);
  const goalLinks = useGoalLinks();
  const goals = useGoals();
  const [error, setError] = useState<unknown>(null);

  const value = values.data?.find((row) => row.accountId === accountId);
  const position = positions.data?.[accountId];
  const preset = profile.data ? presetFor(profile.data.assetKind) : undefined;
  const unitLabel = profile.data?.unitKind ? UNIT_LABELS[profile.data.unitKind] : '';
  const average = position ? averagePriceMicro(position) : null;
  const gain = value ? value.valueMinor - value.costMinor : 0;
  const canArchive = value ? value.valueMinor === 0 && (position?.unitsMicro ?? 0) === 0 : false;
  const forGoals = (goalLinks.data ?? []).filter((link) => link.accountId === accountId && link.kind === 'tagged');

  async function archive() {
    setError(null);
    try {
      await archiveAccount(database, ws, accountId);
      await invalidate();
      await navigate({ to: '/net-worth/assets' });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={value?.name ?? 'Asset'}
        action={
          <Link to="/net-worth/assets" className="text-sm text-slate-600 hover:text-slate-900">
            Back to assets
          </Link>
        }
      />
      <ErrorBox error={values.error ?? profile.error ?? error} />
      {!value && !values.isPending && <Empty>That asset is not in this workspace.</Empty>}

      {value && (
        <Card className="space-y-3">
          <div>
            <div className="text-2xl font-semibold">
              <Money minor={value.valueMinor} currency={value.currency} />
            </div>
            <div className="text-sm text-slate-600">
              Cost <Money minor={value.costMinor} currency={value.currency} />
              {value.costMinor !== 0 && (
                <>
                  {' · '}
                  <Money minor={gain} currency={value.currency} tone="auto" />
                  {' since you bought it'}
                </>
              )}
            </div>
            <div className="text-xs text-slate-500">
              {METHOD_LABELS[value.mode]}
              {position && position.unitsMicro > 0 && (
                <>
                  {` · ${formatUnits(position.unitsMicro)} ${unitLabel}`}
                  {average !== null && ` · average cost ${formatPriceMicro(average, value.currency)}`}
                </>
              )}
              {value.asOf && ` · price from ${value.asOf}`}
              {value.source === 'cost' && ' · no price yet, showing what you paid'}
            </div>
          </div>

          {value.mode === 'market' && (
            <PriceForm
              accountId={accountId}
              currency={value.currency}
              priceLabel={preset?.priceLabel ?? 'Price per unit'}
              priceMicro={prices.data?.[0]?.priceMicro ?? null}
              unitsMicro={position?.unitsMicro ?? 0}
              unitLabel={unitLabel}
            />
          )}
          {value.mode === 'snapshot' && <ValuationForm accountId={accountId} currency={value.currency} />}
          {value.mode === 'derived' && (
            <p className="text-sm text-slate-600">
              This balance follows your transactions.{' '}
              <Link to="/transactions" search={{ account: accountId }} className="underline">
                See them
              </Link>
              .
            </p>
          )}
        </Card>
      )}

      {value && forGoals.length > 0 && (
        <Card>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">For goals</h2>
            <Link to="/net-worth/trades" className="text-xs text-slate-600 underline">
              Change on Buy &amp; sell
            </Link>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {forGoals.map((link) => (
              <span key={link.goalId} className="rounded bg-slate-100 px-2 py-1">
                <b>{(goals.data ?? []).find((goal) => goal.id === link.goalId)?.name ?? 'A goal'}</b> {link.unitsMicro === null ? '' : `${formatUnits(link.unitsMicro)} ${unitLabel}`} ·{' '}
                <Money minor={link.valueMinor} currency={value.currency} />
              </span>
            ))}
          </div>
        </Card>
      )}

      {value && history.data && history.data.some((point) => point !== 0) && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Last 12 months</h2>
          <ValueChart values={history.data} labels={months.map(MONTH_LABEL)} currency={value.currency} />
        </Card>
      )}

      {value?.mode === 'market' && (trades.data?.length ?? 0) > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Buys, sells and income</h2>
          <div className="divide-y divide-slate-100 text-sm">
            {[...(trades.data ?? [])].reverse().map((trade) => (
              <div key={trade.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-slate-500">{trade.occurredOn}</span>
                <span className="flex-1">
                  {trade.kind === 'buy' ? 'Bought' : trade.kind === 'sell' ? 'Sold' : trade.kind === 'income' ? 'Income' : 'Units changed'}
                  {trade.kind !== 'income' && ` ${formatUnits(trade.unitsMicro)} ${unitLabel}`}
                </span>
                <Money minor={trade.grossMinor} currency={value.currency} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {value?.mode === 'snapshot' && (valuations.data?.length ?? 0) > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Value history</h2>
          <div className="divide-y divide-slate-100 text-sm">
            {(valuations.data ?? []).map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-slate-500">{row.asOf}</span>
                <span className="flex-1">
                  {row.basis}
                  {row.note ? ` · ${row.note}` : ''}
                </span>
                <Money minor={row.valueMinor} currency={value.currency} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {profile.data?.coretaxSection && (
        <Card>
          <CoretaxFieldsForm profile={profile.data} section={profile.data.coretaxSection} />
        </Card>
      )}

      {value && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              {canArchive ? 'Nothing left here. Archiving hides it from the list and keeps its history.' : 'Archiving is available once nothing is left in this asset.'}
            </p>
            <Button variant="danger" disabled={!canArchive} onClick={archive}>
              Archive
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
