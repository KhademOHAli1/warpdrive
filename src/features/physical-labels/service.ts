import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { assetActor, lockAssetRegister } from "@/features/assets/service";
import { parseLegacyTagIdentifier } from "@/features/assets/tags/legacyImport";
import { lockTagNamespace } from "@/features/assets/tags/nativeScope";
import { assetTagCodes } from "@/features/assets/tags/schema";
import { parseAssetTagIdentifier } from "@/features/assets/tags/tagCodes";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { lockInventoryCatalog } from "@/features/inventory/catalog/policy";
import { lockDirectory } from "@/features/locations/service";
import type { HydratedActor } from "@/server/hydrateActor";
import { readAssetLabelTargets } from "./assetTargets";
import {
  type LabelCommand,
  type LabelError,
  type LabelResult,
  type LabelTargetRef,
  type LabelWorkspaceResult,
  labelCommand,
  type ScanResult,
  scanInput,
} from "./contracts";
import {
  isInternalLabelCode,
  type NormalizedLabel,
  normalizeLabel,
  parseScannedLabel,
} from "./formats";
import { readInventoryLabelTargets } from "./inventoryTargets";
import { readLocationLabelTargets } from "./locationTargets";
import {
  findActiveCode,
  findLabel,
  issueLabel,
  labelRecord,
  lockActiveLabel,
  lockLabelRequest,
  lockLabelTarget,
  readScopedLabels,
  registerLabel,
  retireLabel,
  targetOf,
} from "./repository";
import { physicalLabelReceipts } from "./schema";

class LabelFailure extends Error {
  constructor(readonly code: LabelError) {
    super(code);
  }
}

const unavailable = { ok: false, error: "unavailable" } as const;
const invalid = { ok: false, error: "invalid" } as const;

function fail(code: LabelError): never {
  throw new LabelFailure(code);
}

async function withLabelActor<Value>(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
  run: (tx: Db, actor: HydratedActor) => Promise<Value>,
): Promise<Value | typeof unavailable> {
  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const actor = await assetActor(tx, who, signal);
      if (actor === null) return unavailable;
      await lockInventoryCatalog(tx, signal);
      await lockDirectory(tx, "read", signal);
      await lockAssetRegister(tx, "read", signal);
      const value = await run(tx, actor);
      if ((await assetActor(tx, who, signal)) === null) fail("unavailable");
      return value;
    });
  } catch (error) {
    if (error instanceof LabelFailure && error.code === "unavailable") return unavailable;
    throw error;
  }
}

async function readTargets(
  tx: Db,
  actor: HydratedActor,
  signal: AbortSignal,
  refs?: readonly LabelTargetRef[],
) {
  return [
    ...(await readAssetLabelTargets(tx, actor, refs)),
    ...(await readLocationLabelTargets(tx, actor, refs)),
    ...(await readInventoryLabelTargets(tx, actor, signal, refs)),
  ];
}

export function readLabelWorkspace(
  db: Db,
  who: NativeSessionRef,
  signal: AbortSignal,
): Promise<LabelWorkspaceResult> {
  return withLabelActor(db, who, signal, async (tx, actor) => {
    const targets = await readTargets(tx, actor, signal);
    const labels = await readScopedLabels(tx, targets);
    return { ok: true, value: { targets, labels } } as const;
  });
}

async function managedTarget(
  tx: Db,
  actor: HydratedActor,
  ref: LabelTargetRef,
  signal: AbortSignal,
) {
  const [target] = await readTargets(tx, actor, signal, [ref]);
  if (target?.canManage !== true) fail("unavailable");
  return ref;
}

type Change =
  | { type: "issue"; target: LabelTargetRef }
  | { type: "registerExternal"; target: LabelTargetRef; label: NormalizedLabel }
  | { type: "retire"; labelId: string };

function prepareChange(command: LabelCommand): Change | null {
  if (command.type === "retire" || command.type === "issue") return command;
  const label = normalizeLabel(command.format, command.value);
  if (label === null || isInternalLabelCode(label.value)) return null;
  return { type: command.type, target: command.target, label };
}

async function registerOutsideEquipmentTags(
  tx: Db,
  actorId: string,
  target: LabelTargetRef,
  label: NormalizedLabel,
) {
  if (parseAssetTagIdentifier(label.value, new URL(env.BASE_URL).origin) !== null) fail("invalid");
  await lockTagNamespace(tx, "write");
  const legacy = label.key.startsWith("text:") ? parseLegacyTagIdentifier(label.value) : null;
  if (legacy !== null) {
    const [assigned] = await tx
      .select({ id: assetTagCodes.id })
      .from(assetTagCodes)
      .where(eq(assetTagCodes.legacyId, legacy.id))
      .limit(1);
    if (assigned !== undefined) fail("conflict");
  }
  return registerLabel(tx, actorId, target, label);
}

async function applyChange(tx: Db, actor: HydratedActor, change: Change, signal: AbortSignal) {
  if (change.type === "retire") {
    const row = await findLabel(tx, change.labelId);
    if (row === undefined) fail("unavailable");
    const target = await managedTarget(tx, actor, targetOf(row), signal);
    await lockLabelTarget(tx, target);
    return (await retireLabel(tx, actor.id, row.id)) ?? fail("state");
  }
  const target = await managedTarget(tx, actor, change.target, signal);
  await lockLabelTarget(tx, target);
  const id =
    change.type === "issue"
      ? await issueLabel(tx, actor.id, target)
      : await registerOutsideEquipmentTags(tx, actor.id, target, change.label);
  return id ?? fail("conflict");
}

async function applyOrReplay(
  tx: Db,
  actor: HydratedActor,
  command: LabelCommand,
  change: Change,
  signal: AbortSignal,
) {
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  await lockLabelRequest(tx, actor.id, command.requestId);
  const [receipt] = await tx
    .select()
    .from(physicalLabelReceipts)
    .where(
      and(
        eq(physicalLabelReceipts.actorId, actor.id),
        eq(physicalLabelReceipts.requestId, command.requestId),
      ),
    );
  if (receipt !== undefined) {
    if (receipt.fingerprint !== fingerprint) fail("conflict");
    const row = await findLabel(tx, receipt.labelId);
    if (row === undefined) fail("unavailable");
    await managedTarget(tx, actor, targetOf(row), signal);
    return row.id;
  }
  const labelId = await applyChange(tx, actor, change, signal);
  await tx.insert(physicalLabelReceipts).values({
    actorId: actor.id,
    requestId: command.requestId,
    fingerprint,
    commandType: command.type,
    labelId,
  });
  return labelId;
}

export async function runLabelCommand(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<LabelResult> {
  const parsed = labelCommand.safeParse(raw);
  if (!parsed.success) return invalid;
  const change = prepareChange(parsed.data);
  if (change === null) return invalid;
  try {
    const id = await withLabelActor(db, who, signal, (tx, actor) =>
      applyOrReplay(tx, actor, parsed.data, change, signal),
    );
    if (typeof id !== "string") return id;
    const workspace = await readLabelWorkspace(db, who, signal);
    if (!workspace.ok || !workspace.value.labels.some((label) => label.id === id))
      return unavailable;
    return { ok: true, value: workspace.value, focusId: id };
  } catch (error) {
    if (error instanceof LabelFailure) return { ok: false, error: error.code };
    throw error;
  }
}

export async function resolveLabel(
  db: Db,
  who: NativeSessionRef,
  raw: unknown,
  expectedOrigin: string,
  signal: AbortSignal,
): Promise<ScanResult> {
  const parsed = scanInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const scan = parseScannedLabel(parsed.data.value, expectedOrigin, parsed.data.format);
  if (scan === null) return invalid;
  return withLabelActor(db, who, signal, async (tx, actor) => {
    const hint = await findActiveCode(tx, scan.key);
    if (hint === undefined) return unavailable;
    const [target] = await readTargets(tx, actor, signal, [targetOf(hint)]);
    if (target === undefined) return unavailable;
    const row = await lockActiveLabel(tx, hint.id);
    return row === undefined
      ? unavailable
      : ({ ok: true, label: labelRecord(row, target) } as const);
  });
}
