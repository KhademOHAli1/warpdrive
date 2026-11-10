import { z } from "zod";
import { historyOrdinal, historyUuid } from "./contracts";
import {
  type InventoryBoundary,
  type InventoryBoundaryFact,
  type InventoryMovementChange,
  type InventoryMovementInput,
  type InventoryState,
  MAX_INVENTORY_CHANGES,
  MAX_INVENTORY_EVENT_WITNESSES,
  MAX_INVENTORY_KEYS,
} from "./inventoryMovement";

const uuid = historyUuid.transform((id) => id.toLowerCase());
const identity = { entityId: uuid, incarnationId: uuid };
const currency = z.string().regex(/^[A-Z]{3}$/);
const rawList = z.custom<readonly unknown[]>((value) => Array.isArray(value));
const ownerIds = z
  .custom<string[]>((value) => Array.isArray(value) && value.length <= MAX_INVENTORY_KEYS)
  .pipe(z.array(uuid).refine((ids) => new Set(ids).size === ids.length));
const scopeSchema = z.strictObject({
  pipelineId: uuid.nullable(),
  owners: z.union([
    z.strictObject({ everyone: z.literal(true) }),
    z.strictObject({ everyone: z.literal(false), ids: ownerIds }),
  ]),
});
const proofSchema = z.strictObject({
  completeness: z.enum(["complete", "incomplete"]),
  cutOrder: z.enum(["native-ordered", "unproven"]),
  authority: z.enum([
    "current-live-authorized",
    "permission-limited",
    "retained-history-unavailable",
  ]),
  membershipDrivers: z.enum(["qualified", "unmodeled"]),
});
const factFields = {
  pipelineId: uuid,
  stageId: uuid,
  ownerId: uuid,
  status: z.enum(["open", "won", "lost"]),
  currency,
  value: z
    .string()
    .regex(/^-?\d{1,14}(\.\d{1,4})?$/)
    .nullable(),
};
const projectedState = z.strictObject({
  ...factFields,
  lifecycle: z.enum(["active", "archived", "removed"]),
  // A proved pipeline lifecycle input, independent of the actor's authorization.
  pipelineActive: z.boolean(),
});
const storedFact = z.strictObject({ ...identity, ...factFields, tipOrdinal: historyOrdinal });
const selection = z.discriminatedUnion("kind", [
  z.strictObject({
    ...identity,
    kind: z.literal("present"),
    eventId: uuid,
    ordinal: historyOrdinal,
  }),
  z.strictObject({ ...identity, kind: z.literal("absent-before-insert"), insertEventId: uuid }),
]);
const boundary = z.strictObject({
  snapshotId: uuid,
  observedAt: z
    .string()
    .datetime()
    .regex(/\.\d{6}Z$/),
  activationId: uuid,
  definitionId: z
    .string()
    .min(1)
    .max(256)
    .refine((id) => id === id.trim()),
  currency,
  scope: scopeSchema,
  records: rawList,
  selections: rawList,
});
const eventSchema = z.strictObject({
  ...identity,
  activationId: uuid,
  eventId: uuid,
  ordinal: historyOrdinal,
  transactionId: z
    .string()
    .refine((id) => /^[1-9]\d{0,19}$/.test(id) && BigInt(id) <= 18_446_744_073_709_551_615n),
  kind: z.enum(["baseline", "insert", "update", "delete"]),
  membership: z.enum(["both-cuts", "closing-only"]),
  beforeState: projectedState.nullable(),
  afterState: projectedState.nullable(),
});
const inputSchema = z.strictObject({
  proof: proofSchema,
  opening: boundary,
  closing: boundary,
  events: rawList,
});

type Boundary = z.output<typeof boundary>;
type Event = z.output<typeof eventSchema>;
type ProjectedState = z.output<typeof projectedState>;
type StoredFact = z.output<typeof storedFact>;
type Selection = z.output<typeof selection>;
type Entity = Pick<Event, "entityId" | "incarnationId">;
type Scope = { pipelineId: string | null; owners: ReadonlySet<string> | null };

export type InventoryBoundaryEvidence = {
  proof: z.input<typeof proofSchema>;
  opening: Omit<z.input<typeof boundary>, "records" | "selections"> & {
    records: readonly z.input<typeof storedFact>[];
    selections: readonly z.input<typeof selection>[];
  };
  closing: InventoryBoundaryEvidence["opening"];
  events: readonly z.input<typeof eventSchema>[];
};

type FailureReason =
  | "invalid-evidence"
  | "bounded-limit"
  | "snapshot-incompatible"
  | "cut-order-unproven"
  | "history-incomplete"
  | "history-permission-limited"
  | "retained-history-authority-unavailable"
  | "unmodeled-membership-change"
  | "invalid-chain"
  | "duplicate-evidence"
  | "conflicting-incarnation"
  | "boundary-selection-mismatch"
  | "boundary-book-mismatch";

type Unavailable = { state: "unavailable"; reason: FailureReason };
export type InventoryBoundaryEvidenceResult =
  | Unavailable
  | { state: "ready"; movement: InventoryMovementInput };

function unavailable(reason: FailureReason): Unavailable {
  return { state: "unavailable", reason };
}

function proofFailure(proof: z.output<typeof proofSchema>): Unavailable | null {
  if (proof.cutOrder !== "native-ordered") return unavailable("cut-order-unproven");
  if (proof.completeness !== "complete") return unavailable("history-incomplete");
  if (proof.authority === "permission-limited") return unavailable("history-permission-limited");
  if (proof.authority === "retained-history-unavailable")
    return unavailable("retained-history-authority-unavailable");
  if (proof.membershipDrivers !== "qualified") return unavailable("unmodeled-membership-change");
  return null;
}

function normalizedScope(scope: Boundary["scope"]): Scope {
  return {
    pipelineId: scope.pipelineId,
    owners: scope.owners.everyone ? null : new Set(scope.owners.ids),
  };
}

function compatibleScopes(left: Scope, right: Scope): boolean {
  if (left.pipelineId !== right.pipelineId) return false;
  const leftOwners = left.owners;
  const rightOwners = right.owners;
  if (leftOwners === null || rightOwners === null) return leftOwners === rightOwners;
  return leftOwners.size === rightOwners.size && [...leftOwners].every((id) => rightOwners.has(id));
}

function commonScope(opening: Boundary, closing: Boundary): Scope | Unavailable {
  if (opening.snapshotId === closing.snapshotId || opening.observedAt >= closing.observedAt)
    return unavailable("cut-order-unproven");
  const scope = normalizedScope(opening.scope);
  if (
    opening.activationId !== closing.activationId ||
    opening.definitionId !== closing.definitionId ||
    opening.currency !== closing.currency ||
    !compatibleScopes(scope, normalizedScope(closing.scope))
  )
    return unavailable("snapshot-incompatible");
  return scope;
}

function keyOf({ entityId, incarnationId }: Entity): string {
  return `${entityId}:${incarnationId}`;
}

interface EventIndex {
  ids: Set<string>;
  ordinals: Set<string>;
  incarnations: Map<string, string>;
  entities: Map<string, string>;
  transactions: Map<string, Event["membership"]>;
}

function recordWitness(event: Event, index: EventIndex): Unavailable | null {
  if (index.ids.has(event.eventId) || index.ordinals.has(event.ordinal))
    return unavailable("duplicate-evidence");
  const incarnation = index.incarnations.get(event.entityId);
  const entity = index.entities.get(event.incarnationId);
  if (
    (incarnation !== undefined && incarnation !== event.incarnationId) ||
    (entity !== undefined && entity !== event.entityId)
  )
    return unavailable("conflicting-incarnation");
  const membership = index.transactions.get(event.transactionId);
  if (membership !== undefined && membership !== event.membership)
    return unavailable("cut-order-unproven");
  index.ids.add(event.eventId);
  index.ordinals.add(event.ordinal);
  index.incarnations.set(event.entityId, event.incarnationId);
  index.entities.set(event.incarnationId, event.entityId);
  index.transactions.set(event.transactionId, event.membership);
  return null;
}

function groupEvents(
  rows: readonly unknown[],
  activationId: string,
): Map<string, Event[]> | Unavailable {
  const groups = new Map<string, Event[]>();
  const index: EventIndex = {
    ids: new Set(),
    ordinals: new Set(),
    incarnations: new Map(),
    entities: new Map(),
    transactions: new Map(),
  };
  for (const row of rows) {
    const parsed = eventSchema.safeParse(row);
    if (!parsed.success || parsed.data.activationId !== activationId)
      return unavailable("invalid-evidence");
    const event = parsed.data;
    if (event.kind === "delete") return unavailable("retained-history-authority-unavailable");
    const failure = recordWitness(event, index);
    if (failure !== null) return failure;
    const key = keyOf(event);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [event]);
    else group.push(event);
    if (groups.size > MAX_INVENTORY_KEYS) return unavailable("bounded-limit");
  }
  return groups;
}

function sameFactState(
  left: Pick<StoredFact, keyof typeof factFields>,
  right: Pick<StoredFact, keyof typeof factFields>,
): boolean {
  return (
    left.pipelineId === right.pipelineId &&
    left.stageId === right.stageId &&
    left.ownerId === right.ownerId &&
    left.status === right.status &&
    left.currency === right.currency &&
    left.value === right.value
  );
}

function matchesState(left: ProjectedState | null, right: ProjectedState | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.lifecycle === right.lifecycle &&
    left.pipelineActive === right.pipelineActive &&
    sameFactState(left, right)
  );
}

type PresentEvent = Event & { afterState: ProjectedState };
interface Chain {
  origin: PresentEvent;
  opening: PresentEvent | null;
  closing: PresentEvent;
  interval: PresentEvent[];
}

function isOrigin(event: Event): event is PresentEvent {
  if (event.beforeState !== null || event.afterState === null) return false;
  return event.kind === "insert" || (event.kind === "baseline" && event.membership === "both-cuts");
}

function follows(prior: PresentEvent, event: Event): event is PresentEvent {
  return (
    event.kind === "update" &&
    event.afterState !== null &&
    matchesState(prior.afterState, event.beforeState) &&
    (prior.membership === "both-cuts" || event.membership === "closing-only")
  );
}

function compareOrdinals(left: Event, right: Event): number {
  const a = BigInt(left.ordinal);
  const b = BigInt(right.ordinal);
  return a < b ? -1 : a > b ? 1 : 0;
}

function readChain(rows: Event[]): Chain | Unavailable {
  const [origin, ...tail] = rows.sort(compareOrdinals);
  if (origin === undefined || !isOrigin(origin)) return unavailable("invalid-chain");
  let opening = origin.membership === "both-cuts" ? origin : null;
  let prior = origin;
  const interval = opening === null ? [origin] : [];
  const seen = new Set([origin.transactionId]);
  for (const event of tail) {
    if (!follows(prior, event)) return unavailable("invalid-chain");
    if (event.transactionId !== prior.transactionId && seen.has(event.transactionId))
      return unavailable("invalid-chain");
    seen.add(event.transactionId);
    if (event.membership === "both-cuts") opening = event;
    else interval.push(event);
    prior = event;
  }
  return { origin, opening, closing: prior, interval };
}

function inScope(state: ProjectedState, scope: Scope): boolean {
  return (
    state.pipelineActive &&
    (scope.pipelineId === null || state.pipelineId === scope.pipelineId) &&
    (scope.owners === null || scope.owners.has(state.ownerId))
  );
}

function inventoryState(state: ProjectedState | null, scope: Scope): InventoryState | null {
  if (state === null) return null;
  return {
    status: state.status,
    lifecycle: state.lifecycle,
    inScope: inScope(state, scope),
    pipelineId: state.pipelineId,
    ownerId: state.ownerId,
    currency: state.currency,
    value: state.value,
  };
}

function matchSelection(choice: Selection | undefined, chain: Chain, side: "opening" | "closing") {
  const tip = chain[side];
  if (tip === null) {
    return choice?.kind === "absent-before-insert" && choice.insertEventId === chain.origin.eventId;
  }
  return (
    choice?.kind === "present" && choice.eventId === tip.eventId && choice.ordinal === tip.ordinal
  );
}

function indexRows<T extends Entity>(
  rows: readonly unknown[],
  schema: z.ZodType<T>,
  reason: FailureReason,
): Map<string, T> | Unavailable {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (!parsed.success) return unavailable(reason);
    const key = keyOf(parsed.data);
    if (indexed.has(key)) return unavailable(reason);
    indexed.set(key, parsed.data);
  }
  return indexed;
}

function admittedByWriter(state: ProjectedState, scope: Scope, currency: string): boolean {
  return state.lifecycle === "active" && state.currency === currency && inScope(state, scope);
}

function consumeStoredFact(
  stored: Map<string, StoredFact>,
  key: string,
  tip: PresentEvent | null,
  scope: Scope,
  currency: string,
): boolean {
  if (tip === null || !admittedByWriter(tip.afterState, scope, currency)) return true;
  const record = stored.get(key);
  if (
    record === undefined ||
    record.tipOrdinal !== tip.ordinal ||
    !sameFactState(record, tip.afterState)
  )
    return false;
  stored.delete(key);
  return true;
}

function verifyFrame(
  frame: Boundary,
  chains: ReadonlyMap<string, Chain>,
  scope: Scope,
  side: "opening" | "closing",
): InventoryBoundary | Unavailable {
  const selected = indexRows(frame.selections, selection, "boundary-selection-mismatch");
  if (!(selected instanceof Map)) return selected;
  if (selected.size !== chains.size) return unavailable("boundary-selection-mismatch");
  const stored = indexRows(frame.records, storedFact, "boundary-book-mismatch");
  if (!(stored instanceof Map)) return stored;
  const facts: InventoryBoundaryFact[] = [];

  for (const [key, chain] of chains) {
    if (!matchSelection(selected.get(key), chain, side))
      return unavailable("boundary-selection-mismatch");
    const tip = chain[side];
    if (!consumeStoredFact(stored, key, tip, scope, frame.currency))
      return unavailable("boundary-book-mismatch");
    facts.push({
      entityId: chain.origin.entityId,
      incarnationId: chain.origin.incarnationId,
      state: inventoryState(tip?.afterState ?? null, scope),
    });
  }
  if (stored.size !== 0) return unavailable("boundary-book-mismatch");
  return {
    activationId: frame.activationId,
    definitionId: frame.definitionId,
    currency: frame.currency,
    facts,
  };
}

function recordPipelineState(states: Map<string, boolean>, side: ProjectedState | null): boolean {
  if (side === null) return true;
  const prior = states.get(side.pipelineId);
  if (prior !== undefined && prior !== side.pipelineActive) return false;
  states.set(side.pipelineId, side.pipelineActive);
  return true;
}

function stablePipelineStates(chains: ReadonlyMap<string, Chain>): boolean {
  const states = new Map<string, boolean>();
  for (const chain of chains.values()) {
    if (!recordPipelineState(states, chain.opening?.afterState ?? null)) return false;
    for (const event of chain.interval) {
      if (
        !recordPipelineState(states, event.beforeState) ||
        !recordPipelineState(states, event.afterState)
      )
        return false;
    }
  }
  return true;
}

type MutableChange = Omit<InventoryMovementChange, "eventIds"> & { eventIds: string[] };

function startChange(event: PresentEvent, scope: Scope): MutableChange {
  return {
    activationId: event.activationId,
    entityId: event.entityId,
    incarnationId: event.incarnationId,
    transactionId: event.transactionId,
    firstOrdinal: event.ordinal,
    lastOrdinal: event.ordinal,
    eventIds: [event.eventId],
    evidence: "observed-row-change",
    beforeState: inventoryState(event.beforeState, scope),
    afterState: inventoryState(event.afterState, scope),
  };
}

function movementChanges(chains: ReadonlyMap<string, Chain>, scope: Scope) {
  const changes: MutableChange[] = [];
  for (const chain of chains.values()) {
    let prior: MutableChange | undefined;
    for (const event of chain.interval) {
      if (prior?.transactionId === event.transactionId) {
        prior.lastOrdinal = event.ordinal;
        prior.afterState = inventoryState(event.afterState, scope);
        prior.eventIds.push(event.eventId);
        continue;
      }
      prior = startChange(event, scope);
      changes.push(prior);
      if (changes.length > MAX_INVENTORY_CHANGES) return unavailable("bounded-limit");
    }
  }
  return changes;
}

function readChains(events: readonly unknown[], activationId: string) {
  const groups = groupEvents(events, activationId);
  if (!(groups instanceof Map)) return groups;
  const chains = new Map<string, Chain>();
  for (const [key, rows] of groups) {
    const chain = readChain(rows);
    if ("state" in chain) return chain;
    chains.set(key, chain);
  }
  return chains;
}

function overLimit(boundary: Boundary): boolean {
  return (
    boundary.records.length > MAX_INVENTORY_KEYS || boundary.selections.length > MAX_INVENTORY_KEYS
  );
}

/**
 * Cross-check the bounded projected evidence supplied by a qualified SQL reader. The SQL
 * reader must independently prove full corpus selection, native membership, source identity,
 * and authority for every projected side. No field here grants database or viewer authority.
 */
export function verifyInventoryBoundaryEvidence(input: unknown): InventoryBoundaryEvidenceResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return unavailable("invalid-evidence");
  const { proof, opening, closing, events } = parsed.data;
  const denied = proofFailure(proof);
  if (denied !== null) return denied;
  if (overLimit(opening) || overLimit(closing) || events.length > MAX_INVENTORY_EVENT_WITNESSES)
    return unavailable("bounded-limit");

  const scope = commonScope(opening, closing);
  if ("state" in scope) return scope;
  const chains = readChains(events, opening.activationId);
  if (!(chains instanceof Map)) return chains;
  if (!stablePipelineStates(chains)) return unavailable("unmodeled-membership-change");
  const first = verifyFrame(opening, chains, scope, "opening");
  if ("state" in first) return first;
  const last = verifyFrame(closing, chains, scope, "closing");
  if ("state" in last) return last;
  const changes = movementChanges(chains, scope);
  if (!Array.isArray(changes)) return changes;
  return { state: "ready", movement: { opening: first, closing: last, changes } };
}
