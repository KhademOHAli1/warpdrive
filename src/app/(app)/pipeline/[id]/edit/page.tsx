import { createSalesStrings } from "@/features/deals/salesStrings";
import { getAppTranslations, getLocalePreferences } from "@/features/i18n/server";
import { EditPipelineClient } from "@/features/pipelines/EditPipelineClient";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";

export async function generateMetadata() {
  const STRINGS = createSalesStrings((await getLocalePreferences()).locale);
  return { title: STRINGS.titles.editPipeline };
}

export default async function EditPipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string | string[] }>;
}): Promise<React.ReactNode> {
  const translateSales = await getAppTranslations("sales");

  const { id } = await params;
  const origin = (await searchParams)?.from;
  const ctx = await createContext();
  if (ctx.actor === null) {
    return <main>{translateSales("unauthorized_d089c")}</main>;
  }
  const caller = createCaller(ctx);
  const pipeline = await caller.pipeline.byId(id);
  if (pipeline === null) {
    return <main>{translateSales("pipeline_not_found_a9a42")}</main>;
  }
  const counts = await caller.pipeline.stageDealCounts(id);

  return (
    <main
      aria-label={translateSales("edit_pipeline_arg0_2a596", { arg0: pipeline.name })}
      className="h-full"
    >
      <h1 className="mb-4 text-display font-[450] leading-tight tracking-tight">
        {translateSales("edit_pipeline_81305")}
      </h1>
      <EditPipelineClient
        key={pipeline.id}
        pipelineId={pipeline.id}
        returnToSettings={origin === "settings"}
        pipelineName={pipeline.name}
        pipelineUpdatedAt={pipeline.updatedAt.toISOString()}
        snapshotId={randomUUID()}
        stages={pipeline.stages.map((s) => ({
          id: s.id,
          name: s.name,
          rottingDays: s.rottingDays,
          dealCount: counts[s.id]?.total ?? 0,
          closedDealCount: counts[s.id]?.closed ?? 0,
        }))}
      />
    </main>
  );
}

import { randomUUID } from "node:crypto";
