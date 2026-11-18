import { describe, expect, it, vi } from 'vitest';
import { DOUBLE_CLICK, type GuardEvent, movedDoubleClick, PEEK_ROW, peekDoubleClick } from './peek-double-click';

describe('movedDoubleClick', () => {
  const first = { id: 'a', x: 400, y: 300, at: 1000 };
  it('is the first row’s double-click when the second click, soon and at the same place, lands off it', () => {
    expect(movedDoubleClick(first, { rowId: null, x: 401, y: 299, at: 1200 })).toBe('a');
    expect(movedDoubleClick(first, { rowId: 'b', x: 400, y: 300, at: 1000 + DOUBLE_CLICK.ms })).toBe('a');
  });
  it('leaves the same row’s second click to its own double-click', () => {
    expect(movedDoubleClick(first, { rowId: 'a', x: 400, y: 300, at: 1100 })).toBeNull();
  });
  it('is an ordinary click when too late, too far, or with no first click', () => {
    expect(movedDoubleClick(first, { rowId: null, x: 400, y: 300, at: 1001 + DOUBLE_CLICK.ms })).toBeNull();
    expect(movedDoubleClick(first, { rowId: null, x: 405, y: 300, at: 1100 })).toBeNull();
    expect(movedDoubleClick(first, { rowId: null, x: 400, y: 295, at: 1100 })).toBeNull();
    expect(movedDoubleClick(null, { rowId: null, x: 400, y: 300, at: 1100 })).toBeNull();
  });
});

/** An element wearing `PEEK_ROW` (a row), and something inside it, as `closest` finds them. */
function row(id: string) {
  const element = { getAttribute: (name: string) => (name === PEEK_ROW ? id : null) } as unknown as Element;
  const inside = { closest: (selector: string) => (selector === `[${PEEK_ROW}]` ? element : null) };
  return { element, inside };
}
const elsewhere = { closest: () => null };

function click(target: unknown, at: number, more: Partial<GuardEvent> = {}): GuardEvent {
  return {
    target: target as EventTarget,
    clientX: 400,
    clientY: 300,
    timeStamp: at,
    detail: 1,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...more,
  };
}

/** A click as the page's root sees it: captured on the way down, then — unless something stopped it — bubbling back up. */
function press(guard: ReturnType<typeof peekDoubleClick>, event: GuardEvent, { kept = false } = {}) {
  let stopped = kept;
  const seen = { ...event, stopPropagation: () => ((stopped = true), (event.stopPropagation as () => void)()) };
  guard.onClickCapture(seen);
  if (!stopped) guard.onClick(seen);
  return event;
}

describe('peekDoubleClick', () => {
  it('opens the first row when the second click lands on another row or the peek, stopping that click and its dblclick', () => {
    const onDouble = vi.fn();
    const guard = peekDoubleClick(onDouble);
    const a = row('a');
    const b = row('b');
    press(guard, click(a.inside, 1000));
    const second = press(guard, click(b.inside, 1200, { detail: 2 }));
    expect(onDouble).toHaveBeenCalledWith('a', a.element);
    expect(second.stopPropagation).toHaveBeenCalled();
    expect(second.preventDefault).toHaveBeenCalled();
    const dblclick = click(b.inside, 1201, { detail: 2 });
    guard.onDoubleClickCapture(dblclick);
    expect(dblclick.stopPropagation).toHaveBeenCalled();

    // A second click on the peek (no row under it) is the first row's too.
    const again = vi.fn();
    const other = peekDoubleClick(again);
    press(other, click(a.inside, 5000));
    press(other, click(elsewhere, 5300, { detail: 2 }));
    expect(again).toHaveBeenCalledWith('a', a.element);
  });

  it('leaves alone a double-click that stays on its row, and the clicks around it', () => {
    const onDouble = vi.fn();
    const guard = peekDoubleClick(onDouble);
    const a = row('a');
    press(guard, click(a.inside, 1000));
    const second = press(guard, click(a.inside, 1100, { detail: 2 }));
    const dblclick = click(a.inside, 1101, { detail: 2 });
    guard.onDoubleClickCapture(dblclick);
    // Nor is a third click, moved off, after the row's own double-click: a double-click's second click starts nothing.
    press(guard, click(elsewhere, 1200, { detail: 3 }));
    expect(onDouble).not.toHaveBeenCalled();
    expect(second.stopPropagation).not.toHaveBeenCalled();
    expect(dblclick.stopPropagation).not.toHaveBeenCalled();
    // A click off any row first, then one on a row: nothing to open.
    press(guard, click(elsewhere, 3000));
    press(guard, click(row('b').inside, 3100, { detail: 2 }));
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('is an ordinary click when too late or too far, and a ⌘, ⌃, ⇧ or ⌥ click never starts one', () => {
    const onDouble = vi.fn();
    const guard = peekDoubleClick(onDouble);
    const a = row('a');
    press(guard, click(a.inside, 1000));
    press(guard, click(elsewhere, 1001 + DOUBLE_CLICK.ms));
    press(guard, click(a.inside, 3000));
    press(guard, click(elsewhere, 3100, { clientX: 410 }));
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
      press(guard, click(a.inside, 5000, { [key]: true }));
      press(guard, click(elsewhere, 5100, { detail: 2 }));
    }
    expect(onDouble).not.toHaveBeenCalled();
    // Three quick clicks: the third, after the guard opened the row, starts nothing.
    press(guard, click(a.inside, 7000));
    press(guard, click(elsewhere, 7100, { detail: 2 }));
    press(guard, click(elsewhere, 7200, { detail: 3 }));
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it('a click a control in the row keeps to itself (a tick, a picker, a fold) is not the row’s', () => {
    const onDouble = vi.fn();
    const guard = peekDoubleClick(onDouble);
    press(guard, click(row('a').inside, 1000), { kept: true });
    press(guard, click(elsewhere, 1100, { detail: 2 }));
    expect(onDouble).not.toHaveBeenCalled();
  });

  it('lets a later dblclick through once the moment has passed', () => {
    const guard = peekDoubleClick(vi.fn());
    const a = row('a');
    press(guard, click(a.inside, 1000));
    press(guard, click(elsewhere, 1100, { detail: 2 }));
    const late = click(a.inside, 1101 + DOUBLE_CLICK.ms);
    guard.onDoubleClickCapture(late);
    expect(late.stopPropagation).not.toHaveBeenCalled();
  });
});
