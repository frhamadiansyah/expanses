/**
 * What an event was expected to cost, against what it actually cost.
 *
 * An event is planned category by category, and a category with a plan is also a category the event
 * draws on — which is what makes suggesting its transactions precise rather than offering the whole
 * month. Anyone who would rather not plan in that detail can set one figure for the whole thing.
 */

export interface EventPlanLine {
  categoryId: string;
  /** Null when the category belongs to the event but has no figure yet. */
  plannedMinor: number | null;
}

export interface EventActual {
  categoryId: string;
  amountBaseMinor: number;
}

export interface EventSheetInput {
  planned: EventPlanLine[];
  actuals: EventActual[];
  /** Names for the categories on either side, so a line can be read. */
  categoryNames: Record<string, string>;
  /** One figure for the whole event. When set, it is what the total is measured against. */
  totalPlannedMinor: number | null;
}

export interface EventSheetLine {
  categoryId: string;
  name: string;
  plannedMinor: number | null;
  actualMinor: number;
  /** How far past its plan this category went, or nought. Null while it has no plan. */
  overMinor: number | null;
  /** True when money landed here without the category ever being planned for. */
  unplanned: boolean;
}

export interface EventSheet {
  lines: EventSheetLine[];
  /** The figure for the whole event when one was set, otherwise the plans added up. */
  plannedMinor: number | null;
  actualMinor: number;
  /** How far past the plan the event went, or nought. Null while nothing was planned. */
  overMinor: number | null;
  /** Spending in categories the plan never mentioned. */
  unplannedMinor: number;
}

/** Planned and actual side by side, one line per category either side mentions. */
export function eventSheet(input: EventSheetInput): EventSheet {
  const plannedOf = new Map<string, number | null>();
  for (const line of input.planned) plannedOf.set(line.categoryId, line.plannedMinor);

  const actualOf = new Map<string, number>();
  for (const actual of input.actuals) {
    actualOf.set(actual.categoryId, (actualOf.get(actual.categoryId) ?? 0) + actual.amountBaseMinor);
  }

  const categoryIds = [...new Set([...plannedOf.keys(), ...actualOf.keys()])];
  const lines: EventSheetLine[] = categoryIds
    .map((categoryId) => {
      const plannedMinor = plannedOf.has(categoryId) ? (plannedOf.get(categoryId) ?? null) : null;
      const actualMinor = actualOf.get(categoryId) ?? 0;
      return {
        categoryId,
        name: input.categoryNames[categoryId] ?? categoryId,
        plannedMinor,
        actualMinor,
        overMinor: plannedMinor === null ? null : Math.max(0, actualMinor - plannedMinor),
        unplanned: !plannedOf.has(categoryId),
      };
    })
    .sort((a, b) => b.actualMinor - a.actualMinor || a.name.localeCompare(b.name));

  const actualMinor = lines.reduce((total, line) => total + line.actualMinor, 0);
  const summed = input.planned.reduce<number | null>(
    (total, line) => (line.plannedMinor === null ? total : (total ?? 0) + line.plannedMinor),
    null,
  );
  // A figure set for the whole event wins: it is what the owner said the thing should cost.
  const plannedMinor = input.totalPlannedMinor ?? summed;

  return {
    lines,
    plannedMinor,
    actualMinor,
    overMinor: plannedMinor === null ? null : Math.max(0, actualMinor - plannedMinor),
    unplannedMinor: lines.filter((line) => line.unplanned).reduce((total, line) => total + line.actualMinor, 0),
  };
}
