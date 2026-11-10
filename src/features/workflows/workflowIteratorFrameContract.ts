import { z } from "zod";

export const workflowIteratorMaxItems = 100;
export const workflowIteratorMaxSteps = 200;
const maxGraphNodes = 100;
const maxRecordFields = 16;
const maxTextCharacters = 255;

const nodeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
const runId = z.uuid();
const itemKind = z.enum(["text", "number", "boolean"]);
const bodyNode = z.strictObject({
  id: nodeId,
  nextNodeIds: z.array(nodeId).max(maxGraphNodes),
  mayEndItem: z.boolean(),
});

const planSchema = z.strictObject({
  runId,
  iteratorNodeId: nodeId,
  entryNodeId: nodeId.nullable(),
  doneNodeId: nodeId.nullable(),
  body: z.array(bodyNode).max(maxGraphNodes),
  // Upper bound supplied by the pinned graph compiler, including the Iterator
  // summary and every executable step outside its loop body.
  nonBodySteps: z.number().int().min(1).max(maxGraphNodes),
  continueOnIterationFailure: z.boolean(),
});

export type WorkflowIteratorPlanInput = z.input<typeof planSchema>;
type PlanData = z.output<typeof planSchema>;
type BodyNode = Readonly<Omit<PlanData["body"][number], "nextNodeIds">> & {
  readonly nextNodeIds: readonly string[];
};
export type WorkflowIteratorPlan = Readonly<Omit<PlanData, "body">> & {
  readonly body: readonly BodyNode[];
  readonly longestBodyPath: number;
};

const identitySchema = z.strictObject({
  runId,
  iteratorNodeId: nodeId,
  nodeId,
  iterationIndex: z
    .number()
    .int()
    .min(0)
    .max(workflowIteratorMaxItems - 1),
});

export const workflowIteratorCompletion = z.discriminatedUnion("status", [
  z.strictObject({
    receipt: identitySchema,
    status: z.literal("completed"),
    nextNodeId: nodeId.nullable(),
  }),
  z.strictObject({ receipt: identitySchema, status: z.literal("itemFailed") }),
]);

export type WorkflowIteratorReceiptIdentity = Readonly<z.infer<typeof identitySchema>>;
export type WorkflowIteratorScalar = string | number | boolean | null;
export type WorkflowIteratorRecordItem = Readonly<
  { id: string } & Record<string, string | boolean | null>
>;
export type WorkflowIteratorRecordProjector = (raw: unknown) => WorkflowIteratorRecordItem | null;
export type WorkflowIteratorItem = WorkflowIteratorScalar | WorkflowIteratorRecordItem;

export type WorkflowIteratorItemsInput =
  | {
      kind: "literal";
      itemKind: z.infer<typeof itemKind>;
      items: readonly WorkflowIteratorScalar[];
    }
  | { kind: "records"; items: readonly unknown[] };

const itemsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), itemKind, items: z.array(z.unknown()) }),
  z.strictObject({ kind: z.literal("records"), items: z.array(z.unknown()) }),
]);

function object(raw: unknown): raw is Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

function boundedPlan(raw: unknown): boolean {
  if (!object(raw) || !Array.isArray(raw.body) || raw.body.length > maxGraphNodes) return false;
  return raw.body.every(
    (node: unknown) =>
      object(node) && Array.isArray(node.nextNodeIds) && node.nextNodeIds.length < maxGraphNodes,
  );
}

export function workflowIteratorBodyDepth(
  plan: Pick<PlanData, "entryNodeId" | "iteratorNodeId" | "doneNodeId" | "body">,
): number | null {
  if (plan.entryNodeId === null) return plan.body.length === 0 ? 0 : null;
  const nodes = new Map(plan.body.map((node) => [node.id, node]));
  if (nodes.size !== plan.body.length || !nodes.has(plan.entryNodeId)) return null;
  if (nodes.has(plan.iteratorNodeId) || (plan.doneNodeId !== null && nodes.has(plan.doneNodeId)))
    return null;
  const childIds = new Set<string>();
  for (const node of plan.body) {
    for (const childId of node.nextNodeIds) {
      if (!nodes.has(childId) || childIds.has(childId) || childId === plan.entryNodeId) return null;
      childIds.add(childId);
    }
  }
  let visited = 0;
  function visit(id: string): number {
    const node = nodes.get(id);
    if (node === undefined) return 0;
    visited++;
    return 1 + Math.max(0, ...node.nextNodeIds.map(visit));
  }
  // The entry has no parent, and every child has at most one. Any cycle must
  // therefore be unreachable, which the visit count rejects.
  const depth = visit(plan.entryNodeId);
  return visited === nodes.size ? depth : null;
}

export function workflowIteratorPlan(raw: unknown): WorkflowIteratorPlan | null {
  if (!boundedPlan(raw)) return null;
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return null;
  const plan = parsed.data;
  if (
    plan.doneNodeId === plan.iteratorNodeId ||
    plan.body.length + plan.nonBodySteps > maxGraphNodes
  )
    return null;
  const longestBodyPath = workflowIteratorBodyDepth(plan);
  if (longestBodyPath === null) return null;
  const body = Object.freeze(
    plan.body.map((node) =>
      Object.freeze({
        ...node,
        nextNodeIds: Object.freeze(node.nextNodeIds),
      }),
    ),
  );
  return Object.freeze({ ...plan, body, longestBodyPath });
}

export function workflowIteratorWithinBudget(
  nonBodySteps: number,
  itemCount: number,
  bodyDepth: number,
): boolean {
  const armSteps = itemCount === 0 || bodyDepth === 0 ? 0 : 1 + itemCount * bodyDepth;
  return nonBodySteps + armSteps <= workflowIteratorMaxSteps;
}

function boundedText(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    raw.length <= maxTextCharacters * 2 &&
    Array.from(raw).length <= maxTextCharacters
  );
}

function isLiteralItem(
  raw: unknown,
  kind: z.infer<typeof itemKind>,
): raw is WorkflowIteratorScalar {
  if (raw === null) return true;
  if (kind === "text") return boundedText(raw);
  if (kind === "number") return typeof raw === "number" && Number.isFinite(raw);
  return typeof raw === "boolean";
}

function copyProjectedRecord(raw: WorkflowIteratorRecordItem): WorkflowIteratorRecordItem | null {
  if (!Object.hasOwn(raw, "id") || !z.uuid().safeParse(raw.id).success) return null;
  const entries = Object.entries(raw);
  if (entries.length > maxRecordFields) return null;
  const copy: { id: string } & Record<string, string | boolean | null> = { id: raw.id };
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/u.test(key) || key === "constructor" || key === "prototype")
      return null;
    if (value !== null && typeof value !== "boolean" && !boundedText(value)) return null;
    copy[key] = value;
  }
  return Object.freeze(copy);
}

export function workflowIteratorItems(
  raw: unknown,
  projectRecord?: WorkflowIteratorRecordProjector,
): readonly WorkflowIteratorItem[] | null {
  if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > workflowIteratorMaxItems)
    return null;
  const parsed = itemsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const source = parsed.data;
  if (source.kind === "literal") {
    const kind = source.itemKind;
    const items = source.items.filter((item) => isLiteralItem(item, kind));
    return items.length === source.items.length ? Object.freeze(items) : null;
  }
  if (projectRecord === undefined) return null;
  const items: WorkflowIteratorRecordItem[] = [];
  for (const item of source.items) {
    const projected = projectRecord(item);
    if (projected === null) return null;
    const snapshot = copyProjectedRecord(projected);
    if (snapshot === null) return null;
    items.push(snapshot);
  }
  return Object.freeze(items);
}
