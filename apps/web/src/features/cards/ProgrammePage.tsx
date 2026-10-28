import { bestRedemption, formatMinor, isoDate, pointsWorth } from '@expanses/core';
import {
  deleteConversion,
  getProgramme,
  getProgrammeValuePerPoint,
  listCards,
  listProgrammes,
  listProgrammeTiers,
  listRedemptionOptions,
  programBalance,
  programmeEarners,
  programmeHistory,
  programmePartners,
  refreshProgramme,
  toRedemption,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useBack } from '../../app/BackHeader';
import { ArrowLeftRight, Hourglass, Settings, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { ActionButtons, InsetGroup, InsetRow, Panel, PushedTitle, type RoundAction, SCREEN } from '../../ui/native';
import { formatPoints } from './format-points';
import { balanceText, expiryNote, historyLine } from './programme-text';
import { BalanceSheet, ConvertSheet, ProgrammeSettingsSheet } from './ProgrammeSheets';
import { RowWithActions } from './rows';

type SheetName = 'convert' | 'balance' | 'settings';

/**
 * A points programme on its own page: Livin' Poin, KrisFlyer, Bonvoy. The balance leads, with what of it is about to
 * expire, and what it is worth when a value per point is known (or the card's best redemption says); under it the
 * four round buttons — Convert (into another programme, or spent on a voucher, cash, a flight), Adjust (to the figure
 * the issuer's app shows), Expiry (how points die, and what dies when) and Settings. Then its history: each card's earning per
 * statement, redemptions, conversions in and out with both sides, corrections and expiries.
 *
 * The value per point, the cards earning here, the catch-up per card for cycles from before the app, and archiving are
 * in the programme's settings; what this statement's points would convert to is in the Convert sheet. A statement's
 * row in History opens that card's statement points page.
 *
 * Opening it brings its ledger up to date first, as a card's page does: each earning card works out its open cycle and
 * the one before, and points past their date are written off.
 */
export function ProgrammePage() {
  const { database, ws } = useApp();
  const { programmeId } = useParams({ strict: false }) as { programmeId: string };
  const navigate = useNavigate();
  const goBack = useBack('/cards/points');
  const invalidate = useInvalidateAll();
  const today = isoDate();
  // Back from a card's Catch up page comes here with the settings open again.
  const reopen = (useSearch({ strict: false }) as { settings?: true }).settings === true;
  const [sheet, setSheet] = useState<SheetName | null>(reopen ? 'settings' : null);
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
        valuePerPoint: await getProgrammeValuePerPoint(database, ws, programmeId),
        balance: await programBalance(database, ws, programmeId, today),
        history: await programmeHistory(database, ws, programmeId),
        partners: await programmePartners(database, ws, programmeId),
        others: (await listProgrammes(database, ws)).filter((other) => other.id !== programmeId),
        // Which of its membership cards Points draws it as (0088), for its Settings.
        tier: (await listProgrammeTiers(database, ws))[programmeId] ?? null,
        // The last digits of each earning card, for the grey line under it in Settings.
        digits: await cardDigits(database, ws),
      };
    },
  });

  if (data.isSuccess && data.data === null) return <Empty>Programme not found.</Empty>;
  if (!data.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { programme, earners, options, valuePerPoint, balance, history, partners, others, digits, tier } = data.data;
  const unit = programme.unit;
  const note = expiryNote(balance);

  // What the balance is worth: the programme's value per point, else the best redemption of the cards earning here.
  const worth = pointsWorth(balance.total, valuePerPoint, bestRedemption(options.map(toRedemption)), ws.baseCurrency);

  const actions: RoundAction[] = [
    { key: 'convert', label: 'Convert', glyph: <ArrowLeftRight size={20} aria-hidden />, run: () => setSheet('convert') },
    { key: 'balance', label: 'Adjust', glyph: <SlidersHorizontal size={20} aria-hidden />, run: () => setSheet('balance') },
    { key: 'expiry', label: 'Expiry', glyph: <Hourglass size={20} aria-hidden />, to: '/cards/points/$programmeId/expiry', params: { programmeId } },
    { key: 'settings', label: 'Settings', glyph: <Settings size={20} aria-hidden />, run: () => setSheet('settings') },
  ];

  // A statement's earning opens that card's statement points page.
  const statementOf = (row: { kind: string; earnedById: string | null }) => (row.kind === 'earn' && row.earnedById ? earners.find((earner) => earner.programId === row.earnedById) : undefined);

  const closeSheet = () => {
    setSheet(null);
    if (reopen) void navigate({ to: '/cards/points/$programmeId', params: { programmeId }, search: {}, replace: true });
  };

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

  const statementPoints = earners.reduce((sum, earner) => sum + (thisStatement(earner.programId)?.quantity ?? 0), 0);

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={programme.name}
        back="Points"
        onBack={goBack}
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
        <p data-testid="programme-provenance" className="tabular text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
          {worth ? `≈ ${formatMinor(worth.valueMinor, worth.currency)} · ` : ''}
          {formatPoints(balance.postedTotal)} posted · {formatPoints(balance.projectedTotal)} estimated
        </p>
      </Panel>

      <ActionButtons actions={actions} />

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
                <InsetRow
                  key={row.key}
                  testId="programme-history-row"
                  title={line.title}
                  subtitle={line.subtitle}
                  value={value}
                  {...(statementOf(row) ? { to: '/cards/$cardId/points' as const, params: { cardId: statementOf(row)!.cardAccountId }, chevron: true } : {})}
                />
              );
            })
          )}
        </InsetGroup>
      </div>

      {sheet === 'convert' && <ConvertSheet programme={programme} others={others} partners={partners} statementPoints={statementPoints} today={today} onClose={closeSheet} />}
      {sheet === 'balance' && <BalanceSheet programme={programme} today={today} onClose={closeSheet} />}
      {sheet === 'settings' && (
        <ProgrammeSettingsSheet
          programme={programme}
          tier={tier}
          earners={earners.map((earner) => ({ ...earner, digits: digits[earner.cardAccountId] ?? null }))}
          valuePerPoint={valuePerPoint}
          onClose={closeSheet}
          onArchived={() => void navigate({ to: '/wallet' })}
        />
      )}
    </div>
  );
}

/** The last four digits of each card account's first card that has them, by account. */
async function cardDigits(database: Parameters<typeof listCards>[0], ws: Parameters<typeof listCards>[1]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const card of await listCards(database, ws)) if (card.last4 && !out[card.accountId]) out[card.accountId] = card.last4;
  return out;
}
