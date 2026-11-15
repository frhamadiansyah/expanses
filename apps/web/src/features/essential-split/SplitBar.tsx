/** The three parts in one bar, with the guide's two marks under it when asked for. */
export function SplitBar({
  parts,
  marks,
  height = 18,
  faded,
}: {
  parts: readonly { key: string; width: number; colour: string }[];
  marks?: readonly number[];
  height?: number;
  /** The part being filtered on: the others are drawn faded. */
  faded?: (key: string) => boolean;
}) {
  return (
    <div data-testid="split-bar">
      <div className="flex w-full overflow-hidden rounded-[5px] bg-[var(--ph-track)]" style={{ height }} aria-hidden>
        {parts
          .filter((part) => part.width > 0)
          .map((part) => (
            <i key={part.key} className="block h-full transition-opacity" style={{ width: `${part.width}%`, background: part.colour, opacity: faded?.(part.key) ? 0.3 : 1 }} />
          ))}
      </div>
      {marks && (
        <div className="relative h-[10px]" aria-hidden>
          {marks.map((at, index) => (
            <span key={index} className="absolute top-0 h-[8px] w-[2px] bg-[var(--ph-ink-2)] opacity-45" style={{ left: `calc(${Math.min(100, Math.max(0, at))}% - 1px)` }} />
          ))}
        </div>
      )}
    </div>
  );
}
