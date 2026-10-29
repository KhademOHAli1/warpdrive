import Link from "next/link";
import type { ReactNode } from "react";
import { PERMISSION_FLAGS } from "@/constants/permissionFlags";
import { getServerSettingsMessages } from "@/features/identity/settingsMessages.server";
import { CreatePipelineButton } from "@/features/pipelines/CreatePipelineButton";
import { createContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/root";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../../SettingsSurface";

export async function generateMetadata() {
  const L = await getServerSettingsMessages();
  return { title: L.pipelines };
}

// Company settings > Pipelines tab: list pipelines, create new ones, link to the stage editor.
// Gated on admin or the pipeline.manage flag (same capability createPipeline enforces server-side).
export default async function PipelinesSettingsPage(): Promise<ReactNode> {
  const L = await getServerSettingsMessages();

  const ctx = await createContext();
  const { actor } = ctx;
  if (
    actor === null ||
    (actor.type !== "admin" && !actor.flags.has(PERMISSION_FLAGS.PIPELINE_MANAGE))
  ) {
    return <p className="text-sm text-red-600">{L.requiresAdmin}</p>;
  }

  const caller = createCaller(ctx);
  const pipelines = await caller.pipeline.list();

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={L.pipelines}
        description={L.pipelinesDescription}
        actions={<CreatePipelineButton label={L.createPipeline} onCreated="edit" />}
      />
      {pipelines.length === 0 ? (
        <SettingsCardBody>
          <p className="text-sm text-muted-foreground">{L.noPipelinesYet}</p>
        </SettingsCardBody>
      ) : (
        <ul className="divide-y">
          {pipelines.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-4 py-3 transition-colors duration-150 ease-out hover:bg-accent/50 motion-reduce:transition-none"
            >
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {L._extra.stageCount(p.stages.length)}
                </div>
              </div>
              <Link
                href={`/pipeline/${p.id}/edit`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {L.editStages}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
