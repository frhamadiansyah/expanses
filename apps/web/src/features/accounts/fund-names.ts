/**
 * The sentence under a Fund account's Broker and Custodian bank (owner, 25 Nov): which of its two names each place
 * shows. A name not given yet is said in general words, never left blank.
 */
export function fundNamesFooter(broker: string, custodian: string): string {
  const brokerName = broker.trim();
  const bank = custodian.trim();
  const inMoney = bank ? `Shown as ${bank} in Money` : `Shown as ${brokerName || 'the broker'} in Money until a custodian bank is named`;
  return `${inMoney}; as ${brokerName || 'the broker'} on stocks, funds and their tax lines.`;
}
