import { formatMinor, isoDate } from '@expanses/core';
import type { AccountSubtype } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { ArrowLeftRight, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useAccounts } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, Panel, PushedTitle, RowIcon, SCREEN } from '../../ui/native';
import { BalanceCard } from '../accounts/BalanceCard';
import { itemTile } from '../accounts/shared-accounts';
import { CategoryIcon } from '../categories/CategoryIcon';
import { JointRowsGroup } from '../sharing/JointAccountRows';
import { useJointRows } from '../sharing/net-worth-queries';
import { ownerRing } from './joint-rows';
import { useHouseholdPurchases, useItemTransfers, useJointSheet, useOwnerRings, useSharedNetWorth } from './queries';
import { heroLine, itemPage, pocketAccountView, type PocketAccountView, shortDay } from './shared-item';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const DAY_LABEL = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * An item of the other's (joint-net-worth §8.3, D11, D13), drawn in the layout one's own account page has, read-only:
 * the bar with its name, the hero (its kind's circle ringed in the owner's colour, whose it is, its kind and the day of
 * its figure, the balance — or what is owed — and a card's limit bar), then Recent and the last 12 months. No Spend,
 * Receive, Transfer or Edit: it is not this person's to change.
 *
 * Recent holds only what this person may see — the Household lines of its period paid from it and the transfers
 * between partners — and ONE "Rina's other use" total in place of her private lines, which never reach this phone.
 */
export function SharedItemPage() {
  const { itemId } = useParams({ from: '/net-worth/shared/$itemId' });
  const shared = useSharedNetWorth();
  const owners = useOwnerRings();
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
  // The partner's account with pockets (`pocketOf`): its id is no item, but the account its pockets name.
  const { ws } = useApp();
  const joint = useJointSheet();
  const pocketed = found ? null : pocketAccountView(shared.data, itemId, joint.data?.ratesToBase ?? {}, ws.baseCurrency);
  if (pocketed)
    return (
      <PocketAccountPage view={pocketed} back={back} ring={owners ? ownerRing(owners.rings, pocketed.owner) : null} baseCurrency={ws.baseCurrency} today={today} />
    );

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
            corner={<ItemMark tile={itemTile(item)} ring={owners ? ownerRing(owners.rings, item.owner) : null} />}
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
            {/* A card with no limit set has nothing to divide: no bar, rather than "−Rp 200.000 available of Rp 0". */}
            {view.bar && view.bar.limitMinor > 0 && (
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
                tone={item.otherUseMinor === 0 ? 'ink' : view.otherUse.credit ? 'in' : 'out'}
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

/**
 * The partner's account with pockets, read-only (owner, 13 Nov: one row on both phones): its pockets' total in the
 * base currency, whose it is, and each pocket in its own currency, opening the pocket's own page.
 */
function PocketAccountPage({ view, back, ring, baseCurrency, today }: { view: PocketAccountView; back: { back: string; backTo: '/net-worth' | '/wallet' }; ring: string | null; baseCurrency: string; today: string }) {
  const updated = view.pockets.map((pocket) => pocket.asOf).sort().at(-1) ?? today;
  return (
    <div className={SCREEN}>
      <PushedTitle title={view.name} back={back.back} backTo={back.backTo} />
      {view.totalMinor !== null ? (
        <BalanceCard
          label="Balance"
          minor={view.totalMinor}
          currency={baseCurrency}
          approximate={view.converted}
          series={null}
          testId="shared-item-hero"
          corner={<ItemMark tile={itemTile({ kind: 'asset', subtype: view.subtype })} ring={ring} />}
          caption={
            <span className="block" data-testid="shared-item-line">
              {heroLine(view.ownerName, SUBTYPE_LABELS[view.subtype as AccountSubtype] ?? view.subtype, updated, today)}
            </span>
          }
        />
      ) : (
        <Panel testId="shared-item-hero">
          <p data-testid="shared-item-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">
            No {view.missing.join(', ')} rate yet, so the pockets cannot be added up.
          </p>
        </Panel>
      )}
      <InsetGroup header="Pockets">
        {view.pockets.map((pocket) => (
          <InsetRow
            key={pocket.itemId}
            title={pocket.currency}
            value={formatMinor(pocket.balanceMinor, pocket.currency)}
            valueTone="ink"
            testId={`shared-pocket-${pocket.itemId}`}
            label={`${pocket.name}, ${formatMinor(pocket.balanceMinor, pocket.currency)}`}
            to="/net-worth/shared/$itemId"
            params={{ itemId: pocket.itemId }}
          />
        ))}
      </InsetGroup>
    </div>
  );
}

/** The item's kind in its circle, at the hero's size, ringed in its owner's colour as its row is. */
function ItemMark({ tile: Glyph, ring }: { tile: ReturnType<typeof itemTile>; ring: string | null }) {
  return (
    <span className="inline-flex" data-testid="shared-item-mark">
      <RowIcon size={36} ring={ring ?? undefined}>
        <Glyph size={18} aria-hidden />
      </RowIcon>
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
