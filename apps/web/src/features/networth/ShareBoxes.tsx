import { formatMinor } from '@expanses/core';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../../ui';
import type { ShareSegment } from './ShareBar';
import { squarify, type TreemapBox } from './treemap';

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

/** One box: its drawing and share at the top, its name and amount at the bottom, as much of that as its size has room for. */
function BoxFace({ segment, currency, share, Glyph, w, h, faded }: { segment: ShareSegment; currency: string; share: string; Glyph: LucideIcon; w: number; h: number; faded: boolean }) {
  // Measured against the space, not the screen: a box under a quarter of the width has no room for a name.
  const words = w >= 24 && h >= 22;
  const marks = w >= 11 && h >= 14;
  return (
    <span
      className={cx(
        // White as a literal: the kit's `white` is the surface, which turns near-black at night, and these words sit on
        // a colour in both themes. The sheen over the colour is the same light either way.
        'flex h-full w-full flex-col justify-between overflow-hidden rounded-[10px] bg-linear-to-b from-[#ffffff33] to-[#ffffff00] p-2 text-left transition-opacity',
        PALE.has(segment.className) ? 'text-[#1c1c1e]' : 'text-[#ffffff]',
        segment.className,
        faded && 'opacity-35',
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
  );
}

/**
 * What one picked box is made of, drawn inside that box: Investments as listed shares, mutual funds and government
 * bonds, in the space Investments already had, so the chart keeps its shape and only that box gains detail.
 */
export interface InnerBoxes {
  /** The box they are drawn in. */
  key: string;
  segments: readonly ShareSegment[];
  iconOf: (key: string) => LucideIcon;
  picked: string | null;
  onPick: (key: string | null) => void;
}

/**
 * What a total is made of, drawn as boxes: one per segment, sized by its share and kept as square as the shares allow.
 *
 * Each box names itself — its drawing and share at the top, its name and amount at the bottom — so the colour key a
 * thin bar needed has nothing left to explain. A box too small for words keeps its colour and drawing, and a box too
 * small for those still answers a tap. A tap picks the segment, for the list below to narrow to; the boxes not picked
 * step back, and the picked one tapped again lets go. A picked box with parts of its own (`inner`) is divided into
 * them where it stands, each part a box to pick in turn, its share still a share of the whole — so every box on the
 * chart adds up to a hundred, divided or not.
 */
export function ShareBoxes({
  segments,
  totalMinor,
  currency: code,
  iconOf,
  picked,
  onPick,
  inner,
}: {
  segments: readonly ShareSegment[];
  totalMinor: number;
  currency: string;
  iconOf: (key: string) => LucideIcon;
  picked: string | null;
  onPick: (key: string | null) => void;
  inner?: InnerBoxes | null;
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
  const place = (box: TreemapBox, w: number, h: number) => ({ left: `${(box.x / w) * 100}%`, top: `${(box.y / h) * 100}%`, width: `${(box.w / w) * 100}%`, height: `${(box.h / h) * 100}%` });
  return (
    <div role="group" aria-label="What the total is made of. Tap a part to show only it below." className="relative w-full" style={{ aspectRatio: `${WIDE} / ${TALL}` }} data-testid="share-boxes">
      {shown.map((segment, index) => {
        const box = boxes[index]!;
        const share = percent(segment.minor, totalMinor);
        const on = active === segment.key;
        const parts = on && inner && inner.key === segment.key ? inner.segments.filter((part) => part.minor > 0) : [];
        const partBoxes = parts.length > 1 ? squarify(parts.map((part) => part.minor), box.w, box.h) : [];
        if (partBoxes.length > 1) {
          const partActive = parts.some((part) => part.key === inner!.picked) ? inner!.picked : null;
          return (
            <div
              key={segment.key}
              role="group"
              aria-label={`${segment.label}, ${formatMinor(segment.minor, code)}, ${share}, by kind`}
              data-testid={`share-box-${segment.key}`}
              data-open="true"
              className="absolute"
              style={place(box, WIDE, TALL)}
            >
              {parts.map((part, at) => {
                const partBox = partBoxes[at]!;
                const partOn = partActive === part.key;
                const partShare = percent(part.minor, totalMinor);
                return (
                  <button
                    key={part.key}
                    type="button"
                    aria-pressed={partOn}
                    aria-label={`${part.label}, ${formatMinor(part.minor, code)}, ${partShare}`}
                    title={`${part.label}: ${formatMinor(part.minor, code)}`}
                    onClick={() => inner!.onPick(partOn ? null : part.key)}
                    data-testid={`share-box-${part.key}`}
                    className="ph-focus absolute p-[1.5px]"
                    style={place(partBox, box.w, box.h)}
                  >
                    <BoxFace segment={part} currency={code} share={partShare} Glyph={inner!.iconOf(part.key)} w={partBox.w} h={partBox.h} faded={partActive !== null && !partOn} />
                  </button>
                );
              })}
            </div>
          );
        }
        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={on}
            aria-label={`${segment.label}, ${formatMinor(segment.minor, code)}, ${share}`}
            title={`${segment.label}: ${formatMinor(segment.minor, code)}`}
            onClick={() => onPick(on ? null : segment.key)}
            data-testid={`share-box-${segment.key}`}
            className="ph-focus absolute p-[1.5px]"
            style={place(box, WIDE, TALL)}
          >
            <BoxFace segment={segment} currency={code} share={share} Glyph={iconOf(segment.key)} w={box.w} h={box.h} faded={active !== null && !on} />
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
