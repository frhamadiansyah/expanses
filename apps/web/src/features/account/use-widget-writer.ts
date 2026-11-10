import { isoDate, monthOf } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApp } from '../../app/context';
import { hasWidget, summaryKey, summaryOf, WidgetSummary } from '../../native/widget-summary';
import { useBudgetSheet } from '../budget/queries';

/**
 * Writes the open workspace's spending for this month to the widget while the switch is on. Every save invalidates
 * the queries, a workspace switch replaces them and a new month changes the key, so each leads to a rewrite; a new
 * time alone does not. Does nothing outside the iOS app.
 */
export function useWidgetSummaryWriter(): void {
  const { ws } = useApp();
  const native = hasWidget();
  const enabled = useQuery({ queryKey: ['widget-enabled'], queryFn: () => WidgetSummary.getEnabled(), enabled: native });
  const on = native && enabled.data?.enabled === true;
  const month = monthOf(isoDate());
  const sheet = useBudgetSheet(month, on);
  const written = useRef<string | null>(null);
  const bookId = ws.bookId ?? '';

  useEffect(() => {
    if (!on) {
      written.current = null;
      return;
    }
    if (!sheet.data) return;
    const summary = summaryOf(sheet.data, { bookId, month, now: new Date() });
    const key = summaryKey(summary);
    if (key === written.current) return;
    written.current = key;
    void WidgetSummary.write({ summary }).catch((error: unknown) => {
      written.current = null;
      console.warn('The widget summary was not written', error);
    });
  }, [on, sheet.data, bookId, month]);
}
