import { createPortal } from 'react-dom';
import { useEscape } from '../../app/use-escape';
import { cx } from '../index';

const OPTION = 'flex min-h-[52px] w-full items-center justify-center border-t border-[var(--ph-track)] px-3 text-[17px] first:border-t-0';

export interface MenuChoice {
  key: string;
  label: string;
  /** Drawn in the alarm colour: a choice that takes something back. */
  destructive?: boolean;
  testId?: string;
  run: () => void;
}

/**
 * An iOS action sheet with no title: the choices grouped at the bottom, a separate Cancel under them, and a dimmed
 * backdrop that closes it too (the way Add workspace's sheet is drawn). A choice closes the menu before it runs.
 * `label` names it for a screen reader only.
 */
export function ActionMenu({ label, choices, onClose, testId = 'action-menu' }: { label: string; choices: readonly MenuChoice[]; onClose: () => void; testId?: string }) {
  useEscape(onClose);
  return createPortal(
    <div
      data-testid={testId}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-[10px] pb-[calc(10px+env(safe-area-inset-bottom))]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-[420px]">
        <div className="mb-2 overflow-hidden rounded-[14px] bg-[var(--ph-surface)] shadow-xl">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              data-testid={choice.testId}
              onClick={() => {
                onClose();
                choice.run();
              }}
              className={cx(OPTION, choice.destructive ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[var(--ph-surface)] px-3 text-[17px] font-semibold text-[var(--ph-tint)] shadow-xl">
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
