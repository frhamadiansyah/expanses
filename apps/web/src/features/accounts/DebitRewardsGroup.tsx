import { InsetGroup, InsetRow } from '../../ui/native';
import { useProgramByAccount } from '../cards/card-queries';

/**
 * A bank account's debit card rewards, on its settings: "Not set up" until the account has a programme, then the
 * programme's name. The row opens the account as a card (`/cards/$cardId`), where the programme is set up and its
 * earning rules kept — the way in that Wallet used to list under "Earning on a debit card?". Only a parent account:
 * a pocket spends through its account's card.
 */
export function DebitRewardsGroup({ accountId }: { accountId: string }) {
  const programs = useProgramByAccount();
  if (!programs.data) return null;
  const program = programs.data.get(accountId);
  return (
    <InsetGroup footer="A debit card earns on the account it spends from. Apply its card's terms here; the card then shows how it earns.">
      <InsetRow testId="debit-card-rewards" title="Debit card rewards" value={program ? program.name || 'Earning' : 'Not set up'} to="/cards/$cardId" params={{ cardId: accountId }} />
    </InsetGroup>
  );
}
