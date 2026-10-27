/** What the instalment plan sheet holds while it is open: every field as the person typed it. */
export interface PlanForm {
  description: string;
  total: string;
  months: string;
  firstBilledMonth: string;
  earnsPoints: boolean;
}

/** The plan as the db takes it, without the card or the id. */
export interface PlanFields {
  description: string;
  totalMinor: number;
  months: number;
  firstBilledMonth: string;
  earnsPoints: boolean;
}

/** A new plan's sheet: nothing typed, twelve months, starting this month, no points until said. */
export const blankPlanForm = (today: string): PlanForm => ({ description: '', total: '', months: '12', firstBilledMonth: today.slice(0, 7), earnsPoints: false });

/** An existing plan's sheet: its own figures, in the shapes the fields take. */
export const planFormOf = (plan: { description: string; totalMinor: number; months: number; firstBilledMonth: string; earnsPoints: boolean }): PlanForm => ({
  description: plan.description,
  total: String(plan.totalMinor),
  months: String(plan.months),
  firstBilledMonth: plan.firstBilledMonth,
  earnsPoints: plan.earnsPoints,
});

/** The typed fields as numbers. A blank name becomes "Instalment plan"; a total typed with dots has them dropped. */
export const planFields = (form: PlanForm): PlanFields => ({
  description: form.description.trim() || 'Instalment plan',
  totalMinor: Number(form.total.replace(/\./g, '')),
  months: Number(form.months),
  firstBilledMonth: form.firstBilledMonth,
  earnsPoints: form.earnsPoints,
});
