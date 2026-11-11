import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import type { Db } from "@/db/client";
import { workflowV2LogicFunctions } from "@/db/schema/workflowV2Functions";
import { blockReferences, resolveBlockConfig } from "@/features/blocks/bindings";
import type { BlockOutput, BlockReadiness, WorkflowV2Node } from "@/features/blocks/contracts";
import { validateResolvedBlockConfig } from "@/features/blocks/schemas";
import { listActorMailboxes } from "@/features/email/mailAccountsRepo";
import { newsletterConfigured } from "@/features/newsletter/listmonkClient";
import { hasNewsletterPermission } from "@/features/newsletter/permissions";
import type { PermSetUser } from "@/features/permissions/effective";
import { classificationSchema } from "./aiActions";
import { workflowHttpsUrl } from "./httpTransport";
import { newsletterActionAccess } from "./newsletterAuthority";
import { validResponseSchema } from "./responseSchema";
import { readAiRuntimeMetadata } from "./runtime";

const needs = (reason: string): BlockReadiness => ({ state: "needs_configuration", reason });
const ready: BlockReadiness = { state: "ready" };
async function mailReadiness(
  db: Db,
  actor: PermSetUser,
  config: BlockOutput,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  const mailboxes = (await listActorMailboxes(db, actor.id, signal)).filter(
    (a) => a.status === "connected" && a.capabilities.send,
  );
  if (mailboxes.length === 0) return { state: "needs_connection", reason: "mailbox_setup" };
  if (typeof config.accountId === "string" && !mailboxes.some((a) => a.id === config.accountId))
    return { state: "forbidden", reason: "mailbox_unavailable" };
  return ready;
}
async function logicReadiness(db: Db, config: BlockOutput): Promise<BlockReadiness> {
  const id = z.uuid().safeParse(config.functionId);
  if (!id.success) {
    const [available] = await db
      .select({ id: workflowV2LogicFunctions.id })
      .from(workflowV2LogicFunctions)
      .limit(1);
    return available === undefined
      ? { state: "needs_connection", reason: "workflow_runtime_setup" }
      : needs("function_required");
  }
  const [fn] = await db
    .select({ id: workflowV2LogicFunctions.id })
    .from(workflowV2LogicFunctions)
    .where(eq(workflowV2LogicFunctions.id, id.data));
  return fn === undefined ? needs("function_unavailable") : ready;
}
async function aiReadiness(
  db: Db,
  node: WorkflowV2Node,
  config: BlockOutput,
  references: boolean,
): Promise<BlockReadiness> {
  const runtime = await readAiRuntimeMetadata(db);
  if (
    runtime === undefined ||
    !runtime.hasAiKey ||
    runtime.aiBaseUrl === null ||
    runtime.aiModels.length === 0
  )
    return { state: "needs_connection", reason: "workflow_runtime_setup" };
  const model =
    typeof config.providerModel === "string" && config.providerModel !== ""
      ? config.providerModel
      : runtime.aiDefaultModel;
  if (model === null || !runtime.aiModels.includes(model)) return needs("model_unavailable");
  if (node.type === "CLASSIFY" && !references && classificationSchema(config.questions) === null)
    return needs("classification_questions");
  return ready;
}

function newsletterReadiness(actor: PermSetUser, node: WorkflowV2Node): BlockReadiness {
  const access = newsletterActionAccess(node.type);
  if (access === null) return ready;
  if (!hasNewsletterPermission(actor, access)) return { state: "forbidden" };
  if (!newsletterConfigured() || (access === "consent" && !env.NEWSLETTER_DELIVERY_ENABLED))
    return { state: "needs_connection", reason: "newsletter_setup" };
  if (
    node.config.personId === undefined ||
    node.config.listId === undefined ||
    (access === "consent" && node.config.linkId === undefined)
  )
    return needs("invalid_configuration");
  return ready;
}

export async function externalActionReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  if (!actor.isActive) return { state: "forbidden" };
  const newsletter = newsletterReadiness(actor, node);
  if (newsletter.state !== "ready") return newsletter;
  let references: boolean;
  try {
    references = blockReferences(node.config).length > 0;
  } catch {
    return needs("invalid_binding");
  }
  const resolved = resolveBlockConfig(node.config, {}, [], {});
  const config = resolved.ok ? resolved.value : node.config;
  const dependency = await connectionReadiness(db, actor, node, config, references, signal);
  if (dependency.state !== "ready") return dependency;
  if (!references && !validateResolvedBlockConfig(node.type, config).success)
    return needs("invalid_configuration");
  if (config.responseSchema !== undefined && !validResponseSchema(config.responseSchema))
    return needs("response_schema");
  if (config.outputSchema !== undefined && !validResponseSchema(config.outputSchema))
    return needs("output_schema");
  return ready;
}

function connectionReadiness(
  db: Db,
  actor: PermSetUser,
  node: WorkflowV2Node,
  config: BlockOutput,
  references: boolean,
  signal: AbortSignal,
): Promise<BlockReadiness> {
  if (
    node.type === "HTTP_REQUEST" &&
    typeof config.url === "string" &&
    workflowHttpsUrl(config.url) === null
  )
    return Promise.resolve(needs("https_url"));
  if (node.type === "SEND_EMAIL") return mailReadiness(db, actor, config, signal);
  if (node.type === "LOGIC_FUNCTION") return logicReadiness(db, config);
  if (node.type === "AI_AGENT" || node.type === "CLASSIFY")
    return aiReadiness(db, node, config, references);
  return Promise.resolve(ready);
}
