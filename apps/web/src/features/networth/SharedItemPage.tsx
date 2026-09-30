import { formatMinor } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { Empty, ErrorBox, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN } from '../../ui/native';
import { memberName, useHouseholdPurchases, useItemTransfers, useSharedNetWorth } from './queries';
import { sharedItemView } from './shared-item';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const DAY_LABEL = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * An item of the other's (joint-net-worth §8.3, D11, D13): read-only. Its balance, the chart of the month-ends it sent,
 * the Household lines of its period paid from it, ONE "Rina's other use" total — never her private lines — and, for a
 * card, the limit bar. Owner, Updated and what is not on her phone yet live in the details here, never on a list row.
 */
export function SharedItemPage() {
  const { itemId } = useParams({ from: '/net-worth/shared/$itemId' });
  const shared = useSharedNetWorth();
  const group = shared.data?.group ?? null;
  const item = shared.data?.items.find((each) => each.itemId === itemId) ?? null;
  const purchases = useHouseholdPurchases(group && item ? group.workspaceBookId : null, item ? item.period : null);
  const transfers = useItemTransfers(group && item ? group.groupBookId : null, item?.itemId ?? null, item ? item.period : null);
  const owner = item && shared.data ? memberName(shared.data.names, item.owner) : '';
  const view = item && group ? sharedItemView(item, purchases.data ?? [], owner, { transfers: transfers.data ?? [], me: group.me }) : null;
  const back = group?.mode === 'joint' ? { back: 'Net worth', backTo: '/net-worth' as const } : { back: 'Accounts', backTo: '/accounts' as const };

  return (
    <div className={SCREEN}>
      <LargeTitle title={view?.name ?? 'Shared item'} {...back} />
      <ErrorBox error={shared.error ?? purchases.error ?? transfers.error} />
      {!view && !shared.isPending && <Empty>This item is not shared with you any more.</Empty>}

      {view && item && (
        <>
          <Hero label={item.kind === 'liability' ? 'Owed' : 'Balance'} minor={view.balance.minor} currency={view.balance.currency} />

          {view.bar && (
            <Panel header="Limit" className="space-y-2">
              {/* Household · other use · available: the three parts of the limit, so the bar always adds up (§5.2). */}
              <div role="img" aria-label={`Household ${view.bar.householdPct}%, other use ${view.bar.otherPct}%, ${formatMinor(view.bar.availableMinor, item.currency)} available`} className="flex h-2 overflow-hidden rounded-full bg-[var(--ph-track)]">
                <i className="block h-full bg-[var(--ph-tint)]" style={{ width: `${view.bar.householdPct}%` }} />
                <i className="block h-full bg-[var(--ph-ink-3)]" style={{ width: `${view.bar.otherPct}%` }} />
              </div>
              <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                {formatMinor(view.bar.availableMinor, item.currency)} available of {formatMinor(view.bar.limitMinor, item.currency)}
              </p>
            </Panel>
          )}

          {view.chart.values.some((value) => value !== 0) && (
            <Panel header="Last 12 months">
              {/* Twelve of the month-ends it sent, as an asset's own page draws them: 24 labels do not fit a phone. */}
              <ValueChart values={view.chart.values.slice(-12)} labels={view.chart.months.slice(-12).map(MONTH_LABEL)} currency={item.currency} />
            </Panel>
          )}

          <InsetGroup header="Lines you can see" footer={`Household purchases paid from it and transfers with you, ${DAY_LABEL(item.period.start)} to ${DAY_LABEL(item.period.end)}.`}>
            {view.lines.map((line) => (
              <InsetRow
                key={line.lineageId}
                title={line.description}
                subtitle={line.pending ? `${DAY_LABEL(line.occurredOn)} · not yet on ${owner}'s phone` : DAY_LABEL(line.occurredOn)}
                value={<Money minor={line.amountMinor} currency={line.currency} />}
                valueTone="ink"
                chevron={false}
              />
            ))}
            {view.transfers.map((line) => (
              <InsetRow
                key={line.key}
                title={line.title}
                subtitle={DAY_LABEL(line.occurredOn)}
                value={<Money minor={line.amountMinor} currency={line.currency} />}
                valueTone="ink"
                chevron={false}
              />
            ))}
            <InsetRow
              title={view.otherUse.label}
              subtitle={view.otherUse.under}
              value={view.otherUse.text}
              valueTone={view.otherUse.credit ? 'tint' : 'ink'}
              chevron={false}
              testId="other-use"
            />
          </InsetGroup>

          <InsetGroup header="Details">
            <InsetRow title="Owner" value={view.details.owner} chevron={false} />
            <InsetRow title="Updated" value={DAY_LABEL(view.details.updated)} chevron={false} />
            {view.details.notYet && <InsetRow title={view.details.notYet} chevron={false} testId="not-yet" />}
          </InsetGroup>
        </>
      )}
    </div>
  );
}
