import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Notice, NoticeButton } from './Notice';
import { noticeLook } from './notice-look';

describe('noticeLook', () => {
  it('is amber only for the kinds that ask for care, and only an error interrupts', () => {
    expect(noticeLook('warning').amber).toBe(true);
    expect(noticeLook('error').amber).toBe(true);
    expect(noticeLook('info').amber).toBe(false);
    expect(noticeLook('success').amber).toBe(false);
    expect(noticeLook('error').role).toBe('alert');
    expect(noticeLook('warning').role).toBe('status');
  });
});

describe('Notice', () => {
  it('is one row: title, line and a round dismiss, with the action, Not now row and text left for the sheet', () => {
    const html = renderToStaticMarkup(
      <Notice kind="warning" title="Not backed up" line="Only copy is on this device" onDismiss={() => {}} actions={<NoticeButton>Download backup</NoticeButton>} body="Long text" />,
    );
    expect(html).toContain('Not backed up');
    expect(html).toContain('Only copy is on this device');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).not.toContain('Download backup');
    expect(html).not.toContain('Not now');
    expect(html).not.toContain('Long text');
    expect(html).not.toMatch(/alarm|red/);
  });
});

describe('Notice without a dismiss', () => {
  it('shows a chevron and no cross', () => {
    const html = renderToStaticMarkup(<Notice kind="info" title="Hello" line="Short" />);
    expect(html).not.toContain('Dismiss');
    expect(html).toContain('<svg');
  });
});
