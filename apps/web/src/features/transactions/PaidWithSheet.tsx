import { Check } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, InsetRow, SearchPill } from '../../ui/native';

/** One thing the list can be narrowed to: an account, or one card on an account carrying two. */
export interface PaidChoice {
  /** `acct:<id>` or `card:<id>`, as `ListFilters.paid` reads it. */
  value: string;
  /** The account's name — or, for one card of two, whose card it is. */
  name: string;
  /** The digits it is known by: a card's own, a bank account's number, a wallet's phone. None for cash, or an account with two cards. */
  digits: string | null;
  /** A word more under the name: the account a card is on, or "all cards" for the account they share. */
  detail?: string;
}

/**
 * Whether a choice answers what was typed: its name, the account it is on, or its digits — "bca", "48". A few digits
 * are enough, since four are what a statement or an alert names a card by. Nothing typed keeps every choice.
 */
export function matchesPaidChoice(choice: PaidChoice, typed: string): boolean {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return true;
  return [choice.name, choice.detail ?? '', choice.digits ?? ''].some((text) => text.toLowerCase().includes(wanted));
}

/**
 * A phone's Paid with filter: a sheet with a search at its top, and every account under it led by its digits — the
 * way a statement names it — with the account's name beneath. "All" comes first and takes the filter off, which is
 * also how the list is cleared: the icon that opened the sheet carries no ✕ of its own. The wide screen's popover
 * (`ChipMenu`) offers the same list; a phone's list is long enough to want a sheet's height and its keyboard.
 */
export function PaidWithSheet({ choices, value, onPick, onClose }: { choices: readonly PaidChoice[]; value: string; onPick: (value: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const shown = choices.filter((choice) => matchesPaidChoice(choice, typed));
  const pick = (next: string) => {
    onPick(next);
    onClose();
  };
  const tick = <Check size={18} aria-hidden />;
  return (
    <Sheet grouped tall expanded title="Payment method" onClose={onClose}>
      <div className="mb-3">
        <SearchPill value={typed} onChange={setTyped} onClose={() => setTyped('')} placeholder="Name or last digits" label="Find an account" />
      </div>
      <InsetGroup>
        {!typed.trim() && <InsetRow title="All" value={value === '' ? tick : undefined} chevron={false} onClick={() => pick('')} />}
        {shown.map((choice) => (
          <InsetRow
            key={choice.value}
            // Named in full for a screen reader and a test: the digits and the name, whichever leads on screen.
            label={choice.digits ? `${choice.name} ···· ${choice.digits}` : choice.name}
            title={<span className={choice.digits ? 'tabular' : undefined}>{choice.digits ?? choice.name}</span>}
            subtitle={choice.digits ? [choice.name, choice.detail].filter(Boolean).join(' · ') : choice.detail}
            value={choice.value === value ? tick : undefined}
            chevron={false}
            onClick={() => pick(choice.value)}
          />
        ))}
        {shown.length === 0 && <p className="px-4 py-3 text-sm text-[var(--ph-ink-3)]">Nothing matches.</p>}
      </InsetGroup>
    </Sheet>
  );
}
