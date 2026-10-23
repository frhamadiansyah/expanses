import { assetItemOfCode, isoDate } from '@expanses/core';
import type { TradeTemplateRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { MoveRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { cx } from '../../ui';
import { GROUP_GAP, GROUP_RADIUS, PanelHeader, ROW_PAD_X, ROW_PAD_Y, RowIcon, rowHeight, toneClass } from '../../ui/native';
import { TradeSheet } from '../networth/AssetSheets';
import { type PlanLine, planLines } from '../networth/monthly-plans';
import { PlanSheet } from '../networth/PlanSheet';
import { useAssetValues, useTemplateBuys, useTradeTemplates } from '../networth/queries';
import { type TradeDraft, typedAmount } from '../networth/trade-form';
import { ASSET_TILES } from '../ownables/catalogue-view';

/**
 * The month's regular buys, under the bills: every holding's monthly plan, set on the holding's own page. A due one
 * says so in the due tone and has Record beside it, which opens the Buy sheet with the plan's holding, amount, account
 * and goal in it and saves against the plan, so it stops being due — the units still come from the fund's or broker's
 * confirmation. One bought this month says the day and what was paid. A row opens its holding; a monthly move, which
 * has no holding, opens its plan.
 */
export function MonthlyBuys() {
  const { ws } = useApp();
  const navigate = useNavigate();
  const today = isoDate();
  const templates = useTradeTemplates();
  const bought = useTemplateBuys(today.slice(0, 7));
  const values = useAssetValues();
  const accounts = useAccounts().data ?? [];
  const [recording, setRecording] = useState<{ templateId: string; initial: Partial<TradeDraft> } | null>(null);
  const [move, setMove] = useState<TradeTemplateRow | null>(null);

  const valueOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId);
  const accountOf = (accountId: string) => accounts.find((account) => account.id === accountId);
  const currencyOf = (accountId: string) => valueOf(accountId)?.currency ?? accountOf(accountId)?.currency ?? ws.baseCurrency;
  const nameOf = (accountId: string) => valueOf(accountId)?.name ?? accountOf(accountId)?.name ?? 'Holding';
  const holdingOf = (accountId: string) => ({ accountId, name: nameOf(accountId), currency: currencyOf(accountId), byMoney: valueOf(accountId)?.mode === 'amount' });

  if (!templates.isSuccess || !bought.isSuccess || templates.data.length === 0) return null;
  const lines = planLines(templates.data, bought.data, today, { holding: nameOf, cash: (id) => accountOf(id)?.name ?? 'an account', currency: currencyOf });

  const record = (template: TradeTemplateRow) =>
    setRecording({
      templateId: template.id,
      initial: {
        kind: 'buy',
        accountId: template.accountId,
        cashAccountId: template.cashAccountId,
        gross: template.amountMinor === null ? '' : typedAmount(template.amountMinor, currencyOf(template.accountId)),
        goalId: template.goalId ?? '',
        occurredOn: today,
      },
    });
  const open = (template: TradeTemplateRow) =>
    template.kind === 'move' ? setMove(template) : void navigate({ to: '/net-worth/assets/$accountId', params: { accountId: template.accountId } });
  const glyphOf = (template: TradeTemplateRow) => {
    if (template.kind === 'move') return <MoveRight size={16} aria-hidden />;
    const Glyph = ASSET_TILES[assetItemOfCode(valueOf(template.accountId)?.coretaxCode ?? null)?.id ?? ''] ?? ASSET_TILES.fund!;
    return <Glyph size={16} aria-hidden />;
  };

  return (
    <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="monthly-buys">
      <PanelHeader title="Monthly buys" />
      <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
        {lines.map((line, index) => (
          <PlanRow key={line.template.id} line={line} glyph={glyphOf(line.template)} separator={index > 0} onOpen={() => open(line.template)} onRecord={() => record(line.template)} />
        ))}
      </div>

      {recording && (
        <TradeSheet
          title="Buy"
          holding={holdingOf(recording.initial.accountId ?? '')}
          initial={recording.initial}
          editing={null}
          templateId={recording.templateId}
          onClose={() => setRecording(null)}
        />
      )}
      {move && <PlanSheet title="Monthly move" holding={holdingOf(move.accountId)} plans={[move]} onClose={() => setMove(null)} />}
    </section>
  );
}

/**
 * One plan, drawn as a bill row is: the kind's circle, the holding and the plan's line under it, the money on the
 * right. A due plan has Record under its money in place of the chevron — under rather than beside it, so a phone's
 * row still has room for the holding's name — and the rest of the row still opens the holding.
 */
function PlanRow({ line, glyph, separator, onOpen, onRecord }: { line: PlanLine; glyph: ReactNode; separator: boolean; onOpen: () => void; onRecord: () => void }) {
  const due = line.state === 'due';
  return (
    <div data-testid="plan-row" data-state={line.state} className="relative">
      {separator && <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
      <button
        type="button"
        onClick={onOpen}
        className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <RowIcon>{glyph}</RowIcon>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{line.title}</span>
          <span data-testid="plan-status" className={cx('mt-[2px] block truncate text-[12.5px] leading-[16px]', toneClass(line.tone))}>
            {line.subtitle}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className={cx('tabular text-[15px] leading-[20px]', line.state === 'paused' ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{line.figure}</span>
          {/* The room Record takes under the money: it is a button of its own, laid over this, not inside the row's. */}
          {due && <span aria-hidden className="mt-[4px] block h-[26px]" />}
        </span>
        {!due && (
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
        )}
      </button>
      {due && (
        <button
          type="button"
          onClick={onRecord}
          aria-label={`Record ${line.title}`}
          // The pill is small; its reach is a thumb's, stretched past it without moving anything.
          className="ph-focus absolute rounded-full bg-[var(--ph-tint-panel)] px-[12px] text-[13px] leading-[26px] font-semibold text-[var(--ph-tint)] after:absolute after:-inset-x-[8px] after:-inset-y-[9px] after:content-['']"
          style={{ right: ROW_PAD_X, bottom: ROW_PAD_Y }}
        >
          Record
        </button>
      )}
    </div>
  );
}
