import { describe, expect, it, vi } from 'vitest';
import { frankfurterFetcher } from './fx-client';

describe('frankfurterFetcher', () => {
  it('requests the dated pair and returns the matching rate', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify([
        { date: '2026-09-05', base: 'THB', quote: 'CNY', rate: 0.2037 },
        { date: '2026-09-05', base: 'THB', quote: 'IDR', rate: 536.49 },
      ])),
    );
    const fetcher = frankfurterFetcher(fetchImpl as unknown as typeof fetch);
    expect(await fetcher('THB', 'IDR', '2026-09-05')).toEqual({ rate: 536.49, sourceDate: '2026-09-05' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rates?date=2026-09-05&base=THB&quotes=IDR');
  });

  it('throws on HTTP errors and missing pairs', async () => {
    await expect(frankfurterFetcher((async () => new Response('', { status: 500 })) as unknown as typeof fetch)('USD', 'IDR', '2026-09-05')).rejects.toThrow('500');
    await expect(frankfurterFetcher((async () => new Response('[]')) as unknown as typeof fetch)('USD', 'IDR', '2026-09-05')).rejects.toThrow('No USD->IDR');
  });
});
