import { formatMinor, monthName } from '@expanses/core';

/** "Internet", "Internet and Mobile phone", "Internet, Mobile phone and Mobile phone 2". */
export function namesInWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What Undo payment asks on a bill's page (owner, 22 Nov 2026, option A). A payment of several bills is deleted whole,
 * so the question names every bill it leaves unpaid; a payment of one bill asks as it always did.
 */
export function undoPaymentQuestion(
  title: string,
  payment: { totalMinor: number; currency: string; bills: readonly { name: string; billMonth: string }[] } | null,
): string {
  if (!payment || payment.bills.length < 2) return `Undo ${title}? The payment is deleted.`;
  const months = new Set(payment.bills.map((bill) => bill.billMonth));
  const when = months.size === 1 ? `for ${monthName([...months][0]!, 'long')}` : 'for their months';
  return `Undo the whole payment?\n\nDeletes the ${formatMinor(payment.totalMinor, payment.currency)} payment. ${namesInWords(payment.bills.map((bill) => bill.name))} become unpaid ${when}.`;
}
