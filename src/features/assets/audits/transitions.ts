import { z } from "zod";
import {
  type EquipmentAuditCommand,
  type EquipmentAuditError,
  type EquipmentAuditEvent,
  type EquipmentAuditEvidence,
  type EquipmentAuditWrite,
  equipmentAuditCommand,
} from "./contracts";
import {
  auditOpaqueKey,
  auditProjectionScope,
  projectAuditDetail,
  projectAuditWorkspace,
  resolveVisibleAuditEquipment,
} from "./projection";
import { siteAuditLocations, snapshotAuditRows, validAuditScope } from "./snapshot";
import {
  type AuditClock,
  type AuditEquipmentResolver,
  type AuditFinding,
  type AuditFixtureActor,
  type AuditFixtureState,
  type AuditRecord,
  canManageAudit,
} from "./state";

type Failure = { ok: false; error: EquipmentAuditError };
type Write =
  | (Extract<EquipmentAuditWrite, { ok: true }> & { state: AuditFixtureState; applied: boolean })
  | Failure;
type Draft = Extract<EquipmentAuditCommand, { type: "create" | "edit" }>;
type PriorCommand = Exclude<EquipmentAuditCommand, { type: "create" }>;
type Count = Extract<EquipmentAuditCommand, { type: "setCount" | "bulkCount" }>;
type Context = {
  state: AuditFixtureState;
  actor: AuditFixtureActor;
  audit: AuditRecord;
  canManage: boolean;
  clock: AuditClock;
  resolve: AuditEquipmentResolver;
};
type EventFields = Pick<EquipmentAuditEvent, "rowId" | "rowName" | "before" | "after" | "note">;
type Change = { audit: AuditRecord; events: EquipmentAuditEvent[] };

const unsupported = { ok: false, error: "unavailable" } as const;
const fail = (error: EquipmentAuditError): Failure => ({ ok: false, error });
const maxQuantity = 1_000_000;
const maxRows = 2000;

function logEvent(
  actor: AuditFixtureActor,
  clock: AuditClock,
  kind: EquipmentAuditEvent["kind"],
  fields: Partial<EventFields> = {},
): EquipmentAuditEvent {
  return {
    id: clock.makeId(),
    at: clock.now,
    actor: actor.name,
    kind,
    rowId: null,
    rowName: null,
    before: null,
    after: null,
    note: null,
    ...fields,
  };
}

function editAssignments(state: AuditFixtureState, siteId: string, assigneeIds: readonly string[]) {
  const roster = new Map((state.participants[siteId] ?? []).map((person) => [person.id, person]));
  const assignees = [];
  for (const id of assigneeIds) {
    const person = roster.get(id);
    if (person === undefined) return null;
    assignees.push({ ...person });
  }
  return assignees;
}

function newDraft(
  siteId: string,
  { title, dueAt, scope }: Pick<Draft, "title" | "dueAt" | "scope">,
  assignees: AuditRecord["assignees"],
  clock: AuditClock,
): AuditRecord {
  return {
    id: clock.makeId(),
    siteId,
    title,
    dueAt,
    scope,
    assignees,
    version: 0,
    status: "draft",
    createdAt: clock.now,
    startedAt: null,
    completedAt: null,
    reviewedAt: null,
    archived: false,
    rows: [],
    activity: [],
    evidence: [],
  };
}

function suppliedDraft(state: AuditFixtureState, siteId: string, command: Draft) {
  if (!validAuditScope(state.assets, siteId, command.scope)) return null;
  return editAssignments(state, siteId, command.assigneeIds);
}

function projected(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  auditId: string,
  applied: boolean,
): Write {
  const detail = projectAuditDetail(state, actor, auditId);
  if (!detail.ok) return detail;
  return {
    ok: true,
    state,
    applied,
    detail: detail.value,
    workspace: projectAuditWorkspace(state, actor),
  };
}

function saveChanges(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  request: string,
  fingerprint: string,
  { audit, events }: Change,
): Write {
  const next =
    events.length === 0
      ? audit
      : {
          ...audit,
          version: audit.version + 1,
          activity: [...events, ...audit.activity],
        };
  const stored = state.audits.some(({ id }) => id === next.id);
  const audits = stored
    ? state.audits.map((row) => (row.id === next.id ? next : row))
    : [next, ...state.audits];
  return projected(
    {
      ...state,
      audits,
      requests: { ...state.requests, [request]: { auditId: audit.id, fingerprint } },
    },
    actor,
    audit.id,
    true,
  );
}

function countEvents(
  ctx: Context,
  kind: "counted" | "unexpected" | "undone",
  old: AuditFinding,
  counted: number | null,
  note?: string,
) {
  return logEvent(ctx.actor, ctx.clock, kind, {
    rowId: old.id,
    rowName: old.target?.name ?? null,
    before: old.counted,
    after: counted,
    note: note ?? null,
  });
}

function activeCounts(ctx: Context, command: Count): Change | Failure {
  const { audit } = ctx;
  if (audit.status !== "active") return fail("state");
  const entries = command.type === "setCount" ? [command] : command.counts;
  const changed = new Map<string, AuditFinding>();
  const events: EquipmentAuditEvent[] = [];
  for (const entry of entries) {
    const row = audit.rows.find(({ id }) => id === entry.rowId);
    if (row === undefined || (row.expected === null && row.counted === null)) return unsupported;
    const counted = countedValue(ctx, row, entry);
    if (typeof counted !== "number") return counted;
    if (counted === row.counted) continue;
    changed.set(row.id, { ...row, counted });
    events.unshift(countEvents(ctx, "counted", row, counted));
  }
  return {
    audit: { ...audit, rows: audit.rows.map((row) => changed.get(row.id) ?? row) },
    events,
  };
}

function countedValue(
  ctx: Context,
  row: AuditFinding,
  entry: { quantity: number } | Extract<Count, { type: "setCount" }>,
): number | Failure {
  if ("proof" in entry && entry.proof !== null) {
    const { code, expectedTargetId } = entry.proof;
    const { target, rows } = resolveVisibleAuditEquipment(
      ctx.state,
      ctx.audit,
      ctx.canManage,
      code,
      ctx.resolve,
    );
    if (
      (target?.id ?? null) !== expectedTargetId ||
      !rows.some(({ id }) => id === row.id) ||
      target?.kind === "kit"
    )
      return fail("conflict");
  }
  const counted =
    "mode" in entry && entry.mode === "add" ? (row.counted ?? 0) + entry.quantity : entry.quantity;
  if (row.quantityType === "single") {
    if ("mode" in entry && entry.mode === "add" && entry.quantity === 1 && row.counted === 1)
      return 1;
    if (counted > 1) return fail("quantity");
  }
  return counted > maxQuantity ? fail("quantity") : counted;
}

type Unexpected = Extract<EquipmentAuditCommand, { type: "unexpected" }>;

function unexpectedLocation(ctx: Context, locationId: string | null) {
  if (locationId === null) return { name: null };
  const bin = siteAuditLocations(ctx.state.assets, ctx.audit.siteId).find(
    ({ id }) => id === locationId,
  );
  const inScope =
    ctx.canManage ||
    ctx.audit.rows.some((row) => row.expected !== null && row.placement.locationId === locationId);
  return bin === undefined || !inScope ? null : { name: bin.name };
}

function observedIdentity(
  ctx: Context,
  target: ReturnType<typeof resolveVisibleAuditEquipment>["target"],
) {
  const { assets } = ctx.state;
  const asset =
    target?.kind === "asset" ? assets.records.find(({ id }) => id === target.id) : undefined;
  const kit =
    target?.kind === "kit" ? assets.kits?.records.find(({ id }) => id === target.id) : undefined;
  const record = asset ?? kit;
  return {
    target:
      target === null || record === undefined
        ? null
        : { ...target, name: record.name, code: record.code },
    serial: asset?.tracking === "individual" ? asset.serial : null,
    sourceVersion: record?.version ?? null,
    quantityType:
      kit !== undefined || asset?.tracking === "individual"
        ? ("single" as const)
        : ("pool" as const),
  };
}

function unexpectedCount(ctx: Context, command: Unexpected): Change | Failure {
  const { audit, state, canManage, resolve } = ctx;
  if (audit.status !== "active") return fail("state");
  const { code, expectedTargetId, locationId, quantity } = command;
  const { target, rows } = resolveVisibleAuditEquipment(state, audit, canManage, code, resolve);
  if ((target?.id ?? null) !== expectedTargetId) return fail("conflict");
  const bin = unexpectedLocation(ctx, locationId);
  if (bin === null) return unsupported;
  const identity = observedIdentity(ctx, target);
  if (identity.quantityType === "single" && quantity !== 1) return fail("quantity");
  const matching = rows.find(
    (row) => identity.quantityType === "single" || row.placement.locationId === locationId,
  );
  if (matching?.expected != null) return fail("conflict");
  if (matching?.counted != null) return { audit, events: [] };
  if (matching === undefined && audit.rows.length >= maxRows) return fail("quantity");
  const row: AuditFinding = matching ?? {
    ...identity,
    id: ctx.clock.makeId(),
    placement: {
      kind: locationId === null ? "unlocated" : "storage",
      locationId,
      kitId: null,
      sourceId: null,
      label: bin.name,
    },
    expected: null,
    counted: null,
    opaqueKey: target === null ? auditOpaqueKey(code) : null,
  };
  const updated = { ...row, counted: quantity };
  const nextRows =
    matching === undefined
      ? [...audit.rows, updated]
      : audit.rows.map((finding) => (finding.id === row.id ? updated : finding));
  return {
    audit: { ...audit, rows: nextRows },
    events: [countEvents(ctx, "unexpected", row, quantity)],
  };
}

function undoCount(
  ctx: Context,
  { rowId, reason }: Extract<EquipmentAuditCommand, { type: "undo" }>,
): Change | Failure {
  const { audit } = ctx;
  if (audit.status !== "active") return fail("state");
  const row = audit.rows.find(({ id }) => id === rowId);
  if (row === undefined) return unsupported;
  if (row.counted === null) return fail("state");
  return {
    audit: {
      ...audit,
      rows: audit.rows.map((entry) => (entry.id === rowId ? { ...entry, counted: null } : entry)),
    },
    events: [countEvents(ctx, "undone", row, null, reason)],
  };
}

function addNote(
  ctx: Context,
  { rowId, note }: Extract<EquipmentAuditCommand, { type: "note" }>,
): Change | Failure {
  const { audit, actor, clock } = ctx;
  if (audit.status !== "active") return fail("state");
  const row = rowId === null ? undefined : audit.rows.find(({ id }) => id === rowId);
  if (rowId !== null && row === undefined) return unsupported;
  return {
    audit,
    events: [logEvent(actor, clock, "note", { rowId, rowName: row?.target?.name ?? null, note })],
  };
}

function startAudit(ctx: Context): Change | Failure {
  const { audit, state, clock, actor } = ctx;
  if (audit.status !== "draft") return fail("state");
  if (!validAuditScope(state.assets, audit.siteId, audit.scope)) return unsupported;
  const rows = snapshotAuditRows(state.assets, audit.siteId, audit.scope, clock.makeId);
  if (rows.length === 0) return fail("state");
  if (rows.length > maxRows) return fail("quantity");
  return {
    audit: { ...audit, rows, status: "active", startedAt: clock.now },
    events: [logEvent(actor, clock, "started")],
  };
}

type Management = Extract<
  PriorCommand,
  { type: "edit" | "assign" | "cancel" | "archive" | "duplicate" | "review" }
>;
type Operation = Exclude<PriorCommand, Management>;
const managementTypes: readonly Management["type"][] = [
  "edit",
  "assign",
  "cancel",
  "archive",
  "duplicate",
  "review",
];

function management(command: PriorCommand): command is Management {
  return managementTypes.some((type) => type === command.type);
}

function editDraft(ctx: Context, command: Extract<Management, { type: "edit" }>): Change | Failure {
  const { audit, state, actor, clock } = ctx;
  if (audit.status !== "draft") return fail("state");
  const assignees = suppliedDraft(state, audit.siteId, command);
  if (assignees === null) return unsupported;
  const { title, dueAt, scope } = command;
  return {
    audit: { ...audit, title, dueAt, scope, assignees },
    events: [logEvent(actor, clock, "edited")],
  };
}

function assignAudit(
  ctx: Context,
  command: Extract<Management, { type: "assign" }>,
): Change | Failure {
  const { audit, state, actor, clock } = ctx;
  if (audit.status !== "draft" && audit.status !== "active") return fail("state");
  const assignees = editAssignments(state, audit.siteId, command.assigneeIds);
  if (assignees === null) return unsupported;
  return { audit: { ...audit, assignees }, events: [logEvent(actor, clock, "assigned")] };
}

function manageAudit(ctx: Context, command: Management): Change | Failure {
  const { audit, actor, clock } = ctx;
  switch (command.type) {
    case "edit":
      return editDraft(ctx, command);
    case "assign":
      return assignAudit(ctx, command);
    case "cancel":
      if (audit.status !== "draft" && audit.status !== "active") return fail("state");
      return {
        audit: { ...audit, status: "cancelled" },
        events: [logEvent(actor, clock, "cancelled", { note: command.note })],
      };
    case "archive":
      if (
        (audit.status !== "completed" && audit.status !== "cancelled") ||
        audit.archived === command.archived
      )
        return fail("state");
      return {
        audit: { ...audit, archived: command.archived },
        events: [logEvent(actor, clock, command.archived ? "archived" : "restored")],
      };
    case "duplicate":
      if (audit.status !== "completed" && audit.status !== "cancelled") return fail("state");
      return {
        audit: newDraft(audit.siteId, { ...command, scope: audit.scope }, [], clock),
        events: [logEvent(actor, clock, "duplicated")],
      };
    case "review":
      if (audit.status !== "completed" || audit.archived || audit.reviewedAt !== null)
        return fail("state");
      return {
        audit: { ...audit, reviewedAt: clock.now },
        events: [logEvent(actor, clock, "reviewed", { note: command.note })],
      };
  }
}

function operateAudit(ctx: Context, command: Operation): Change | Failure {
  const { audit, clock, actor } = ctx;
  if (audit.archived) return fail("state");
  switch (command.type) {
    case "start":
      return startAudit(ctx);
    case "setCount":
    case "bulkCount":
      return activeCounts(ctx, command);
    case "unexpected":
      return unexpectedCount(ctx, command);
    case "undo":
      return undoCount(ctx, command);
    case "note":
      return addNote(ctx, command);
    case "complete":
      if (audit.status !== "active") return fail("state");
      return {
        audit: { ...audit, status: "completed", completedAt: clock.now },
        events: [logEvent(actor, clock, "completed", { note: command.note })],
      };
  }
}

function existingWrite(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  command: PriorCommand,
  request: string,
  fingerprint: string,
  clock: AuditClock & { resolve: AuditEquipmentResolver },
): Write {
  const scope = auditProjectionScope(state, actor, command.auditId);
  const isManagement = management(command);
  if (scope === null || (isManagement && !scope.canManage)) return unsupported;
  const prior = state.requests[request];
  if (prior !== undefined) {
    return prior.fingerprint === fingerprint
      ? projected(state, actor, prior.auditId, false)
      : fail("conflict");
  }
  const { audit, canManage } = scope;
  if (audit.version !== command.version) return fail("stale");
  const ctx = { state, actor, audit, canManage, clock, resolve: clock.resolve };
  const result = isManagement ? manageAudit(ctx, command) : operateAudit(ctx, command);
  return "error" in result ? result : saveChanges(state, actor, request, fingerprint, result);
}

export function applyAuditCommand(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  raw: unknown,
  clock: AuditClock & { resolve: AuditEquipmentResolver },
): Write {
  const input = equipmentAuditCommand.safeParse(raw);
  if (!input.success || !Number.isFinite(Date.parse(clock.now))) return fail("invalid");
  const command = input.data;
  const fingerprint = JSON.stringify(command);
  const request = `${actor.id}:${command.requestId}`;
  if (command.type !== "create")
    return existingWrite(state, actor, command, request, fingerprint, clock);
  if (!canManageAudit(state, actor, command.siteId)) return unsupported;
  const prior = state.requests[request];
  if (prior !== undefined) {
    return prior.fingerprint === fingerprint
      ? projected(state, actor, prior.auditId, false)
      : fail("conflict");
  }
  const assignees = suppliedDraft(state, command.siteId, command);
  if (assignees === null) return unsupported;
  const audit = newDraft(command.siteId, command, assignees, clock);
  return saveChanges(state, actor, request, fingerprint, {
    audit,
    events: [logEvent(actor, clock, "created")],
  });
}

const photo = z.strictObject({
  auditId: z.uuid(),
  rowId: z.uuid().nullable(),
  version: z.number().int().positive(),
  requestId: z.uuid(),
  source: z.enum(["camera", "file"]),
  name: z.string().trim().min(1).max(180),
  href: z.string().startsWith("blob:").max(4_096),
  fingerprint: z.string().min(1).max(200),
});

export function attachAuditPhoto(
  state: AuditFixtureState,
  actor: AuditFixtureActor,
  raw: unknown,
  clock: AuditClock,
): Write {
  const parsed = photo.safeParse(raw);
  if (!parsed.success || !Number.isFinite(Date.parse(clock.now))) return fail("invalid");
  const {
    auditId,
    rowId,
    version,
    requestId,
    source,
    name,
    href,
    fingerprint: digest,
  } = parsed.data;
  const scope = auditProjectionScope(state, actor, auditId);
  if (scope === null) return unsupported;
  const request = `${actor.id}:${requestId}`;
  const fingerprint = JSON.stringify({
    type: "photo",
    auditId,
    rowId,
    version,
    source,
    name,
    digest,
  });
  const prior = state.requests[request];
  if (prior !== undefined) {
    return prior.fingerprint === fingerprint
      ? projected(state, actor, prior.auditId, false)
      : fail("conflict");
  }
  const { audit } = scope;
  if (audit.version !== version) return fail("stale");
  if (audit.status !== "active" || audit.archived) return fail("state");
  const row = rowId === null ? undefined : audit.rows.find(({ id }) => id === rowId);
  if (rowId !== null && row === undefined) return unsupported;
  const evidence: EquipmentAuditEvidence = {
    id: clock.makeId(),
    rowId,
    name,
    href,
    source,
    at: clock.now,
    actor: actor.name,
  };
  const event = logEvent(actor, clock, "photo", {
    rowId,
    rowName: row?.target?.name ?? null,
    note: name,
  });
  return saveChanges(state, actor, request, fingerprint, {
    audit: { ...audit, evidence: [evidence, ...audit.evidence] },
    events: [event],
  });
}
