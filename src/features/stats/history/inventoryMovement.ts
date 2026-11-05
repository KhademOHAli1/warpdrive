import { z } from "zod";
import { historyOrdinal, historyUuid } from "./contracts";

export const MAX_INVENTORY_KEYS = 5_000;
export const MAX_INVENTORY_CHANGES = 10_000;
export const MAX_INVENTORY_EVENT_WITNESSES = 50_000;

const SCALE = 10_000n;
const uuid = historyUuid.transform((value) => value.toLowerCase());
const currencyCode = z.string().min(1);
const xid8 = z
  .string()
  .refine(
    (value) =>
      value.length <= 20 &&
      value === value.trim() &&
      /^[1-9][0-9]*$/.test(value) &&
      BigInt(value) <= 18_446_744_073_709_551_615n,
  );
const rawList = z.custom<readonly unknown[]>((value) => Array.isArray(value));

function fixedUnits(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(4, "0")}`);
}

function fixedDecimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(4, "0");
  return `${value < 0n ? "-" : ""}${absolute / SCALE}.${fraction}`;
}

// Match the captured numeric(18,4) domain before converting to exact signed units.
const exactValue = z
  .string()
  .refine((value) => value === value.trim() && /^-?[0-9]{1,14}(?:\.[0-9]{1,4})?$/.test(value))
  .transform(fixedUnits);
const stateSchema = z.strictObject({
  status: z.enum(["open", "won", "lost"]),
  lifecycle: z.enum(["active", "archived", "removed"]),
  // Resolved by the caller under the same report definition, independently of currency.
  inScope: z.boolean(),
  pipelineId: uuid,
  ownerId: uuid,
  currency: currencyCode,
  value: exactValue.nullable(),
});

const identity = { entityId: uuid, incarnationId: uuid };
const factSchema = z.strictObject({ ...identity, state: stateSchema.nullable() });
const frameSchema = z.strictObject({
  activationId: uuid,
  definitionId: z.string().min(1),
  currency: currencyCode,
  facts: rawList,
});
const inputSchema = z.strictObject({
  opening: frameSchema,
  closing: frameSchema,
  changes: rawList,
});
const changeSchema = z.strictObject({
  ...identity,
  activationId: uuid,
  transactionId: xid8,
  firstOrdinal: historyOrdinal,
  lastOrdinal: historyOrdinal,
  eventIds: rawList,
  evidence: z.enum(["activation-baseline", "observed-row-change"]),
  beforeState: stateSchema.nullable(),
  afterState: stateSchema.nullable(),
});
const eventIdList = z.array(uuid).min(1);

type State = z.output<typeof stateSchema>;
type Frame = z.output<typeof frameSchema>;
type Change = Omit<z.output<typeof changeSchema>, "eventIds"> & {
  eventIds: string[];
  first: bigint;
  last: bigint;
};

export type InventoryState = z.input<typeof stateSchema>;
export type InventoryBoundaryFact = z.input<typeof factSchema>;
export type InventoryMovementChange = Omit<z.input<typeof changeSchema>, "eventIds"> & {
  eventIds: readonly string[];
};
export interface InventoryBoundary extends Omit<Frame, "facts"> {
  facts: readonly InventoryBoundaryFact[];
}
export interface InventoryMovementInput {
  opening: InventoryBoundary;
  closing: InventoryBoundary;
  changes: readonly InventoryMovementChange[];
}

export interface InventoryTotals {
  count: number;
  knownValueCount: number;
  missingValueCount: number;
  knownValue: string;
}

export type InventoryMovementCategory =
  | "new"
  | "value-increase"
  | "value-decrease"
  | "won"
  | "lost"
  | "reopened"
  | "transfer-in"
  | "transfer-out"
  | "archived"
  | "removed"
  | "restore"
  | "value-set"
  | "value-clear";

export interface InventoryMovement {
  category: InventoryMovementCategory;
  entityId: string;
  incarnationId: string;
  attribution: Pick<State, "pipelineId" | "ownerId" | "currency">;
  delta: InventoryTotals;
  source: {
    transactionId: string;
    firstOrdinal: string;
    lastOrdinal: string;
    eventIds: readonly string[];
  };
}

type Failure = {
  ok: false;
  reason:
    | "invalid-input"
    | "incompatible-frame"
    | "bounded-limit"
    | "invalid-boundary-fact"
    | "duplicate-boundary-fact"
    | "missing-boundary-fact"
    | "conflicting-incarnation"
    | "invalid-change"
    | "mixed-activation"
    | "baseline-in-movement"
    | "duplicate-evidence"
    | "incomplete-chain"
    | "retired-incarnation"
    | "reconciliation-gap";
};
export type InventoryMovementResult =
  | Failure
  | {
      ok: true;
      activationId: string;
      definitionId: string;
      currency: string;
      opening: InventoryTotals;
      closing: InventoryTotals;
      netMovement: InventoryTotals;
      movements: InventoryMovement[];
    };

type Vector = Omit<InventoryTotals, "knownValue"> & { knownValue: bigint };
const ZERO: Vector = { count: 0, knownValueCount: 0, missingValueCount: 0, knownValue: 0n };

function add(left: Vector, right: Vector): Vector {
  return {
    count: left.count + right.count,
    knownValueCount: left.knownValueCount + right.knownValueCount,
    missingValueCount: left.missingValueCount + right.missingValueCount,
    knownValue: left.knownValue + right.knownValue,
  };
}

function unit(value: bigint | null, sign: 1 | -1): Vector {
  return {
    count: sign,
    knownValueCount: value === null ? 0 : sign,
    missingValueCount: value === null ? sign : 0,
    knownValue: value === null ? 0n : BigInt(sign) * value,
  };
}

function totals(vector: Vector): InventoryTotals {
  return { ...vector, knownValue: fixedDecimal(vector.knownValue) };
}

function eligible(state: State | null, currency: string): State | null {
  return state?.status === "open" &&
    state.lifecycle === "active" &&
    state.inScope &&
    state.currency === currency
    ? state
    : null;
}

function keyOf(fact: { entityId: string; incarnationId: string }): string {
  return `${fact.entityId}:${fact.incarnationId}`;
}

interface Book {
  states: Map<string, State | null>;
  present: Map<string, string>;
  stock: Vector;
}

function readBoundary(frame: Frame): Failure | { ok: true; book: Book } {
  const states = new Map<string, State | null>();
  const present = new Map<string, string>();
  let stock = ZERO;
  for (const row of frame.facts) {
    const parsed = factSchema.safeParse(row);
    if (!parsed.success) return { ok: false, reason: "invalid-boundary-fact" };
    const fact = parsed.data;
    const key = keyOf(fact);
    if (states.has(key)) return { ok: false, reason: "duplicate-boundary-fact" };
    states.set(key, fact.state);
    if (fact.state === null) continue;
    if (present.has(fact.entityId)) return { ok: false, reason: "conflicting-incarnation" };
    present.set(fact.entityId, fact.incarnationId);
    const included = eligible(fact.state, frame.currency);
    if (included !== null) stock = add(stock, unit(included.value, 1));
  }
  return { ok: true, book: { states, present, stock } };
}

function sameKeys(opening: Book, closing: Book): boolean {
  if (opening.states.size !== closing.states.size) return false;
  for (const key of opening.states.keys()) {
    if (!closing.states.has(key)) return false;
  }
  return true;
}

function sameState(left: State | null, right: State | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.status === right.status &&
    left.lifecycle === right.lifecycle &&
    left.inScope === right.inScope &&
    left.pipelineId === right.pipelineId &&
    left.ownerId === right.ownerId &&
    left.currency === right.currency &&
    left.value === right.value
  );
}

interface EvidenceIndex {
  transactions: Set<string>;
  ordinals: Set<string>;
  eventIds: Set<string>;
  witnessCount: number;
}

function addUnique(set: Set<string>, key: string): boolean {
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

function uniqueEvidence(change: Change, index: EvidenceIndex): boolean {
  if (!addUnique(index.transactions, `${keyOf(change)}:${change.transactionId}`)) return false;
  if (!addUnique(index.ordinals, change.firstOrdinal)) return false;
  if (change.last !== change.first && !addUnique(index.ordinals, change.lastOrdinal)) return false;
  return change.eventIds.every((id) => addUnique(index.eventIds, id));
}

function validSpan(change: Change): boolean {
  const events = change.eventIds.length;
  if (
    change.firstOrdinal !== change.first.toString() ||
    change.lastOrdinal !== change.last.toString()
  )
    return false;
  if (change.beforeState === null && change.afterState === null && events < 2) return false;
  if (events === 1) return change.first === change.last;
  return BigInt(events) <= change.last - change.first + 1n;
}

function readChange(row: unknown, activationId: string, index: EvidenceIndex): Failure | Change {
  const parsed = changeSchema.safeParse(row);
  if (!parsed.success) return { ok: false, reason: "invalid-change" };
  const event = parsed.data;
  if (event.activationId !== activationId) return { ok: false, reason: "mixed-activation" };
  if (event.evidence === "activation-baseline")
    return { ok: false, reason: "baseline-in-movement" };
  index.witnessCount += event.eventIds.length;
  if (index.witnessCount > MAX_INVENTORY_EVENT_WITNESSES)
    return { ok: false, reason: "bounded-limit" };
  const ids = eventIdList.safeParse(event.eventIds);
  if (!ids.success) return { ok: false, reason: "invalid-change" };
  const change = {
    ...event,
    eventIds: ids.data,
    first: BigInt(event.firstOrdinal),
    last: BigInt(event.lastOrdinal),
  };
  if (!validSpan(change)) return { ok: false, reason: "invalid-change" };
  if (!uniqueEvidence(change, index)) return { ok: false, reason: "duplicate-evidence" };
  return change;
}

function compareChanges(left: Change, right: Change): number {
  return left.first < right.first ? -1 : left.first > right.first ? 1 : 0;
}

function readChanges(
  rows: readonly unknown[],
  activationId: string,
): Failure | { ok: true; changes: Change[] } {
  const index: EvidenceIndex = {
    transactions: new Set(),
    ordinals: new Set(),
    eventIds: new Set(),
    witnessCount: 0,
  };
  const changes: Change[] = [];
  for (const row of rows) {
    const change = readChange(row, activationId, index);
    if ("ok" in change) return change;
    changes.push(change);
  }
  return { ok: true, changes: changes.sort(compareChanges) };
}

interface Ledger {
  book: Book;
  retired: Set<string>;
  last: Map<string, Change>;
  transactions: Set<string>;
}

function ordered(change: Change, ledger: Ledger): boolean {
  const previous = ledger.last.get(change.entityId);
  if (previous !== undefined && previous.last >= change.first) return false;
  if (previous?.transactionId === change.transactionId) return true;
  return addUnique(ledger.transactions, `${change.entityId}:${change.transactionId}`);
}

function applyChange(change: Change, ledger: Ledger): Failure | null {
  const key = keyOf(change);
  const prior = ledger.book.states.get(key);
  if (prior === undefined) return { ok: false, reason: "missing-boundary-fact" };
  if (ledger.retired.has(key)) return { ok: false, reason: "retired-incarnation" };
  if (!sameState(prior, change.beforeState) || !ordered(change, ledger)) {
    return { ok: false, reason: "incomplete-chain" };
  }
  const expectedPresent = prior === null ? undefined : change.incarnationId;
  if (ledger.book.present.get(change.entityId) !== expectedPresent) {
    return { ok: false, reason: "conflicting-incarnation" };
  }
  if (change.afterState === null) {
    ledger.book.present.delete(change.entityId);
    ledger.retired.add(key);
  } else {
    ledger.book.present.set(change.entityId, change.incarnationId);
  }
  ledger.book.states.set(key, change.afterState);
  ledger.last.set(change.entityId, change);
  return null;
}

// Final-state precedence attributes a compound movement exactly once on a stock boundary.
function entryCategory(before: State | null): InventoryMovementCategory {
  if (before === null) return "new";
  if (before.lifecycle !== "active") return "restore";
  if (before.status !== "open") return "reopened";
  return "transfer-in";
}

function exitCategory(after: State | null): InventoryMovementCategory {
  if (after === null || after.lifecycle === "removed") return "removed";
  if (after.lifecycle === "archived") return "archived";
  if (after.status !== "open") return after.status;
  return "transfer-out";
}

function valueCategory(
  before: bigint | null,
  after: bigint | null,
): InventoryMovementCategory | null {
  if (before === after) return null;
  if (before === null) return "value-set";
  if (after === null) return "value-clear";
  return after > before ? "value-increase" : "value-decrease";
}

interface Component {
  category: InventoryMovementCategory;
  state: State;
  delta: Vector;
}

function components(change: Change, currency: string): Component[] {
  const before = eligible(change.beforeState, currency);
  const after = eligible(change.afterState, currency);
  if (before === null) {
    return after === null
      ? []
      : [
          {
            category: entryCategory(change.beforeState),
            state: after,
            delta: unit(after.value, 1),
          },
        ];
  }
  if (after === null) {
    return [
      { category: exitCategory(change.afterState), state: before, delta: unit(before.value, -1) },
    ];
  }

  const result: Component[] = [];
  if (before.pipelineId !== after.pipelineId || before.ownerId !== after.ownerId) {
    // Carry the old stock between attributions. Apply the value change under the new one.
    result.push({ category: "transfer-out", state: before, delta: unit(before.value, -1) });
    result.push({ category: "transfer-in", state: after, delta: unit(before.value, 1) });
  }
  const category = valueCategory(before.value, after.value);
  if (category !== null) {
    result.push({
      category,
      state: after,
      delta: add(unit(before.value, -1), unit(after.value, 1)),
    });
  }
  return result;
}

function movement(change: Change, component: Component): InventoryMovement {
  const { pipelineId, ownerId, currency } = component.state;
  return {
    category: component.category,
    entityId: change.entityId,
    incarnationId: change.incarnationId,
    attribution: { pipelineId, ownerId, currency },
    delta: totals(component.delta),
    source: {
      transactionId: change.transactionId,
      firstOrdinal: change.firstOrdinal,
      lastOrdinal: change.lastOrdinal,
      eventIds: change.eventIds,
    },
  };
}

function sameBook(left: Book, right: Book): boolean {
  for (const [key, state] of left.states) {
    const expected = right.states.get(key);
    if (expected === undefined || !sameState(state, expected)) return false;
  }
  return true;
}

function sameTotals(left: Vector, right: Vector): boolean {
  return (
    left.count === right.count &&
    left.knownValueCount === right.knownValueCount &&
    left.missingValueCount === right.missingValueCount &&
    left.knownValue === right.knownValue
  );
}

function reconcile(
  frame: Frame,
  opening: Book,
  closing: Book,
  changes: Change[],
): InventoryMovementResult {
  const ledger: Ledger = {
    book: opening,
    retired: new Set(),
    last: new Map(),
    transactions: new Set(),
  };
  const movements: InventoryMovement[] = [];
  let net = ZERO;
  for (const change of changes) {
    const invalid = applyChange(change, ledger);
    if (invalid !== null) return invalid;
    for (const component of components(change, frame.currency)) {
      net = add(net, component.delta);
      movements.push(movement(change, component));
    }
  }
  if (!sameBook(opening, closing) || !sameTotals(add(opening.stock, net), closing.stock)) {
    return { ok: false, reason: "reconciliation-gap" };
  }
  return {
    ok: true,
    activationId: frame.activationId,
    definitionId: frame.definitionId,
    currency: frame.currency,
    opening: totals(opening.stock),
    closing: totals(closing.stock),
    netMovement: totals(net),
    movements,
  };
}

function sameFrame(opening: Frame, closing: Frame): boolean {
  return (
    opening.activationId === closing.activationId &&
    opening.definitionId === closing.definitionId &&
    opening.currency === closing.currency
  );
}

/**
 * Reconcile one authorized open-deal stock in one stored currency. The caller supplies both
 * SQL-proven boundary books under the same definition, plus the complete transaction-final
 * change membership between them. Each boundary explicitly covers every entity/incarnation
 * key in either book or the change set, using null only for observed physical absence.
 * inScope represents non-currency report selection, never denied access. Both sides of every
 * change and its witness must be separately authorized, including closed/out-of-scope states.
 * Matching frame labels and coherent chains cannot prove membership, authority, or omitted
 * changes that cancel each other. Ordinals order each entity chain and give deterministic
 * contributor output. They carry no cross-entity commit ordering. An activation baseline
 * belongs in the opening book.
 */
export function reconcileInventoryMovement(input: unknown): InventoryMovementResult {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { opening, closing, changes } = parsed.data;
  if (!sameFrame(opening, closing)) return { ok: false, reason: "incompatible-frame" };
  if (
    opening.facts.length > MAX_INVENTORY_KEYS ||
    closing.facts.length > MAX_INVENTORY_KEYS ||
    changes.length > MAX_INVENTORY_CHANGES
  ) {
    return { ok: false, reason: "bounded-limit" };
  }
  const first = readBoundary(opening);
  if (!first.ok) return first;
  const last = readBoundary(closing);
  if (!last.ok) return last;
  if (!sameKeys(first.book, last.book)) return { ok: false, reason: "missing-boundary-fact" };
  const orderedChanges = readChanges(changes, opening.activationId);
  if (!orderedChanges.ok) return orderedChanges;
  return reconcile(opening, first.book, last.book, orderedChanges.changes);
}
