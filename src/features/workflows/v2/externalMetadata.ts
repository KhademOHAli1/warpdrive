import { desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowV2LogicFunctions } from "@/db/schema/workflowV2Functions";
import type {
  BlockFieldDescriptor,
  BlockJson,
  WorkflowV2ExternalStudio,
} from "@/features/blocks/contracts";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { readAiRuntimeMetadata } from "./runtime";

function schemaFields(schema: BlockJson): BlockFieldDescriptor[] {
  if (
    schema === null ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    schema.properties === null ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  )
    return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(schema.properties).map(([key, field]) => {
    const type =
      field !== null &&
      typeof field === "object" &&
      !Array.isArray(field) &&
      typeof field.type === "string"
        ? field.type
        : "object";
    return {
      key,
      label: key,
      type:
        type === "string" || type === "number" || type === "boolean" || type === "array"
          ? type
          : "object",
      required: required.includes(key),
      readable: true,
      createable: true,
      updateable: false,
    };
  });
}
export async function readExternalStudioMetadata(
  db: Db,
  actor: PermSetUser,
  signal: AbortSignal,
): Promise<WorkflowV2ExternalStudio> {
  const accounts = await listActorMailboxes(db, actor.id, signal);
  const runtime = await readAiRuntimeMetadata(db);
  const functions = await db
    .select({
      id: workflowV2LogicFunctions.id,
      name: workflowV2LogicFunctions.name,
      revision: workflowV2LogicFunctions.revision,
      input: workflowV2LogicFunctions.inputSchema,
      output: workflowV2LogicFunctions.outputSchema,
    })
    .from(workflowV2LogicFunctions)
    .orderBy(desc(workflowV2LogicFunctions.createdAt))
    .limit(200);
  signal.throwIfAborted();
  return {
    accounts: accounts
      .filter((a) => a.status !== "disconnected")
      .map((a) => ({
        id: a.id,
        label:
          a.displayName === undefined ? a.emailAddress : `${a.displayName} · ${a.emailAddress}`,
        kind: a.provider,
      })),
    models:
      runtime?.hasAiKey === true && runtime.aiBaseUrl !== null
        ? runtime.aiModels.map((id) => ({ id, label: id }))
        : [],
    functions: functions.map((f) => ({
      id: f.id,
      label: `${f.name} · v${f.revision}`,
      inputs: schemaFields(f.input),
      outputs: schemaFields(f.output),
    })),
  };
}
