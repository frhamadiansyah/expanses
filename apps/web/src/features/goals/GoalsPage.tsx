import { formatUnits, fundingOrder, type GoalClass, goalClass, type GoalKind, isoDate } from '@expanses/core';
import type { GoalRow } from '@expanses/db';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, InsetGroup, InsetRow, LargeTitle, PanelHeader, SCREEN } from '../../ui/native';
import { LinkAmount } from './funding';
import { GoalForm } from './GoalForm';
import { goalCard, GOAL_TEMPLATES } from './goal-cards';
import { useEarmarks, useGoalPlans } from './queries';

/** The page's two sections, in funding order: what you save reaches the compulsory goals first. */
const SECTIONS: { key: GoalClass; title: string; note: string }[] = [
  { key: 'compulsory', title: 'Compulsory', note: 'The emergency fund and retirement. What you save reaches these first.' },
  { key: 'additional', title: 'Additional', note: 'Everything else, from what is left.' },
];

export function GoalsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const summary = useGoalPlans(today);
  const earmarks = useEarmarks();
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [adding, setAdding] = useState<GoalKind | null>(null);
  // The templates are not a section of the page: the + opens them, and one opens the form it already carries.
  const [choosing, setChoosing] = useState(false);

  const plans = summary.data?.plans ?? [];
  // The page's order is the funding order: compulsory goals first, each section in its own rank order.
  const ordered = fundingOrder(plans.map((plan) => ({ ...plan, kind: plan.goal.kind, rank: plan.goal.rank })));
  const cards = ordered.map((plan) => goalCard(plan));
  const shortfall = (summary.data?.neededMonthlyMinor ?? 0) - (summary.data?.capacityMonthlyMinor ?? 0);

  /* The primary action is a corner glyph at every width, not a dark rectangle beside the title. */
  const actions: CornerAction[] =
    adding || editing || choosing
      ? []
      : [{ key: 'add', label: 'Add goal', glyph: <Plus size={22} aria-hidden />, run: () => setChoosing(true) }];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Goals" actions={actions} />
      <ErrorBox error={summary.error} />

      {/* The templates, where the + is: a grouped list of rows with chevrons, and one opens the form. */}
      {choosing && (
        <Sheet title="Add a goal" onClose={() => setChoosing(false)} grouped>
          <InsetGroup>
            {GOAL_TEMPLATES.map((template) => (
              <InsetRow
                key={template.kind}
                title={template.label}
                onClick={() => {
                  setChoosing(false);
                  setAdding(template.kind);
                }}
              />
            ))}
          </InsetGroup>
        </Sheet>
      )}

      {(adding || editing) && (
        <GoalForm
          goal={editing ?? undefined}
          startKind={adding ?? undefined}
          earmarks={earmarks.data ?? []}
          onDone={() => {
            setAdding(null);
            setEditing(null);
          }}
        />
      )}

      {summary.data && (
        <InsetGroup
          header="Every month"
          footer={
            shortfall > 0 ? (
              <>
                Goals ask for <Money minor={shortfall} currency={ws.baseCurrency} /> more than you save. In this order,{' '}
                {summary.data.fits.filter((fit) => fit.fits === 'full').length} fit, and the rest wait. Move a date, lower a target, or reorder them.
              </>
            ) : undefined
          }
        >
          <InsetRow
            title="Goals need each month"
            value={<Money minor={summary.data.neededMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="Set up each month"
            subtitle="Monthly buys and standing transfers"
            value={<Money minor={summary.data.plannedMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
          <InsetRow
            title="You save each month"
            subtitle="Take-home pay − spending − loan principal"
            value={<Money minor={summary.data.capacityMonthlyMinor} currency={ws.baseCurrency} />}
            valueTone="ink"
            chevron={false}
          />
        </InsetGroup>
      )}

      {cards.length === 0 && !adding && summary.isSuccess && <Empty>No goals yet. Start with an emergency fund, education or a holiday.</Empty>}

      {SECTIONS.map((section) => {
        const inSection = ordered
          .map((plan, index) => ({ plan, card: cards[index]! }))
          .filter(({ plan }) => goalClass(plan.goal.kind) === section.key);
        if (inSection.length === 0) return null;
        return (
          <div key={section.key} data-testid={`goals-${section.key}`}>
            <PanelHeader title={section.title} />
            <p className="px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{section.note}</p>
            {/* One row a goal: the figure is read at a glance here, and the goal itself opens on its own page. */}
            <InsetGroup wide>
              {inSection.map(({ card }) => (
                <InsetRow
                  key={card.goalId}
                  testId="goal-row"
                  title={card.name}
                  subtitle={`${card.kindLabel} · by ${card.dueLabel}`}
                  value={<Money minor={card.currentMinor} currency={ws.baseCurrency} />}
                  valueTone="ink"
                  to="/goals/$goalId"
                  params={{ goalId: card.goalId }}
                />
              ))}
            </InsetGroup>
          </div>
        );
      })}

      {plans.some((plan) => plan.links.length > 0) && (
        <InsetGroup header="What each asset is for" footer="Goals never change your net worth or the tax report; they only say what the money is for.">
          {plans.flatMap((plan) =>
            plan.links.map((link) => (
              <InsetRow
                key={`${plan.goalId}-${link.accountId}-${link.kind}`}
                testId="goal-asset"
                title={link.name}
                subtitle={`${link.kind === 'tagged' && link.unitsMicro !== null ? `${formatUnits(link.unitsMicro)} tagged` : 'set aside'} for ${plan.goal.name}`}
                value={<LinkAmount link={link} />}
                valueTone="ink"
                chevron={false}
              />
            )),
          )}
        </InsetGroup>
      )}
    </div>
  );
}
