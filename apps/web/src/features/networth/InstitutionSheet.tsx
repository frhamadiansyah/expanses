import { fundPlaceMatches } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup } from '../../ui/native';
import { SuggestRow } from '../ownables/CashAccountForm';

const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]';
const OPTION = 'ph-focus-inset flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left';
const HEADING = 'mb-1.5 px-4 text-[12px] leading-[16px] font-medium tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';

/** What a fund's or bond's Institution is: a broker's cash account it links to, a place typed by name, or nothing. */
export type InstitutionChoice = { accountId: string } | { name: string } | null;

/**
 * A fund's or bond's Institution, picked (owner, 25 Nov 2026): the brokers' cash accounts — and only those, never a bank,
 * savings or wallet account, so a fund never reads as linked to a bank account — then Other place…, a name typed for a
 * place with no account here (a fund app, a bank's counter), and None. Picking an account links the holding to it: its
 * Buy and Sell start there, and the tax report names it.
 */
export function InstitutionSheet({
  brokers,
  linkedId,
  bankOf,
  typedName,
  places,
  local,
  onPick,
  onClose,
}: {
  /** The brokers' cash accounts (subtype `fund`), open and top-level. */
  brokers: readonly AccountRow[];
  /** The account the holding is linked to now, if any. */
  linkedId: string | null;
  /** A broker cash account's own Nama institusi (its RDN bank), drawn small under its name to tell two apart. */
  bankOf: (accountId: string) => string | null;
  /** The name typed now, when it is a place with no account. */
  typedName: string;
  /** Names already used for places, offered as Other place is typed. */
  places: readonly string[];
  /** A rupiah workspace: Other place also offers the fund apps, brokers and banks that sell funds here. */
  local: boolean;
  onPick: (choice: InstitutionChoice) => void;
  onClose: () => void;
}) {
  const otherNow = !linkedId && typedName !== '';
  const [typing, setTyping] = useState<string | null>(null);
  const brokerNames = new Set(brokers.map((broker) => broker.name.trim().toLowerCase()));
  // A broker with an account here is picked from the list, not typed: the strip offers the other places.
  const offers = (typed: string) => fundPlaceMatches(typed, places.filter((name) => !brokerNames.has(name.trim().toLowerCase())), local).filter((place) => !brokerNames.has(place.name.trim().toLowerCase()));

  if (typing !== null) {
    const name = typing.trim();
    return (
      <Sheet
        grouped
        title="Other place"
        onClose={onClose}
        back={{ label: 'Institution', run: () => setTyping(null) }}
        confirm={{ label: 'Save place', disabled: name === '', run: () => onPick({ name }) }}
      >
        <InsetGroup footer="A place with no account here, such as a fund app or a bank's counter. Kept as the name the tax report files.">
          <SuggestRow label="Name" stripLabel="Institutions" value={typing} onChange={setTyping} placeholder="Place name" offers={offers} />
        </InsetGroup>
      </Sheet>
    );
  }

  return (
    <Sheet grouped tall title="Institution" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <section aria-label="Brokers">
          <h3 className={HEADING}>Brokers</h3>
          <div className={LIST}>
            {brokers.length === 0 ? (
              <p className="px-4 py-3 text-[15px] text-[var(--ph-ink-3)]">No broker accounts yet</p>
            ) : (
              brokers.map((broker) => (
                <button
                  key={broker.id}
                  type="button"
                  aria-pressed={broker.id === linkedId}
                  onClick={() => (broker.id === linkedId ? onClose() : onPick({ accountId: broker.id }))}
                  className={OPTION}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] text-[var(--ph-ink)]">{broker.name}</span>
                    {bankOf(broker.id) && <span className="truncate text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{bankOf(broker.id)}</span>}
                  </span>
                  {broker.id === linkedId && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}
                </button>
              ))
            )}
          </div>
        </section>
        <div className={LIST}>
          <button type="button" aria-pressed={otherNow} onClick={() => setTyping(otherNow ? typedName : '')} className={OPTION}>
            <span className="flex-1 text-[15px] text-[var(--ph-ink)]">Other place…</span>
            {otherNow && <span className="max-w-[50%] truncate text-[15px] text-[var(--ph-ink-3)]">{typedName}</span>}
          </button>
          <button type="button" aria-pressed={!linkedId && typedName === ''} onClick={() => onPick(null)} className={OPTION}>
            <span className="flex-1 text-[15px] text-[var(--ph-ink)]">None</span>
            {!linkedId && typedName === '' && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
