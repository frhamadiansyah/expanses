import { Capacitor, registerPlugin, WebPlugin } from '@capacitor/core';
import { formatMinor } from '@expanses/core';

/** This month's spending for the open workspace, as the medium home screen widget shows it. */
export interface WidgetSummary {
  bookId: string;
  /** YYYY-MM: the widget shows the line only while this is the current month. */
  month: string;
  amountMinor: number;
  currency: string;
  amountText: string;
  /** The share of the month's budget spent, or null with no budget. */
  sharePercent: number | null;
  writtenAt: string;
}

/** The app's own Swift plugin (ios/App/App/WidgetSummaryPlugin.swift): it keeps the summary in the App Group. */
export interface WidgetSummaryPluginApi {
  getEnabled(): Promise<{ enabled: boolean }>;
  /** Off erases the summary at once. */
  setEnabled(options: { enabled: boolean }): Promise<void>;
  /** Ignored natively while switched off. */
  write(options: { summary: WidgetSummary }): Promise<void>;
  erase(): Promise<void>;
}

class WidgetSummaryWeb extends WebPlugin implements WidgetSummaryPluginApi {
  async getEnabled(): Promise<{ enabled: boolean }> {
    return { enabled: false };
  }
  async setEnabled(): Promise<void> {}
  async write(): Promise<void> {}
  async erase(): Promise<void> {}
}

export const WidgetSummary = registerPlugin<WidgetSummaryPluginApi>('WidgetSummary', { web: () => new WidgetSummaryWeb() });

const erasedListeners = new Set<() => void>();

/** The writer hears of an erase here, so it writes the next workspace's summary afresh. Returns the unsubscribe. */
export function onWidgetSummaryErased(listener: () => void): () => void {
  erasedListeners.add(listener);
  return () => {
    erasedListeners.delete(listener);
  };
}

/**
 * Erases the widget's summary — after leaving a shared workspace or deleting one (spec §E) — and then tells the writer,
 * which forgets what it last wrote and writes the open workspace's figure again. Never throws: an erase that fails is
 * logged, and the writer is told all the same.
 */
export async function eraseWidgetSummary(plugin: Pick<WidgetSummaryPluginApi, 'erase'> = WidgetSummary): Promise<void> {
  await plugin.erase().catch((error: unknown) => console.warn('The widget summary was not erased', error));
  for (const listener of [...erasedListeners]) listener();
}

/** The widget exists only in the iOS app. */
export const hasWidget = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export function summaryOf(
  sheet: { spendingActualMinor: number; capsTotalMinor: number; currency: string },
  at: { bookId: string; month: string; now: Date },
): WidgetSummary {
  const amountMinor = Math.max(0, sheet.spendingActualMinor);
  return {
    bookId: at.bookId,
    month: at.month,
    amountMinor,
    currency: sheet.currency,
    amountText: formatMinor(amountMinor, sheet.currency),
    sharePercent: sheet.capsTotalMinor > 0 ? Math.round((amountMinor / sheet.capsTotalMinor) * 100) : null,
    writtenAt: at.now.toISOString(),
  };
}

/** What decides a rewrite: everything except writtenAt, so a new month or workspace rewrites and a new time does not. */
export function summaryKey(summary: WidgetSummary): string {
  const { writtenAt: _writtenAt, ...rest } = summary;
  return JSON.stringify(rest);
}
