import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getLocalePreferences } from "@/features/i18n/server";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type FormattingPreferences,
  formatDateOnly,
  formatDateTime,
  formatNumber,
} from "@/lib/localeFormatting";
import type { ProjectSummary } from "../contracts";
import { projectIdInput } from "../input";
import { ProjectTypeNav } from "../ProjectTypeNav";
import { projectToday } from "../settings/projectTime";
import { ProjectWorkspaceNav } from "../ui/ProjectWorkspaceNav";
import { readInternalWorkspace, requireInternalProjects } from "../webReads";
import { planningAdvancedLabels } from "./advancedMessages";
import {
  canArchivePlanningGroup,
  type PlanningChoice,
  type PlanningGroup,
  type PlanningGroupKind,
  type PlanningSection,
  planningCyclePhase,
  planningViewLayouts,
} from "./contracts";
import { type PlanningLabels, planningLabels } from "./messages";
import { PlanningArchiveToggle, PlanningGroupItems } from "./PlanningChanges";
import { PlanningCycleRollover, type RolloverDestination } from "./PlanningCycleRollover";
import { PlanningGroupEditor, PlanningViewEditor } from "./PlanningEditors";
import { PlanningViewFavorite, PlanningViewLock } from "./PlanningViewControls";
import { PlanningViewQuickActions } from "./PlanningViewQuickActions";
import { openPlanningGroupPath, openPlanningViewPath, planningPath } from "./paths";
import {
  readPlanningGroup,
  readPlanningGroups,
  readPlanningSavedView,
  readPlanningViews,
  readWorkspacePlanning,
} from "./webReads";

const detailLink = "min-w-0 font-medium text-foreground hover:underline [overflow-wrap:anywhere]";
const secondaryLink =
  "inline-flex min-h-9 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

function checkedId(raw: string) {
  const id = projectIdInput.safeParse(raw);
  if (!id.success) notFound();
  return id.data;
}

function PlanningFrame({
  project,
  section,
  canManageSettings,
  intakeEnabled,
  labels,
  entry,
  children,
}: {
  project: ProjectSummary;
  section: PlanningSection;
  canManageSettings: boolean;
  intakeEnabled: boolean;
  labels: PlanningLabels;
  entry?: PlanningChoice;
  children: ReactNode;
}) {
  const sectionClue = { label: labels[section], href: planningPath(project.id, section) };
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-4`}>
      <ProjectTypeNav active="internal" />
      <PageHeading
        title={entry?.title ?? labels[section]}
        crumbs={[
          { label: project.title, href: planningPath(project.id) },
          sectionClue,
          ...(entry ? [{ label: entry.title }] : []),
        ]}
      />
      <ProjectWorkspaceNav
        projectId={project.id}
        active={section}
        canManageSettings={canManageSettings}
        intakeEnabled={intakeEnabled}
      />
      {children}
    </section>
  );
}

function canRollover(group: PlanningGroup, canEdit: boolean, today: string) {
  return (
    canEdit &&
    group.kind === "cycles" &&
    !group.archived &&
    planningCyclePhase(group, today) === "completed" &&
    group.itemCount > group.closedCount
  );
}

function rolloverTargets(groups: PlanningGroup[], today: string): RolloverDestination[] {
  return groups
    .filter(({ archived }) => !archived)
    .map(({ id, title, startDate, endDate }) => ({
      id,
      title,
      phase: planningCyclePhase({ startDate, endDate }, today),
    }))
    .filter(({ phase }) => phase !== "completed");
}

function RolloverSnapshot({
  group,
  projectId,
  preferences,
}: {
  group: PlanningGroup;
  projectId: string;
  preferences: FormattingPreferences;
}) {
  const snapshot = group.rolloverSnapshot;
  if (snapshot === null) return null;
  const labels = planningAdvancedLabels[preferences.locale];
  const base = planningLabels[preferences.locale];
  return (
    <section className="space-y-2 rounded-md border bg-card px-4 py-3">
      <h2 className="text-sm font-semibold">{labels.lastTransfer}</h2>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <div>
          <dt>{labels.beforeTransfer}</dt>
          <dd className="font-medium text-foreground">
            {formatNumber(snapshot.itemCount, preferences)}
          </dd>
        </div>
        <div>
          <dt>{base.closed}</dt>
          <dd className="font-medium text-foreground">
            {formatNumber(snapshot.closedCount, preferences)}
          </dd>
        </div>
        <div>
          <dt>{labels.moved}</dt>
          <dd className="font-medium text-foreground">
            {formatNumber(snapshot.movedCount, preferences)}
          </dd>
        </div>
        <div>
          <dt>
            <Link
              className="underline"
              href={planningPath(projectId, "cycles", snapshot.targetCycleId)}
            >
              {labels.destination}
            </Link>
          </dt>
          <dd>
            <time dateTime={snapshot.recordedAt}>
              {formatDateTime(snapshot.recordedAt, preferences)}
            </time>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EditorPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border bg-card p-4">
      <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {title}
      </summary>
      {children}
    </details>
  );
}

function SplitIndex<T extends PlanningChoice>({
  entries,
  labels,
  emptyTitle,
  emptyBody,
  children,
}: {
  entries: T[];
  labels: PlanningLabels;
  emptyTitle: string;
  emptyBody: string;
  children: (entry: T) => ReactNode;
}) {
  if (entries.length === 0)
    return <EmptyState className="rounded-lg border bg-card" title={emptyTitle} body={emptyBody} />;
  return ([false, true] as const).map((archived) => {
    const visible = entries.filter((entry) => entry.archived === archived);
    if (visible.length === 0) return null;
    return (
      <section key={String(archived)} className="space-y-2">
        <h2 className="text-sm font-semibold">{archived ? labels.archived : labels.active}</h2>
        <ul className="divide-y rounded-lg border bg-card">
          {visible.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              {children(entry)}
            </li>
          ))}
        </ul>
      </section>
    );
  });
}

function GroupFacts({
  entry,
  labels,
  preferences,
  today,
}: {
  entry: PlanningGroup;
  labels: PlanningLabels;
  preferences: FormattingPreferences;
  today: string;
}) {
  const status = entry.kind === "cycles" ? planningCyclePhase(entry, today) : entry.moduleStatus;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {entry.archived && <Badge variant="secondary">{labels.archived}</Badge>}
      {status !== null && (
        <Badge variant={status === "completed" ? "success" : "outline"}>{labels[status]}</Badge>
      )}
      {entry.startDate !== null && (
        <span>
          {labels.startDate} {formatDateOnly(entry.startDate, preferences)}
        </span>
      )}
      {entry.endDate !== null && (
        <span>
          {labels.endDate} {formatDateOnly(entry.endDate, preferences)}
        </span>
      )}
      <span>
        {labels.workItems} {formatNumber(entry.itemCount, preferences)}
      </span>
      {entry.itemCount > 0 && (
        <span>
          {labels.closed} {formatNumber(entry.closedCount, preferences)}
        </span>
      )}
    </div>
  );
}

function GroupLayouts({
  projectId,
  group,
  labels,
}: {
  projectId: string;
  group: PlanningGroup;
  labels: PlanningLabels;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{labels.layouts}</h2>
      <nav aria-label={labels.layouts} className="flex flex-wrap gap-2">
        {planningViewLayouts.map((layout) => (
          <Link
            key={layout}
            className={secondaryLink}
            href={openPlanningGroupPath(projectId, group.kind, group.id, layout)}
          >
            {labels[layout]}
          </Link>
        ))}
      </nav>
    </section>
  );
}

export async function planningGroupsPage(rawProjectId: string, kind: PlanningGroupKind) {
  const { actorId } = await requireInternalProjects();
  const projectId = checkedId(rawProjectId);
  const [result, preferences] = await Promise.all([
    readPlanningGroups(projectId, kind),
    getLocalePreferences(),
  ]);
  if (!result.ok) notFound();
  const { project, canEdit, canManageSettings, intakeEnabled, groups } = result.value;
  const labels = planningLabels[preferences.locale];
  const cycle = kind === "cycles";
  const today = projectToday(project.timeZone);
  const targets = cycle ? rolloverTargets(groups, today) : [];
  return (
    <PlanningFrame
      project={project}
      section={kind}
      labels={labels}
      canManageSettings={canManageSettings}
      intakeEnabled={intakeEnabled}
    >
      {canEdit && (
        <EditorPanel title={cycle ? labels.newCycle : labels.newModule}>
          <PlanningGroupEditor actorId={actorId} projectId={projectId} kind={kind} />
        </EditorPanel>
      )}
      <SplitIndex
        entries={groups}
        labels={labels}
        emptyTitle={cycle ? labels.cycleEmpty : labels.moduleEmpty}
        emptyBody={cycle ? labels.cycleHelp : labels.moduleHelp}
      >
        {(group) => (
          <>
            <Link href={planningPath(projectId, kind, group.id)} className={detailLink}>
              <bdi>{group.title}</bdi>
            </Link>
            <GroupFacts entry={group} labels={labels} preferences={preferences} today={today} />
            {canRollover(group, canEdit, today) && (
              <PlanningCycleRollover
                actorId={actorId}
                projectId={projectId}
                source={group}
                targets={targets}
              />
            )}
          </>
        )}
      </SplitIndex>
    </PlanningFrame>
  );
}

export async function planningGroupPage(
  rawProjectId: string,
  kind: PlanningGroupKind,
  rawGroupId: string,
) {
  const { actorId } = await requireInternalProjects();
  const projectId = checkedId(rawProjectId);
  const groupId = checkedId(rawGroupId);
  const [result, preferences] = await Promise.all([
    readPlanningGroup(projectId, kind, groupId),
    getLocalePreferences(),
  ]);
  if (!result.ok) notFound();
  const { project, group, items, canEdit, canManageSettings, intakeEnabled } = result.value;
  const labels = planningLabels[preferences.locale];
  const today = projectToday(project.timeZone);
  const cycleCompleted = kind === "cycles" && planningCyclePhase(group, today) === "completed";
  const canAdd = canEdit && !group.archived && !cycleCompleted;
  const canArchive = canArchivePlanningGroup(group, today);
  const canTransfer = canRollover(group, canEdit, today);
  const candidates = canTransfer ? await readPlanningGroups(projectId, "cycles") : null;
  return (
    <PlanningFrame
      project={project}
      section={kind}
      labels={labels}
      canManageSettings={canManageSettings}
      intakeEnabled={intakeEnabled}
      entry={group}
    >
      <GroupFacts entry={group} preferences={preferences} labels={labels} today={today} />
      {group.description && (
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{group.description}</p>
      )}
      <GroupLayouts projectId={projectId} group={group} labels={labels} />
      {canTransfer && (
        <PlanningCycleRollover
          actorId={actorId}
          projectId={projectId}
          source={group}
          targets={candidates?.ok === true ? rolloverTargets(candidates.value.groups, today) : []}
        />
      )}
      <RolloverSnapshot group={group} projectId={projectId} preferences={preferences} />
      {canEdit && (group.archived || canArchive) && (
        <PlanningArchiveToggle actorId={actorId} projectId={projectId} entry={group} />
      )}
      {canEdit && !group.archived && !canArchive && (
        <p className="text-sm text-muted-foreground">
          {labels[kind === "cycles" ? "archiveCycleHelp" : "archiveModuleHelp"]}
        </p>
      )}
      {canAdd && (
        <EditorPanel title={labels.edit}>
          <PlanningGroupEditor
            key={group.revision}
            actorId={actorId}
            projectId={projectId}
            kind={kind}
            group={group}
          />
        </EditorPanel>
      )}
      <PlanningGroupItems
        actorId={actorId}
        projectId={projectId}
        groupId={groupId}
        kind={kind}
        items={items}
        canEdit={canEdit && !group.archived}
        canAdd={canAdd}
      />
    </PlanningFrame>
  );
}

async function readEditorContext(projectId: string) {
  const [workspace, planning] = await Promise.all([
    readInternalWorkspace(projectId),
    readWorkspacePlanning(projectId),
  ]);
  if (!workspace.ok || !planning.ok) notFound();
  const { project, states, members, workStructure } = workspace.value;
  const { cycles, modules } = planning.value;
  return { workspace: { project, states, members, workStructure }, planning: { cycles, modules } };
}

export async function planningViewsPage(rawProjectId: string, favoriteOnly = false) {
  const { actorId } = await requireInternalProjects();
  const projectId = checkedId(rawProjectId);
  const [result, preferences] = await Promise.all([
    readPlanningViews(projectId),
    getLocalePreferences(),
  ]);
  if (!result.ok) notFound();
  const { project, canEdit, canManageSettings, intakeEnabled, views } = result.value;
  const context = canEdit ? await readEditorContext(projectId) : null;
  const labels = planningLabels[preferences.locale];
  const advanced = planningAdvancedLabels[preferences.locale];
  const indexPath = planningPath(projectId, "views");
  return (
    <PlanningFrame
      project={project}
      section="views"
      labels={labels}
      canManageSettings={canManageSettings}
      intakeEnabled={intakeEnabled}
    >
      {context && (
        <EditorPanel title={labels.newView}>
          <PlanningViewEditor actorId={actorId} {...context} />
        </EditorPanel>
      )}
      <nav aria-label={labels.views} className="flex flex-wrap gap-2">
        <Link
          href={indexPath}
          className={secondaryLink}
          aria-current={!favoriteOnly ? "page" : undefined}
        >
          {advanced.allViews}
        </Link>
        <Link
          href={`${indexPath}?favorites=1`}
          className={secondaryLink}
          aria-current={favoriteOnly ? "page" : undefined}
        >
          {advanced.favorites}
        </Link>
      </nav>
      <SplitIndex
        entries={favoriteOnly ? views.filter((view) => view.favorite && !view.archived) : views}
        labels={labels}
        emptyTitle={favoriteOnly ? advanced.noFavorites : labels.viewEmpty}
        emptyBody={favoriteOnly ? advanced.favoritesHelp : labels.viewHelp}
      >
        {(view) => (
          <>
            <Link href={planningPath(projectId, "views", view.id)} className={detailLink}>
              <bdi>{view.title}</bdi>
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{labels[view.layout]}</Badge>
              <Badge variant="secondary">{labels[view.visibility]}</Badge>
              {view.locked && <Badge variant="outline">{advanced.locked}</Badge>}
              {!view.archived && (
                <Link href={openPlanningViewPath(projectId, view.id)} className={secondaryLink}>
                  {labels.openView}
                </Link>
              )}
              <PlanningViewFavorite actorId={actorId} projectId={projectId} view={view} />
              <PlanningViewQuickActions actorId={actorId} projectId={projectId} view={view} />
            </div>
          </>
        )}
      </SplitIndex>
    </PlanningFrame>
  );
}

export async function planningViewPage(rawProjectId: string, rawViewId: string) {
  const { actorId } = await requireInternalProjects();
  const projectId = checkedId(rawProjectId);
  const viewId = checkedId(rawViewId);
  const [result, index, preferences] = await Promise.all([
    readPlanningSavedView(projectId, viewId),
    readPlanningViews(projectId),
    getLocalePreferences(),
  ]);
  if (!result.ok || !index.ok) notFound();
  const view = result.value;
  const labels = planningLabels[preferences.locale];
  const advanced = planningAdvancedLabels[preferences.locale];
  const context =
    view.canEdit && !view.archived && !view.locked ? await readEditorContext(projectId) : null;
  return (
    <PlanningFrame
      project={index.value.project}
      section="views"
      labels={labels}
      canManageSettings={index.value.canManageSettings}
      intakeEnabled={index.value.intakeEnabled}
      entry={view}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{labels[view.layout]}</Badge>
        <Badge variant="secondary">{labels[view.archived ? "archived" : view.visibility]}</Badge>
        {view.locked && <Badge variant="outline">{advanced.locked}</Badge>}
        {!view.archived && (
          <Link href={openPlanningViewPath(projectId, view.id)} className={secondaryLink}>
            {labels.openView}
          </Link>
        )}
        <PlanningViewFavorite actorId={actorId} projectId={projectId} view={view} />
        <PlanningViewLock actorId={actorId} projectId={projectId} view={view} />
        <PlanningViewQuickActions actorId={actorId} projectId={projectId} view={view} detail />
        {view.canArchive && (
          <PlanningArchiveToggle actorId={actorId} projectId={projectId} entry={view} />
        )}
      </div>
      {view.description && (
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{view.description}</p>
      )}
      {context && (
        <EditorPanel title={labels.edit}>
          <PlanningViewEditor key={view.revision} actorId={actorId} view={view} {...context} />
        </EditorPanel>
      )}
    </PlanningFrame>
  );
}
