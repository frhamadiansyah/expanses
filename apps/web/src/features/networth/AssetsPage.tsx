import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { type AssetGroup, type AssetRow, groupAssets, liveGroups, soldRows, staleRows, totalOf } from './asset-rows';
import { useAssetProfiles, useAssetValues } from './queries';

function Row({ row }: { row: AssetRow }) {
  return (
    <Link
      to="/net-worth/assets/$accountId"
      params={{ accountId: row.accountId }}
      className="flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
    >
      <span className="min-w-0">
        <span className="block font-medium">{row.name}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded border border-slate-200 px-1.5 py-0.5">{row.method}</span>
          {row.coretax && <span>{row.coretax}</span>}
          {row.stale && !row.sold && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Update price</span>}
          {row.sold && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">Sold</span>}
        </span>
      </span>
      <Money minor={row.valueMinor} currency={row.currency} className="font-medium" />
    </Link>
  );
}

function Group({ group }: { group: AssetGroup }) {
  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{group.label}</h2>
        <Money minor={group.totalMinor} currency={group.rows[0]?.currency ?? 'IDR'} className="text-sm font-semibold" />
      </div>
      <div className="divide-y divide-slate-100">
        {group.rows.map((row) => (
          <Row key={row.accountId} row={row} />
        ))}
      </div>
    </Card>
  );
}

export function AssetsPage() {
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const [showSold, setShowSold] = useState(false);

  const groups = values.data && profiles.data ? groupAssets(values.data, profiles.data) : [];
  const live = liveGroups(groups);
  const sold = soldRows(groups);
  const stale = staleRows(groups);
  const baseCurrency = values.data?.[0]?.currency ?? 'IDR';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assets"
        action={
          <div className="text-right">
            <div className="text-xs text-slate-500">Everything you own</div>
            <Money minor={totalOf(groups)} currency={baseCurrency} className="text-lg font-semibold" />
          </div>
        }
      />
      <ErrorBox error={values.error ?? profiles.error} />

      {stale.length > 0 && (
        <Card className="bg-amber-50 ring-amber-200">
          <p className="text-sm text-amber-900">
            {stale.length === 1 ? '1 asset needs' : `${stale.length} assets need`} a fresh price or estimate: {stale.map((row) => row.name).join(', ')}.
          </p>
        </Card>
      )}

      {live.length === 0 && !values.isPending && <Empty>No assets yet. Add a bank account, fund, gold or property to see it here.</Empty>}
      {live.map((group) => (
        <Group key={group.group} group={group} />
      ))}

      {sold.length > 0 && (
        <Card>
          <button type="button" className="text-sm font-medium text-slate-600" onClick={() => setShowSold((open) => !open)}>
            {showSold ? 'Hide' : 'Show'} sold holdings ({sold.length})
          </button>
          {showSold && (
            <div className="mt-2 divide-y divide-slate-100">
              {sold.map((row) => (
                <Row key={row.accountId} row={row} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
