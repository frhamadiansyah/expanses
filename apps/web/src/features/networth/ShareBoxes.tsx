import { formatMinor } from '@expanses/core';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../../ui';
import type { ShareSegment } from './ShareBar';
import { squarify } from './treemap';

/** The space the boxes are laid out in: a little wider than tall, so the largest share reads as a slab, not a strip. */
const WIDE = 100;
const TALL = 82;

/**
 * The segment colours too pale to carry white words: on these the box writes in the ink instead. Literal colours, like
 * the white, because both sit on a colour that is the same in either theme.
 */
const PALE = new Set(['bg-rose-300', 'bg-amber-500', 'bg-slate-400']);

/** A share as it is written in a box: whole per cent, and "<1%" for one too small to round to anything. */
function percent(minor: number, totalMinor: number): string {
  const share = (minor / totalMinor) * 100;
  return share < 1 ? '<1%' : `${Math.round(share)}%`;
}

/**
 * What a total is made of, drawn as boxes: one per segment, sized by its share and kept as square as the shares allow.
 *
 * Each box names itself — its drawing and share at the top, its name and amount at the bottom — so the colour key a
 * thin bar needed has nothing left to explain. A box too small for words keeps its colour and drawing, and a box too
 * small for those still answers a tap. A tap picks the segment, for the list below to narrow to; the boxes not picked
 * step back, and the picked one tapped again lets go.
 */
export function ShareBoxes({
  segments,
  totalMinor,
  currency,
  iconOf,
  picked,
  onPick,
}: {
  segments: readonly ShareSegment[];
  totalMinor: number;
  currency: string;
  iconOf: (key: string) => LucideIcon;
  picked: string | null;
  onPick: (key: string | null) => void;
}) {
  const shown = segments.filter((segment) => segment.minor > 0);
  const boxes = squarify(
    shown.map((segment) => segment.minor),
    WIDE,
    TALL,
  );
  if (totalMinor <= 0 || boxes.length === 0) return null;
  // A pick whose box is gone (paid off, moved below nought) picks nothing, rather than fading every box there is.
  const active = shown.some((segment) => segment.key === picked) ? picked : null;
  return (
    <div role="group" aria-label="What the total is made of. Tap a part to show only it below." className="relative w-full" style={{ aspectRatio: `${WIDE} / ${TALL}` }} data-testid="share-boxes">
      {shown.map((segment, index) => {
        const box = boxes[index]!;
        const Glyph = iconOf(segment.key);
        // Measured against the space, not the screen: a box under a quarter of the width has no room for a name.
        const words = box.w >= 24 && box.h >= 22;
        const marks = box.w >= 11 && box.h >= 14;
        const share = percent(segment.minor, totalMinor);
        const on = active === segment.key;
        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={on}
            aria-label={`${segment.label}, ${formatMinor(segment.minor, currency)}, ${share}`}
            title={`${segment.label}: ${formatMinor(segment.minor, currency)}`}
            onClick={() => onPick(on ? null : segment.key)}
            data-testid={`share-box-${segment.key}`}
            className="ph-focus absolute p-[1.5px]"
            style={{ left: `${box.x}%`, top: `${(box.y / TALL) * 100}%`, width: `${box.w}%`, height: `${(box.h / TALL) * 100}%` }}
          >
            <span
              className={cx(
                // White as a literal: the kit's `white` is the surface, which turns near-black at night, and these words sit on
                // a colour in both themes. The sheen over the colour is the same light either way.
                'flex h-full w-full flex-col justify-between overflow-hidden rounded-[10px] bg-linear-to-b from-[#ffffff33] to-[#ffffff00] p-2 text-left transition-opacity',
                PALE.has(segment.className) ? 'text-[#1c1c1e]' : 'text-[#ffffff]',
                segment.className,
                active !== null && !on && 'opacity-35',
              )}
            >
              {marks && (
                <span className="flex items-start justify-between gap-1 text-[12px] leading-[14px] font-semibold">
                  <Glyph size={16} strokeWidth={2.2} aria-hidden className="shrink-0" />
                  {words && <span className="tabular">{share}</span>}
                </span>
              )}
              {words && (
                <span className="block min-w-0">
                  <span className="block truncate text-[12px] leading-[15px] font-semibold opacity-95">{segment.label}</span>
                  <span className="tabular block truncate text-[13px] leading-[17px] font-bold">{formatMinor(segment.minor, currency)}</span>
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The way back from one picked part to the whole list, where the list would otherwise start. */
export function ShowAll({ onClick }: { onClick: () => void }) {
  return (
    <div className="-mt-[8px] mb-[6px] flex justify-end px-[4px]">
      <button type="button" onClick={onClick} className="ph-focus min-h-[44px] rounded px-[4px] text-[15px] font-semibold text-[var(--ph-tint)]" data-testid="show-all">
        Show all
      </button>
    </div>
  );
}
