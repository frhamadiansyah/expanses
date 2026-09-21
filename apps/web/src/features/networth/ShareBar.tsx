export interface ShareSegment {
  key: string;
  label: string;
  minor: number;
  /** A kit-scale background class (Tailwind's scale is the kit's palette, so it follows dark mode). */
  className: string;
}

/** A thin bar split into each segment's share of the total. Nothing when there is no total to share. */
export function ShareBar({ segments, totalMinor }: { segments: ShareSegment[]; totalMinor: number }) {
  if (totalMinor <= 0) return null;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={segment.className}
          style={{ width: `${(segment.minor / totalMinor) * 100}%` }}
          title={`${segment.label}: ${Math.round((segment.minor / totalMinor) * 100)}%`}
        />
      ))}
    </div>
  );
}

/** The bar's key: a swatch, the label and its share. */
export function ShareLegend({ segments, totalMinor }: { segments: ShareSegment[]; totalMinor: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--ph-ink-3)]">
      {segments.map((segment) => (
        <span key={segment.key} className="flex items-center gap-1.5">
          <i className={`h-2 w-2 rounded-sm ${segment.className}`} />
          {segment.label} {totalMinor > 0 ? Math.round((segment.minor / totalMinor) * 100) : 0}%
        </span>
      ))}
    </div>
  );
}
