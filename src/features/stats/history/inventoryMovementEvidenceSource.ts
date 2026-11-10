import { z } from "zod";
import { canSee } from "@/features/permissions/canSee";
import type { PermSetUser } from "@/features/permissions/effective";
import type { OwnerIdFilter } from "@/types/stats";
import { analyticsHistoryEvent, historyUuid } from "./contracts";
import { sameHistoryState } from "./fold";
import type { InventoryBoundaryEvidence } from "./inventoryBoundaryEvidence";
import { MAX_INVENTORY_KEYS } from "./inventoryMovement";

export const corpusRowSchema = z.strictObject({
  event: analyticsHistoryEvent,
  inOpening: z.boolean(),
  inClosing: z.boolean(),
  openingTip: z.boolean(),
  closingTip: z.boolean(),
  closingOrigin: z.boolean(),
});

type CorpusRow = z.output<typeof corpusRowSchema>;
type Boundary = InventoryBoundaryEvidence["opening"];
type ProjectedEvent = InventoryBoundaryEvidence["events"][number];
type ProjectedState = NonNullable<ProjectedEvent["afterState"]>;
type Selection = Boundary["selections"][number];

export interface CapturedBoundary {
  snapshotId: string;
  observedAt: string;
  activationId: string;
  currency: string;
  scope: { pipelineId: string | null; owners: OwnerIdFilter };
  records: readonly unknown[];
}

export interface CurrentInventoryRef {
  kind: "deal" | "pipeline" | "stage";
  entityId: string;
  incarnationId: string;
}

type EvidenceFailure = {
  state: "unavailable";
  reason:
    | "history-incomplete"
    | "history-limit"
    | "history-permission-limited"
    | "retained-history-authority-unavailable"
    | "unmodeled-membership-change";
};

const incomplete = { state: "unavailable", reason: "history-incomplete" } as const;
const permissionLimited = { state: "unavailable", reason: "history-permission-limited" } as const;
const retained = {
  state: "unavailable",
  reason: "retained-history-authority-unavailable",
} as const;
const limit = { state: "unavailable", reason: "history-limit" } as const;
const unmodeled = { state: "unavailable", reason: "unmodeled-membership-change" } as const;
// Separate deal admission from current verification of all deal, stage and pipeline references.
const MAX_CURRENT_REFERENCES = 3 * MAX_INVENTORY_KEYS + 1;

const identity = z.object({ entityId: historyUuid, incarnationId: historyUuid });
const capturedDealProjection = z.object({
  pipelineId: historyUuid,
  stageId: historyUuid,
  ownerId: historyUuid,
  // The capture preserves stored text. Compare the exact value before report-currency decoding.
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  value: z
    .string()
    .regex(/^-?\d{1,14}(\.\d{1,4})?$/)
    .nullable(),
  status: z.enum(["open", "won", "lost"]),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  visibilityLevel: z.enum(["owner", "group", "all"]),
  visibilityGroupId: historyUuid.nullable(),
  visibleToUserIds: z.array(historyUuid),
});
const nullableDealProjection = capturedDealProjection.nullable();
const pipelineProjection = z.object({
  isArchived: z.boolean(),
  visibilityGroupId: historyUuid.nullable(),
});
const stageProjection = z.object({ pipelineId: historyUuid });

type DealProjection = z.output<typeof capturedDealProjection>;
type PipelineProjection = z.output<typeof pipelineProjection>;
type StageProjection = z.output<typeof stageProjection>;

interface Tips {
  opening: CorpusRow | undefined;
  closing: CorpusRow;
  origin: CorpusRow;
}
interface DealSides {
  before: DealProjection | null;
  after: DealProjection | null;
}
interface DealHistory {
  rows: CorpusRow[];
  tips: Tips;
  sides: Map<string, DealSides>;
}
interface Dependency<P> {
  ref: CurrentInventoryRef;
  opening: P | null;
  closing: P;
  sides: P[];
}
interface Dependencies {
  pipelines: Map<string, Dependency<PipelineProjection> | null>;
  stages: Map<string, Dependency<StageProjection> | null>;
  permittedPipelines: ReadonlySet<string>;
}
type DraftBoundary = CapturedBoundary & { definitionId: string; selections: Selection[] };
interface Prepared {
  state: "ready";
  evidence: { opening: DraftBoundary; closing: DraftBoundary; events: ProjectedEvent[] };
  currentRefs: CurrentInventoryRef[];
}

function keyOf(entity: { entityId: string; incarnationId: string }) {
  return `${entity.entityId}:${entity.incarnationId}`;
}

function candidateKeys(opening: CapturedBoundary, closing: CapturedBoundary): Set<string> | null {
  const keys = new Set<string>();
  for (const record of [...opening.records, ...closing.records]) {
    const parsed = identity.safeParse(record);
    if (!parsed.success) return null;
    keys.add(keyOf(parsed.data));
  }
  return keys;
}

function groupRows(rows: readonly CorpusRow[]) {
  const deals = new Map<string, CorpusRow[]>();
  const pipelines = new Map<string, CorpusRow[]>();
  const stages = new Map<string, CorpusRow[]>();
  for (const row of rows) {
    if (!row.inClosing) continue;
    const { entityKind, entityId } = row.event;
    const groups = entityKind === "deal" ? deals : entityKind === "pipeline" ? pipelines : stages;
    const key = entityKind === "deal" ? keyOf(row.event) : entityId;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return { deals, pipelines, stages };
}

function selectTips(rows: readonly CorpusRow[]): Tips | null {
  const opening = rows.filter((row) => row.openingTip);
  const closing = rows.filter((row) => row.closingTip);
  const origin = rows.filter((row) => row.closingOrigin);
  if (opening.length > 1 || closing.length !== 1 || origin.length !== 1) return null;
  if (closing[0] === undefined || origin[0] === undefined) return null;
  return { opening: opening[0], closing: closing[0], origin: origin[0] };
}

function coherentChain(rows: readonly CorpusRow[], tips: Tips): boolean {
  if (rows[0] !== tips.origin || rows.at(-1) !== tips.closing) return false;
  if (tips.origin.event.eventKind !== "baseline" && tips.origin.event.eventKind !== "insert")
    return false;
  let previous = tips.origin.event;
  let outsideOpening = !tips.origin.inOpening;
  for (const row of rows.slice(1)) {
    const current = row.event;
    if (
      current.incarnationId !== previous.incarnationId ||
      (current.eventKind !== "update" && current.eventKind !== "delete") ||
      previous.afterState === null ||
      (outsideOpening && row.inOpening) ||
      !sameHistoryState(previous.afterState, current.beforeState)
    )
      return false;
    previous = current;
    outsideOpening ||= !row.inOpening;
  }
  return true;
}

function parseDependency<P>(
  rows: readonly CorpusRow[],
  schema: z.ZodType<P>,
): Dependency<P> | null {
  const tips = selectTips(rows);
  if (tips === null || !coherentChain(rows, tips)) return null;
  const closing = schema.safeParse(tips.closing.event.afterState);
  if (!closing.success) return null;
  const opening = tips.opening ? schema.safeParse(tips.opening.event.afterState) : null;
  if (opening !== null && !opening.success) return null;
  const sides: P[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row.event.afterState);
    if (!parsed.success) return null;
    sides.push(parsed.data);
  }
  const { entityId, incarnationId, entityKind: kind } = tips.closing.event;
  return {
    ref: { entityId, incarnationId, kind },
    opening: opening?.data ?? null,
    closing: closing.data,
    sides,
  };
}

function metadataChanged(row: CorpusRow): boolean {
  if (!row.inClosing || row.inOpening) return false;
  const event = row.event;
  if (event.entityKind === "deal") return false;
  if (event.entityKind === "pipeline") {
    const before = pipelineProjection.safeParse(event.beforeState);
    const after = pipelineProjection.safeParse(event.afterState);
    return (
      !before.success ||
      !after.success ||
      before.data.isArchived !== after.data.isArchived ||
      before.data.visibilityGroupId !== after.data.visibilityGroupId
    );
  }
  if (event.eventKind === "insert") return false;
  const before = stageProjection.safeParse(event.beforeState);
  const after = stageProjection.safeParse(event.afterState);
  return !before.success || !after.success || before.data.pipelineId !== after.data.pipelineId;
}

function parseDealHistory(rows: CorpusRow[]): DealHistory | null {
  const tips = selectTips(rows);
  if (tips === null || !coherentChain(rows, tips)) return null;
  const sides = new Map<string, DealSides>();
  for (const { event } of rows) {
    const before = nullableDealProjection.safeParse(event.beforeState);
    const after = nullableDealProjection.safeParse(event.afterState);
    if (!before.success || !after.success) return null;
    sides.set(event.eventId, { before: before.data, after: after.data });
  }
  return { rows, tips, sides };
}

function containsCurrency(history: DealHistory, currency: string): boolean {
  for (const { before, after } of history.sides.values()) {
    if (before?.currency === currency || after?.currency === currency) return true;
  }
  return false;
}

interface ReportSelection {
  actor: PermSetUser;
  currency: string;
  pipelineId: string | null;
  owners: ReadonlySet<string> | null;
}

function historicalPermission(
  actor: PermSetUser,
  state: DealProjection,
  pipeline: PipelineProjection,
) {
  return canSee(actor, {
    kind: "deal",
    ownerId: state.ownerId,
    visibilityLevel: state.visibilityLevel,
    visibilityGroupId: state.visibilityGroupId,
    visibleToUserIds: state.visibleToUserIds,
    pipelineVisibilityGroupId: pipeline.visibilityGroupId,
  });
}

function couldBeSelected(
  state: DealProjection | null | undefined,
  selection: ReportSelection,
  dependencies: Dependencies,
): boolean {
  if (state == null || state.archivedAt !== null || state.deletedAt !== null) return false;
  if (state.currency !== selection.currency) return false;
  if (selection.pipelineId !== null && state.pipelineId !== selection.pipelineId) return false;
  if (selection.owners !== null && !selection.owners.has(state.ownerId)) return false;
  const pipeline = dependencies.pipelines.get(state.pipelineId);
  // Unresolved metadata cannot establish that a potentially relevant row was out of scope.
  return (
    pipeline == null ||
    (!pipeline.closing.isArchived && historicalPermission(selection.actor, state, pipeline.closing))
  );
}

function touchesReport(
  history: DealHistory,
  selection: ReportSelection,
  dependencies: Dependencies,
) {
  const opening = history.tips.opening?.event;
  if (
    opening &&
    couldBeSelected(history.sides.get(opening.eventId)?.after, selection, dependencies)
  )
    return true;
  const closing = history.tips.closing.event;
  if (couldBeSelected(history.sides.get(closing.eventId)?.after, selection, dependencies))
    return true;
  for (const row of history.rows) {
    if (row.inOpening) continue;
    const sides = history.sides.get(row.event.eventId);
    if (
      couldBeSelected(sides?.before, selection, dependencies) ||
      couldBeSelected(sides?.after, selection, dependencies)
    )
      return true;
  }
  return false;
}

function addRef(refs: Map<string, CurrentInventoryRef>, ref: CurrentInventoryRef) {
  refs.set(`${ref.kind}:${ref.entityId}:${ref.incarnationId}`, ref);
}

function projectAuthorizedSide(
  state: DealProjection | null,
  dependencies: Dependencies,
  actor: PermSetUser,
  refs: Map<string, CurrentInventoryRef>,
): ProjectedState | null | EvidenceFailure {
  if (state === null) return null;
  const pipeline = dependencies.pipelines.get(state.pipelineId);
  const stage = dependencies.stages.get(state.stageId);
  if (pipeline == null || stage == null || stage.closing.pipelineId !== state.pipelineId)
    return incomplete;
  if (
    !dependencies.permittedPipelines.has(state.pipelineId) ||
    !historicalPermission(actor, state, pipeline.closing)
  )
    return permissionLimited;
  addRef(refs, pipeline.ref);
  addRef(refs, stage.ref);
  return {
    pipelineId: state.pipelineId,
    stageId: state.stageId,
    ownerId: state.ownerId,
    currency: state.currency,
    status: state.status,
    value: state.value,
    lifecycle:
      state.deletedAt !== null ? "removed" : state.archivedAt !== null ? "archived" : "active",
    pipelineActive: !pipeline.closing.isArchived,
  };
}

function checkBoundaryDependencies(
  row: CorpusRow | undefined,
  side: "opening" | "closing",
  history: DealHistory,
  dependencies: Dependencies,
): boolean {
  if (row === undefined) return true;
  const projected = history.sides.get(row.event.eventId)?.after;
  if (projected == null) return false;
  const pipeline = dependencies.pipelines.get(projected.pipelineId)?.[side];
  const stage = dependencies.stages.get(projected.stageId)?.[side];
  return pipeline != null && stage?.pipelineId === projected.pipelineId;
}

function toProjectedEvent(
  row: CorpusRow,
  history: DealHistory,
  dependencies: Dependencies,
  actor: PermSetUser,
  refs: Map<string, CurrentInventoryRef>,
): ProjectedEvent | EvidenceFailure {
  const { activationId, entityId, incarnationId, eventId, ordinal, transactionId, eventKind } =
    row.event;
  const sides = history.sides.get(eventId);
  if (sides === undefined) return incomplete;
  const before = projectAuthorizedSide(sides.before, dependencies, actor, refs);
  if (before !== null && "state" in before) return before;
  const after = projectAuthorizedSide(sides.after, dependencies, actor, refs);
  if (after !== null && "state" in after) return after;
  return {
    activationId,
    entityId,
    incarnationId,
    eventId,
    ordinal,
    transactionId,
    kind: eventKind,
    membership: row.inOpening ? "both-cuts" : "closing-only",
    beforeState: before,
    afterState: after,
  };
}

function selectionAt(history: DealHistory, side: "opening" | "closing"): Selection {
  const row = history.tips[side];
  const { entityId, incarnationId, eventId } = history.tips.origin.event;
  return row === undefined
    ? { entityId, incarnationId, kind: "absent-before-insert", insertEventId: eventId }
    : {
        entityId,
        incarnationId,
        kind: "present",
        eventId: row.event.eventId,
        ordinal: row.event.ordinal,
      };
}

interface Preparation {
  dependencies: Dependencies;
  actor: PermSetUser;
  refs: Map<string, CurrentInventoryRef>;
  events: ProjectedEvent[];
  opening: Selection[];
  closing: Selection[];
}

function appendDeal(history: DealHistory, work: Preparation): EvidenceFailure | null {
  if (history.rows.some((row) => row.event.eventKind === "delete")) return retained;
  const { tips } = history;
  if (
    !checkBoundaryDependencies(tips.opening, "opening", history, work.dependencies) ||
    !checkBoundaryDependencies(tips.closing, "closing", history, work.dependencies)
  )
    return incomplete;
  const { entityId, incarnationId } = tips.closing.event;
  addRef(work.refs, { kind: "deal", entityId, incarnationId });
  for (const row of history.rows) {
    const event = toProjectedEvent(row, history, work.dependencies, work.actor, work.refs);
    if ("state" in event) return event;
    work.events.push(event);
  }
  work.opening.push(selectionAt(history, "opening"));
  work.closing.push(selectionAt(history, "closing"));
  if (work.opening.length > MAX_INVENTORY_KEYS || work.refs.size > MAX_CURRENT_REFERENCES)
    return limit;
  return null;
}

function admitNamedPipeline(pipelineId: string | null, work: Preparation): EvidenceFailure | null {
  if (pipelineId === null) return null;
  const pipeline = work.dependencies.pipelines.get(pipelineId);
  if (pipeline == null || pipeline.opening === null) return incomplete;
  if (pipeline.closing.isArchived) return permissionLimited;
  if (!work.dependencies.permittedPipelines.has(pipelineId)) return permissionLimited;
  addRef(work.refs, pipeline.ref);
  return null;
}

function stageDependency(rows: readonly CorpusRow[]): Dependency<StageProjection> | null {
  const stage = parseDependency(rows, stageProjection);
  if (stage === null || stage.sides.some((side) => side.pipelineId !== stage.closing.pipelineId))
    return null;
  return stage;
}

function resolveDependencies(
  groups: ReturnType<typeof groupRows>,
  actor: PermSetUser,
): Dependencies {
  const pipelines = new Map<string, Dependency<PipelineProjection> | null>();
  const permittedPipelines = new Set<string>();
  for (const [id, rows] of groups.pipelines) {
    const pipeline = parseDependency(rows, pipelineProjection);
    pipelines.set(id, pipeline);
    if (pipeline === null) continue;
    if (
      actor.type === "admin" ||
      pipeline.sides.every(
        (side) => side.visibilityGroupId === null || actor.groupIds.has(side.visibilityGroupId),
      )
    )
      permittedPipelines.add(id);
  }
  const stages = new Map([...groups.stages].map(([id, rows]) => [id, stageDependency(rows)]));
  return { pipelines, stages, permittedPipelines };
}

function appendSelectedDeals(
  deals: ReadonlyMap<string, CorpusRow[]>,
  pinnedKeys: Set<string>,
  selection: ReportSelection,
  work: Preparation,
): EvidenceFailure | null {
  for (const [key, rows] of deals) {
    const history = parseDealHistory(rows);
    if (history === null) return incomplete;
    const pinned = pinnedKeys.delete(key);
    // A malformed history cannot prove exclusion. Only a coherent chain with no exact
    // selected currency on any captured side can bypass the stricter report evidence decoder.
    if (!pinned && !containsCurrency(history, selection.currency)) continue;
    if (!pinned && !touchesReport(history, selection, work.dependencies)) continue;
    const failure = appendDeal(history, work);
    if (failure !== null) return failure;
  }
  return pinnedKeys.size === 0 ? null : incomplete;
}

export function prepareMovementEvidence(
  corpus: readonly CorpusRow[],
  opening: CapturedBoundary,
  closing: CapturedBoundary,
  actor: PermSetUser,
): Prepared | EvidenceFailure {
  if (corpus.some((row) => row.inOpening && !row.inClosing)) return incomplete;
  if (corpus.some(metadataChanged)) return unmodeled;
  const keys = candidateKeys(opening, closing);
  if (keys === null) return incomplete;
  const groups = groupRows(corpus);
  const work: Preparation = {
    dependencies: resolveDependencies(groups, actor),
    actor,
    refs: new Map(),
    events: [],
    opening: [],
    closing: [],
  };
  const named = admitNamedPipeline(opening.scope.pipelineId, work);
  if (named !== null) return named;
  const selection = {
    actor,
    currency: opening.currency,
    pipelineId: opening.scope.pipelineId,
    owners: opening.scope.owners.everyone ? null : new Set(opening.scope.owners.ids),
  };

  const failure = appendSelectedDeals(groups.deals, keys, selection, work);
  if (failure !== null) return failure;

  const definitionId = "current-pipeline-inventory-v1";
  return {
    state: "ready",
    evidence: {
      opening: { ...opening, definitionId, selections: work.opening },
      closing: { ...closing, definitionId, selections: work.closing },
      events: work.events,
    },
    currentRefs: [...work.refs.values()],
  };
}
