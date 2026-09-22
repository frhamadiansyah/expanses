import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useEscape } from '../../app/use-escape';
import { type GroupChild, InsetGroup, InsetRow, PickerRow } from '../../ui/native';

export interface Choice {
  value: string;
  label: string;
}

/**
 * A row whose answer is one of a few — chosen in the app's own menu, opened at the row, not in the platform's
 * picker.
 *
 * A `<select>` is right when the list is long: a year, a category tree, a broker. iOS draws the wheel and a
 * keyboard draws the menu, both for free, and a page of them is what native forms are made of. For two or three
 * answers that trade goes the wrong way: the system's panel is mostly empty, it cannot be styled, and it is the one
 * control on the screen that does not look like the app.
 *
 * So this is the pair the kit draws itself: the row is `PickerRow` — label left, answer right, chevron — and the
 * menu drops under the row that was tapped, as wide as its longest answer and as tall as its answers, with a tick
 * on the one in force. `SelectRow` keeps its place for the long lists; the short ones belong here.
 */
export function ChoiceRow({
  label,
  value,
  options,
  onChoose,
  hint,
  position,
}: {
  label: string;
  /** The chosen value; the label it shows is looked up in `options`. */
  value: string;
  options: readonly Choice[];
  onChoose: (value: string) => void;
  hint?: ReactNode;
} & GroupChild) {
  // The row that was tapped, so the menu can sit under it — and follow it while the page moves.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const chosen = options.find((option) => option.value === value);
  return (
    <>
      <PickerRow
        label={label}
        value={chosen?.label ?? null}
        placeholder="Choose…"
        hint={hint}
        position={position}
        onOpen={(event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget)}
      />
      {anchor && (
        <ChoiceMenu label={label} anchor={anchor} onClose={() => setAnchor(null)}>
          {options.map((option) => (
            <InsetRow
              key={option.value}
              title={option.label}
              /* The tick is a selection, so it takes the tint — the one place colour still says something. */
              value={option.value === value ? '✓' : undefined}
              valueTone="tint"
              chevron={false}
              label={option.label}
              onClick={() => {
                onChoose(option.value);
                setAnchor(null);
              }}
            />
          ))}
        </ChoiceMenu>
      )}
    </>
  );
}

/**
 * The menu itself: drawn under the row, clamped to the screen, flipped above it when there is no room below.
 *
 * One layout pass decides where it goes, since its size is only known once it is drawn; after that it follows the
 * row — a scroll of anything between the row and the screen moves the row, and what sits under it moves too. A row
 * scrolled out of sight takes the menu with it. The backdrop, Escape and the answer are the other ways out, the
 * same three a sheet has.
 */
function ChoiceMenu({ label, anchor, onClose, children }: { label: string; anchor: HTMLElement; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  // The listeners live for as long as the menu does, so the close they call is read at the moment of the call.
  const close = useRef(onClose);
  close.current = onClose;

  useEscape(onClose);

  useLayoutEffect(() => {
    const put = () => {
      const node = panel.current;
      if (!node || !anchor.isConnected) {
        close.current();
        return;
      }
      const row = anchor.getBoundingClientRect();
      if (row.bottom < 0 || row.top > window.innerHeight) {
        close.current();
        return;
      }
      const { width, height } = node.getBoundingClientRect();
      const edge = 12;
      const gap = 6;
      const left = Math.min(Math.max(edge, row.left), Math.max(edge, window.innerWidth - width - edge));
      const below = row.bottom + gap;
      const above = row.top - height - gap;
      const top = below + height + edge <= window.innerHeight ? below : Math.max(edge, above);
      setPlace((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    put();
    window.addEventListener('scroll', put, true);
    window.addEventListener('resize', put);
    return () => {
      window.removeEventListener('scroll', put, true);
      window.removeEventListener('resize', put);
    };
  }, [anchor]);

  return (
    <div className="fixed inset-0 z-30 bg-[var(--ph-scrim)]" onClick={onClose} role="presentation">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="absolute w-fit min-w-40 max-w-[calc(100%-1.5rem)] rounded-2xl bg-[var(--ph-ground)] p-1.5 text-[var(--ph-ink)] shadow-xl outline-none"
        style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
      >
        <InsetGroup>{children}</InsetGroup>
      </div>
    </div>
  );
}
