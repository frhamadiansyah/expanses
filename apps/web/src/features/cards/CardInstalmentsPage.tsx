import { isoDate } from '@expanses/core';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { InsetGroup } from '../../ui/native';
import { InstallmentRow, usePlanEditor } from '../loans/InstallmentList';
import { useInstallments } from '../loans/queries';
import { CardScreen, useCardPage } from './card-page';
import { TextLine } from './rows';

const route = getRouteApi('/cards/$cardId/settings/instalments');

/**
 * A card's instalment plans on a page of their own, pushed from its settings: the rows the card page's box shows, and
 * the ＋ in the corner adds a plan through the same sheet the box's Add a plan row opens. A row opens the plan's own page.
 */
export function CardInstalmentsPage() {
  const { cardId } = route.useParams();
  const { page, gate } = useCardPage(cardId);
  const plans = useInstallments(cardId);
  const editor = usePlanEditor(cardId, page?.currency ?? '');
  const navigate = useNavigate();
  const today = isoDate();
  const fallback = `/cards/${cardId}/settings` as const;
  if (!page) {
    return (
      <CardScreen title="Instalments" back="Settings" fallback={fallback}>
        {gate}
      </CardScreen>
    );
  }
  const list = plans.data ?? [];
  return (
    <CardScreen
      title="Instalments"
      back="Settings"
      fallback={fallback}
      actions={[{ key: 'add', label: 'Add a plan', glyph: <Plus size={20} aria-hidden />, run: () => editor.open('new') }]}
    >
      <div data-testid="card-instalments-page">
        <InsetGroup>
          {list.length === 0 && <TextLine tone="ink-3">None</TextLine>}
          {list.map((plan) => (
            <InstallmentRow
              key={plan.id}
              plan={plan}
              currency={page.currency}
              today={today}
              onOpen={() => void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId, planId: plan.id } })}
            />
          ))}
        </InsetGroup>
        {editor.node}
      </div>
    </CardScreen>
  );
}
