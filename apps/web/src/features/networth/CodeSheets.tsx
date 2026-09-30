import { hartaLabel } from '@expanses/core';
import { Check } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, TextRow } from '../../ui/native';
import { choiceForCode, codeChoices } from '../ownables/catalogue-view';

const HEADING = 'mb-1.5 px-4 text-[12px] leading-[16px] font-medium tracking-[0.04em] text-[var(--ph-ink-3)] uppercase';
const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]';
const OPTION = 'ph-focus-inset flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left';

/**
 * Changing what a thing files as, in the words it was chosen with.
 *
 * The list never shows a code, because nobody owns a "0503": it asks "which of these is it really?" — the thing's
 * own table first, then the rest of that table under *Something else*. A tap is the answer, saved as it is made.
 *
 * *Type a code instead* is the way out, and is where a code no table names already sits. It changes nothing by itself:
 * it opens the four-digit sheet, because DJP's own guidance is to pick the code that matches your situation, and a
 * list the app wrote can never be the last word on that.
 */
export function WhatItIsSheet({
  code,
  itemId,
  onPick,
  onTypeInstead,
  onClose,
}: {
  code: string;
  /** The thing's catalogue item — a money account's subtype — which tells two items sharing one code apart. */
  itemId?: string;
  /** The code, and which of the items sharing it was tapped. */
  onPick: (code: string, value: string) => void;
  onTypeInstead: () => void;
  onClose: () => void;
}) {
  const groups = codeChoices('asset', code);
  const chosen = choiceForCode(groups, code, itemId);
  return (
    <Sheet grouped tall title="What it is" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className={HEADING}>{group.label}</h3>
            <div className={LIST}>
              {group.choices.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={chosen?.value === choice.value}
                  onClick={() => (chosen?.value === choice.value ? onClose() : onPick(choice.code, choice.value))}
                  className={OPTION}
                >
                  <span className="flex-1 text-[15px] text-[var(--ph-ink)]">{choice.label}</span>
                  {chosen?.value === choice.value && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className={LIST}>
          <button type="button" aria-pressed={chosen === null} onClick={onTypeInstead} className={OPTION}>
            <span className="flex-1 text-[15px] text-[var(--ph-ink)]">Type a code instead</span>
            {chosen === null && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** The code itself, four digits typed. Empty goes back to the code this kind of thing normally takes. */
export function CodeSheet({ code, onSave, onClose }: { code: string; onSave: (code: string) => void; onClose: () => void }) {
  const [typed, setTyped] = useState(code);
  const id = useId();
  // The sheet takes focus for itself as it opens; the cursor is put in the box a frame later, since asking for this
  // sheet is asking to type.
  useEffect(() => {
    const frame = requestAnimationFrame(() => document.getElementById(id)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return (
    <Sheet grouped title="Tax report code" onClose={onClose} confirm={{ label: 'Save code', run: () => onSave(typed.trim()) }}>
      <InsetGroup>
        <TextRow
          label="Code"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave(typed.trim())}
          inputMode="numeric"
          maxLength={4}
          placeholder="Four digits"
          id={id}
          hint={typed.trim() === '' ? 'Empty uses the code this kind of thing normally takes.' : hartaLabel(typed.trim()) || 'Not a code the form knows.'}
        />
      </InsetGroup>
    </Sheet>
  );
}
