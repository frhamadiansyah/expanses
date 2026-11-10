import { isoDate, monthOf } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { hasWidget, onWidgetSummaryErased, summaryKey, summaryOf, WidgetSummary } from '../../native/widget-summary';
import { useBudgetSheet } from '../budget/queries';
import { useOpenBookReadOnly } from '../sharing/queries';

/** What `written` holds once a read-only workspace's summary has been erased rather than written. */
const ERASED = 'erased';

/**
 * Writes the open workspace's spending for this month to the widget while the switch is on. Every save invalidates
 * the queries, a workspace switch replaces them and a new month changes the key, so each leads to a rewrite; a new
 * time alone does not. After an erase (leaving or deleting a workspace) it forgets what it wrote and writes afresh. A
 * read-only workspace (one left, kept here as it was) has no figure to show: the summary is erased instead. Does
 * nothing outside the iOS app.
 */
export function useWidgetSummaryWriter(): void {
  const { ws } = useApp();
  const native = hasWidget();
  const enabled = useQuery({ queryKey: ['widget-enabled'], queryFn: () => WidgetSummary.getEnabled(), enabled: native });
  const on = native && enabled.data?.enabled === true;
  const readOnly = useOpenBookReadOnly();
  const month = monthOf(isoDate());
  const sheet = useBudgetSheet(month, on && !readOnly);
  const written = useRef<string | null>(null);
  const [erasures, setErasures] = useState(0);
  const bookId = ws.bookId ?? '';

  useEffect(
    () =>
      onWidgetSummaryErased(() => {
        written.current = null;
        setErasures((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!on) {
      written.current = null;
      return;
    }
    if (readOnly) {
      if (written.current === ERASED) return;
      written.current = ERASED;
      void WidgetSummary.erase().catch((error: unknown) => {
        written.current = null;
        console.warn('The widget summary was not erased', error);
      });
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
  }, [on, readOnly, sheet.data, bookId, month, erasures]);
}
