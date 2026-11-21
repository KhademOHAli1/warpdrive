"use client";

import { Badge } from "@/components/ui/Badge";
import { MultiCombobox } from "@/components/ui/MultiCombobox";
import { Select } from "@/components/ui/Select";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { WorkspacePlanning } from "../planning/contracts";
import { ProjectWriteNotice } from "./ProjectTitleDialog";
import type { ProjectsTranslator } from "./projectMessages";

export function ProjectItemPlanning({
  projectId,
  itemId,
  actorId,
  canEdit,
  planning,
  labels,
  change,
}: {
  projectId: string;
  itemId: string;
  actorId: string;
  canEdit: boolean;
  planning: WorkspacePlanning;
  labels: ProjectsTranslator;
  change: (next: WorkspacePlanning) => void;
}) {
  const mutation = trpc.internalProjects.planning.setItemPlanning.useMutation({
    onSuccess(result) {
      if (result.ok) change(result.value);
    },
  });
  const assignment = planning.assignments.find((entry) => entry.itemId === itemId);
  const cycleId = assignment?.cycleId ?? null;
  const moduleIds = assignment?.moduleIds ?? [];
  const cycle = planning.cycles.find(({ id }) => id === cycleId);

  function save(patch: { cycleId?: string | null; moduleIds?: string[] }) {
    if (mutation.isPending) return;
    mutation.mutate({
      projectId,
      itemId,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      ...patch,
    });
  }

  return (
    <section className="mt-5 space-y-3 border-t pt-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="font-medium">{labels("planning.cycle")}</p>
          {canEdit ? (
            <Select
              ariaLabel={labels("planning.cycle")}
              disabled={mutation.isPending}
              value={cycleId ?? ""}
              contentClassName={`${BLOCK_CLASS} ph-no-capture`}
              options={[
                { value: "", label: labels("planning.noCycle") },
                ...planning.cycles
                  .filter(({ acceptsWork, id }) => acceptsWork || id === cycleId)
                  .map(({ id, title }) => ({ value: id, label: title })),
              ]}
              onChange={(value) => save({ cycleId: value || null })}
            />
          ) : (
            <bdi>{cycle?.title ?? labels("planning.noCycle")}</bdi>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">{labels("planning.modules")}</p>
          {canEdit ? (
            <fieldset disabled={mutation.isPending}>
              <MultiCombobox
                ariaLabel={labels("planning.modules")}
                placeholder={labels("planning.noModules")}
                values={moduleIds}
                options={planning.modules
                  .filter(({ acceptsWork, id }) => acceptsWork || moduleIds.includes(id))
                  .map(({ id, title }) => ({ value: id, label: title }))}
                onChange={(value) => save({ moduleIds: value })}
              />
            </fieldset>
          ) : (
            <div className="flex flex-wrap gap-1">
              {moduleIds.length === 0 && labels("planning.noModules")}
              {planning.modules
                .filter(({ id }) => moduleIds.includes(id))
                .map(({ id, title }) => (
                  <Badge variant="secondary" key={id}>
                    <bdi>{title}</bdi>
                  </Badge>
                ))}
            </div>
          )}
        </div>
      </div>
      <ProjectWriteNotice
        labels={labels}
        error={
          mutation.data?.ok === false
            ? mutation.data.error
            : mutation.isError
              ? "project_unavailable"
              : null
        }
      />
    </section>
  );
}
