/** The four kinds of notice, and what each looks like. Pure so the one rule that matters can be asserted. */
export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

export interface NoticeLook {
  /** The glyph inside the round icon. */
  glyph: 'i' | '!' | 'check';
  /** Amber is allowed only inside the icon, and only for the kinds that ask for care. There is no red here. */
  amber: boolean;
  /** `alert` interrupts a reader; the rest wait their turn. */
  role: 'status' | 'alert';
}

export function noticeLook(kind: NoticeKind): NoticeLook {
  switch (kind) {
    case 'warning':
      return { glyph: '!', amber: true, role: 'status' };
    case 'error':
      return { glyph: '!', amber: true, role: 'alert' };
    case 'success':
      return { glyph: 'check', amber: false, role: 'status' };
    default:
      return { glyph: 'i', amber: false, role: 'status' };
  }
}
