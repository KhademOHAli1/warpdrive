import { redirect } from "next/navigation";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { DashboardSelect } from "@/features/dashboards/DashboardSelect";
import { createSalesStrings } from "@/features/deals/salesStrings";
import { getAppTranslations, getLocalePreferences } from "@/features/i18n/server";
import { CreatePipelineButton } from "@/features/pipelines/CreatePipelineButton";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";

export async function generateMetadata() {
  const nav = await getAppTranslations("nav");
  return { title: nav("dashboard") };
}

// The primary nav links to /pipeline, but a board is always scoped to a specific
// pipeline (/pipeline/[id]). Land the section root on the user's first visible
// pipeline so the nav item never 404s.
export default async function PipelineIndexPage(): Promise<React.ReactNode> {
  const STRINGS = createSalesStrings((await getLocalePreferences()).locale);

  const nav = await getAppTranslations("nav");

  const ctx = await createContext();
  if (ctx.actor === null) {
    redirect("/login");
  }
  const caller = createCaller(ctx);
  const pipelines = await caller.pipeline.list();
  const first = pipelines[0];
  if (first === undefined) {
    // Performance remains reachable even when this viewer has no visible pipeline dashboard.
    const canManage =
      ctx.actor.type === "admin" || ctx.actor.flags.has(PERMISSION_FLAGS.PIPELINE_MANAGE);
    return (
      <main aria-label={nav("dashboard")} className="flex h-full flex-col p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{nav("dashboard")}</h1>
          <DashboardSelect current={null} pipelines={pipelines} canManagePipelines={canManage} />
        </div>
        <div className="grid flex-1 place-items-center p-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{STRINGS.settings.noPipelinesYet}</p>
            {canManage && (
              <CreatePipelineButton
                label={STRINGS.settings.createFirstPipeline}
                onCreated="board"
              />
            )}
          </div>
        </div>
      </main>
    );
  }
  redirect(`/pipeline/${first.id}`);
}
