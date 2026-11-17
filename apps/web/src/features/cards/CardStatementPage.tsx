import { formatMinor } from '@expanses/core';
import { listStatementChecks } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ClipboardCheck, Search } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { InsetGroup, InsetRow, SearchPill } from '../../ui/native';
import type { CornerAction } from '../../ui/native';
import { CardScreen, statementPointsOf, useCardPage } from './card-page';
import { StatementPanel } from './StatementPanel';
import { cycleBack } from './statement-dates';

const shortDay = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const route = getRouteApi('/cards/$cardId/statement');

/**
 * A card's statement, on a page of its own: what the Activity tab held, whole — the statement stepper, the check from
 * screenshots, the search over every statement, the band of paid and still to pay, and every line with its fixes.
 * The card's Statement button and its Recent's See all open it.
 */
export function CardStatementPage() {
  const { cardId } = route.useParams();
  const navigate = useNavigate();
  const { page, gate } = useCardPage(cardId);
  const { database, ws } = useApp();
  // The statement on screen and the search live here, because the title bar's two icons use them: the check goes to the
  // statement shown, and the search field takes the bar.
  // Which statement is on screen is in the address, so Back from the Pay it opens lands on the same one.
  const back = route.useSearch().back ?? 0;
  const setBack = (next: number | ((was: number) => number)) => {
    const value = typeof next === 'function' ? next(back) : next;
    void navigate({ to: '/cards/$cardId/statement', params: { cardId }, search: value > 0 ? { back: value } : {}, replace: true });
  };
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  // The statements checked from screenshots, so a closed statement that was checked says so on the check icon.
  const checks = useQuery({ queryKey: ['statement-checks', ws.workspaceId, cardId], queryFn: () => listStatementChecks(database, ws, cardId) });
  const fallback = `/cards/${cardId}` as const;
  if (!page) {
    return (
      <CardScreen title="Statement" back="Card" fallback={fallback} backTo={{ to: '/cards/$cardId', cardId }}>
        {gate}
      </CardScreen>
    );
  }
  const { card, cp, all, plastic, today } = page;
  const actions: CornerAction[] = [];
  if (cp.terms) {
    const cycle = cycleBack(today, cp.terms.statementDay, back);
    const checked = cycle.end < today ? checks.data?.find((c) => c.periodStart === cycle.start && c.periodEnd === cycle.end) : undefined;
    const money = (minor: number) => formatMinor(minor, card.currency ?? ws.baseCurrency);
    const outcome = checked ? (checked.status === 'reconciled' ? 'reconciled' : checked.status === 'differs' ? `differs by ${money(Math.abs(checked.differenceMinor))}` : 'no summary yet') : '';
    actions.push(
      {
        key: 'check',
        label: checked ? `Check statement, checked ${shortDay(checked.checkedAt.slice(0, 10))}, ${outcome}` : 'Check statement',
        testId: 'check-statement',
        glyph: (
          <span className="relative flex">
            <ClipboardCheck size={20} aria-hidden />
            {checked && <span aria-hidden data-testid="check-statement-dot" className="absolute -top-[3px] -right-[4px] h-[7px] w-[7px] rounded-full bg-[var(--ph-ink)] ring-2 ring-[var(--ph-corner)]" />}
          </span>
        ),
        to: '/cards/$cardId/check',
        params: { cardId: card.id },
        search: { start: cycle.start, end: cycle.end },
      },
      { key: 'search', label: 'Search statements', glyph: <Search size={20} aria-hidden />, pressed: searching, run: () => setSearching((was) => !was) },
    );
  }
  return (
    <CardScreen
      title="Statement"
      back={card.name}
      fallback={fallback}
      backTo={{ to: '/cards/$cardId', cardId }}
      actions={actions}
      field={
        searching ? (
          <SearchPill
            value={query}
            onChange={setQuery}
            onClose={() => {
              setQuery('');
              setSearching(false);
            }}
            placeholder="Description, category, digits or amount"
            label="Search statements"
          />
        ) : undefined
      }
    >
      {cp.terms ? (
        <StatementPanel
          card={card}
          statementDay={cp.terms.statementDay}
          accounts={all}
          plastic={plastic}
          today={today}
          points={cp.program && cp.rules.length > 0 ? statementPointsOf(cp) : undefined}
          unit={cp.program?.unit}
          back={back}
          onBack={setBack}
          query={query}
          onQuery={setQuery}
          onOpened={() => setSearching(false)}
        />
      ) : (
        // A statement is cut on the billing date, so a card without one has none to show yet.
        <InsetGroup footer="Statements are cut on the billing date, so they show once it is set.">
          <InsetRow title="Add the billing date" to="/cards/$cardId/settings" params={{ cardId: card.id }} />
        </InsetGroup>
      )}
    </CardScreen>
  );
}
