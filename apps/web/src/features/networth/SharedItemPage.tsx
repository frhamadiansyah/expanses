import { formatMinor, isoDate } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { ArrowLeftRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { Panel, PushedTitle, RowIcon, SCREEN } from '../../ui/native';
import { BalanceCard } from '../accounts/BalanceCard';
import { itemTile } from '../accounts/shared-accounts';
import { CategoryIcon } from '../categories/CategoryIcon';
import { JointRowsGroup } from '../sharing/JointAccountRows';
import { useJointRows } from '../sharing/net-worth-queries';
import { MemberBadge } from '../workspaces/WorkspaceBadge';
import { ownerRing } from './joint-rows';
import { useHouseholdPurchases, useItemTransfers, useSharedNetWorth } from './queries';
import { heroLine, itemPage, shortDay } from './shared-item';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const DAY_LABEL = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * An item of the other's (joint-net-worth §8.3, D11, D13), drawn in the layout one's own account page has, read-only:
 * the bar with its name, the hero (its kind's circle wearing the owner's initial, whose it is, its kind and the day of
 * its figure, the balance — or what is owed — and a card's limit bar), then Recent and the last 12 months. No Spend,
 * Receive, Transfer or Edit: it is not this person's to change.
 *
 * Recent holds only what this person may see — the Household lines of its period paid from it and the transfers
 * between partners — and ONE "Rina's other use" total in place of her private lines, which never reach this phone.
 */
export function SharedItemPage() {
  const { itemId } = useParams({ from: '/net-worth/shared/$itemId' });
  const shared = useSharedNetWorth();
  const accounts = useAccounts();
  const group = shared.data?.group ?? null;
  const found = shared.data?.items.find((each) => each.itemId === itemId) ?? null;
  const purchases = useHouseholdPurchases(group && found ? group.workspaceBookId : null, found ? found.period : null);
  const transfers = useItemTransfers(group && found ? group.groupBookId : null, found?.itemId ?? null, found ? found.period : null);
  const jointRows = useJointRows(group && found?.joint ? { workspaceBookId: group.workspaceBookId, itemId: found.itemId, owner: found.owner } : null);
  // Either mode: Net worth's rows with one tax ID, Accounts' "Andi's, shared" with separate ones (itemPage, tested).
  const { item, view, back } = itemPage(shared.data, itemId, purchases.data ?? [], transfers.data ?? []);
  const owner = view?.details.owner ?? '';
  const withTransfers = view !== null && (view.transfers.length > 0 || view.otherTransfers !== null);
  const today = isoDate();
  // The item's money in reads green and its money out red, whichever side of the sheet it is on: a card owes less by money in.
  const inward = (minor: number) => (item?.kind === 'liability' ? minor < 0 : minor > 0);

  return (
    <div className={SCREEN}>
      <PushedTitle title={view?.name ?? 'Shared item'} back={back.back} backTo={back.backTo} />
      <ErrorBox error={shared.error ?? purchases.error ?? transfers.error} />
      {!view && !shared.isPending && <Empty>This item is no longer shared.</Empty>}

      {view && item && group && (
        <>
          <BalanceCard
            label={item.joint ? 'Balance · Joint account' : item.kind === 'liability' ? 'Owed' : 'Balance'}
            minor={view.balance.minor}
            currency={view.balance.currency}
            series={null}
            testId="shared-item-hero"
            corner={<ItemMark tile={itemTile(item)} name={owner} colour={ownerRing(group.members, item.owner)} />}
            caption={
              <>
                <span className="block" data-testid="shared-item-line">
                  {heroLine(owner, SUBTYPE_LABELS[item.subtype as AccountSubtype] ?? item.subtype, view.details.updated, today)}
                </span>
                {view.details.notYet && (
                  <span className="block text-[var(--ph-warn)]" data-testid="not-yet">
                    {view.details.notYet}
                  </span>
                )}
              </>
            }
          >
            {view.bar && (
              <div className="space-y-1 border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3">
                {/* From earlier · Household · other use · available: the parts of the limit, so the bar always adds up (§8.3). */}
                <div
                  role="img"
                  data-testid="shared-item-limit"
                  aria-label={`${view.bar.openingPct > 0 ? `From earlier ${view.bar.openingPct}%, ` : ''}Household ${view.bar.householdPct}%, other use ${view.bar.otherPct}%, ${formatMinor(view.bar.availableMinor, item.currency)} available`}
                  className="flex h-2 overflow-hidden rounded-full bg-[var(--ph-track)]"
                >
                  <i className="block h-full bg-[var(--ph-chevron)]" style={{ width: `${view.bar.openingPct}%` }} />
                  <i className="block h-full bg-[var(--ph-up)]" style={{ width: `${view.bar.householdPct}%` }} />
                  <i className="block h-full bg-[var(--ph-ink-3)]" style={{ width: `${view.bar.otherPct}%` }} />
                </div>
                <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                  {view.bar.openingPct > 0 && `${formatMinor(item.openingMinor, item.currency)} from earlier · `}
                  {formatMinor(view.bar.availableMinor, item.currency)} available of {formatMinor(view.bar.limitMinor, item.currency)}
                </p>
              </div>
            )}
          </BalanceCard>

          {item.joint && jointRows.data ? <JointRowsGroup rows={jointRows.data.rows} me={group.me} names={jointRows.data.names} workspaceBookId={group.workspaceBookId} /> : null}

          <Panel header="Recent" testId="shared-item-recent">
            <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
              {(item.joint ? [] : view.lines).map((line) => (
                <RecentLine
                  key={line.lineageId}
                  circle={<CategoryIcon categoryId={line.categoryId ?? null} accounts={accounts.data ?? []} />}
                  title={line.description || 'Purchase'}
                  under={`${shortDay(line.occurredOn, today)} · Household${line.pending ? ` · not yet on ${owner}'s phone` : ''}`}
                  // A purchase is money out of what it was paid from; a refund (negative) is money back in.
                  money={line.amountMinor < 0 ? `+${formatMinor(-line.amountMinor, line.currency)}` : formatMinor(line.amountMinor, line.currency)}
                  tone={line.amountMinor < 0 ? 'in' : 'out'}
                />
              ))}
              {(item.joint ? [] : view.transfers).map((line) => (
                <RecentLine
                  key={line.key}
                  circle={<CategoryIcon categoryId={null} accounts={[]} transfer />}
                  title={line.title}
                  under={line.note ? `${shortDay(line.occurredOn, today)} · ${line.note}` : shortDay(line.occurredOn, today)}
                  money={inward(line.amountMinor) ? `+${formatMinor(Math.abs(line.amountMinor), line.currency)}` : formatMinor(Math.abs(line.amountMinor), line.currency)}
                  tone={inward(line.amountMinor) ? 'in' : 'out'}
                />
              ))}
              {view.otherTransfers && (
                <RecentLine
                  testId="other-transfers"
                  circle={<Locked glyph={<ArrowLeftRight size={17} aria-hidden />} />}
                  title={view.otherTransfers.label}
                  under="this period · total only"
                  money={formatMinor(view.otherTransfers.minor, view.otherTransfers.currency)}
                  tone="ink"
                />
              )}
              <RecentLine
                testId="other-use"
                circle={<Locked glyph={<Lock size={17} aria-hidden />} />}
                title={view.otherUse.label}
                under={`this period · ${view.otherUse.under}`}
                money={view.otherUse.text}
                tone={view.otherUse.credit ? 'in' : 'out'}
              />
            </ul>
            <p className="pt-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              Household purchases paid from it{withTransfers ? ' and transfers between partners' : ''}, {DAY_LABEL(item.period.start)} to {DAY_LABEL(item.period.end)}.
            </p>
          </Panel>

          {view.chart.values.some((value) => value !== 0) && (
            <Panel header="Last 12 months">
              {/* Twelve of the month-ends it sent, as an asset's own page draws them: 24 labels do not fit a phone. */}
              <ValueChart values={view.chart.values.slice(-12)} labels={view.chart.months.slice(-12).map(MONTH_LABEL)} currency={item.currency} />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/** The item's kind in its circle, at the hero's size, with its owner's initial on the corner. */
function ItemMark({ tile: Glyph, name, colour }: { tile: ReturnType<typeof itemTile>; name: string; colour: string | null }) {
  return (
    <span className="relative inline-flex" data-testid="shared-item-mark">
      <RowIcon size={36}>
        <Glyph size={18} aria-hidden />
      </RowIcon>
      <MemberBadge name={name} colour={colour} size="hero" />
    </span>
  );
}

/** A total only: the lock says the lines behind it stay on the owner's phone. */
function Locked({ glyph }: { glyph: ReactNode }) {
  return (
    <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]">
      {glyph}
    </span>
  );
}

/**
 * One line of Recent, drawn as an account's own Recent draws a transaction (`TransactionRow`): the circle, the note
 * and its day, the amount in red going out and in green coming in. Not a link: these are read here, not changed.
 */
function RecentLine({ circle, title, under, money, tone, testId = 'shared-item-line-row' }: { circle: ReactNode; title: string; under: string; money: string; tone: 'in' | 'out' | 'ink'; testId?: string }) {
  return (
    <li data-testid={testId} className="flex items-center gap-3 py-2">
      <span className="shrink-0">{circle}</span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-slate-500">{under}</span>
      </div>
      <span className={cx('tabular shrink-0 text-sm font-semibold whitespace-nowrap', tone === 'out' && 'text-red-700', tone === 'in' && 'text-emerald-700')}>{money}</span>
    </li>
  );
}
