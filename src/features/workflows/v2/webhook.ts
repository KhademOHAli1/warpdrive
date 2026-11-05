import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { workflowsV2, workflowV2Runs, workflowV2TriggerReceipts } from "@/db/schema/workflowV2";
import type { BlockJson, BlockOutput, WorkflowV2Adapters } from "@/features/blocks/contracts";
import { blockOutputSchema } from "@/features/blocks/schemas";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "../access";
import { initialV2State } from "./admission";
import { publishedWorkflowV2 } from "./persistence";
import { workflowV2Readiness } from "./readiness";
import { matchesResponseSchema } from "./responseSchema";
import { authorizedWorkflow, documentDto, V2_ERROR } from "./shared";

export function canonicalBlockJson(value: BlockJson): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBlockJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalBlockJson(value[key] ?? null)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export async function rotateWorkflowV2Webhook(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  const input = z
    .strictObject({ id: z.uuid(), expectedRevision: z.number().int().positive() })
    .safeParse(raw);
  if (!input.success) return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const access = await authorizedWorkflow(tx, actor, input.data.id, "edit", signal, true);
    if (!access.ok) return access;
    const workflow = access.value.workflow;
    if (workflow.revision !== input.data.expectedRevision) return err(V2_ERROR.conflict);
    if (workflow.archivedAt !== null || workflow.draft.trigger.type !== "webhook")
      return err(V2_ERROR.invalid);
    const apiKey = randomBytes(32).toString("base64url");
    const [row] = await tx
      .update(workflowsV2)
      .set({
        draft: {
          ...workflow.draft,
          trigger: {
            ...workflow.draft.trigger,
            config: {
              ...workflow.draft.trigger.config,
              authentication: "api_key",
              apiKeyHash: sha256(apiKey),
            },
          },
        },
        revision: workflow.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(workflowsV2.id, workflow.id))
      .returning();
    return row === undefined ? err(V2_ERROR.write) : ok({ document: documentDto(row), apiKey });
  });
}
export async function admitWorkflowV2Webhook(
  db: Db,
  id: string,
  raw: { apiKey?: string | null; requestKey: string; payload: BlockOutput },
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
) {
  if (
    !z.uuid().safeParse(id).success ||
    !z.uuid().safeParse(raw.requestKey).success ||
    !blockOutputSchema.safeParse(raw.payload).success ||
    JSON.stringify(raw.payload).length > 128_000
  )
    return err(V2_ERROR.invalid);
  return db.transaction(async (tx) => {
    const [workflow] = await tx
      .select()
      .from(workflowsV2)
      .where(eq(workflowsV2.id, id))
      .for("update");
    if (
      workflow === undefined ||
      !workflow.active ||
      workflow.archivedAt !== null ||
      workflow.publishedNumber === null
    )
      return err(V2_ERROR.denied);
    const version = await publishedWorkflowV2(tx, id, workflow.publishedNumber);
    if (version === null || version.definition.trigger.type !== "webhook")
      return err(V2_ERROR.denied);
    const config = version.definition.trigger.config;
    if (config.authentication === "api_key") {
      if (
        typeof config.apiKeyHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(config.apiKeyHash) ||
        typeof raw.apiKey !== "string" ||
        raw.apiKey.length > 200 ||
        !timingSafeEqual(
          Buffer.from(config.apiKeyHash, "hex"),
          Buffer.from(sha256(raw.apiKey), "hex"),
        )
      )
        return err(V2_ERROR.denied);
    } else if (config.authentication !== "none") return err(V2_ERROR.denied);
    if (
      config.responseSchema !== undefined &&
      !matchesResponseSchema(config.responseSchema, raw.payload)
    )
      return err(V2_ERROR.invalid);
    const actor = await hydrateActor(tx, workflow.ownerId, signal);
    if (actor === null || !canWorkflow(actor, "run", workflow.ownerId)) return err(V2_ERROR.denied);
    const eventKey = `webhook:${raw.requestKey}`;
    const [prior] = await tx
      .select()
      .from(workflowV2TriggerReceipts)
      .where(
        and(
          eq(workflowV2TriggerReceipts.workflowId, id),
          eq(workflowV2TriggerReceipts.eventKey, eventKey),
        ),
      );
    if (prior !== undefined)
      return prior.versionId === version.id &&
        canonicalBlockJson(prior.payload) === canonicalBlockJson(raw.payload) &&
        prior.runId !== null
        ? ok({ id: prior.runId })
        : err(V2_ERROR.conflict);
    const readiness = await workflowV2Readiness(tx, actor, version.definition, adapters, signal);
    if (Object.values(readiness).some((row) => row.state !== "ready"))
      return err(V2_ERROR.notReady);
    const [run] = await tx
      .insert(workflowV2Runs)
      .values({
        workflowId: id,
        versionId: version.id,
        actorId: actor.id,
        requestKey: raw.requestKey,
        mode: "live",
        trigger: { ...raw.payload, $workflowV2: { depth: 0, workflowIds: [id] } },
        state: initialV2State(version.definition),
      })
      .returning({ id: workflowV2Runs.id });
    if (run === undefined) return err(V2_ERROR.write);
    await tx.insert(workflowV2TriggerReceipts).values({
      workflowId: id,
      versionId: version.id,
      eventKey,
      payload: raw.payload,
      runId: run.id,
    });
    return ok({ id: run.id });
  });
}
