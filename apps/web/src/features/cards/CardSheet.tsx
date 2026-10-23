import type { CardRow } from '@expanses/db';
import { CreditCard } from 'lucide-react';
import { ChoiceSheet } from '../transactions/ChoiceSheet';
import { plasticName, primaryFirst } from './statement-groups';

/**
 * The cards of one account to pick from — "Primary ···· 1467", "Supplementary ···· 8820" — as the statement heads
 * their sections, so the card picked here is the section the purchases move into. Whose card it is, when recorded,
 * is the quiet caption.
 */
export function CardSheet({
  title,
  cards,
  value = '',
  footer,
  onPick,
  onClose,
}: {
  title: string;
  cards: readonly CardRow[];
  /** The card already named on every purchase being set, if they share one. */
  value?: string;
  footer?: string;
  onPick: (cardId: string) => void;
  onClose: () => void;
}) {
  return (
    <ChoiceSheet
      title={title}
      value={value}
      groups={[
        {
          choices: primaryFirst(cards).map((card) => {
            const name = plasticName(card);
            return { value: card.id, label: `${name.title} ${name.digits}`, caption: card.holderName ?? undefined, glyph: <CreditCard size={16} /> };
          }),
        },
      ]}
      footer={footer}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
