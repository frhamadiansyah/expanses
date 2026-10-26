import { assetItemOfCode, formatMinor } from '@expanses/core';
import { restoreAsset, undoSale } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, Panel, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { useOpenings } from '../accounts/queries';
import { dayLabel } from './asset-page';
import { heldFor, signedGain } from './sell-model';
import { useAcquiredDates, useAssetProfile, useAssetSale, useGoneAssets } from './queries';

/**
 * The page of an asset that is no longer on the list. Sold: no value and no buttons, only what the sale was — the day,
 * the price, where the money went, the gain against the original cost and how long it was held — and one row to take
 * the sale back. Archived: its details and one row to put it back. Neither counts in net worth.
 *
 * Reached from the Sold and archived group at the foot of Assets, and by the address of an asset that was sold from
 * its Settings; an address that is neither is not in this workspace.
 */
export function GoneAssetPage({ accountId, pending, error: loadError }: { accountId: string; pending: boolean; error: unknown }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const sale = useAssetSale(accountId);
  const gone = useGoneAssets();
  const profile = useAssetProfile(accountId);
  const openings = useOpenings([accountId]);
  const acquiredDates = useAcquiredDates();
  const [error, setError] = useState<unknown>(null);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  const row = (gone.data ?? []).find((item) => item.accountId === accountId);
  const name = account?.name ?? row?.name ?? 'Asset';

  if (pending || sale.isPending || gone.isPending || accounts.isPending) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Asset" back="Assets" backTo="/net-worth/assets" />
      </div>
    );
  }
  if (!row) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Asset" back="Assets" backTo="/net-worth/assets" />
        <ErrorBox error={loadError} />
        <Empty>That asset is not in this workspace.</Empty>
      </div>
    );
  }

  const currency = row.currency;
  const money = (minor: number) => formatMinor(minor, currency);
  const openedOn = openings.data?.[accountId]?.occurredOn;
  const acquiredOn = acquiredDates.data?.[accountId]?.on ?? openedOn ?? null;
  const kindLabel = assetItemOfCode(profile.data?.coretaxCode ?? row.coretaxCode)?.label ?? SUBTYPE_LABELS[row.subtype as keyof typeof SUBTYPE_LABELS] ?? 'Asset';

  const act = (ask: string | null, run: () => Promise<void>) => {
    if (ask && !window.confirm(ask)) return;
    setError(null);
    void (async () => {
      try {
        await run();
        await invalidate();
      } catch (e) {
        setError(e);
      }
    })();
  };

  if (sale.data) {
    const sold = sale.data;
    const into = (accounts.data ?? []).find((item) => item.id === sold.cashAccountId)?.name;
    const gain = sold.gainMinor;
    return (
      <div className={SCREEN}>
        <PushedTitle title={name} back="Assets" backTo="/net-worth/assets" />
        <Panel className="space-y-1 text-center">
          <div data-testid="sold-word" className="text-[34px] leading-[40px] font-semibold text-[var(--ph-ink)]">
            Sold
          </div>
          <p data-testid="sold-line" className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
            {[dayLabel(sold.soldOn), money(sold.soldForMinor), into ? `into ${into}` : null].filter(Boolean).join(' · ')}
          </p>
        </Panel>
        <InsetGroup>
          <ReadOnlyRow
            label="Gain"
            info="Against the original cost, not against the last estimate"
            value={signedGain(gain, money)}
            tone={gain > 0 ? 'gain' : gain < 0 ? 'alarm' : 'ink'}
          />
          {sold.costsMinor > 0 && <ReadOnlyRow label="Costs" value={money(sold.costsMinor)} />}
          <ReadOnlyRow label="Original cost" value={money(sold.costMinor)} />
          {acquiredOn && <ReadOnlyRow label="Held for" value={heldFor(acquiredOn, sold.soldOn)} />}
        </InsetGroup>
        <InsetGroup>
          <InsetRow
            title="Undo sale"
            testId="undo-sale"
            onClick={() =>
              act(`Undo the sale of ${name}? The money it brought in is taken out again and the asset is back on the list as it was.`, () => undoSale(database, ws, accountId))
            }
          />
        </InsetGroup>
        <ErrorBox error={error} />
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title={name} back="Assets" backTo="/net-worth/assets" />
      <Panel className="space-y-1 text-center">
        <div data-testid="archived-word" className="text-[34px] leading-[40px] font-semibold text-[var(--ph-ink)]">
          Archived
        </div>
        {row.figureMinor !== null && <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Last value {money(row.figureMinor)}</p>}
      </Panel>
      <InsetGroup>
        <ReadOnlyRow label="Type" value={kindLabel} />
        {row.figureMinor !== null && <ReadOnlyRow label="Last value" value={money(row.figureMinor)} />}
        {acquiredOn && <ReadOnlyRow label="Acquired" value={dayLabel(acquiredOn)} />}
      </InsetGroup>
      <InsetGroup>
        <InsetRow title="Restore" testId="restore-asset" onClick={() => act(null, () => restoreAsset(database, ws, accountId))} />
      </InsetGroup>
      <ErrorBox error={error} />
    </div>
  );
}
