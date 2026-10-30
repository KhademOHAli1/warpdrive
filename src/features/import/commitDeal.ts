import { createDeal } from "@/features/deals/dealActions";
import { applyImportedDealHistory } from "@/features/deals/importedHistory";
import { dealCreateInput } from "@/features/deals/schemas";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { ImportActor, RowError } from "./commitHelpers";
import { authorityError, issuesOf, toEntityCreateSession } from "./commitHelpers";
import type { ImportContext } from "./externalIds";
import { dealImportRowSchema } from "./importRowSchemas";
import { resolvePipelineId, resolveStageId } from "./resolveDealPlacement";

export async function applyCreateDeal(
  tx: DbOrTx,
  actor: ImportActor,
  mapped: Record<string, unknown>,
  links: { orgId: string | null; personId: string | null },
  ctx: ImportContext,
  signal: AbortSignal,
): Promise<Result<{ id: string; warnings: RowError[] }, RowError[]>> {
  const parsed = dealImportRowSchema.safeParse(mapped);
  if (parsed.success === false) return err(issuesOf(parsed.error));

  const pipelineResult = await resolvePipelineId(tx, actor, ctx, parsed.data.pipeline, signal);
  if (pipelineResult.ok === false) return pipelineResult;
  const stageResult = await resolveStageId(
    tx,
    actor,
    ctx,
    pipelineResult.value,
    parsed.data.stage,
    signal,
  );
  if (stageResult.ok === false) return stageResult;

  const candidate = {
    title: parsed.data.title,
    value: parsed.data.value,
    expectedCloseDate: parsed.data.expectedCloseDate,
    pipelineId: pipelineResult.value,
    stageId: stageResult.value,
    orgId: links.orgId,
    personId: links.personId,
    customFields: parsed.data.customFields,
    labels: parsed.data.labels,
  };
  const finalParsed = dealCreateInput.safeParse(candidate);
  if (finalParsed.success === false) return err(issuesOf(finalParsed.error));

  const result = await createDeal(tx, toEntityCreateSession(actor), finalParsed.data, signal);
  if (result.ok === false) return err(authorityError(result.error));
  const warnings =
    ctx.source === "pipedrive"
      ? await applyImportedDealHistory(tx, result.value.id, parsed.data, signal)
      : [];
  return ok({ id: result.value.id, warnings });
}
