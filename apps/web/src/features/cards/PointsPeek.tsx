import { formatMinor, formatValuePerPoint } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { cx } from '../../ui';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { BIG_FACE, type DeskProgramme, ProgrammeFace } from './programme-face';
import { formatPoints } from './format-points';
import { PER_UNIT, type PointsUnit } from './points-desk-model';
import { statementPointsOf, thisStatement, useProgramme } from './programme-data';
import { balanceText, historyLine } from './programme-text';
import { BalanceSheet, ConvertSheet, ProgrammeSettingsSheet } from './ProgrammeSheets';

/** How many history lines the peek lists; the programme's page has them all. */
const RECENT_SHOWN = 4;
const H3 = 'border-t border-[var(--ph-hair)] px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';
const LINE = 'flex w-full items-center gap-[8px] px-[14px] py-[5px] text-left text-[13px] text-[var(--ph-ink)]';

type SheetName = 'convert' | 'redeem' | 'balance' | 'settings';

/**
 * A programme in Mac Points' side peek: its card drawn big, its balance as its page says it (with what it is worth, at
 * its value per point when one is set, and what is posted and estimated), Convert, Adjust, Redeem and Edit — the
 * programme page's own sheets, opened here — and Open, its page; then the cards earning into it with this statement's
 * points, its latest history (a statement's line opens that card's points, as on its page) and what expires next.
 */
export function PointsPeek({
  row,
  today,
  top,
  first,
  last,
  onStep,
  onClose,
  onOpen,
}: {
  row: DeskProgramme;
  today: string;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const { ws } = useApp();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  // The programme page's own figures, for its sheets — the programmes to convert to, the partners, the earning cards'
  // digits — read as they stand: the page has just brought the ledger up to date.
  const full = useProgramme(row.id, today, true).data ?? null;
  const { programme, earners, balance, history, worth, valuePerPoint, expiry, note } = row;
  const unit = programme.unit;
  const per = PER_UNIT[unit as PointsUnit];
  const worthLine = worth
    ? `≈ ${formatMinor(worth.valueMinor, worth.currency)}${valuePerPoint !== null && per ? ` at ${formatValuePerPoint(valuePerPoint, ws.baseCurrency)} a ${per}` : ''}`
    : null;
  const recent = history.slice(0, RECENT_SHOWN);
  const statementOf = (line: { kind: string; earnedById: string | null }) => (line.kind === 'earn' && line.earnedById ? earners.find((earner) => earner.programId === line.earnedById) : undefined);

  return (
    <SidePeek top={top} label="Programme details" testId="points-peek" titleTestId="peek-title" noun="programme" title={programme.name} first={first} last={last} onStep={onStep} onClose={onClose}>
      <div className="px-[12px] pt-[4px] pb-[12px]" data-testid="peek-face">
        <ProgrammeFace card={row.card} width={BIG_FACE} />
      </div>
      <div className="px-[14px] pb-[10px]">
        <div className="flex items-center gap-[8px]">
          <div data-testid="peek-balance" className="min-w-0 flex-1 text-[22px] font-semibold tabular-nums text-[var(--ph-ink)]">
            {balanceText(balance.total, unit)}
          </div>
          {note && (
            <span data-testid="peek-expiry-note" className="shrink-0 rounded-full bg-[var(--ph-warn-panel)] px-[8px] py-[2px] text-[11.5px] font-semibold text-[var(--ph-warn-ink)]">
              {note}
            </span>
          )}
        </div>
        {worthLine && (
          <div data-testid="peek-worth" className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">
            {worthLine}
          </div>
        )}
        <div data-testid="peek-provenance" className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">
          {formatPoints(balance.postedTotal)} posted · {formatPoints(balance.projectedTotal)} estimated
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-[14px] pb-[12px]">
        {(['convert', 'balance', 'redeem', 'settings'] as const).map((name) => (
          <button key={name} type="button" className={PEEK_BUTTON} disabled={!full} onClick={() => setSheet(name)}>
            {name === 'convert' ? 'Convert' : name === 'balance' ? 'Adjust' : name === 'redeem' ? 'Redeem' : 'Edit'}
          </button>
        ))}
        <button type="button" className={PEEK_BUTTON} onClick={onOpen}>
          Open
        </button>
      </div>

      <h3 className={H3}>Earned with</h3>
      <ul aria-label="Earned with" data-testid="peek-earners" className="pb-[6px]">
        {earners.length === 0 && <li className="px-[14px] py-[5px] text-[12.5px] text-[var(--ph-ink-3)]">No card earns here: its {unit} arrive by conversion or a balance set by hand.</li>}
        {earners.map((earner) => {
          const open = thisStatement(history, earner.programId, today);
          return (
            <li key={earner.programId}>
              <button
                type="button"
                data-testid="peek-earner"
                onClick={() => void navigate({ to: '/cards/$cardId', params: { cardId: earner.cardAccountId } })}
                className={cx(LINE, 'hover:bg-[var(--ph-fill)]')}
              >
                <span className="min-w-0 flex-1 break-words">{earner.cardName}</span>
                <span className="shrink-0 text-[var(--ph-ink-3)] tabular-nums">{open ? `+${formatPoints(open.quantity)} this statement` : ''}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className={H3}>Recent</h3>
      <ul aria-label="Recent" data-testid="peek-recent">
        {recent.length === 0 && <li className="px-[14px] py-[5px] text-[12.5px] text-[var(--ph-ink-3)]">Nothing yet.</li>}
        {recent.map((line) => {
          const text = historyLine(line, unit);
          const card = statementOf(line);
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block break-words">{text.title}</span>
                <span className="block text-[11.5px] text-[var(--ph-ink-3)]">{text.subtitle}</span>
              </span>
              <span className={cx('shrink-0 tabular-nums', line.quantity > 0 && line.kind === 'earn' ? 'text-[var(--ph-up)]' : line.quantity < 0 ? 'text-[var(--ph-ink-2)]' : undefined)}>{text.value}</span>
            </>
          );
          return (
            <li key={line.key}>
              {card ? (
                <button
                  type="button"
                  data-testid="peek-recent-row"
                  onClick={() => void navigate({ to: '/cards/$cardId/points', params: { cardId: card.cardAccountId } })}
                  className={cx(LINE, 'hover:bg-[var(--ph-fill)]')}
                >
                  {body}
                </button>
              ) : (
                <div data-testid="peek-recent-row" className={LINE}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onOpen} className="flex items-center justify-between px-[14px] py-[6px] text-[13px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]">
        All history
        <ChevronRight size={14} aria-hidden />
      </button>

      <button
        type="button"
        data-testid="peek-expire"
        onClick={() => void navigate({ to: '/cards/points/$programmeId/expiry', params: { programmeId: row.id } })}
        className={cx(LINE, 'mb-3 border-t border-[var(--ph-hair)] py-[8px] hover:bg-[var(--ph-fill)]')}
      >
        <span className="flex-1">Expire</span>
        <span className={cx('shrink-0 tabular-nums', expiry?.soon ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]')}>
          {expiry ? expiry.text : programme.expiryPolicy === 'none' ? 'Never' : 'Nothing dated yet'}
        </span>
        <ChevronRight size={14} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
      </button>

      {full && sheet === 'convert' && (
        <ConvertSheet programme={full.programme} others={full.others} partners={full.partners} statementPoints={statementPointsOf(full.history, full.earners, today)} today={today} onClose={() => setSheet(null)} />
      )}
      {full && sheet === 'redeem' && (
        <ConvertSheet
          redeemOnly
          programme={full.programme}
          others={full.others}
          partners={full.partners}
          statementPoints={statementPointsOf(full.history, full.earners, today)}
          today={today}
          onClose={() => setSheet(null)}
        />
      )}
      {full && sheet === 'balance' && <BalanceSheet programme={full.programme} today={today} onClose={() => setSheet(null)} />}
      {full && sheet === 'settings' && (
        <ProgrammeSettingsSheet
          programme={full.programme}
          tier={full.tier}
          earners={full.earners.map((earner) => ({ ...earner, digits: full.digits[earner.cardAccountId] ?? null }))}
          valuePerPoint={full.valuePerPoint}
          onClose={() => setSheet(null)}
          onOpenCard={(programId) => void navigate({ to: '/cards/points/$programmeId/card/$programId', params: { programmeId: row.id, programId } })}
          onArchived={onClose}
        />
      )}
    </SidePeek>
  );
}
