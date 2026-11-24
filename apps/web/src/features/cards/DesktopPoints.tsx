import { bestRedemption, formatMinor, isoDate, pointsWorth } from '@expanses/core';
import {
  listProgrammes,
  listProgrammeSummaries,
  listProgrammeValues,
  listRedemptionOptions,
  programmeExpiry,
  programmeHistory,
  refreshProgramme,
  toRedemption,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { cx, ErrorBox } from '../../ui';
import { useBoxWidth } from '../networth/DeskNetWorthChart';
import { useCardIdentities, useProgrammeTiers } from './card-queries';
import { formatPoints } from './format-points';
import { earnedByMonth, type EarnedMonth, expiringRows, expiringSoon, nextExpiry, pointsFaceRef, pointsLine, type PointsUnit, shortCount, tierLabel, UNIT_LABELS, worthBox } from './points-desk-model';
import { PointsPeek } from './PointsPeek';
import { type DeskProgramme, ProgrammeFace, SMALL_FACE } from './programme-face';
import { balanceText, earnersLine, expiryNote } from './programme-text';
import { AddProgrammeSheet } from './ProgrammeSheets';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { Award, Coins, Hourglass, TrendingUp } from 'lucide-react';
import { Card, DeskBar, DeskTitle, PILL, PILL_BLUE, StatTile, Tag, tileMoney } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { PEEK_ROOM } from '../../ui/native/panel-frame';

const TH = 'border-b border-[var(--mk-line)] px-[10px] pt-[2px] pb-[8px] text-left text-[12px] font-semibold whitespace-nowrap text-[var(--mk-ink-3)]';
const ROW = 'mx-[20px] flex items-baseline gap-3 border-t border-[var(--mk-line)] py-[8px] text-[13.5px] text-[var(--mk-ink)]';

/**
 * Points on a wide screen (Mac Points, owner 2026-11-17, option A): a title bar with Which card? and ＋ Add programme;
 * three boxes — what the programmes are worth (at each one's value per point, by unit), what the cards earned each month,
 * and what expires next — over every programme in one table, each with a small card before its name: its membership
 * card at its tier, as the iPhone draws it, or — the Mac's own — its bank's drawn card for a bank's programme no
 * membership card is drawn for (`pointsFaceRef`). A click opens the programme's side peek (the card big, its balance,
 * Convert, Adjust, Redeem, Edit, the cards earning into it, its recent history and expiry), a double-click or Open its
 * page. Every figure is the phone's own: each ledger is brought up to date first, as the phone's Points page does.
 */
export function DesktopPoints() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const today = isoDate();
  const base = ws.baseCurrency;
  const [adding, setAdding] = useState(false);
  const data = useQuery({
    queryKey: ['programmes-desk', ws.workspaceId, today],
    queryFn: async () => {
      for (const programme of await listProgrammes(database, ws)) await refreshProgramme(database, ws, programme.id, today);
      const values = await listProgrammeValues(database, ws);
      return Promise.all(
        (await listProgrammeSummaries(database, ws, today)).map(async (summary) => ({
          ...summary,
          valuePerPoint: values[summary.programme.id] ?? null,
          options: (await Promise.all(summary.earners.map((earner) => listRedemptionOptions(database, ws, earner.programId)))).flat(),
          lots: (await programmeExpiry(database, ws, summary.programme.id, today)).lots,
          history: await programmeHistory(database, ws, summary.programme.id),
        })),
      );
    },
  });
  const tiers = useProgrammeTiers().data ?? {};
  const identities = useCardIdentities().data ?? {};

  const rows: DeskProgramme[] = (data.data ?? []).map(({ programme, earners, balance, valuePerPoint, options, lots, history }) => {
    const note = expiryNote(balance);
    const earning = earnersLine(earners);
    const figure = balanceText(balance.total, programme.unit);
    const tier = tiers[programme.id] ?? null;
    return {
      id: programme.id,
      programme,
      earners,
      balance,
      history,
      valuePerPoint,
      worth: pointsWorth(balance.total, valuePerPoint, bestRedemption(options.map(toRedemption)), base),
      expiry: nextExpiry(lots, note, programme.unit),
      note,
      tier,
      card: {
        key: programme.id,
        issuer: null,
        name: programme.name,
        last4: null,
        // The phone's chip of words, for the plain face.
        kind: note ? `${earning} · ${note}` : earning,
        face: pointsFaceRef({
          name: programme.name,
          tier,
          banks: [...earners.map((earner) => identities[earner.cardAccountId]?.issuer), ...earners.map((earner) => earner.cardName)],
        }),
        figure,
        figureLabel: '',
        to: '/cards/points/$programmeId',
        params: { programmeId: programme.id },
        label: programme.name,
      },
    };
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const order = rows.map((row) => row.id);

  // ── The side peek ─────────────────────────────────────────────────────────────────────────────────────────────────
  const [peekId, setPeekId] = useState<string | null>(null);
  const peeked = peekId !== null ? byId.get(peekId) : undefined;
  const peeking = peeked !== undefined;
  const step = (by: -1 | 1) => {
    if (!peekId) return;
    const at = order.indexOf(peekId);
    const next = at < 0 ? undefined : order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  // The page makes room for the peek as it opens, which can move the boxes under one another: the row picked is brought
  // back into view. A double-click whose second click lands off the moved row is still the row's (`usePeekDoubleClick`).
  useEffect(() => {
    if (!peekId) return;
    document.querySelector('[data-points-row][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [peekId]);
  useEffect(() => {
    if (!peeking) return;
    const place = () => setPeekTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [peeking]);
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peekId) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') setPeekId(null);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  /** The programme's own page: today's, with its history, settings and expiry. */
  const open = (id: string) => {
    window.scrollTo(0, 0);
    void navigate({ to: '/cards/points/$programmeId', params: { programmeId: id } });
  };
  const onRow = (id: string) => (event: MouseEvent) => {
    event.preventDefault();
    setPeekId(id);
  };
  const doubleClick = usePeekDoubleClick(open);

  const worth = worthBox(
    rows.map((row) => ({ unit: row.programme.unit as PointsUnit, worth: row.worth })),
    base,
  );
  const earned = earnedByMonth(
    rows.flatMap((row) => row.history),
    today,
  );
  const thisMonth = earned.at(-1)?.quantity ?? 0;
  const expiring = expiringRows(rows.map((row) => ({ id: row.id, name: row.programme.name, unit: row.programme.unit, expiry: row.expiry })));
  const soon = expiringSoon(rows.map((row) => ({ id: row.id, name: row.programme.name, expiry: row.expiry })));
  const unvalued = worth.unvalued > 0 ? `${worth.unvalued === 1 ? '1 programme' : `${worth.unvalued} programmes`} with no value per point` : null;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="points-page" data-desk="true" {...doubleClick}>
      <DeskBar crumb="Points" barRef={bar}>
        <Link to="/recommend" className={PILL}>
          Which card?
        </Link>
        <button type="button" className={PILL_BLUE} onClick={() => setAdding(true)}>
          <span aria-hidden>＋</span>Add programme
        </button>
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Points" line={data.isSuccess ? pointsLine(rows.length, worth, (minor) => tileMoney(minor, base)) : undefined} />

      {/* The peek makes room on the whole page, so it covers no figure; the boxes go by the room they have. */}
      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && PEEK_ROOM)}>
        <ErrorBox error={data.error} />
        {rows.length > 0 && (
          // Three across down to the peek-open page (1280 wide); the kit's TileRow stacks them below 700.
          <div className="grid grid-cols-1 gap-[16px] @min-[520px]:grid-cols-3" data-testid="points-tiles">
            <StatTile
              icon={Coins}
              colour="gold"
              testId="points-worth-tile"
              valueTestId="points-worth-total"
              value={worth.units.length > 0 ? formatMinor(worth.totalMinor, base) : '—'}
              label={
                <>
                  Worth
                  {unvalued && <span data-testid={macV2 ? undefined : 'points-worth-unvalued'}> · {unvalued}</span>}
                </>
              }
            />
            <StatTile icon={TrendingUp} colour="green" testId="points-earned-month" value={formatPoints(thisMonth)} label="Earned this month · all programmes" />
            <StatTile
              icon={Hourglass}
              colour="orange"
              testId="points-expiring-tile"
              badge={soon.count > 0 ? <Tag tone="orange">{soon.count === 1 ? '1 programme' : `${soon.count} programmes`}</Tag> : undefined}
              value={soon.first ? soon.first.expiry.text : 'None'}
              label={soon.first ? `Expiring soon · ${soon.first.name}` : 'Expiring soon'}
              onClick={soon.first ? () => setPeekId(soon.first!.id) : undefined}
            />
          </div>
        )}

        {/* v2: what the Worth tile adds up, by unit; what the cards earned each month; every expiry to come. */}
        {macV2 && rows.length > 0 && (
          <div className="grid grid-cols-1 items-stretch gap-[16px] @min-[560px]:grid-cols-2 @min-[900px]:grid-cols-3">
            <Card title="Worth" icon={Coins} note="at each programme’s value per point" testId="points-worth">
              <div className="pb-[10px]">
                {worth.units.map((unit) => (
                  <div key={unit.unit} data-testid={`points-worth-${unit.unit}`} className={ROW}>
                    <span className="min-w-0 flex-1 truncate">{unit.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatMinor(unit.minor, base)}</span>
                  </div>
                ))}
                {unvalued && (
                  <div data-testid="points-worth-unvalued" className={cx(ROW, 'text-[var(--mk-ink-2)]')}>
                    <span className="min-w-0 flex-1">{unvalued}</span>
                    <span className="shrink-0">—</span>
                  </div>
                )}
              </div>
            </Card>
            {/* Two cards a row in a narrower page (the peek open at 1280): Earned goes under them, the width of both. */}
            <Card
              title="Earned"
              icon={TrendingUp}
              note="each month, all programmes"
              testId="points-earned"
              className="@min-[560px]:order-last @min-[560px]:col-span-2 @min-[900px]:order-none @min-[900px]:col-span-1"
            >
              <EarnedBars months={earned} />
            </Card>
            <Card title="Expiring soon" icon={Hourglass} testId="points-expiring">
              <div className="pb-[10px]">
                {expiring.length === 0 && <div className={cx(ROW, 'text-[var(--mk-ink-2)]')}>Nothing has a date to expire</div>}
                {expiring.map((row) => (
                  <button key={row.id} type="button" data-testid="points-expiring-row" onClick={() => setPeekId(row.id)} className={cx(ROW, 'w-full text-left hover:bg-[var(--mk-pill)]')}>
                    <span className="min-w-[96px] flex-1 break-words">{row.name}</span>
                    <span className={cx('max-w-[62%] text-right tabular-nums', row.expiry.soon ? 'text-[var(--mk-t-orange)]' : 'text-[var(--mk-ink-2)]')}>{row.expiry.text}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        )}

        <Card title="Programmes" icon={Award} note={rows.length > 0 ? 'click a programme to see it' : undefined} testId="points-programmes" className="overflow-clip">
          {data.isSuccess && rows.length === 0 && (
            <p className="px-[20px] pt-1 pb-4 text-[13px] text-[var(--mk-ink-2)]">
              No programmes yet. A card set up with rewards earns into a programme of its own; an airline or hotel programme filled by conversions is added with Add programme.
            </p>
          )}
          {rows.length > 0 && <ProgrammeTable rows={rows} peekId={peekId} onRow={onRow} onOpen={open} />}
        </Card>
      </div>

      {peeked && (
        <PointsPeek
          key={peeked.id}
          row={peeked}
          today={today}
          top={peekTop}
          first={order.indexOf(peeked.id) <= 0}
          last={order.indexOf(peeked.id) === order.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
          onOpen={() => open(peeked.id)}
        />
      )}
      {adding && <AddProgrammeSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Every programme, one row each: the small card and name, unit, balance, worth, tier, what expires next, who earns into it. */
function ProgrammeTable({ rows, peekId, onRow, onOpen }: { rows: readonly DeskProgramme[]; peekId: string | null; onRow: (id: string) => (event: MouseEvent) => void; onOpen: (id: string) => void }) {
  return (
    <table className="mb-[8px] w-full border-collapse text-[13.5px]" data-testid="points-table">
      <thead>
        <tr>
          <th className={cx(TH, 'pl-[20px]')}>Programme</th>
          <th className={cx(TH, 'hidden @min-[860px]:table-cell')}>Unit</th>
          <th className={cx(TH, 'text-right')}>Balance</th>
          <th className={cx(TH, 'text-right')}>Worth</th>
          <th className={cx(TH, 'hidden @min-[860px]:table-cell')}>Tier</th>
          <th className={cx(TH, 'pr-[20px] @min-[860px]:pr-[10px]')}>Expiring next</th>
          <th className={cx(TH, 'hidden pr-[20px] @min-[860px]:table-cell')}>Earned with</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const on = peekId === row.id;
          const grey = on ? 'text-white/85' : 'text-[var(--mk-ink-2)]';
          const tier = tierLabel(row.programme.name, row.tier);
          const unit = UNIT_LABELS[row.programme.unit as PointsUnit] ?? row.programme.unit;
          return (
            <tr
              key={row.id}
              data-points-row
              data-peek-row={row.id}
              data-testid="points-row"
              data-face={row.card.face?.key}
              aria-selected={on}
              onClick={onRow(row.id)}
              onDoubleClick={() => onOpen(row.id)}
              className={cx('cursor-default scroll-mt-[64px] scroll-mb-[16px]', on ? 'bg-[var(--mk-blue)] text-white' : 'hover:bg-[var(--mk-pill)]', index > 0 && !on && 'border-t border-[var(--mk-line)]')}
            >
              <td className="py-[7px] pr-[10px] pl-[20px]">
                <span className="flex min-w-0 items-center gap-[10px]">
                  <ProgrammeFace card={row.card} width={SMALL_FACE} selected={on} />
                  <Link
                    to="/cards/points/$programmeId"
                    params={{ programmeId: row.id }}
                    draggable={false}
                    aria-label={[row.programme.name, balanceText(row.balance.total, row.programme.unit), earnersLine(row.earners), row.note].filter(Boolean).join(', ')}
                    onClick={onRow(row.id)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onOpen(row.id);
                    }}
                    className="min-w-0 font-medium break-words"
                  >
                    {row.programme.name}
                    {/* Under 860px the Tier and Earned with columns fold under the name, so no column has to wrap. */}
                    <span className={cx('block text-[11.5px] font-normal @min-[860px]:hidden', grey)}>{[tier, earnersLine(row.earners)].filter(Boolean).join(' · ')}</span>
                  </Link>
                </span>
              </td>
              <td className={cx('hidden px-[10px] py-[7px] @min-[860px]:table-cell', grey)}>{unit}</td>
              <td data-testid="points-row-balance" className="px-[10px] py-[7px] text-right font-semibold whitespace-nowrap tabular-nums">
                {formatPoints(row.balance.total)}
                {/* Under 860px the Unit column folds into the figure, so the count still says what it counts. */}
                <span className={cx('font-normal @min-[860px]:hidden', grey)}> {row.programme.unit}</span>
              </td>
              <td data-testid="points-row-worth" className={cx('px-[10px] py-[7px] text-right whitespace-nowrap tabular-nums', !row.worth && grey)}>
                {row.worth ? formatMinor(row.worth.valueMinor, row.worth.currency) : '—'}
              </td>
              <td className={cx('hidden px-[10px] py-[7px] @min-[860px]:table-cell', grey)}>{tier ?? '—'}</td>
              <td data-testid="points-row-expiry" className={cx('py-[7px] pr-[20px] pl-[10px] tabular-nums @min-[860px]:pr-[10px]', row.expiry?.soon ? (on ? 'text-white' : 'text-[var(--mk-t-orange)]') : grey)}>
                {row.expiry?.text ?? '—'}
              </td>
              <td className={cx('hidden py-[7px] pr-[20px] pl-[10px] @min-[860px]:table-cell', grey)}>{earnersLine(row.earners)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The cards' earning each month as bars, this month's lighter (its statements are still open), each with its figure. */
function EarnedBars({ months }: { months: readonly EarnedMonth[] }) {
  const [box, measured] = useBoxWidth<HTMLDivElement>();
  const top = Math.max(1, ...months.map((month) => month.quantity));
  // Drawn at the box's own width, so a box the width of two (the peek open) spreads its months rather than scaling them.
  const width = Math.max(180, measured);
  const slot = width / months.length;
  const barW = Math.min(28, slot - 12);
  const chart = 74;
  return (
    <div ref={box} className="mx-[20px] pt-[4px] pb-[12px]">
      <svg viewBox={`0 0 ${width} 112`} width={width} height={112} className="block" role="img" aria-label={months.map((month) => `${month.label} ${formatPoints(month.quantity)}`).join(', ')} data-testid="points-earned-bars">
        {months.map((month, index) => {
          const h = month.quantity > 0 ? Math.max(2, (month.quantity / top) * chart) : 0;
          const x = index * slot + (slot - barW) / 2;
          const y = 16 + chart - h;
          return (
            <g key={month.month}>
              {h > 0 && <rect x={x} y={y} width={barW} height={h} rx={3} fill="var(--mac-accent)" opacity={month.current ? 0.55 : 1} />}
              <text x={x + barW / 2} y={y - 4} fontSize={9.5} textAnchor="middle" fill="var(--mk-ink)">
                {month.quantity > 0 ? shortCount(month.quantity) : ''}
              </text>
              <text x={x + barW / 2} y={16 + chart + 16} fontSize={10} textAnchor="middle" fill="var(--mk-ink-3)">
                {month.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

