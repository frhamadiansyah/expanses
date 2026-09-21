import { describe, expect, it, vi } from 'vitest';
import { securityListQuery } from './security-list';

const loader = () => vi.fn(async (list: 'idx' | 'us') => ({ asOf: '2026-09-21', securities: [{ ticker: list === 'us' ? 'AAPL' : 'BBCA' }] as never[] }));

describe('securityListQuery', () => {
  it('never loads the US list without the switch — not enabled, and the read itself refuses', async () => {
    const load = loader();
    const query = securityListQuery('us', false, load);
    expect(query.enabled).toBe(false);
    await expect(query.queryFn()).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the US list once it is granted, and the IDX list for everyone', async () => {
    const load = loader();
    const us = securityListQuery('us', true, load);
    expect(us.enabled).toBe(true);
    await us.queryFn();
    expect(load).toHaveBeenLastCalledWith('us');
    const idx = securityListQuery('idx', false, load);
    expect(idx.enabled).toBe(true);
    await idx.queryFn();
    expect(load).toHaveBeenLastCalledWith('idx');
  });

  it('keys a granted read apart from a refused one, so flipping the switch reads again', () => {
    expect(securityListQuery('us', true).queryKey).not.toEqual(securityListQuery('us', false).queryKey);
  });
});

describe('useSecurityList', () => {
  it('reads the paid list only as the switch says — nothing granted, nothing asked for', async () => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { useSecurityList } = await import('./queries');
    const client = new QueryClient();
    const Probe = () => {
      useSecurityList('us');
      useSecurityList('idx');
      return null;
    };
    renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
    const keys = client.getQueryCache().findAll().map((q) => q.queryKey);
    expect(keys).toContainEqual(['security-list', 'us', false]);
    expect(keys).toContainEqual(['security-list', 'idx', true]);
  });
});
