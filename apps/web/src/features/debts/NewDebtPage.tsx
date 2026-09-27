import type { DebtDirection } from '@expanses/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { SCREEN } from '../../ui/native';
import { DebtForm } from './DebtForm';
import { sideOf } from './sides';

/**
 * New receivable and New payable: adding money lent or borrowed, on a screen of its own.
 *
 * It used to open inline above the lists, which pushed the very thing you were adding to off the screen, and asked
 * which way the money went with a toggle the + already knew the answer to. Each side is its own screen now, named
 * for what it adds, with the way back to Lend & borrow at the top left. Saving lands back on the side just added to.
 */
export function NewDebtPage({ direction }: { direction: DebtDirection }) {
  const navigate = useNavigate();
  // Opened while Lend & borrow showed one person: the form starts with their name, and back returns to that person.
  const { person } = useSearch({ strict: false }) as { person?: string };
  const back = { side: sideOf(direction), ...(person ? { person } : {}) };
  return (
    <div className={SCREEN}>
      <DebtForm direction={direction} initialPerson={person} backSearch={back} onDone={() => void navigate({ to: '/net-worth/lend-borrow', search: back })} />
    </div>
  );
}
