export type Detent = 'medium' | 'large';

/**
 * Where a sheet lands when its drag lets go, the way iOS decides it: a flick goes the way it was flicked; a slow drag
 * goes to whichever detent the top edge is nearer; and pulled well below the medium detent, the sheet closes.
 *
 * Heights in px. `height` is where the drag left the sheet; `velocity` is px/ms, positive downwards.
 */
export function landing({ height, velocity, medium, large }: { height: number; velocity: number; medium: number; large: number }): Detent | 'close' {
  const FLICK = 0.5;
  if (velocity > FLICK) return height < medium - 40 ? 'close' : 'medium';
  if (velocity < -FLICK) return 'large';
  if (height < medium * 0.6) return 'close';
  return height > (medium + large) / 2 ? 'large' : 'medium';
}
