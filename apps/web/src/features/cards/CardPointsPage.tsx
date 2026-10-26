import { type CycleBonus, cycleFor, type EarnRule, explainCycle, formatMinor, previousCycle, type Redemption } from '@expanses/core';
import { type AccountRow, listCycleActuals, recordCycleActual } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PanelHeader, ReadOnlyRow, TextRow, toneClass } from '../../ui/native';
import { bonusProgressRows } from './BonusProgress';
import { capMeter } from './cap-meter';
import { CardScreen, type CardPage, useCardAction, useCardPage } from './card-page';
import { activeDuring } from './catalog-panel';
import { describeSuggestion, purchasesOf } from './hint-text';
import { PurchaseList, SuggestionFixes } from './PurchaseList';
import { Capsule, EARLIER, FigureRow, Line, Meter, StepperRow, SubmitRow, SUBTITLE, TextLine } from './rows';
import { refreshLedger } from './useCardLedger';
import { type CardPoints, type CycleResult, formatPoints, loadCycleResult, pointsValue, shortDate } from './useCardPoints';

const pointsRoute = getRouteApi('/cards/$cardId/points');
const purchasesRoute = getRouteApi('/cards/$cardId/points/purchases');
const checkRoute = getRouteApi('/cards/$cardId/points/check');

/** What the points page and the pages under it are called, so a way back names the page it returns to. */
const TITLE = "This statement's points";
const BACK = 'Points';

/** Whether the card can work its points out: a program with at least one rule. */
const earning = (cp: CardPoints) => !!cp.program && cp.rules.length > 0;

function CycleSummary({
  result,
  rules,
  bonuses,
  unit,
  currency,
  best,
  cardId,
}: {
  result: CycleResult;
  rules: EarnRule[];
  bonuses: CycleBonus[];
  unit: string;
  currency: string;
  best: Redemption | null;
  cardId: string;
}) {
  // Catalogue cards keep earlier terms as dated rules; only those in force during the cycle are relevant here.
  const activeRules = rules.filter((rule) => activeDuring(rule, result.cycle.start, result.cycle.end));
  const spend = result.lines.reduce((s, l) => s + Math.max(0, l.amountMinor), 0);
  const value = pointsValue(result.earn.totalPoints, best);
  const bonusRows = bonusProgressRows(bonuses, result, unit, currency);
  const hasSources = activeRules.length > 0 || bonusRows.length > 0 || result.earn.unearnedSpendMinor > 0 || result.earn.cardFeeSpendMinor > 0;
  /*
   * Two boxes: the cycle's three figures under its dates, then where they came from — each rule, each spend bonus,
   * and what earned nothing, which opens the purchases that did not earn.
   */
  return (
    <>
      <InsetGroup header={`${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`}>
        <ReadOnlyRow label="Spend" value={formatMinor(spend, currency)} />
        <ReadOnlyRow label={`Projected ${unit}`} value={formatPoints(result.earn.totalPoints)} />
        {value !== null && best && <ReadOnlyRow label="Worth about" value={formatMinor(value, best.currency)} />}
      </InsetGroup>
      {hasSources && (
        <InsetGroup header="Where they came from">
          {activeRules.map((rule) => {
            const used = result.earn.spendByRule[rule.id] ?? 0;
            const cap = rule.capSpendMinor ? capMeter(used, rule.capSpendMinor) : null;
            return (
              <FigureRow key={rule.id} title={rule.name} value={`${formatMinor(used, currency)} → ${formatPoints(result.earn.pointsByRule[rule.id] ?? 0)} ${unit}`}>
                {cap !== null && (
                  <>
                    <Meter fraction={cap.fraction} tone={cap.tone} />
                    <p className={cx('mt-[4px]', SUBTITLE)}>
                      Cap {formatMinor(rule.capSpendMinor!, currency)} · {formatMinor(Math.max(0, rule.capSpendMinor! - used), currency)} left
                    </p>
                  </>
                )}
              </FigureRow>
            );
          })}
          {bonusRows}
          {result.earn.unearnedSpendMinor > 0 && (
            <Line testId="earned-nothing">
              <Link to="/cards/$cardId/points/purchases" params={{ cardId }} search={{ filter: 'nothing' }} className="ph-focus flex w-full items-center gap-[8px] text-left">
                <span className={cx('min-w-0 flex-1 text-[14px] leading-[19px]', toneClass('warn'))}>
                  {formatMinor(result.earn.unearnedSpendMinor, currency)} earned nothing — no rule matched. Add a base rule?
                </span>
                <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
                  ›
                </span>
              </Link>
            </Line>
          )}
          {result.earn.cardFeeSpendMinor > 0 && (
            <TextLine tone="ink-3">{formatMinor(result.earn.cardFeeSpendMinor, currency)} in card fees and charges earns no points.</TextLine>
          )}
        </InsetGroup>
      )}
    </>
  );
}

/** A card with no rules works nothing out: the way to its settings, where rewards are set up. */
function NotEarning({ page }: { page: CardPage }) {
  return (
    <InsetGroup footer="Points are worked out from the card's earning rules, set in its Settings.">
      <InsetRow
        title={page.cp.program ? 'Add an earning rule' : 'Set up rewards'}
        to={page.cp.program ? '/cards/$cardId/settings/rules' : '/cards/$cardId/settings'}
        params={{ cardId: page.card.id }}
      />
    </InsetGroup>
  );
}

/**
 * This statement's points, on a page of their own: the cycle still open — its spend, its projection and what that is
 * worth, each rule with its cap and the spend bonuses — then the purchases and the statement's own figure a tap away.
 *
 * What is done with a balance — redeem, convert, set it to the issuer's figure — and what the points would transfer to
 * are the programme's, on its page, as is the catch-up for cycles from before the app.
 */
export function CardPointsPage() {
  const { cardId } = pointsRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error } = useCardAction();
  const fallback = `/cards/${cardId}` as const;
  if (!page) {
    return (
      <CardScreen title={TITLE} back="Card" fallback={fallback}>
        {gate}
      </CardScreen>
    );
  }
  const { card, cp, currency } = page;
  const program = cp.program;
  const purchases = cp.current ? purchasesOf(cp.current.lines).length : 0;
  return (
    <CardScreen title={TITLE} back={card.name} fallback={fallback}>
      <ErrorBox error={error} />
      {!earning(cp) && <NotEarning page={page} />}
      {program && cp.current && earning(cp) && <CycleSummary result={cp.current} rules={cp.rules} bonuses={cp.bonuses} unit={program.unit} currency={currency} best={cp.best} cardId={card.id} />}
      {program && earning(cp) && (cp.current || cp.previous) && (
        <InsetGroup>
          {cp.current && (
            <InsetRow
              title="Purchases"
              subtitle={`${purchases} this cycle · each with its ${program.unit}`}
              to="/cards/$cardId/points/purchases"
              params={{ cardId: card.id }}
            />
          )}
          {cp.previous && (
            <InsetRow
              title="Points the statement shows"
              subtitle={cp.crediting === 'per_transaction' ? 'Bonus points credited outside purchases' : 'Checked against what the bank gave'}
              to="/cards/$cardId/points/check"
              params={{ cardId: card.id }}
            />
          )}
        </InsetGroup>
      )}
    </CardScreen>
  );
}

/** Each purchase of this cycle or the last, with what it earned and — when the bank credits per purchase — what it gave. */
export function CardPurchasesPage() {
  const { cardId } = purchasesRoute.useParams();
  const { filter } = purchasesRoute.useSearch();
  const navigate = useNavigate();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  const fallback = `/cards/${cardId}/points` as const;
  return (
    <CardScreen title="Purchases" back={BACK} fallback={fallback}>
      {gate}
      <ErrorBox error={error} />
      {page && (earning(page.cp) ? <PurchaseList cp={page.cp} run={run} currency={page.currency} onlyNothing={filter === 'nothing'} onShowAll={() => void navigate({ to: '/cards/$cardId/points/purchases', params: { cardId }, search: {}, replace: true })} /> : <NotEarning page={page} />)}
    </CardScreen>
  );
}

/** The points a statement shows, checked against the projection: the last statement first, earlier ones on request. */
export function CardPointsCheckPage() {
  const { cardId } = checkRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const fallback = `/cards/${cardId}/points` as const;
  return (
    <CardScreen title="Points on the statement" back={BACK} fallback={fallback}>
      {gate}
      {page && (earning(page.cp) && page.cp.previous ? <StatementCheck cp={page.cp} accounts={page.all} unit={page.cp.program!.unit} currency={page.currency} today={page.today} /> : !earning(page.cp) && <NotEarning page={page} />)}
    </CardScreen>
  );
}

/**
 * Checks one statement's points against what the bank gave: the last statement to begin with, and any earlier
 * one on request, so a statement left unchecked can still be caught up. Earlier statements not checked yet are
 * listed, to jump straight to them.
 */
function StatementCheck({ cp, accounts, unit, currency, today }: { cp: CardPoints; accounts: AccountRow[]; unit: string; currency: string; today: string }) {
  const { database, ws } = useApp();
  const { error, run } = useCardAction();
  const program = cp.program!;
  const statementDay = cp.terms?.statementDay ?? 1;
  // 1 is the statement just closed; the cycle still open has no statement to check yet.
  const [back, setBack] = useState(1);
  const cycleAt = (steps: number) => {
    let cycle = cycleFor(today, program.cycleAnchor, statementDay);
    for (let i = 0; i < steps; i += 1) cycle = previousCycle(cycle, program.cycleAnchor, statementDay);
    return cycle;
  };
  const cycle = cycleAt(back);
  const result = useQuery({
    queryKey: ['statement-check', ws.workspaceId, program.id, cycle.start, cp.rules.length, cp.bonuses.length],
    queryFn: () => loadCycleResult(database, ws, cp, accounts, cycle),
  });
  const actuals = useQuery({ queryKey: ['cycle-actuals', ws.workspaceId, program.id], queryFn: () => listCycleActuals(database, ws, program.id) });
  const checked = new Set((actuals.data ?? []).map((row) => row.cycleStart));
  const unchecked = [1, 2, 3, 4, 5, 6].map(cycleAt).filter((c) => !checked.has(c.start));
  /*
   * One section for the whole check, headed by the statement it is checking, so the figure, the field, its Save and
   * the causes found are all read as one statement's check — in groups, not in a ringed card.
   */
  return (
    <section className="mb-[18px]">
      <PanelHeader title={`${cp.crediting === 'per_transaction' ? 'Bonus points credited' : 'Check against statement'}: ${shortDate(cycle.start)} – ${shortDate(cycle.end)}`} />
      <InsetGroup>
        <StepperRow
          earlier={{ label: 'Earlier statement to check', glyph: EARLIER, onClick: () => setBack((b) => b + 1) }}
          later={{ label: 'Later statement to check', onClick: () => setBack((b) => Math.max(1, b - 1)) }}
          laterDisabled={back <= 1}
        >
          Statement of {shortDate(cycle.end)}
        </StepperRow>
        {unchecked.length > 0 && (
          <Line testId="unchecked-statements" className="flex flex-wrap items-center gap-[8px]">
            <span className={SUBTITLE}>Not checked yet:</span>
            {unchecked.map((c) => (
              <Capsule
                key={c.start}
                selected={c.start === cycle.start}
                onClick={() => setBack([1, 2, 3, 4, 5, 6].find((steps) => cycleAt(steps).start === c.start) ?? 1)}
              >
                {shortDate(c.end)}
              </Capsule>
            ))}
          </Line>
        )}
      </InsetGroup>
      {result.data ? (
        <ActualForm
          key={`${cycle.start}:${result.data.actual ?? ''}`}
          result={result.data}
          unit={unit}
          currency={currency}
          crediting={cp.crediting}
          save={(actualPoints) =>
            run(async () => {
              await recordCycleActual(database, ws, { programId: program.id, cycleStart: cycle.start, actualPoints });
              // The ledger for this cycle is rebuilt now, since the card only derives the two cycles it shows.
              await refreshLedger(database, ws, program.id, [cycle], today);
            })
          }
        />
      ) : (
        <p className="pb-[18px] text-[15px] text-[var(--ph-ink-3)]">Working out this statement…</p>
      )}
      <ErrorBox error={error} />
    </section>
  );
}

function ActualForm({
  result,
  unit,
  currency,
  crediting,
  save,
}: {
  result: CycleResult;
  unit: string;
  currency: string;
  crediting: 'per_transaction' | 'per_statement';
  save: (actualPoints: number) => Promise<boolean>;
}) {
  const { run } = useCardAction();
  const [value, setValue] = useState(result.actual === null ? '' : String(result.actual));
  const perPurchase = crediting === 'per_transaction';
  const diff = result.actual === null ? null : result.actual - result.earn.totalPoints;
  // Recomputes the cycle per purchase, so only when the saved statement total or the cycle changes, not per keystroke.
  const hints = useMemo(() => (!perPurchase && result.actual !== null && result.actual !== result.earn.totalPoints ? explainCycle(result.context, result.actual) : []), [perPurchase, result]);
  const dates = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.occurredOn]));
  const descriptions = Object.fromEntries(result.lines.map((line) => [line.transactionId, line.description]));
  const estimatedBonus = Object.values(result.earn.bonusById).reduce((sum, points) => sum + points, 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(Number(value.trim().replace(',', '.')));
  };
  return (
    <>
      <form onSubmit={submit}>
        <InsetGroup>
          {perPurchase ? (
            <TextLine>
              Points the bank credited outside individual purchases, such as cycle bonuses. Estimated <span className="tabular font-medium">{formatPoints(estimatedBonus)}</span> {unit}.
            </TextLine>
          ) : (
            <TextLine>
              Projected <span className="tabular font-medium">{formatPoints(result.earn.totalPoints)}</span> {unit}.
              {diff !== null && (diff === 0 ? ' Statement matches exactly.' : ` Statement shows ${diff > 0 ? '+' : ''}${formatPoints(diff)} vs projection.`)}
            </TextLine>
          )}
          <TextRow label={perPurchase ? 'Bonus points credited' : `Actual ${unit} on statement`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required />
        </InsetGroup>
        <InsetGroup>
          <SubmitRow label="Save" />
        </InsetGroup>
      </form>
      {hints.length > 0 && (
        <InsetGroup header="Likely causes">
          {hints.map((hint, i) => (
            <Line key={i}>
              <p className="text-[14px] leading-[19px] text-[var(--ph-ink)]">{describeSuggestion(hint, unit, currency, descriptions)}</p>
              <SuggestionFixes suggestion={hint} description={hint.kind === 'mcc' ? (descriptions[hint.transactionId] ?? '') : ''} occurredOn={hint.kind === 'mcc' ? dates[hint.transactionId] : undefined} run={run} />
            </Line>
          ))}
        </InsetGroup>
      )}
      {!perPurchase && diff !== null && diff !== 0 && hints.length === 0 && (
        <p className="px-[4px] pb-[18px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">No MCC, bonus, or rounding in this card's rules explains the difference. A rule may need adjusting.</p>
      )}
    </>
  );
}
