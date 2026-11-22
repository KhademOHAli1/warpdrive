import { createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { parseScannedLabel } from "@/features/physical-labels/formats";
import { findActiveCode, targetOf } from "@/features/physical-labels/repository";
import type { HydratedActor } from "@/server/hydrateActor";
import { activeEquipment, equipmentByPrintedCode } from "../bookings/handover/equipmentIdentity";
import { nativeBookingAssets } from "../bookings/nativeResources";
import { lookupEquipmentTag } from "../tags/nativeScans";
import { lockTagNamespace } from "../tags/nativeScope";
import { parseAssetTagIdentifier } from "../tags/tagCodes";
import {
  type EquipmentAuditCommand,
  type EquipmentAuditLookup,
  type EquipmentAuditRead,
  type EquipmentAuditWorkspace,
  type EquipmentAuditWrite,
  equipmentAuditCommand,
} from "./contracts";
import { equipmentAuditEvidencePath } from "./evidenceTransport";
import {
  auditProjectionScope,
  lookupAuditEquipment,
  projectAuditDetail,
  projectAuditWorkspace,
} from "./projection";
import {
  findAuditSite,
  lockAuditHeader,
  lockAuditRequest,
  persistAuditChange,
  readAuditReceipt,
  readAuditRecord,
  readAuditRecords,
} from "./repository";
import {
  type AuditAuthority,
  auditInvalid,
  auditUnavailable,
  hasEquipmentAuditScope,
  readAuditAuthority,
  withAuditAuthority,
} from "./scope";
import { type AuditEquipmentResolver, type AuditState, createAuditState } from "./state";
import { applyAuditCommand } from "./transitions";

const id = z.uuid().toLowerCase();
const scan = z.string().trim().min(1).max(4096);

export function auditDigest(kind: "receipt" | "unresolved", parts: readonly string[]) {
  return createHmac("sha256", env.AUTH_SECRET)
    .update(JSON.stringify(["warpdrive-equipment-audit-v1", kind, parts]))
    .digest("hex");
}

function opaqueKeyFor(siteId: string, code: string) {
  return auditDigest("unresolved", [siteId, code.trim()]);
}

async function workspaceSnapshot(tx: Db, authority: AuditAuthority): Promise<AuditState> {
  const assets = await nativeBookingAssets(tx, authority.sites);
  const empty = createAuditState(assets, authority.participants);
  const audits = await readAuditRecords(tx, authority.recordScope, equipmentAuditEvidencePath);
  return { ...empty, audits };
}

export async function loadAuditInteraction(
  tx: Db,
  authority: AuditAuthority,
  auditId: string,
  mode: "read" | "write",
) {
  const siteId = await findAuditSite(tx, auditId);
  if (siteId === undefined || !(await hasEquipmentAuditScope(tx, authority, siteId, auditId))) {
    return null;
  }
  const header = await lockAuditHeader(tx, siteId, auditId, mode);
  if (header === undefined) return null;
  const record = await readAuditRecord(tx, header, equipmentAuditEvidencePath);
  const workspace = await workspaceSnapshot(tx, authority);
  const state = {
    ...workspace,
    audits: [...workspace.audits.filter(({ id }) => id !== auditId), record],
  };
  const access = auditProjectionScope(state, authority.viewer, auditId);
  return access === null ? null : { siteId, record, state, access };
}

async function auditWorkspaceReadAt(db: Db) {
  const clock = await db.execute<{ microseconds: string }>(
    sql`SELECT (extract(epoch FROM clock_timestamp()) * 1000000)::bigint::text AS microseconds`,
  );
  const readAt = Number(clock.rows[0]?.microseconds);
  if (!Number.isSafeInteger(readAt)) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Invalid equipment audit workspace timestamp");
  }
  return readAt;
}

export async function refreshAuditWrite(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  result: EquipmentAuditWrite,
): Promise<EquipmentAuditWrite> {
  if (!result.ok) return result;
  const current = await readEquipmentAudits(db, who, signal);
  return current.ok ? { ...result, workspace: current.value } : current;
}

type WorkspaceResult = { ok: true; value: EquipmentAuditWorkspace } | typeof auditUnavailable;

export function readEquipmentAudits(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<WorkspaceResult> {
  return withAuditAuthority(db, who, signal, async (tx, actor) => {
    const readAt = await auditWorkspaceReadAt(tx);
    const authority = await readAuditAuthority(tx, actor);
    const state = await workspaceSnapshot(tx, authority);
    const value = projectAuditWorkspace(state, authority.viewer);
    if (actor.type !== "admin" && value.sites.length === 0) return auditUnavailable;
    return { ok: true, value: { ...value, readAt } } as const;
  });
}

export async function readEquipmentAudit(
  db: Db,
  who: NativeSessionRef,
  rawId: unknown,
  signal: AbortSignal,
): Promise<EquipmentAuditRead> {
  const auditId = id.safeParse(rawId);
  if (!auditId.success) return auditInvalid;
  return withAuditAuthority(db, who, signal, async (tx, actor) => {
    const authority = await readAuditAuthority(tx, actor);
    const found = await loadAuditInteraction(tx, authority, auditId.data, "read");
    return found === null
      ? auditUnavailable
      : projectAuditDetail(found.state, authority.viewer, auditId.data);
  });
}

async function resolveAuditCode(tx: Db, state: AuditState, siteId: string, code: string) {
  await lockTagNamespace(tx, "read");
  const origin = new URL(env.BASE_URL).origin;
  const tag = await lookupEquipmentTag(tx, code, origin, siteId);
  if (tag === null) return null;
  const scanned = tag === undefined ? parseScannedLabel(code, origin) : null;
  const label = scanned === null ? undefined : await findActiveCode(tx, scanned.key);
  const identity = tag ?? (label === undefined ? undefined : targetOf(label));
  if (identity !== undefined) {
    const { id, kind } = identity;
    return (kind === "asset" || kind === "kit") &&
      activeEquipment(state.assets, siteId, { id, kind })
      ? { id, kind }
      : null;
  }
  if (parseAssetTagIdentifier(code, origin) !== null) return null;
  const direct = equipmentByPrintedCode(state.assets, siteId, code);
  return direct == null ? null : { id: direct.id, kind: direct.kind };
}

async function resolverFor(
  tx: Db,
  state: AuditState,
  siteId: string,
  code: string | null,
): Promise<AuditEquipmentResolver> {
  if (code === null) return () => null;
  const target = await resolveAuditCode(tx, state, siteId, code);
  return (askedSite, askedCode) => (askedSite === siteId && code === askedCode ? target : null);
}

export async function lookupEquipmentAudit(
  db: Db,
  who: NativeSessionRef,
  rawId: unknown,
  rawCode: unknown,
  signal: AbortSignal,
): Promise<EquipmentAuditLookup> {
  const auditId = id.safeParse(rawId);
  const code = scan.safeParse(rawCode);
  if (!auditId.success || !code.success) return auditInvalid;
  return withAuditAuthority(db, who, signal, async (tx, actor) => {
    const authority = await readAuditAuthority(tx, actor);
    const interaction = await loadAuditInteraction(tx, authority, auditId.data, "read");
    if (
      interaction === null ||
      !interaction.access.canCount ||
      interaction.record.status !== "active"
    )
      return auditUnavailable;
    const resolve = await resolverFor(tx, interaction.state, interaction.siteId, code.data);
    return lookupAuditEquipment(
      interaction.state,
      authority.viewer,
      auditId.data,
      code.data,
      resolve,
      opaqueKeyFor,
    );
  });
}

function codeForCommand(input: EquipmentAuditCommand) {
  if (input.type === "unexpected") return input.code;
  return input.type === "setCount" ? (input.proof?.code ?? null) : null;
}

export async function priorAuditRequest(
  tx: Db,
  state: AuditState,
  actorId: string,
  requestId: string,
  siteId: string,
  sourceAuditId: string | null,
  original: string,
) {
  const digest = auditDigest("receipt", [original]);
  const prior = await readAuditReceipt(tx, actorId, requestId);
  if (prior === undefined) return { state, digest, replay: false };
  const matches =
    prior.siteId === siteId &&
    prior.sourceAuditId === sourceAuditId &&
    prior.fingerprint === digest;
  let audits = state.audits;
  if (matches && prior.auditId !== sourceAuditId) {
    const header = await lockAuditHeader(tx, siteId, prior.auditId, "read");
    if (header !== undefined) {
      const record = await readAuditRecord(tx, header, equipmentAuditEvidencePath);
      audits = [...audits.filter(({ id }) => id !== record.id), record];
    }
  }
  return {
    state: {
      ...state,
      audits,
      requests: {
        [`${actorId}:${requestId}`]: {
          auditId: prior.auditId,
          fingerprint: matches ? original : "",
        },
      },
    },
    digest,
    replay: true,
  };
}

async function applyEquipmentAudit(
  tx: Db,
  actor: HydratedActor,
  command: EquipmentAuditCommand,
): Promise<EquipmentAuditWrite> {
  const authority = await readAuditAuthority(tx, actor);
  const { viewer } = authority;
  await lockAuditRequest(tx, actor.id, command.requestId);
  const sourceAuditId = command.type === "create" ? null : command.auditId;
  const interaction =
    sourceAuditId === null
      ? null
      : await loadAuditInteraction(tx, authority, sourceAuditId, "write");
  if (command.type !== "create" && interaction === null) return auditUnavailable;
  const siteId = command.type === "create" ? command.siteId : interaction?.siteId;
  if (siteId === undefined || (command.type === "create" && viewer.roles[siteId] !== "manager"))
    return auditUnavailable;

  const current = interaction?.state ?? (await workspaceSnapshot(tx, authority));
  const original = JSON.stringify(command);
  const prior = await priorAuditRequest(
    tx,
    current,
    actor.id,
    command.requestId,
    siteId,
    sourceAuditId,
    original,
  );
  const resolve = await resolverFor(
    tx,
    current,
    siteId,
    prior.replay ? null : codeForCommand(command),
  );
  const now = new Date().toISOString();
  const changed = applyAuditCommand(prior.state, viewer, command, {
    now,
    makeId: randomUUID,
    resolve,
    opaqueKeyFor,
  });
  if (!changed.ok) return changed;
  if (changed.change !== null) {
    const selected = interaction?.record;
    const before = selected?.id === changed.change.audit.id ? selected : undefined;
    await persistAuditChange(tx, before, changed.change, {
      id: randomUUID(),
      requestId: command.requestId,
      actorId: actor.id,
      siteId,
      sourceAuditId,
      fingerprint: prior.digest,
      at: new Date(now),
    });
  }
  return { ok: true, workspace: changed.workspace, detail: changed.detail };
}

export async function runEquipmentAudit(
  db: Db,
  who: NativeSessionRef,
  input: unknown,
  signal: AbortSignal,
): Promise<EquipmentAuditWrite> {
  const command = equipmentAuditCommand.safeParse(input);
  if (!command.success) return auditInvalid;
  const result = await withAuditAuthority(db, who, signal, (tx, actor) =>
    applyEquipmentAudit(tx, actor, command.data),
  );
  return refreshAuditWrite(db, who, signal, result);
}
