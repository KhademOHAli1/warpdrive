import { applyImportedLeadHistory } from "@/features/leads/importedHistory";
import { createLead } from "@/features/leads/leadActions";
import { leadCreateInput } from "@/features/leads/schemas";
import { err, ok, type Result } from "@/types/result";
import type { ImportActor, RowError } from "./commitHelpers";
import { type applyCreate, authorityError, issuesOf, toEntityCreateSession } from "./commitHelpers";
import type { ImportContext } from "./externalIds";
import { leadImportRowSchema } from "./importRowSchemas";

type Tx = Parameters<typeof applyCreate>[0];

export async function applyCreateLead(
  tx: Tx,
  actor: ImportActor,
  mapped: Record<string, unknown>,
  links: { orgId: string | null; personId: string | null },
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<Result<string, RowError[]>> {
  const parsed = leadImportRowSchema.safeParse(mapped);
  if (parsed.success === false) return err(issuesOf(parsed.error));
  const data = parsed.data;

  const candidate = {
    title: data.title,
    value: data.value,
    orgId: links.orgId,
    personId: links.personId,
    labels: data.labels,
    expectedCloseDate: data.expectedCloseDate,
    sourceOrigin: "imported",
    customFields: data.customFields,
    ...(data.sourceChannel !== null ? { sourceChannel: data.sourceChannel } : {}),
    ...(data.sourceChannelId !== null ? { sourceChannelId: data.sourceChannelId } : {}),
  };
  const finalParsed = leadCreateInput.safeParse(candidate);
  if (finalParsed.success === false) return err(issuesOf(finalParsed.error));

  const result = await createLead(tx, toEntityCreateSession(actor), finalParsed.data, signal);
  if (result.ok === false) return err(authorityError(result.error));
  if (ctx.source === "pipedrive") {
    await applyImportedLeadHistory(tx, result.value.id, data, signal);
  }
  return ok(result.value.id);
}
