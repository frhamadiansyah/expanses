import type { ReactNode } from 'react';
import { cx } from '../index';
import { heroFigure, progressFraction, progressPercent, progressTone } from './hero-figure';
import { toneClass } from './InsetList';
import { iconTint } from './row';
import type { Direction } from './row';

/**
 * Primitive 5: the hero — the figure that is the point of the page.
 *
 * Money arrives as integer minor units and a currency, never as a string a caller formatted itself: that is how
 * IDR keeps its nought decimal places and how the no-break space after `Rp` survives.
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
  caption,
  progress,
  align = 'center',
  className,
}: {
  icon?: ReactNode;
  iconColour?: string;
  /** What the figure is, above it: "In the account", "You owe". Left off where the page's own title says it. */
  label?: ReactNode;
  /** Null when there is no figure to show yet — a bill whose amount varies. `empty` is drawn in its place, quietly. */
  minor: number | null;
  currency: string;
  /** A figure that is an estimate, drawn with a leading `~` so it never reads as a sum already known. */
  approximate?: boolean;
  empty?: string;
  direction?: Direction;
  caption?: ReactNode;
  /** The bar under the figure, when the figure is part of the way to something. */
  progress?: { targetMinor: number; label: string };
  /** Centred, as a phone's hero is; `start` for a desktop column that reads from the left. */
  align?: 'center' | 'start';
  className?: string;
}) {
  const figure = minor === null ? ({ text: empty, tone: 'ink-3' } as const) : heroFigure(minor, currency, direction);
  const tint = icon && iconColour ? iconTint(iconColour) : null;
  return (
    <div className={cx('flex flex-col', align === 'start' ? 'items-start text-left' : 'items-center text-center', className)} style={{ marginBottom: 18 }}>
      {icon && (
        <span
          aria-hidden
          className="mb-[10px] flex items-center justify-center rounded-full"
          style={{ width: 44, height: 44, background: tint?.background ?? 'var(--ph-fill)', color: tint?.foreground ?? 'var(--ph-ink-2)' }}
        >
          {icon}
        </span>
      )}
      {label && <p className="mb-[2px] text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{label}</p>}
      <p className={cx('tabular text-[34px] leading-[40px] font-extrabold tracking-[-0.03em]', toneClass(figure.tone))}>
        {approximate && minor !== null && '~'}
        {figure.text}
      </p>
      {caption && <p className="mt-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{caption}</p>}
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
