import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  workflowV2LogicFunctions,
  workflowV2RuntimeSettings,
} from "@/db/schema/workflowV2Functions";
import { blockJsonSchema } from "@/features/blocks/schemas";
import { encryptToken } from "@/features/email/crypto";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { validResponseSchema } from "./responseSchema";

const runtimeInput = z.strictObject({
  aiBaseUrl: z.union([z.literal(""), z.url().max(2000)]),
  aiDefaultModel: z.string().trim().max(200),
  aiModels: z.array(z.string().trim().min(1).max(200)).max(100),
  aiApiKey: z.string().max(8192).optional(),
  removeAiKey: z.boolean().optional(),
});
const functionInput = z.strictObject({
  familyId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000),
  sourceCode: z.string().min(1).max(50_000),
  inputSchema: blockJsonSchema,
  outputSchema: blockJsonSchema,
});
export async function readAiRuntimeMetadata(db: Db) {
  const [row] = await db
    .select({
      aiBaseUrl: workflowV2RuntimeSettings.aiBaseUrl,
      aiDefaultModel: workflowV2RuntimeSettings.aiDefaultModel,
      aiModels: workflowV2RuntimeSettings.aiModels,
      hasAiKey: sql<boolean>`${workflowV2RuntimeSettings.aiApiKey} is not null`,
    })
    .from(workflowV2RuntimeSettings)
    .limit(1);
  return row;
}
export async function readWorkflowRuntime(db: Db, actor: PermSetUser, signal: AbortSignal) {
  if (!actor.isActive || actor.type !== "admin") return err("E_PERM_001");
  signal.throwIfAborted();
  const row = await readAiRuntimeMetadata(db);
  const functions = await db
    .select()
    .from(workflowV2LogicFunctions)
    .orderBy(desc(workflowV2LogicFunctions.createdAt))
    .limit(50);
  return ok({
    aiBaseUrl: row?.aiBaseUrl ?? "",
    aiDefaultModel: row?.aiDefaultModel ?? "",
    aiModels: row?.aiModels ?? [],
    hasAiKey: row?.hasAiKey ?? false,
    functions: functions.map(
      ({ id, familyId, revision, name, description, sourceCode, inputSchema, outputSchema }) => ({
        id,
        familyId,
        revision,
        name,
        description,
        sourceCode,
        inputSchema,
        outputSchema,
      }),
    ),
  });
}
export async function saveWorkflowRuntime(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  if (!actor.isActive || actor.type !== "admin") return err("E_PERM_001");
  signal.throwIfAborted();
  const input = runtimeInput.safeParse(raw);
  if (!input.success) return err("E_WORKFLOW_RUNTIME_INPUT");
  const value = input.data;
  if (value.aiBaseUrl !== "") {
    const url = new URL(value.aiBaseUrl);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return err("E_WORKFLOW_RUNTIME_INPUT");
  }
  if (value.aiDefaultModel !== "" && !value.aiModels.includes(value.aiDefaultModel))
    return err("E_WORKFLOW_RUNTIME_MODEL");
  const aiApiKey =
    value.removeAiKey === true
      ? null
      : value.aiApiKey !== undefined && value.aiApiKey !== ""
        ? encryptToken(value.aiApiKey)
        : undefined;
  const fields = {
    aiBaseUrl: value.aiBaseUrl || null,
    aiDefaultModel: value.aiDefaultModel || null,
    aiModels: [...new Set(value.aiModels)],
    updatedBy: actor.id,
    updatedAt: new Date(),
    aiApiKey,
  };
  await db
    .insert(workflowV2RuntimeSettings)
    .values(fields)
    .onConflictDoUpdate({
      target: workflowV2RuntimeSettings.id,
      set: {
        ...fields,
        aiApiKey:
          fields.aiApiKey === undefined
            ? sql`case when ${workflowV2RuntimeSettings.aiBaseUrl} is distinct from ${fields.aiBaseUrl} then null else ${workflowV2RuntimeSettings.aiApiKey} end`
            : fields.aiApiKey,
      },
    });
  return readWorkflowRuntime(db, actor, signal);
}
export async function saveWorkflowLogicFunction(
  db: Db,
  actor: PermSetUser,
  raw: unknown,
  signal: AbortSignal,
) {
  if (!actor.isActive || actor.type !== "admin") return err("E_PERM_001");
  signal.throwIfAborted();
  const input = functionInput.safeParse(raw);
  if (
    !input.success ||
    !validResponseSchema(input.data.inputSchema) ||
    !validResponseSchema(input.data.outputSchema)
  )
    return err("E_WORKFLOW_FUNCTION_INPUT");
  return db.transaction(async (tx) => {
    const familyId = input.data.familyId ?? randomUUID();
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`workflow-function:${familyId}`},0))`,
    );
    const [prior] = await tx
      .select({ revision: workflowV2LogicFunctions.revision })
      .from(workflowV2LogicFunctions)
      .where(eq(workflowV2LogicFunctions.familyId, familyId))
      .orderBy(desc(workflowV2LogicFunctions.revision))
      .limit(1);
    if (input.data.familyId !== undefined && prior === undefined)
      return err("E_WORKFLOW_FUNCTION_INPUT");
    const [created] = await tx
      .insert(workflowV2LogicFunctions)
      .values({
        ...input.data,
        familyId,
        revision: (prior?.revision ?? 0) + 1,
        createdBy: actor.id,
      })
      .returning({ id: workflowV2LogicFunctions.id, revision: workflowV2LogicFunctions.revision });
    return created === undefined ? err("E_WORKFLOW_FUNCTION_WRITE") : ok(created);
  });
}
