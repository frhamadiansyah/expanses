import { iconCentre, nestedPad } from './metrics';

/**
 * Where a row sits in an open tree: `last` among its siblings, and `rails` — the lines of ancestors that carry on past
 * it to later siblings of theirs, as x positions — so a row two levels down still draws the line its grandparent's
 * next child hangs from.
 */
export interface TreePlace {
  last: boolean;
  rails?: readonly number[];
}

const LINE = 'pointer-events-none absolute bg-[var(--ph-chevron)]';

/**
 * The outline view's tree line in a row's left gutter, where the indent used to be empty: down from the parent's icon,
 * turning into this row at its middle, and stopping there on the last child. Drawn inside a positioned row.
 */
export function TreeLines({ depth, tree }: { depth: number; tree: TreePlace }) {
  const x = iconCentre(depth - 1);
  return (
    <>
      {(tree.rails ?? []).map((rail) => (
        <span key={rail} aria-hidden className={`${LINE} inset-y-0 w-px`} style={{ left: rail }} />
      ))}
      <span aria-hidden className={`${LINE} top-0 w-px`} style={{ left: x, bottom: tree.last ? '50%' : 0 }} />
      <span aria-hidden className={`${LINE} top-1/2 h-px`} style={{ left: x, width: nestedPad(depth) - x - 6 }} />
    </>
  );
}

/** The start of the line under an open drawer's own icon, which its first child picks up. */
export function TreeStem({ depth, iconSize }: { depth: number; iconSize: number }) {
  return <span aria-hidden className={`${LINE} bottom-0 w-px`} style={{ left: iconCentre(depth), top: `calc(50% + ${iconSize / 2 + 2}px)` }} />;
}
