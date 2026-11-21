"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectFailure } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import type { PlanningGroup, PlanningGroupKind, PlanningSavedView } from "./contracts";
import { planningLabels } from "./messages";
import { planningSelectClass } from "./PlanningEditors";
import { planningItemPath } from "./paths";

export function PlanningArchiveToggle({
  actorId,
  projectId,
  entry,
}: {
  actorId: string;
  projectId: string;
  entry: PlanningGroup | PlanningSavedView;
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningLabels[locale];
  const router = useRouter();
  const [error, setError] = useState<ProjectFailure | null>(null);
  const archiveGroup = trpc.internalProjects.planning.archiveGroup.useMutation();
  const archiveView = trpc.internalProjects.planning.archiveView.useMutation();

  async function toggle() {
    setError(null);
    const common = {
      projectId,
      expectedActorId: actorId,
      csrfToken: readCsrfToken(),
      archived: !entry.archived,
      revision: entry.revision,
    };
    try {
      const result =
        "kind" in entry
          ? await archiveGroup.mutateAsync({ ...common, groupId: entry.id, kind: entry.kind })
          : await archiveView.mutateAsync({ ...common, viewId: entry.id });
      if (result.ok) router.refresh();
      else setError(result.error);
    } catch {
      setError("project_unavailable");
    }
  }

  return (
    <div>
      <Button
        variant="outline"
        onClick={() => void toggle()}
        disabled={archiveGroup.isPending || archiveView.isPending}
      >
        {entry.archived ? labels.restore : labels.archive}
      </Button>
      <ProjectWriteNotice error={error} labels={projectsTranslator(locale, numberingSystem)} />
    </div>
  );
}

export function PlanningGroupItems({
  actorId,
  projectId,
  groupId,
  kind,
  canEdit,
  canAdd,
  items,
}: {
  actorId: string;
  projectId: string;
  groupId: string;
  kind: PlanningGroupKind;
  canEdit: boolean;
  canAdd: boolean;
  items: { id: string; title: string; included: boolean }[];
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningLabels[locale];
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [error, setError] = useState<ProjectFailure | null>(null);
  const change = trpc.internalProjects.planning.changeGroupItems.useMutation();
  const members = items.filter(({ included }) => included);
  const candidates = items.filter(({ included }) => !included);

  async function setIncluded(id: string, included: boolean) {
    setError(null);
    try {
      const result = await change.mutateAsync({
        projectId,
        groupId,
        kind,
        itemId: id,
        included,
        expectedActorId: actorId,
        csrfToken: readCsrfToken(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setItemId("");
      router.refresh();
    } catch {
      setError("project_unavailable");
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{labels.workItems}</h2>
      {canAdd && candidates.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (itemId) void setIncluded(itemId, true);
          }}
        >
          <label className="min-w-40 max-w-sm grow text-sm">
            {labels.chooseItem}
            <select
              className={planningSelectClass}
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            >
              <option value="">{labels.chooseItem}</option>
              {candidates.map(({ id, title }) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={itemId === "" || change.isPending}>
            {labels.add}
          </Button>
        </form>
      )}
      <ProjectWriteNotice error={error} labels={projectsTranslator(locale, numberingSystem)} />
      {members.length > 0 ? (
        <ul className="divide-y rounded-md border bg-card">
          {members.map(({ id, title }) => (
            <li key={id} className="flex items-center justify-between gap-2 px-3 py-2">
              <Link
                className="min-w-0 text-sm font-medium hover:underline [overflow-wrap:anywhere]"
                href={planningItemPath(projectId, id)}
              >
                <bdi>{title}</bdi>
              </Link>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={change.isPending}
                  onClick={() => void setIncluded(id, false)}
                >
                  {labels.remove}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{labels.noItems}</p>
      )}
    </section>
  );
}
