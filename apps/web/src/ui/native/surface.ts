import { GROUP_GAP, GROUP_RADIUS, ROW_PAD_X } from './metrics';

/**
 * A group's surface, measured for the things that are not rows.
 *
 * `InsetGroup` clones its children to hand each one its place in the group, so it takes rows and only rows: a
 * donut, a gauge, a health tile or a form nobody has converted yet cannot be one of them. They still belong on
 * the group's own fill, radius and rhythm, which is what this decides — the same three numbers a group uses,
 * asked for by something that is not a list.
 *
 * It exists as a primitive because it was written twice before it was written once: `EventDetailPage` had one
 * copy and the net-worth screens grew a second. A second copy of something that already exists is the recurring
 * fault on this project, so the answer is one shape in the kit rather than a third.
 */

export interface PanelPlan {
  /** The surface's corner radius: a group's, exactly. */
  radius: number;
  /** The air under the panel before the next header. */
  gap: number;
  /** The inside padding, or 0 when what is inside draws its own rows and carries the row padding itself. */
  padding: number;
  /** Whether the panel stops at the reading column, or takes the width it is given. */
  column: boolean;
}

/**
 * How a panel is drawn.
 *
 * The padding is the row's own horizontal padding rather than a number chosen for charts, so a paragraph inside
 * a panel starts on the same vertical line as the text of a row in the group above it. A panel that draws rows
 * of its own asks for none, since the rows bring it.
 *
 * Width follows `InsetGroup`: on a wide screen it stops growing rather than stretching, unless a caller that
 * genuinely wants the full column — a desktop grid's cell, a table — says `wide`.
 */
export function planPanel(options: { wide?: boolean; pad?: boolean } = {}): PanelPlan {
  return {
    radius: GROUP_RADIUS,
    gap: GROUP_GAP,
    padding: options.pad === false ? 0 : ROW_PAD_X,
    column: options.wide !== true,
  };
}
