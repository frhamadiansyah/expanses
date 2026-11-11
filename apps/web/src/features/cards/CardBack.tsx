import { formatMinor, type SpendBonusItem, timeLeftText } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { ProgressRing } from '../../ui/native';
import { formatPoints } from './useCardPoints';

/** What a bonus pays, as the app words it: points of the programme's unit, or the fee a waiver saves. */
export function rewardText(item: SpendBonusItem, unit: string, currency: string): string {
  if (item.kind === 'bonus') return `+${formatPoints(item.rewardPoints ?? 0)} ${unit}`;
  return item.rewardMinor !== null ? formatMinor(item.rewardMinor, currency) : 'Fee waived';
}

/** The line under a bonus: what is left and how long, or what was reached. */
export function standingText(item: SpendBonusItem, currency: string): string {
  if (item.reached) return item.kind === 'bonus' ? 'Top tier reached' : `${formatMinor(item.goalMinor, currency)} reached`;
  return [`${formatMinor(item.remainingMinor, currency)} to go`, item.daysLeft !== null ? timeLeftText(item.daysLeft) : null].filter(Boolean).join(' · ');
}

/**
 * The lower part of a card's back, under the limit bar and a thin rule: the nearest spend bonus with its ring (a tap
 * opens the card's list of them), or, with no bonus, this statement's points as a pair of lines (a tap opens them).
 */
export function BackSlot({
  cardId,
  items,
  unit,
  currency,
  points,
}: {
  cardId: string;
  items: SpendBonusItem[];
  unit: string;
  currency: string;
  /** Null when the card earns nothing; the pair of lines is then not drawn. */
  points: { total: number; posted: number; estimated: number } | null;
}) {
  const top = items[0];
  const rule = 'mt-2 border-t-[0.5px] border-[var(--ph-hair)] pt-2';
  if (top) {
    return (
      <Link to="/cards/$cardId/bonuses" params={{ cardId }} data-testid="back-bonus" className={`ph-focus ${rule} flex items-center gap-[10px]`}>
        <ProgressRing fraction={top.fraction} reached={top.reached} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2 text-[15px] leading-[19px] text-[var(--ph-ink)]">
            <b className="truncate font-semibold">{top.name}</b>
            <span className="tabular shrink-0">{rewardText(top, unit, currency)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-2 text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
            <span className="tabular truncate">{standingText(top, currency)}</span>
            {items.length > 1 && <span className="shrink-0">+ {items.length - 1} more ›</span>}
          </span>
        </span>
      </Link>
    );
  }
  if (!points) {
    return (
      <Link to="/cards/$cardId/settings" params={{ cardId }} data-testid="back-points" className={`ph-focus ${rule} block text-[13px] leading-[18px] text-[var(--ph-ink-3)]`}>
        Rewards are not set up for this card.
      </Link>
    );
  }
  return (
    <Link to="/cards/$cardId/points" params={{ cardId }} data-testid="back-points" className={`ph-focus ${rule} block text-[13px] leading-[19px] text-[var(--ph-ink-2)]`}>
      <span className="flex justify-between gap-2">
        <span>Points this statement</span>
        <span className="tabular text-[var(--ph-ink)]" data-testid="tile-points-balance">
          {formatPoints(points.total)} {unit}
        </span>
      </span>
      <span className="flex justify-between gap-2">
        <span>Posted · estimated</span>
        <span className="tabular" data-testid="tile-this-cycle">
          {formatPoints(points.posted)} · {formatPoints(points.estimated)}
        </span>
      </span>
    </Link>
  );
}
