import { type MccMatch, mccName, searchMccs } from '@expanses/core';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';

/** The typed part of a name in bold, wherever the first typed word starts in it. */
function Marked({ text, typed }: { text: string; typed: string }) {
  const word = typed.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const at = word ? text.toLowerCase().indexOf(word) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-semibold text-[var(--ph-ink)]">{text.slice(at, at + word.length)}</b>
      {text.slice(at + word.length)}
    </>
  );
}

/**
 * A category's merchant category code, typed in a sheet of the app's own rather than the browser's prompt. One field
 * takes either the number — its name shows under it as it is typed — or words, which search the names of the 981
 * codes the app knows; a match is a tap away. ✓ saves any four digits, known or not. On a code of your own, the sheet
 * also says what the built-in one is and offers going back to it.
 */
export function MccSheet({
  name,
  current,
  own,
  builtIn,
  onSave,
  onReset,
  onClose,
}: {
  name: string;
  /** The code the category uses now, whoever set it. */
  current: string | null;
  /** Whether that code is one set by hand, which is when Reset means anything. */
  own: boolean;
  /** What it would use without the one set by hand: the built-in default, its parent's, or none. */
  builtIn: string | null;
  onSave: (mcc: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(current ?? '');
  const text = typed.trim();
  const digits = /^\d+$/.test(text);
  const code = digits && text.length === 4 ? text : null;
  const matches: MccMatch[] = code ? [] : searchMccs(text);
  const known = code ? mccName(code) : null;
  const partial = digits && text.length > 0 && text.length < 4 && typed === typed.trimStart();
  return (
    <Sheet
      grouped
      title="Merchant category code"
      onClose={onClose}
      confirm={{ label: 'Save merchant category code', disabled: !code || (code === current && own), run: () => code && onSave(code) }}
    >
      <div className="flex flex-col gap-[10px]">
        <div className="overflow-hidden rounded-[14px] bg-[var(--ph-surface)]">
          <div className="relative">
            <input
              aria-label={`Merchant category code for ${name}`}
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value.slice(0, 60))}
              placeholder="Code or a word, e.g. 5812 or restaurant"
              autoComplete="off"
              autoCapitalize="none"
              className="ph-focus-inset min-h-12 w-full bg-transparent px-3 text-[20px] font-semibold tracking-[0.5px] text-[var(--ph-ink)] tabular placeholder:text-[16px] placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--ph-ink-3)] focus:outline-none"
            />
            {/* The digits still to come, as faint 0s after the typed ones: four digits, said by the field's own shape. */}
            {partial && (
              <span aria-hidden data-testid="mcc-ghost" className="pointer-events-none absolute inset-0 flex items-center px-3 text-[20px] font-semibold tracking-[0.5px] whitespace-pre tabular">
                <span className="invisible">{text}</span>
                <span className="text-[var(--ph-ink-3)] opacity-45">{'0'.repeat(4 - text.length)}</span>
              </span>
            )}
          </div>
          {code && (
            <p data-testid="mcc-meaning" className="px-3 pb-3 text-[14px] leading-[18px] text-[var(--ph-ink-2)]">
              {known ?? 'Not a code on the list. It will still be used as typed.'}
            </p>
          )}
        </div>

        {!code && text && (
          <>
            <p className="px-[6px] pt-[2px] text-[12px] tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">
              {digits ? `Codes starting ${text}` : 'Matching codes'}
            </p>
            {matches.length > 0 ? (
              <ul aria-label="Matching codes" className="overflow-hidden rounded-[14px] bg-[var(--ph-surface)]">
                {matches.map((m, i) => (
                  <li key={m.code}>
                    <button
                      type="button"
                      aria-label={`${m.code}, ${m.name}`}
                      onClick={() => setTyped(m.code)}
                      className={`ph-focus-inset flex w-full items-baseline gap-[10px] px-3 py-[10px] text-left active:bg-[var(--ph-fill)] ${i > 0 ? 'border-t-[0.5px] border-[var(--ph-hair)]' : ''}`}
                    >
                      <span className="min-w-[42px] text-[14px] leading-[18px] font-semibold text-[var(--ph-ink)] tabular">{m.code}</span>
                      <span className="flex-1 text-[14px] leading-[18px] text-[var(--ph-ink-2)]">
                        {digits ? m.name : <Marked text={m.name} typed={text} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-[6px] text-[14px] text-[var(--ph-ink-3)]">No code by that name.</p>
            )}
          </>
        )}

        {own && (
          <>
            <p className="px-[6px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
              Custom.{' '}
              {builtIn ? `Without it: ${builtIn}${mccName(builtIn) ? ` · ${mccName(builtIn)}` : ''}.` : 'Without it, this category has no code.'}
            </p>
            <button
              type="button"
              onClick={onReset}
              className="ph-focus flex min-h-11 w-full items-center rounded-[14px] bg-[var(--ph-surface)] px-3 text-left text-[15px] text-[var(--ph-ink)] active:bg-[var(--ph-fill)]"
            >
              <span className="flex-1">{builtIn ? 'Reset to built-in' : 'Remove my code'}</span>
              {builtIn && <span className="text-[var(--ph-ink-3)] tabular">{builtIn}</span>}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
