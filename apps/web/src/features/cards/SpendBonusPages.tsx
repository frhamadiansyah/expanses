import { type FeeWaiver, formatMinor, matchesSpend, parseMajor, minorToMajorString, type SpendBonusItem, type SpendLine, timeLeftText } from '@expanses/core';
import { clearFeeWaiver, saveFeeWaiver } from '@expanses/db';
import { getRouteApi, Link } from '@tanstack/react-router';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ReadOnlyRow, TextRow } from '../../ui/native';
import { CardScreen, type CardPage, useCardPage } from './card-page';
import { rewardText } from './CardBack';
import { activeDuring } from './catalog-panel';
import { Line, Meter, SUBTITLE, TextLine } from './rows';
import { CountsRow } from './CountsRow';
import { FeeWaivedFlow, useFeeWaivedStatus, waivedLine } from './FeeWaivedSheet';
import { challengeCoversFee } from './fee-line';
import { useSpendBonuses } from './spend-bonuses';
import { expenseAncestors, formatPoints, shortDate } from './useCardPoints';

const listRoute = getRouteApi('/cards/$cardId/bonuses');
const oneRoute = getRouteApi('/cards/$cardId/bonuses/$bonusId');
const waiverRoute = getRouteApi('/cards/$cardId/settings/fee-waiver');


/** What a bonus line says under its name: which window it counts over, or the fee it saves and by when. */
function windowText(item: SpendBonusItem, currency: string): string {
  if (item.kind === 'bonus') return 'This statement';
  if (item.kind === 'challenge') return `${item.rewardMinor !== null ? `${formatMinor(item.rewardMinor, currency)} fee · ` : ''}by ${item.endsOn ? shortDate(item.endsOn) : '-'}`;
  return `Annual fee · ${item.endsOn ? shortDate(item.endsOn) : '-'}`;
}

/**
 * Fee waived for a fee challenge (was Fee refunded): reached and not yet waived, the button opens the one Fee waived
 * sheet Settings opens; once waived, the challenge says so, with what came back.
 */
function FeeWaivedButton({ page, item }: { page: CardPage; item: SpendBonusItem | undefined }) {
  const { card, cp, currency, today } = page;
  const status = useFeeWaivedStatus(card.id, today);
  const [open, setOpen] = useState(false);
  // Only a challenge kept for the fee year a waiver covers now offers it or says it was waived; any other reads as before.
  const covers = Boolean(status.data && challengeCoversFee(status.data.challengeYear, status.data.year));
  if (!item || item.kind !== 'challenge' || (!covers && !open)) return null;
  const waived = status.data?.waived ? waivedLine(status.data, currency) : null;
  return (
    <>
      {waived ? (
        <InsetGroup>
          <TextLine>
            <span data-testid="fee-waived-status" className="font-medium text-[var(--ph-up)]">
              {waived}
            </span>
          </TextLine>
        </InsetGroup>
      ) : (
        item.reached && (
          <InsetGroup>
            <InsetRow action title="Fee waived" testId="fee-waived" onClick={() => setOpen(true)} />
          </InsetGroup>
        )
      )}
      {open && <FeeWaivedFlow fee={{ cardId: card.id, currency, annualFeeMinor: cp.terms?.annualFeeMinor ?? item.rewardMinor, annualFeeOn: cp.terms?.annualFeeOn ?? null }} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function BonusList({ page }: { page: CardPage }) {
  const { card, cp, currency, today } = page;
  const { items } = useSpendBonuses(cp, page.all, today);
  const unit = cp.programme?.unit ?? cp.program?.unit ?? 'points';
  const challenge = items.find((i) => i.kind === 'challenge');
  return (
    <>
      <InsetGroup header="Spend bonuses · nearest first">
        {items.length === 0 && <TextLine tone="ink-3">No spend bonuses</TextLine>}
        {items.map((item) => (
          <Line key={item.id} testId={`bonus-row-${item.id}`}>
            <Link to="/cards/$cardId/bonuses/$bonusId" params={{ cardId: card.id, bonusId: item.id }} className="ph-focus block">
              <span className="flex items-baseline justify-between gap-2 text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">
                <span className="truncate">{item.name}</span>
                <span className="tabular shrink-0 text-[14px] text-[var(--ph-ink-3)]">{rewardText(item, unit, currency)}</span>
              </span>
              <span className={`block ${SUBTITLE}`}>{windowText(item, currency)}</span>
              <span className="my-[4px] block">
                <Meter fraction={item.fraction} label={`${item.name} progress`} />
              </span>
              <span className={`tabular block ${SUBTITLE}`}>
                {item.reached && item.kind !== 'bonus'
                  ? `${formatMinor(item.goalMinor, currency)} reached ✓`
                  : `${formatMinor(item.spentMinor, currency)} of ${formatMinor(item.goalMinor, currency)}${item.daysLeft !== null ? ` · ${timeLeftText(item.daysLeft)}` : ''}`}
              </span>
            </Link>
          </Line>
        ))}
      </InsetGroup>
      <FeeWaivedButton page={page} item={challenge} />
      {/* With a bonus on the card's back, the points are not: this is where they are one tap away. */}
      {cp.program && (
        <InsetGroup>
          <InsetRow title="This statement's points" to="/cards/$cardId/points" params={{ cardId: card.id }} />
        </InsetGroup>
      )}
    </>
  );
}

/** `/cards/$cardId/bonuses`: every spend bonus of the card, challenge and target included, nearest to its goal first. */
export function SpendBonusListPage() {
  const { cardId } = listRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  return (
    <CardScreen
      title={page?.card.name ?? 'Spend bonuses'}
      back="Card"
      fallback={`/cards/${cardId}`}
      actions={[{ key: 'add', label: 'Add a spend bonus', glyph: <Plus size={20} aria-hidden />, to: '/cards/$cardId/settings/bonuses', params: { cardId } }]}
    >
      {gate}
      {page && <BonusList page={page} />}
    </CardScreen>
  );
}

/** The purchases a spend bonus counted, newest first, five at a time until all are asked for. */
function Counted({ lines, currency }: { lines: SpendLine[]; currency: string }) {
  const [all, setAll] = useState(false);
  const rows = [...lines].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <InsetGroup header="Counted so far">
      {rows.length === 0 && <TextLine tone="ink-3">No purchases counted yet</TextLine>}
      {shown.map((line) => (
        <InsetRow key={line.entryId} title={line.description || 'Purchase'} subtitle={shortDate(line.occurredOn)} value={formatMinor(line.amountMinor, currency)} valueTone="ink" to="/transactions/$transactionId" params={{ transactionId: line.transactionId }} />
      ))}
      {!all && rows.length > 5 && <InsetRow title={<span className="text-[var(--ph-tint)]">Show all {rows.length}</span>} onClick={() => setAll(true)} />}
    </InsetGroup>
  );
}

function BonusDetail({ page, bonusId }: { page: CardPage; bonusId: string }) {
  const { card, cp, currency, today, all } = page;
  const bonuses = useSpendBonuses(cp, all, today);
  const unit = cp.programme?.unit ?? cp.program?.unit ?? 'points';
  const item = bonuses.items.find((i) => i.id === bonusId);
  if (!item) {
    return (
      <>
        <InsetGroup>
          <TextLine tone="ink-3">This spend bonus is no longer on the card.</TextLine>
        </InsetGroup>
      </>
    );
  }
  const names = (ids: string[]) => (ids.length === 0 ? 'All purchases' : ids.map((id) => all.find((a) => a.id === id)?.name ?? '?').join(', '));
  const ancestors = expenseAncestors(all);
  const bonus = item.kind === 'bonus' ? cp.bonuses.find((b) => b.id === item.id) : undefined;
  const counted =
    item.kind === 'bonus' && bonus && cp.current
      ? cp.current.lines.filter((l) => activeDuring(bonus, cp.current!.cycle.end, cp.current!.cycle.end) && matchesSpend(bonus.match, l, ancestors, currency))
      : bonuses.waiver
        ? bonuses.waiverLines.filter(
            (l) => matchesSpend({ categoryIds: bonuses.waiver!.categoryIds }, l, ancestors, currency) && l.occurredOn >= (item.endsOn ? windowStart(bonuses.waiver!, item.endsOn) : '') && l.occurredOn <= (item.endsOn ?? '9999'),
          )
        : [];
  return (
    <>
      <InsetGroup>
        <Line testId="bonus-hero">
          <div className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]">{card.name}</div>
          <div data-testid="bonus-spent" className="tabular text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
            {formatMinor(item.spentMinor, currency)}
          </div>
          <div className={`tabular ${SUBTITLE}`}>
            of {formatMinor(item.goalMinor, currency)} · {item.reached ? 'reached' : `${formatMinor(item.remainingMinor, currency)} to go`}
          </div>
          <div className="my-[6px]">
            <Meter fraction={item.fraction} label={`${item.name} progress`} />
          </div>
          <div className={SUBTITLE}>
            {item.daysLeft !== null ? timeLeftText(item.daysLeft) : ''}
            {item.endsOn ? ` · ends ${shortDate(item.endsOn)}` : ''}
          </div>
        </Line>
      </InsetGroup>
      <FeeWaivedButton page={page} item={item} />
      <InsetGroup header="Terms">
        <ReadOnlyRow label="Reward" value={rewardText(item, unit, currency)} />
        {item.kind === 'bonus' && bonus && <ReadOnlyRow label="Counts" value={names(bonus.match.categoryIds ?? [])} />}
        {item.kind === 'bonus' && <ReadOnlyRow label="Window" value="Statement cycle" />}
        {item.kind !== 'bonus' && bonuses.waiver && <ReadOnlyRow label="Counts" value={names(bonuses.waiver.categoryIds)} />}
        {item.kind === 'challenge' && bonuses.waiver && (
          <>
            <ReadOnlyRow label="Counted from" value={bonuses.waiver.countedFrom ? shortDate(bonuses.waiver.countedFrom) : '-'} />
            <ReadOnlyRow label="Spend by" value={bonuses.waiver.spendBy ? shortDate(bonuses.waiver.spendBy) : '-'} />
          </>
        )}
        {item.kind === 'target' && <ReadOnlyRow label="Window" value="12 months before the fee date" />}
        {item.kind !== 'bonus' && <InsetRow title="Change or remove" to="/cards/$cardId/settings/fee-waiver" params={{ cardId: card.id }} />}
        {item.kind === 'bonus' && <InsetRow title="Edit in Settings" to="/cards/$cardId/settings/bonuses" params={{ cardId: card.id }} />}
      </InsetGroup>
      <Counted lines={counted} currency={currency} />
    </>
  );
}

/** The first day of an automatic waiver's window, from its end. Challenges are bounded by their own days. */
function windowStart(waiver: FeeWaiver, endsOn: string): string {
  if (waiver.kind === 'challenge') return waiver.countedFrom ?? '';
  const d = new Date(`${endsOn}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `/cards/$cardId/bonuses/$bonusId`: one spend bonus: spent so far, its terms and the purchases that counted. */
export function SpendBonusPage() {
  const { cardId, bonusId } = oneRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  return (
    <CardScreen title="Spend bonus" back="Spend bonuses" fallback={`/cards/${cardId}/bonuses`}>
      {gate}
      {page && <BonusDetail page={page} bonusId={bonusId} />}
    </CardScreen>
  );
}

type Kind = 'none' | 'automatic' | 'challenge';

function WaiverForm({ page }: { page: CardPage }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const { card, currency, today, all } = page;
  const existing = useSpendBonuses(page.cp, all, today).waiver;
  const [kind, setKind] = useState<Kind | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [by, setBy] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const goBack = () => window.history.back();

  const shownKind: Kind = kind ?? existing?.kind ?? 'none';
  const shownAmount = amount ?? (existing ? minorToMajorString(existing.amountMinor, currency) : '');
  const shownFrom = from ?? existing?.countedFrom ?? today;
  const shownBy = by ?? existing?.spendBy ?? '';
  const shownCategories = categories ?? existing?.categoryIds ?? [];

  async function save() {
    setError(null);
    try {
      if (shownKind === 'none') await clearFeeWaiver(database, ws, card.id);
      else {
        const waiver: FeeWaiver = {
          kind: shownKind,
          amountMinor: parseMajor(shownAmount, currency),
          countedFrom: shownKind === 'challenge' ? shownFrom : null,
          spendBy: shownKind === 'challenge' ? shownBy || null : null,
          categoryIds: shownCategories,
        };
        await saveFeeWaiver(database, ws, card.id, waiver, today);
      }
      await invalidate();
      goBack();
    } catch (e) {
      setError(e);
    }
  }

  const choice = (value: Kind, title: string, hint: string) => (
    <InsetRow
      key={value}
      testId={`waiver-${value}`}
      plain
      title={title}
      subtitle={hint}
      value={shownKind === value ? <Check size={17} aria-label="Chosen" className="text-[var(--ph-tint)]" /> : undefined}
      onClick={() => setKind(value)}
    />
  );
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup header="How is the fee waived?">
        {choice('none', 'None', 'The fee is charged and stays charged')}
        {choice('automatic', 'Spend a yearly amount', 'The bank waives the fee itself when spending reaches the amount')}
        {choice('challenge', 'Spending challenge', 'The bank set a target and a date, usually after a call')}
      </InsetGroup>
      {shownKind !== 'none' && (
        <InsetGroup header={shownKind === 'automatic' ? 'Target' : 'From the bank'}>
          <TextRow label="Spend" prefix={currency} value={shownAmount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" />
          {shownKind === 'automatic' && <ReadOnlyRow label="Within" value="12 months before the fee date" />}
          {shownKind === 'challenge' && <TextRow label="Counted from" type="date" value={shownFrom} onChange={(e) => setFrom(e.target.value)} />}
          {shownKind === 'challenge' && <TextRow label="Spend by" type="date" value={shownBy} onChange={(e) => setBy(e.target.value)} />}
          <CountsRow accounts={all} value={shownCategories} onChange={setCategories} />
        </InsetGroup>
      )}
      <InsetGroup>
        <InsetRow action title="Save" testId="waiver-save" onClick={() => void save()} />
      </InsetGroup>
    </>
  );
}

/** `/cards/$cardId/settings/fee-waiver`: how the annual fee is waived, if it is: nothing, a yearly target, or a bank's challenge. */
export function FeeWaiverPage() {
  const { cardId } = waiverRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  return (
    <CardScreen title="Fee waiver" back="Settings" fallback={`/cards/${cardId}/settings`}>
      {gate}
      {page && <WaiverForm page={page} />}
    </CardScreen>
  );
}
