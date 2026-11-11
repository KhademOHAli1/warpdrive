import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import type { Result } from "@/types/result";

export const ACTION_BLOCK_KINDS = [
  "CODE",
  "LOGIC_FUNCTION",
  "SEND_EMAIL",
  "NEWSLETTER_CONSENT_STATUS",
  "NEWSLETTER_INVITE",
  "SEND_CHAT_MESSAGE",
  "DRAFT_EMAIL",
  "CREATE_CALENDAR_EVENT",
  "CREATE_RECORD",
  "UPDATE_RECORD",
  "DELETE_RECORD",
  "UPSERT_RECORD",
  "FIND_RECORDS",
  "PICK_RECORD",
  "FORM",
  "FILTER",
  "IF_ELSE",
  "HTTP_REQUEST",
  "AI_AGENT",
  "CLASSIFY",
  "ITERATOR",
  "DELAY",
  "WAIT_FOR_EVENT",
] as const;
export type ActionBlockKind = (typeof ACTION_BLOCK_KINDS)[number];
export const NEWSLETTER_TRIGGER_KINDS = [
  "newsletter.identity.verified",
  "newsletter.consent.confirmed",
  "newsletter.consent.revoked",
] as const;

export function isNewsletterTrigger(
  value: string,
): value is (typeof NEWSLETTER_TRIGGER_KINDS)[number] {
  return NEWSLETTER_TRIGGER_KINDS.some((kind) => kind === value);
}

export const TRIGGER_BLOCK_KINDS = [
  "record.created",
  "record.updated",
  "record.deleted",
  "record.created_or_updated",
  "manual",
  "schedule",
  "webhook",
  ...NEWSLETTER_TRIGGER_KINDS,
] as const;
export type TriggerBlockKind = (typeof TRIGGER_BLOCK_KINDS)[number];
export type BlockJson =
  | string
  | number
  | boolean
  | null
  | BlockJson[]
  | { [key: string]: BlockJson };
export type BlockOutput = Record<string, BlockJson>;
export type NativeEntity = "deal" | "lead" | "person" | "organization" | "activity";
export interface BlockReference {
  kind: "reference";
  nodeId: string;
  path: (string | number)[];
}
export type BlockBinding =
  | { kind: "literal"; value: BlockJson }
  | BlockReference
  | { kind: "template"; template: string; variables: Record<string, BlockReference> };
export type BlockBindingMap = Record<string, BlockBinding>;
export interface BlockReadiness {
  state:
    | "ready"
    | "needs_configuration"
    | "needs_connection"
    | "forbidden"
    | "unsupported_in_context";
  reason?: string;
  fields?: string[];
}
export interface BlockFieldDescriptor {
  key: string;
  label: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "decimal"
    | "date"
    | "instant"
    | "record"
    | "array"
    | "object";
  required?: boolean;
  nullable?: boolean;
  readable: boolean;
  createable: boolean;
  updateable: boolean;
  choices?: { value: string; label: string }[];
  filterOperators?: string[];
  format?: string;
  referenceObject?: NativeEntity | "user" | "pipeline" | "stage" | "activityType";
  upsertIdentity?: boolean;
}
export interface WorkflowV2Studio {
  objects: { name: NativeEntity; label: string; fields: BlockFieldDescriptor[] }[];
  members: { id: string; label: string }[];
  accounts: { id: string; label: string; kind: string }[];
  models: { id: string; label: string }[];
  functions: {
    id: string;
    label: string;
    inputs: BlockFieldDescriptor[];
    outputs: BlockFieldDescriptor[];
  }[];
  readiness: Partial<Record<ActionBlockKind, BlockReadiness>>;
  newsletterEvents?: boolean;
}
export type WorkflowV2ExternalStudio = Pick<WorkflowV2Studio, "accounts" | "models" | "functions">;
export interface WorkflowV2Node {
  id: string;
  type: ActionBlockKind;
  version: 1;
  name: string;
  config: Record<string, BlockJson>;
}
export interface WorkflowV2Trigger {
  type: TriggerBlockKind;
  config: Record<string, BlockJson>;
}
export interface WorkflowV2Edge {
  id: string;
  source: string;
  target: string;
  sourcePort: string;
}
export interface WorkflowV2Definition {
  schemaVersion: 2;
  trigger: WorkflowV2Trigger;
  nodes: WorkflowV2Node[];
  edges: WorkflowV2Edge[];
  entryNodeIds: string[];
  layout?: Record<string, { x: number; y: number }>;
}
export interface WorkflowV2LibraryEntry {
  id: string;
  engineVersion: 1 | 2;
  name: string;
  ownerId: string;
  revision: number;
  active: boolean;
  archivedAt: string | null;
  publishedNumber: number | null;
  updatedAt: string;
}
export type WorkflowV2PublishedManualLaunch =
  | { availability: "global" }
  | { availability: "single" | "bulk"; objectName: NativeEntity };
export interface WorkflowV2Document extends WorkflowV2LibraryEntry {
  engineVersion: 2;
  draft: WorkflowV2Definition;
  capabilities?: { edit: boolean; publish: boolean; run: boolean; archive: boolean };
  publishedManualLaunch?: WorkflowV2PublishedManualLaunch;
}
export interface WorkflowV2Version {
  id: string;
  workflowId: string;
  number: number;
  name: string;
  definition: WorkflowV2Definition;
  createdAt: string;
}
export interface WorkflowV2Token {
  nodeId: string;
  framePath: string[];
  visitKey: string;
  afterNodeIds?: string[];
}
export interface WorkflowV2Frame {
  id: string;
  iteratorId: string;
  items: BlockJson[];
  index: number;
  parentPath: string[];
  doneNodeIds: string[];
  bodyNodeIds: string[];
  continueOnFailure: boolean;
}
export interface WorkflowV2RunState {
  queue: WorkflowV2Token[];
  outputs: Record<string, { nodeId: string; framePath: string[]; output: BlockOutput }>;
  frames: WorkflowV2Frame[];
  stepCount: number;
}
export type WorkflowV2RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface WorkflowV2Run {
  id: string;
  workflowId: string;
  versionId: string;
  actorId: string;
  mode: "test" | "live";
  status: WorkflowV2RunStatus;
  state: WorkflowV2RunState;
  trigger: BlockOutput;
  errorId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowV2Execution {
  id: string;
  runId: string;
  nodeId: string;
  visitKey: string;
  framePath: string[];
  status: "running" | "waiting" | "completed" | "failed";
  output: BlockOutput | null;
  errorId: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface WorkflowV2Wait {
  id: string;
  runId: string;
  executionId: string;
  kind: "delay" | "form" | "event" | "chat";
  status: "open" | "resumed" | "expired" | "cancelled";
  wakeAt: string | null;
  expiresAt: string | null;
  config: BlockOutput;
  output: BlockOutput | null;
}
export interface WorkflowV2RunDetail {
  run: WorkflowV2Run;
  executions: WorkflowV2Execution[];
  waits: WorkflowV2Wait[];
}
export interface WorkflowV2Context {
  db: Db;
  actor: PermSetUser;
  workflowId: string;
  runId: string;
  executionId: string;
  effectKey: string;
  mode: "test" | "live";
  signal: AbortSignal;
  nextPickIndex: (nodeId: string, count: number) => Promise<number>;
}
export type NativeActionExecutor = (
  tx: Db,
  args: {
    actor: PermSetUser;
    node: WorkflowV2Node;
    resolvedConfig: BlockOutput;
    effectKey: string;
    signal: AbortSignal;
    nextPickIndex: (nodeId: string, count: number) => Promise<number>;
  },
) => Promise<Result<BlockOutput, string>>;
export type ExternalActionExecutor = (
  context: WorkflowV2Context,
  node: WorkflowV2Node,
  resolvedConfig: BlockOutput,
) => Promise<Result<BlockOutput, { id: string; outcome?: "unknown" }>>;
export interface WorkflowV2Adapters {
  native: NativeActionExecutor;
  external: ExternalActionExecutor;
  readiness: (
    db: Db,
    actor: PermSetUser,
    node: WorkflowV2Node,
    signal: AbortSignal,
  ) => Promise<BlockReadiness>;
}
export type WorkflowV2ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { id: string } };
