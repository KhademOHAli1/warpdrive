import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type AnalyticsInputBatch,
  type AnalyticsSourceEvent,
  analyticsSourceEvent,
  analyticsSourceProvenance,
  MAX_ANALYTICS_INPUT_EVENTS,
} from "./analyticsInputContracts";

export const ANALYTICS_INPUT_FINGERPRINT_VERSION = "analytics-input-event-v1:sha256";
export const MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS = 5_000;

const source = analyticsSourceProvenance.shape;
const family = z.union(analyticsSourceEvent.options.map(({ shape }) => shape.kind));
const fingerprintSchema = z.strictObject({
  version: z.literal(ANALYTICS_INPUT_FINGERPRINT_VERSION),
  digest: z.string().regex(/^[0-9a-f]{64}$/u),
});
const receiptSchema = z.strictObject({
  producer: source.producer,
  sourceRecordId: source.sourceRecordId,
  eventId: source.eventId,
  revision: source.revision,
  kind: family,
  supersedes: z.strictObject({ eventId: source.eventId, revision: source.revision }).nullable(),
  fingerprint: fingerprintSchema,
});
const priorSchema = z.strictObject({
  completeness: z.enum(["complete", "incomplete"]),
  receipts: z.custom<readonly unknown[]>((value) => Array.isArray(value)),
});

export type AnalyticsInputFingerprint = z.output<typeof fingerprintSchema>;
export type AnalyticsInputReceipt = z.output<typeof receiptSchema>;
export interface PriorAnalyticsInputReceipts {
  completeness: "complete" | "incomplete";
  receipts: readonly AnalyticsInputReceipt[];
}

interface PlannedAppend {
  inputIndex: number;
  event: AnalyticsSourceEvent;
  receipt: AnalyticsInputReceipt;
}
interface PlannedRetry {
  inputIndex: number;
  receipt: AnalyticsInputReceipt;
}
type PriorFailure = "incomplete-prior" | "invalid-prior" | "bounded-limit";
type KeyConflict = "event-key-conflict" | "revision-key-conflict" | "fingerprint-conflict";
type ChainFailure =
  | "unknown-correction-target"
  | "invalid-correction-target"
  | "stale-correction-target"
  | "revision-gap";
export type AnalyticsInputAdmission =
  | {
      state: "planned";
      batchId: string;
      appends: PlannedAppend[];
      retries: PlannedRetry[];
    }
  | { state: "rejected"; reason: PriorFailure | "invalid-batch-size" }
  | { state: "rejected"; reason: KeyConflict | ChainFailure; inputIndex: number };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Contract v1 events are bounded JSON. Sort object keys, omit undefined optional properties,
// and preserve the parsed scalar values, including exact money and offset timestamp spellings.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const fields: [string, unknown][] = Object.entries(value);
  return `{${fields
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function fingerprintAnalyticsInputEvent(
  event: AnalyticsSourceEvent,
): AnalyticsInputFingerprint {
  return {
    version: ANALYTICS_INPUT_FINGERPRINT_VERSION,
    digest: createHash("sha256")
      .update(`${ANALYTICS_INPUT_FINGERPRINT_VERSION}\n`, "utf8")
      .update(canonicalJson(event), "utf8")
      .digest("hex"),
  };
}

function receiptFor(event: AnalyticsSourceEvent): AnalyticsInputReceipt {
  const { producer, sourceRecordId, eventId, revision, supersedes } = event.provenance;
  return {
    producer,
    sourceRecordId,
    eventId,
    revision,
    kind: event.kind,
    supersedes: supersedes === undefined ? null : { ...supersedes },
    fingerprint: fingerprintAnalyticsInputEvent(event),
  };
}

type RecordIdentity = Pick<AnalyticsInputReceipt, "producer" | "sourceRecordId">;

function eventKey(producer: string, eventId: string): string {
  return JSON.stringify([producer, eventId]);
}

function recordKey(receipt: RecordIdentity): string {
  return JSON.stringify([receipt.producer, receipt.sourceRecordId]);
}

function revisionKey(receipt: AnalyticsInputReceipt): string {
  return JSON.stringify([receipt.producer, receipt.sourceRecordId, receipt.revision]);
}

function compareReceipts(left: AnalyticsInputReceipt, right: AnalyticsInputReceipt): number {
  const producer = compareText(left.producer, right.producer);
  if (producer !== 0) return producer;
  const record = compareText(left.sourceRecordId, right.sourceRecordId);
  if (record !== 0) return record;
  if (left.revision !== right.revision) return left.revision - right.revision;
  return compareText(left.eventId, right.eventId);
}

interface ReceiptIndex {
  events: Map<string, AnalyticsInputReceipt>;
  revisions: Map<string, AnalyticsInputReceipt>;
  heads: Map<string, AnalyticsInputReceipt>;
}

function addReceipt(index: ReceiptIndex, receipt: AnalyticsInputReceipt): void {
  index.events.set(eventKey(receipt.producer, receipt.eventId), receipt);
  index.revisions.set(revisionKey(receipt), receipt);
  index.heads.set(recordKey(receipt), receipt);
}

function correctionFailure(
  index: ReceiptIndex,
  receipt: AnalyticsInputReceipt,
): ChainFailure | null {
  const { supersedes } = receipt;
  const head = index.heads.get(recordKey(receipt));
  if (receipt.revision === 1) {
    return supersedes === null && head === undefined ? null : "invalid-correction-target";
  }
  if (supersedes === null) return "invalid-correction-target";
  const target = index.events.get(eventKey(receipt.producer, supersedes.eventId));
  if (target === undefined) return "unknown-correction-target";
  if (
    target.sourceRecordId !== receipt.sourceRecordId ||
    target.kind !== receipt.kind ||
    target.revision !== supersedes.revision
  )
    return "invalid-correction-target";
  if (target !== head) return "stale-correction-target";
  if (receipt.revision !== target.revision + 1) return "revision-gap";
  return null;
}

type PriorRead = { ok: true; index: ReceiptIndex } | { ok: false; reason: PriorFailure };

function indexPrior(receipts: AnalyticsInputReceipt[]): PriorRead {
  const index: ReceiptIndex = { events: new Map(), revisions: new Map(), heads: new Map() };
  for (const receipt of receipts.sort(compareReceipts)) {
    if (
      index.events.has(eventKey(receipt.producer, receipt.eventId)) ||
      index.revisions.has(revisionKey(receipt)) ||
      correctionFailure(index, receipt) !== null
    )
      return { ok: false, reason: "invalid-prior" };
    addReceipt(index, receipt);
  }
  return { ok: true, index };
}

function readPrior(input: unknown): PriorRead {
  const prior = priorSchema.safeParse(input);
  if (!prior.success) return { ok: false, reason: "invalid-prior" };
  const { completeness, receipts } = prior.data;
  if (receipts.length > MAX_PRIOR_ANALYTICS_INPUT_RECEIPTS)
    return { ok: false, reason: "bounded-limit" };
  if (completeness !== "complete") return { ok: false, reason: "incomplete-prior" };
  const parsed: AnalyticsInputReceipt[] = [];
  for (const row of receipts) {
    const receipt = receiptSchema.safeParse(row);
    if (!receipt.success) return { ok: false, reason: "invalid-prior" };
    parsed.push(receipt.data);
  }
  return indexPrior(parsed);
}

function samePredecessor(
  left: AnalyticsInputReceipt["supersedes"],
  right: AnalyticsInputReceipt["supersedes"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.eventId === right.eventId && left.revision === right.revision;
}

type ExistingDecision =
  | { state: "new" }
  | { state: "retry"; receipt: AnalyticsInputReceipt }
  | { state: "conflict"; reason: KeyConflict };

function compareExisting(index: ReceiptIndex, incoming: AnalyticsInputReceipt): ExistingDecision {
  const priorEvent = index.events.get(eventKey(incoming.producer, incoming.eventId));
  const priorRevision = index.revisions.get(revisionKey(incoming));
  if (priorEvent === undefined) {
    return priorRevision === undefined
      ? { state: "new" }
      : { state: "conflict", reason: "revision-key-conflict" };
  }
  if (priorEvent !== priorRevision) return { state: "conflict", reason: "event-key-conflict" };
  if (
    priorEvent.fingerprint.digest !== incoming.fingerprint.digest ||
    priorEvent.kind !== incoming.kind ||
    !samePredecessor(priorEvent.supersedes, incoming.supersedes)
  )
    return { state: "conflict", reason: "fingerprint-conflict" };
  return { state: "retry", receipt: priorEvent };
}

/**
 * Batch must be the output of analyticsInputBatch parsing. Batch ID identifies the delivery.
 * Event identity uses producer/event and producer/source-record/revision keys.
 * The caller supplies complete immutable receipt chains for the touched record and lookup
 * keys, including correction targets. A completeness label cannot prove those reads. The
 * adapter still authenticates producers and actors, validates links, and atomically reserves
 * keys and checks heads when applying this plan. A retry carries no new append.
 */
export function planAnalyticsInputAdmission(
  batch: AnalyticsInputBatch,
  prior: unknown,
): AnalyticsInputAdmission {
  if (batch.events.length === 0 || batch.events.length > MAX_ANALYTICS_INPUT_EVENTS)
    return { state: "rejected", reason: "invalid-batch-size" };
  const indexed = readPrior(prior);
  if (!indexed.ok) return { state: "rejected", reason: indexed.reason };
  const ordered = batch.events
    .map((event, inputIndex) => ({ inputIndex, event, receipt: receiptFor(event) }))
    .sort((left, right) => compareReceipts(left.receipt, right.receipt));
  const appends: PlannedAppend[] = [];
  const retries: PlannedRetry[] = [];
  for (const candidate of ordered) {
    const { inputIndex, receipt } = candidate;
    const existing = compareExisting(indexed.index, receipt);
    if (existing.state === "conflict")
      return { state: "rejected", reason: existing.reason, inputIndex };
    if (existing.state === "retry") {
      retries.push({ inputIndex, receipt: existing.receipt });
      continue;
    }
    const invalid = correctionFailure(indexed.index, receipt);
    if (invalid !== null) return { state: "rejected", reason: invalid, inputIndex };
    addReceipt(indexed.index, receipt);
    appends.push(candidate);
  }
  return { state: "planned", batchId: batch.batchId, appends, retries };
}
