import type { ReactNode } from 'react';
import { cx } from '../index';
import { heroChange, heroFigure, figureSize, progressFraction, progressPercent, progressTone } from './hero-figure';

/**
 * The figure's sizes, largest first: `figureSize` says which, from how wide the figure turns out to be.
 *
 * Each step carries its own line box, a shade under the iOS ratio the 40 px one is drawn on, because the figure is
 * the only thing in that line.
 */
const FIGURE_SIZE_CLASS: Record<number, string> = {
  40: 'text-[40px] leading-[46px]',
  34: 'text-[34px] leading-[40px]',
  30: 'text-[30px] leading-[36px]',
  26: 'text-[26px] leading-[32px]',
};
import { toneClass } from './InsetList';
import type { Direction } from './row';

/**
 * Primitive 5: the hero — the figure that is the point of the page.
 *
 * Money arrives as integer minor units and a currency, never as a string a caller formatted itself: that is how
 * IDR keeps its nought decimal places and how the no-break space after `Rp` survives.
 *
 * Its shape is the one iOS draws for a metric, as Health draws Steps and Activity: a small caps label in the quiet
 * ink, the figure large and bold under it, the sentence that says what the figure is about in the quiet ink once
 * more, and the whole block reading from the left gutter, on the page rather than in a card. Nothing is centred: a
 * figure centred over a list makes the eye hunt for the start of the sentence, and the label above it the only
 * thing that says what it is.
 */

/** The bar under a hero: 7 px, fully rounded, the tint while there is room and alarm once the target is passed. */
export function ProgressBar({
  currentMinor,
  targetMinor,
  label,
  className,
}: {
  currentMinor: number;
  targetMinor: number;
  label: string;
  className?: string;
}) {
  const fraction = progressFraction(currentMinor, targetMinor);
  const percent = progressPercent(currentMinor, targetMinor);
  const tone = progressTone(currentMinor, targetMinor);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx('w-full overflow-hidden bg-[var(--ph-track)]', className)}
      style={{ height: 7, borderRadius: 99 }}
    >
      <div
        className="h-full"
        style={{
          width: `${fraction * 100}%`,
          borderRadius: 99,
          background: tone === 'alarm' ? 'var(--ph-alarm)' : tone === 'tint' ? 'var(--ph-tint)' : 'var(--ph-ink-3)',
        }}
      />
    </div>
  );
}

export function Hero({
  icon,
  iconColour,
  label,
  minor,
  currency,
  direction = 'neutral',
  approximate = false,
  empty = '—',
  change,
  caption,
  progress,
  align = 'start',
  className,
}: {
  icon?: ReactNode;
  iconColour?: string;
  /** What the figure is, above it: "In the account", "You owe". Left off where the page's own title says it. */
  label?: ReactNode;
  /** Null when there is no figure to show yet — a bill whose amount varies. `empty` is drawn in its place, quietly. */
  minor: number | null;
  currency: string;
  /** A figure that is an estimate, drawn with a leading `≈` so it never reads as a sum already known. */
  approximate?: boolean;
  empty?: string;
  direction?: Direction;
  /**
   * How far the figure has moved across the range it is read over: the arrow, the money and the share of it.
   *
   * The two figures rather than the change, so the caller hands over what it measured — a range whose ends are
   * months, months and not a number worked out twice.
   */
  change?: { fromMinor: number; toMinor: number } | null;
  caption?: ReactNode;
  /** The bar under the figure, when the figure is part of the way to something. */
  progress?: { targetMinor: number; label: string };
  /** Reads from the left gutter, as iOS draws a metric; `center` for the screen that wants its figure centred. */
  align?: 'center' | 'start';
  className?: string;
}) {
  const figure = minor === null ? ({ text: empty, tone: 'ink-3' } as const) : heroFigure(minor, currency, direction);
  const move = change ? heroChange(change.fromMinor, change.toMinor, currency) : null;
  return (
    <div
      className={cx('flex flex-col', align === 'start' ? 'items-start text-left' : 'items-center text-center', className)}
      style={{ marginBottom: 12 }}
    >
      {icon && (
        /* The metric's own glyph, in its own colour, on the page: iOS does not put a chip behind it. */
        <span aria-hidden className="mb-[6px] flex items-center justify-center" style={{ width: 32, height: 32, color: iconColour ?? 'var(--ph-ink-2)' }}>
          {icon}
        </span>
      )}
      {label && <p className="mb-[2px] text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">{label}</p>}
      <p className={cx('tabular font-bold tracking-[-0.02em]', FIGURE_SIZE_CLASS[figureSize(figure.text)], toneClass(figure.tone))}>
        {/* The estimate sign is a caveat, not part of the figure: it wears the quiet ink, as the label does. */}
        {approximate && minor !== null && <span className="text-[var(--ph-ink-3)]">≈ </span>}
        {figure.text}
      </p>
      {move && (
        /* The arrow says which way and the money says how much, so neither carries a sign the other repeats. */
        <p className={cx('tabular mt-[2px] text-[15px] leading-[20px] font-medium', toneClass(move.tone))}>
          {move.direction !== 'flat' && (
            <>
              <span aria-hidden>{move.direction === 'up' ? '▲' : '▼'}</span>{' '}
              <span className="sr-only">{move.direction === 'up' ? 'Up' : 'Down'} </span>
            </>
          )}
          {move.text}
          {move.percent && ` · ${move.percent}`}
        </p>
      )}
      {caption && <p className="mt-[1px] text-[15px] leading-[20px] text-[var(--ph-ink-3)]">{caption}</p>}
      {progress && minor !== null && (
        <ProgressBar
          className="mt-[12px] max-w-[320px]"
          currentMinor={minor}
          targetMinor={progress.targetMinor}
          label={progress.label}
        />
      )}
    </div>
  );
}
