/** Programs a purchase can be compared in: each card's own program and every transfer partner program, once, sorted. */
export function compareTargets(cards: { programName: string | null; transferPartners: { program: string }[] }[]): string[] {
  const names = cards.flatMap((card) => [card.programName, ...card.transferPartners.map((partner) => partner.program)]);
  return [...new Set(names.filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b));
}
