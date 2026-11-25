import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../../ui';

/*
 * The Mac tables' right-click menu (owner 2026-11-25): a Mac menu at the pointer with what the row can already do —
 * Copy, Paste, Open, Duplicate, Split…, Turn into instalments…, Delete — each with its key on the right. Nothing in it
 * is new: every line is the peek's or the cells' own. ↑ ↓ move along it, Return chooses, Esc or a click elsewhere
 * closes it. Delete asks twice, in place, as the peek's Delete does.
 */

export interface TableMenuItem {
  key: string;
  label: string;
  /** The key that does the same, on the right: "⌘C", "Space". */
  keys?: string;
  /** Red, and asks twice ("Click again to delete"). */
  danger?: boolean;
  /** A line above it, starting a group. */
  divided?: boolean;
  onPick: () => void;
}

export function TableMenu({ x, y, items, onClose, label = 'Row menu' }: { x: number; y: number; items: readonly TableMenuItem[]; onClose: () => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<number>(-1);
  const [armed, setArmed] = useState<string | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // At the pointer, kept inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setPlace({ left: Math.max(6, Math.min(x, window.innerWidth - width - 6)), top: Math.max(6, y + height > window.innerHeight - 6 ? y - height : y) });
  }, [x, y, items.length]);
  const choose = (item: TableMenuItem) => {
    if (item.danger && armed !== item.key) {
      setArmed(item.key);
      return;
    }
    onClose();
    item.onPick();
  };
  const latest = useRef({ items, at, choose, onClose });
  latest.current = { items, at, choose, onClose };
  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) latest.current.onClose();
    };
    // The menu has the keyboard while open: ahead of the table's keys and the page's.
    const keys = (event: KeyboardEvent) => {
      const { items: list, at: now } = latest.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        latest.current.onClose();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const by = event.key === 'ArrowDown' ? 1 : -1;
        setAt(now < 0 ? (by > 0 ? 0 : list.length - 1) : (now + by + list.length) % list.length);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const item = list[now];
        if (item) latest.current.choose(item);
      }
    };
    const gone = () => latest.current.onClose();
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', keys, true);
    window.addEventListener('blur', gone);
    window.addEventListener('resize', gone);
    window.addEventListener('scroll', gone, { passive: true });
    return () => {
      document.removeEventListener('mousedown', away, true);
      window.removeEventListener('keydown', keys, true);
      window.removeEventListener('blur', gone);
      window.removeEventListener('resize', gone);
      window.removeEventListener('scroll', gone);
    };
  }, []);
  return (
    <div
      ref={box}
      role="menu"
      aria-label={label}
      data-testid="table-menu"
      onContextMenu={(event) => event.preventDefault()}
      style={place ?? { left: x, top: y, visibility: 'hidden' }}
      className="fixed z-[70] min-w-[230px] rounded-[10px] border border-[var(--mk-line)] bg-[var(--mk-panel)] p-[5px] text-[13px] text-[var(--mk-ink)] shadow-[0_10px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl"
    >
      {items.map((item, i) => {
        const asking = item.danger && armed === item.key;
        return (
          <div key={item.key}>
            {item.divided && i > 0 && <div role="separator" className="mx-[8px] my-[4px] h-px bg-[var(--mk-line)]" />}
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt(-1)}
              onClick={() => choose(item)}
              className={cx(
                'flex w-full items-center gap-[18px] rounded-[6px] px-[10px] py-[4px] text-left whitespace-nowrap',
                at === i ? (item.danger ? 'bg-[var(--mk-c-red)] text-white' : 'bg-[var(--mk-blue)] text-white') : item.danger ? 'text-[var(--mk-c-red)]' : '',
                asking && 'bg-[var(--mk-c-red)] text-white',
              )}
            >
              <span className="flex-1">{asking ? 'Click again to delete' : item.label}</span>
              {item.keys && !asking && <span className={cx('text-[12px]', at === i ? 'text-white/80' : 'text-[var(--mk-ink-2)]')}>{item.keys}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
