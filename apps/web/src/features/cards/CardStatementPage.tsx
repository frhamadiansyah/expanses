import { getRouteApi } from '@tanstack/react-router';
import { InsetGroup, InsetRow } from '../../ui/native';
import { CardScreen, statementPointsOf, useCardPage } from './card-page';
import { StatementPanel } from './StatementPanel';

const route = getRouteApi('/cards/$cardId/statement');

/**
 * A card's statement, on a page of its own: what the Activity tab held, whole — the statement stepper, the check from
 * screenshots, the search over every statement, the band of paid and still to pay, and every line with its fixes.
 * The card's Statement button and its Recent's See all open it.
 */
export function CardStatementPage() {
  const { cardId } = route.useParams();
  const { page, gate } = useCardPage(cardId);
  const fallback = `/cards/${cardId}` as const;
  if (!page) {
    return (
      <CardScreen title="Statement" back="Card" fallback={fallback}>
        {gate}
      </CardScreen>
    );
  }
  const { card, cp, all, plastic, today } = page;
  return (
    <CardScreen title="Statement" back={card.name} fallback={fallback}>
      {cp.terms ? (
        <StatementPanel
          card={card}
          statementDay={cp.terms.statementDay}
          accounts={all}
          plastic={plastic}
          today={today}
          points={cp.program && cp.rules.length > 0 ? statementPointsOf(cp) : undefined}
          unit={cp.program?.unit}
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
