import { isoDate } from '@expanses/core';
import {
  deleteConversion,
  getProgramme,
  listProgrammes,
  listRedemptionOptions,
  programBalance,
  programmeEarners,
  programmeHistory,
  programmePartners,
  refreshProgramme,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeftRight, Gift, Scale, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { ActionButtons, InsetGroup, InsetRow, Panel, PushedTitle, type RoundAction, SCREEN } from '../../ui/native';
import { formatPoints } from './format-points';
import { balanceText, expiryNote, historyLine } from './programme-text';
import { BalanceSheet, ConvertSheet, ProgrammeSettingsSheet, RedeemSheet } from './ProgrammeSheets';
import { RowWithActions } from './rows';

type SheetName = 'redeem' | 'convert' | 'balance' | 'settings';

/**
 * A points programme on its own page: Livin' Poin, KrisFlyer, Bonvoy. The balance leads, with what of it is about to
 * expire; under it the three things done with a balance — redeem it, convert it into another programme, set it to the
 * figure the issuer's app shows. Then the cards earning into it, each opening its card, and its history: each card's
 * earning per statement, redemptions, conversions in and out with both sides, corrections and expiries.
 *
 * Opening it brings its ledger up to date first, as a card's page does: each earning card works out its open cycle and
 * the one before, and points past their date are written off.
 */
export function ProgrammePage() {
  const { database, ws } = useApp();
  const { programmeId } = useParams({ strict: false }) as { programmeId: string };
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = useQuery({
    queryKey: ['programme', ws.workspaceId, programmeId, today],
    queryFn: async () => {
      const programme = await getProgramme(database, ws, programmeId);
      if (!programme) return null;
      await refreshProgramme(database, ws, programmeId, today);
      const earners = (await programmeEarners(database, ws)).get(programmeId) ?? [];
      const options = (await Promise.all(earners.map((earner) => listRedemptionOptions(database, ws, earner.programId)))).flat();
      return {
        programme,
        earners,
        options,
        balance: await programBalance(database, ws, programmeId, today),
        history: await programmeHistory(database, ws, programmeId),
        partners: await programmePartners(database, ws, programmeId),
        others: (await listProgrammes(database, ws)).filter((other) => other.id !== programmeId),
      };
    },
  });

  if (data.isSuccess && data.data === null) return <Empty>Programme not found.</Empty>;
  if (!data.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { programme, earners, options, balance, history, partners, others } = data.data;
  const unit = programme.unit;
  const note = expiryNote(balance);

  const actions: RoundAction[] = [
    { key: 'redeem', label: 'Redeem', glyph: <Gift size={20} aria-hidden />, run: () => setSheet('redeem') },
    { key: 'convert', label: 'Convert', glyph: <ArrowLeftRight size={20} aria-hidden />, run: () => setSheet('convert') },
    { key: 'balance', label: 'Balance', glyph: <Scale size={20} aria-hidden />, run: () => setSheet('balance') },
  ];

  const removeConversion = async (conversionId: string, title: string) => {
    if (!window.confirm(`Remove the conversion ${title}? Both balances go back to how they were.`)) return;
    setError(null);
    try {
      await deleteConversion(database, ws, conversionId);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  };

  // This statement's points for each card: its earning in the cycle still open today.
  const thisStatement = (programId: string) =>
    history
      .filter((row) => row.kind === 'earn' && row.earnedById === programId && row.on >= today)
      .sort((a, b) => a.on.localeCompare(b.on))[0];

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={programme.name}
        back="Cards"
        backTo="/cards"
        actions={[{ key: 'settings', label: 'Programme settings', glyph: <Settings size={20} aria-hidden />, run: () => setSheet('settings') }]}
      />
      <ErrorBox error={error} />

      <Panel testId="programme-hero" className="space-y-[6px]">
        <div className="flex items-center gap-[10px]">
          <p className="flex-1 text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Balance</p>
          {note && (
            <span data-testid="programme-expiry" className="rounded-full bg-[var(--ph-warn-panel)] px-[8px] py-[2px] text-[12px] leading-[16px] font-semibold text-[var(--ph-warn-ink)]">
              {note}
            </span>
          )}
        </div>
        <p data-testid="programme-balance" className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
          {balanceText(balance.total, unit)}
        </p>
        <p className="tabular text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
          {formatPoints(balance.postedTotal)} posted · {formatPoints(balance.projectedTotal)} estimated
        </p>
      </Panel>

      <ActionButtons actions={actions} />

      {earners.length > 0 && (
        <InsetGroup header="Earned by" footer="Each card's rules, caps and statement checks stay with the card.">
          {earners.map((earner) => {
            const current = thisStatement(earner.programId);
            return (
              <InsetRow
                key={earner.programId}
                title={earner.cardName}
                subtitle={current ? `This statement${current.estimated ? ', estimated' : ''}` : 'Nothing this statement yet'}
                value={current ? `+${formatPoints(current.quantity)}` : undefined}
                to="/cards/$cardId"
                params={{ cardId: earner.cardAccountId }}
                search={{ tab: 'points' }}
              />
            );
          })}
        </InsetGroup>
      )}

      <div data-testid="programme-history">
        <InsetGroup header="History" footer={earners.length === 0 ? `No card earns into ${programme.name}: its ${unit} arrive by conversion, or by setting the balance to the one its own app shows.` : undefined}>
          {history.length === 0 ? (
            <InsetRow title={<span className="text-[var(--ph-ink-3)]">Nothing yet</span>} />
          ) : (
            history.map((row) => {
              const line = historyLine(row, unit);
              const value = <span className={cx('tabular', row.quantity < 0 ? 'text-[var(--ph-ink-2)]' : 'text-[var(--ph-ink)]')}>{line.value}</span>;
              return row.conversionId ? (
                <RowWithActions
                  key={row.key}
                  testId="programme-history-row"
                  title={line.title}
                  subtitle={line.subtitle}
                  value={value}
                  actions={[{ label: `Remove conversion ${line.title}`, glyph: <Trash2 size={17} aria-hidden />, destructive: true, onClick: () => void removeConversion(row.conversionId!, line.title) }]}
                />
              ) : (
                <InsetRow key={row.key} testId="programme-history-row" title={line.title} subtitle={line.subtitle} value={value} />
              );
            })
          )}
        </InsetGroup>
      </div>

      {sheet === 'redeem' && <RedeemSheet programme={programme} options={options} today={today} onClose={() => setSheet(null)} />}
      {sheet === 'convert' && <ConvertSheet programme={programme} others={others} partners={partners} today={today} onClose={() => setSheet(null)} />}
      {sheet === 'balance' && <BalanceSheet programme={programme} today={today} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && (
        <ProgrammeSettingsSheet
          programme={programme}
          earning={earners.length}
          onClose={() => setSheet(null)}
          onArchived={() => void navigate({ to: '/cards' })}
        />
      )}
    </div>
  );
}
