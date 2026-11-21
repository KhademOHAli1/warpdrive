"use client";

import { Columns3, List, Plus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useDirection } from "@/components/ui/direction";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import type {
  ProjectCommands,
  ProjectItem,
  ProjectMemberGrant,
  ProjectStatus,
  ProjectWorkspace,
} from "../contracts";
import {
  defaultProjectItemFilters,
  filterProjectItems,
  ProjectItemFilters,
} from "./ProjectItemFilters";
import { ProjectMembers } from "./ProjectMembers";
import { ProjectWriteNotice } from "./ProjectTitleDialog";
import { ProjectWorkItemCreate } from "./ProjectWorkItemCreate";
import { ProjectWorkItemPeek } from "./ProjectWorkItemPeek";
import {
  type ProjectItemChanges,
  ProjectWorkItemBoard,
  ProjectWorkItemList,
} from "./ProjectWorkItems";
import { ProjectWorkspaceNav } from "./ProjectWorkspaceNav";
import {
  handleLayoutChange,
  type ProjectWorkspaceLocation,
  resolveProjectView,
} from "./planeWorkItemView";
import { projectsTranslator } from "./projectMessages";
import { useProjectWrites } from "./projectWrites";

export function InternalProjectWorkspace({
  initial,
  initialLocation,
  commands,
  locale,
}: {
  initial: ProjectWorkspace;
  initialLocation?: ProjectWorkspaceLocation;
  commands: ProjectCommands;
  locale: Locale;
}) {
  const { numberingSystem } = useLocalePreferences();
  const direction = useDirection();
  const labels = projectsTranslator(locale, numberingSystem);
  const [workspace, setWorkspace] = useState(initial);
  const [location, setLocation] = useState<ProjectWorkspaceLocation>(
    () => initialLocation ?? { view: "list", itemId: null },
  );
  const [filters, setFilters] = useState(defaultProjectItemFilters);
  const itemTrigger = useRef<HTMLElement | null>(null);
  const { execute, error, pending } = useProjectWrites();
  const projectId = workspace.project.id;

  useEffect(() => {
    if (initialLocation === undefined) return;
    function syncLocation() {
      const query = new URLSearchParams(window.location.search);
      setLocation({ view: resolveProjectView(query.get("view")), itemId: query.get("item") });
    }
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, [initialLocation]);

  function moveLocation(next: ProjectWorkspaceLocation) {
    setLocation(next);
    if (initialLocation === undefined) return;
    const url = new URL(window.location.href);
    if (next.view === "list") url.searchParams.delete("view");
    else url.searchParams.set("view", next.view);
    if (next.itemId === null) url.searchParams.delete("item");
    else url.searchParams.set("item", next.itemId);
    window.history.replaceState(null, "", url);
  }

  function updateItem(item: ProjectItem, changes: ProjectItemChanges, report = true) {
    return execute(
      () =>
        commands.updateItem({ projectId, itemId: item.id, revision: item.revision, ...changes }),
      setWorkspace,
      report,
    );
  }

  function setMember(userId: string, membership: ProjectMemberGrant | null) {
    return execute(() => commands.setMember({ projectId, userId, membership }), setWorkspace);
  }

  function createItem(status: ProjectStatus, forColumn = false) {
    if (!workspace.canEdit) return null;
    return (
      <ProjectWorkItemCreate
        workspace={workspace}
        status={status}
        labels={labels}
        pending={pending}
        trigger={
          <Button
            variant={forColumn ? "ghost" : "default"}
            size={forColumn ? "sm" : "md"}
            aria-label={
              forColumn
                ? `${labels(`status.${status}`)} · ${labels("workspace.create")}`
                : undefined
            }
            disabled={pending}
          >
            <Plus aria-hidden="true" className="size-4" />
            {forColumn ? null : labels("workspace.create")}
          </Button>
        }
        submit={(draft, id) =>
          execute(() => commands.createItem({ projectId, id, ...draft }), setWorkspace, false)
        }
      />
    );
  }

  const items = filterProjectItems(workspace, filters, locale);
  const activeItem = workspace.items.find(({ id }) => id === location.itemId);
  const workItemsProps = {
    workspace: { ...workspace, items },
    labels,
    pending,
    updateItem,
    openItem: (id: string, trigger: HTMLElement) => {
      itemTrigger.current = trigger;
      moveLocation({ ...location, itemId: id });
    },
  };
  const noMatches =
    workspace.items.length > 0 && items.length === 0 ? (
      <p role="status" className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        {labels("workspace.noMatches")}
      </p>
    ) : null;
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={workspace.project.title}
        crumbs={[
          { label: labels("index.title"), href: "/projects/internal" },
          { label: workspace.project.title },
        ]}
        actions={createItem("todo")}
      />
      <ProjectWorkspaceNav projectId={projectId} active="work_items" />
      <ProjectWriteNotice error={error} labels={labels} />
      <Tabs
        value={location.view}
        onValueChange={(value) =>
          handleLayoutChange(value, location.view, (view) => moveLocation({ view, itemId: null }))
        }
        dir={direction}
        className="gap-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList
            aria-label={labels("workspace.views")}
            className="w-fit gap-1 rounded-md border bg-card p-1"
          >
            <TabsTrigger value="list" className={PILL_TAB}>
              <List aria-hidden="true" className="size-4" />
              {labels("workspace.list")}
            </TabsTrigger>
            <TabsTrigger value="board" className={PILL_TAB}>
              <Columns3 aria-hidden="true" className="size-4" />
              {labels("workspace.board")}
            </TabsTrigger>
            <TabsTrigger value="members" className={PILL_TAB}>
              <Users aria-hidden="true" className="size-4" />
              {labels("workspace.members")}
            </TabsTrigger>
          </TabsList>
          {location.view !== "members" && (
            <ProjectItemFilters
              workspace={workspace}
              filters={filters}
              change={setFilters}
              labels={labels}
            />
          )}
        </div>
        <TabsContent value="list">
          {noMatches ?? <ProjectWorkItemList {...workItemsProps} />}
        </TabsContent>
        <TabsContent value="board">
          {noMatches ?? (
            <ProjectWorkItemBoard
              {...workItemsProps}
              createInColumn={(status) => createItem(status, true)}
            />
          )}
        </TabsContent>
        <TabsContent value="members">
          <ProjectMembers
            workspace={workspace}
            labels={labels}
            pending={pending}
            setMember={setMember}
          />
        </TabsContent>
      </Tabs>
      {activeItem !== undefined && (
        <ProjectWorkItemPeek
          item={activeItem}
          workspace={workspace}
          labels={labels}
          pending={pending}
          updateItem={updateItem}
          close={() => moveLocation({ ...location, itemId: null })}
          restoreFocus={() => {
            const trigger = itemTrigger.current;
            if (trigger?.isConnected !== true) return false;
            trigger.focus();
            return true;
          }}
        />
      )}
    </section>
  );
}
