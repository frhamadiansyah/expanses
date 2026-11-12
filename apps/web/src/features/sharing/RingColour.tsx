import type { RingColour } from '@expanses/core';
import { Landmark, Palette } from 'lucide-react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { InsetGroup, InsetRow, type RowPosition } from '../../ui/native';
import { RING_LABELS, RING_OPTIONS, ringSheetFooter, ringVar, takenLabel } from '../networth/rings';

/*
 * The Member page's "Ring colour" (owner rings, 12 Nov; mockup docs/mockups/2026-11-12-owner-ring-colours.html §3):
 * one's own colour, the ring round each of one's accounts on the household's Net worth, Assets and Liabilities. A row
 * under Name opens a sheet of the palette, each colour drawn as the ring it makes; a colour another member holds is
 * greyed, named as theirs, and cannot be picked. Saved on tap.
 */

/** A small ringed circle, as the row shows the colour held. */
function Swatch({ colour }: { colour: RingColour }) {
  return <span aria-hidden className="inline-block h-[22px] w-[22px] shrink-0 rounded-full bg-[var(--ph-fill)]" style={{ boxShadow: `inset 0 0 0 3px ${ringVar(colour)}` }} />;
}

/** The row, under Name: the colour held, drawn and named. */
export function RingColourRow({ colour, disabled, onOpen, position }: { colour: RingColour; disabled?: boolean; onOpen: () => void; position?: RowPosition }) {
  return (
    <InsetRow
      position={position}
      testId="ring-colour-row"
      icon={<Palette size={15} aria-hidden />}
      title="Ring colour"
      label={`Ring colour, ${RING_LABELS[colour]}`}
      value={
        <span className="inline-flex items-center gap-[6px]" data-ring-colour={colour}>
          <Swatch colour={colour} />
          {RING_LABELS[colour]}
        </span>
      }
      disabled={disabled}
      onClick={onOpen}
    />
  );
}

/** The palette as a grid inside a group: one ringed circle per colour, its name under it. */
function RingGrid({ current, taken, onPick, busy }: { current: RingColour; taken: Partial<Record<RingColour, string>>; onPick: (colour: RingColour) => void; busy: boolean; position?: RowPosition }) {
  return (
    <div role="group" aria-label="Ring colours" className="grid grid-cols-4 gap-x-[8px] gap-y-[14px] px-[8px] py-[14px]">
      {RING_OPTIONS.map((colour) => {
        const owner = taken[colour];
        const on = colour === current;
        return (
          <button
            key={colour}
            type="button"
            data-testid={`ring-option-${colour}`}
            aria-label={owner ? `${RING_LABELS[colour]}, ${takenLabel(owner)}` : RING_LABELS[colour]}
            aria-pressed={on}
            disabled={busy || owner !== undefined}
            onClick={() => onPick(colour)}
            className={cx('flex flex-col items-center gap-[6px] text-[12px] leading-[15px] text-[var(--ph-ink-2)]', owner !== undefined && 'opacity-45')}
          >
            <span
              aria-hidden
              className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]"
              style={{ boxShadow: `inset 0 0 0 3px ${ringVar(colour)}`, outline: on ? '2.5px solid var(--ph-ink)' : undefined, outlineOffset: on ? 3 : undefined }}
            >
              <Landmark size={18} aria-hidden />
            </span>
            {owner ? takenLabel(owner) : RING_LABELS[colour]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The sheet: every colour of the palette, the one held marked, each other member's greyed under their name. `taken`
 * is each colour another member holds, with that member's name.
 */
export function RingColourSheet({
  current,
  taken,
  busy,
  onPick,
  onClose,
}: {
  current: RingColour;
  taken: Partial<Record<RingColour, string>>;
  busy: boolean;
  onPick: (colour: RingColour) => void;
  onClose: () => void;
}) {
  const footer = ringSheetFooter([...new Set(Object.values(taken))].filter((name): name is string => typeof name === 'string'));
  return (
    <Sheet title="Ring colour" onClose={onClose} grouped closeOnly>
      <InsetGroup wide footer={footer ?? undefined}>
        <RingGrid current={current} taken={taken} busy={busy} onPick={onPick} />
      </InsetGroup>
    </Sheet>
  );
}
