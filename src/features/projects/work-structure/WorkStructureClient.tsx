"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectResult, ProjectWorkspace } from "../contracts";
import { ProjectSettingsTabs } from "../settings/ProjectSettingsTabs";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { projectsTranslator } from "../ui/projectMessages";
import { useProjectWrites } from "../ui/projectWrites";
import {
  saveProjectEstimateScaleAction,
  saveProjectLabelsAction,
  setProjectEstimateScaleAction,
} from "./actions";
import type { ProjectWorkStructure } from "./contracts";
import { EstimateSettings } from "./EstimateSettings";
import { LabelSettings } from "./LabelSettings";
import { workStructureMessages } from "./messages";

export type WorkStructureSection = "labels" | "estimates";

export function WorkStructureClient({
  actorId,
  initial,
  section,
}: {
  actorId: string;
  initial: ProjectWorkspace;
  section: WorkStructureSection;
}) {
  const [catalog, setCatalog] = useState(initial.workStructure);
  const [saved, setSaved] = useState(false);
  const { execute, pending, error } = useProjectWrites();
  const router = useRouter();
  const { locale, numberingSystem } = useLocalePreferences();
  const t = workStructureMessages[locale];
  const projectLabels = projectsTranslator(locale, numberingSystem);
  const { id, archived, title } = initial.project;
  const target = { projectId: id, revision: catalog.revision };
  const writable = initial.canManageSettings && !archived;
  const usedPoints = new Set(
    initial.items.flatMap(({ estimatePointId }) =>
      estimatePointId === null ? [] : [estimatePointId],
    ),
  );

  async function persist(write: () => Promise<ProjectResult<ProjectWorkStructure>>) {
    setSaved(false);
    const result = await execute(write, setCatalog);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    }
    return result.ok;
  }

  return (
    <div className={`${BLOCK_CLASS} ph-no-capture min-w-0`}>
      <PageHeading
        title={t[section]}
        crumbs={[{ label: title, href: `/projects/internal/${id}` }, { label: t[section] }]}
      />
      <ProjectWorkspaceNav
        projectId={id}
        active="settings"
        canManageSettings={initial.canManageSettings}
        intakeEnabled={initial.settings.intakeEnabled}
      />
      <ProjectSettingsTabs projectId={id} active={section} />
      <div className="max-w-4xl space-y-4">
        {archived && <p className="rounded-lg border bg-muted/50 p-3 text-sm">{t.archived}</p>}
        <ProjectWriteNotice error={error} labels={projectLabels} />
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t.saved}
          </p>
        )}
        {section === "labels" ? (
          <LabelSettings
            key={catalog.revision}
            initial={catalog.labels}
            labels={t}
            writable={writable}
            pending={pending}
            save={(labels) =>
              void persist(() =>
                saveProjectLabelsAction(actorId, { ...target, labels }, readCsrfToken()),
              )
            }
          />
        ) : (
          <EstimateSettings
            catalog={catalog}
            labels={t}
            writable={writable}
            pending={pending}
            usedPoints={usedPoints}
            save={(draft) =>
              persist(() =>
                saveProjectEstimateScaleAction(actorId, { ...target, ...draft }, readCsrfToken()),
              )
            }
            activate={(scaleId) =>
              void persist(() =>
                setProjectEstimateScaleAction(actorId, { ...target, scaleId }, readCsrfToken()),
              )
            }
          />
        )}
      </div>
    </div>
  );
}
