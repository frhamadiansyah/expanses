import { describe, expect, it } from 'vitest';
import { toastIconStyle, type ToastIcon } from './UndoToast';

describe('toast icon', () => {
  it('draws done things green and the rest grey', () => {
    for (const kind of ['paid', 'recorded', 'refund'] as ToastIcon[]) expect(toastIconStyle(kind).done).toBe(true);
    for (const kind of ['deleted', 'discarded', 'category', 'event', 'skipped', 'info'] as ToastIcon[]) expect(toastIconStyle(kind).done).toBe(false);
  });
});
