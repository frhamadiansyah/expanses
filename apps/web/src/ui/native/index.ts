/**
 * The native-iPhone kit: seven primitives, their tokens, and the pure functions that decide the hard cases.
 *
 * One import brings the palette with it, so adopting a primitive never means remembering to edit a global
 * stylesheet as well. Nothing in here fetches, validates or knows what a bill is — these are shapes.
 */

import './tokens.css';

/* The primitives. */
export { InsetGroup, InsetRow, toneClass, type GroupChild, type InsetRowProps } from './InsetList';
export { CornerButton, LargeTitle } from './NavTitle';
export { SegmentedControl } from './Segmented';
export { Hero, ProgressBar } from './Hero';
export { DestructiveRow, PickerRow, ReadOnlyRow, SearchField, SelectRow, SubmitRow, SwitchRow, TextRow, FORM_KINDS } from './FormRow';
export { CardStack, type WalletCard } from './CardStack';
export { Panel, PanelHeader, SCREEN } from './Panel';
export { Figure, RecordTable, type RecordColumn, type RecordDetail, type RecordShape } from './RecordTable';
/* The shared parts for a figure in another currency and a row that adds its children up (pockets, then securities). */
export { ApproxFigure, GroupedRow } from './Grouped';
export { approxLine, groupedFigure, rateLine } from './approx';

/* The decisions, exported so a screen can ask the same questions the components ask. */
export { CHEVRON, GROUP_GAP, GROUP_RADIUS, MIN_TEXT, PHONE_WIDTH, ROW_ICON, ROW_PAD_X, ROW_PAD_Y, TAP, rowHeight, tapReach, textWidth } from './metrics';
export { groupHeader, rowPositions, type GroupHeader, type HeaderProgress, type RowPosition } from './group';
export { iconTint, moneyTone, planRow, type Direction, type RowLayout, type RowShape, type Tone } from './row';
export { activeSegment, PHONE_MAX, SEGMENT_HEIGHT, SEGMENT_MORE, fitSegments, segmentRoute, type PlacedSegment, type Segment, type SegmentPlan, type SegmentRoute } from './segments';
export { CORNER_MAX, backLabel, planCornerActions, type CornerAction, type CornerPlan } from './title';
export { heroFigure, progressFraction, progressPercent, progressTone, type HeroFigure } from './hero-figure';
export { planFormRow, planSwitchRow, type FormKind, type FormRowPlan, type SwitchRowPlan } from './form-row';
export { planRecordTable, reachableColumns, type PhoneForm, type RecordDestination, type RecordTablePlan } from './record-table';
export { planPanel, type PanelPlan } from './surface';
export { CARD_H, CARD_W, FAN_X, STRIP, cardFigure, cardsBeforeScrolling, stackLayout, type StackLayout, type StackedCard } from './card-stack';
