"use client";

import { Columns3, List, Plus, Users } from "lucide-react";
import { useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useDirection } from "@/components/ui/direction";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type ProjectCommands,
  type ProjectItem,
  type ProjectMemberGrant,
  type ProjectWorkspace,
  projectItemTitleMaxLength,
} from "../contracts";
import { ProjectMembers } from "./ProjectMembers";
import { ProjectTitleDialog, ProjectWriteNotice } from "./ProjectTitleDialog";
import {
  type ProjectItemChanges,
  ProjectWorkItemBoard,
  ProjectWorkItemList,
} from "./ProjectWorkItems";
import { projectsTranslator } from "./projectMessages";
import { useProjectWrites } from "./projectWrites";

export function InternalProjectWorkspace({
  initial,
  commands,
  locale,
}: {
  initial: ProjectWorkspace;
  commands: ProjectCommands;
  locale: Locale;
}) {
  const { numberingSystem } = useLocalePreferences();
  const direction = useDirection();
  const labels = projectsTranslator(locale, numberingSystem);
  const [workspace, setWorkspace] = useState(initial);
  const { execute, error, pending } = useProjectWrites();
  const projectId = workspace.project.id;

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

  const workItemsProps = { workspace, labels, pending, updateItem };
  return (
    <section className={`${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading
        title={workspace.project.title}
        crumbs={[
          { label: labels("index.title"), href: "/projects/internal" },
          { label: workspace.project.title },
        ]}
        actions={
          workspace.canEdit && (
            <ProjectTitleDialog
              labels={labels}
              title={labels("workspace.create")}
              description={labels("workspace.newDescription")}
              field={labels("workspace.itemTitle")}
              maxLength={projectItemTitleMaxLength}
              pending={pending}
              trigger={
                <Button disabled={pending}>
                  <Plus aria-hidden="true" className="size-4" />
                  {labels("workspace.create")}
                </Button>
              }
              submit={(title, getRequestId) =>
                execute(
                  () =>
                    commands.createItem({ projectId, id: getRequestId(), title, status: "todo" }),
                  setWorkspace,
                  false,
                )
              }
            />
          )
        }
      />
      <ProjectWriteNotice error={error} labels={labels} />
      <Tabs defaultValue="list" dir={direction} className="gap-2">
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
        <TabsContent value="list">
          <ProjectWorkItemList {...workItemsProps} />
        </TabsContent>
        <TabsContent value="board">
          <ProjectWorkItemBoard {...workItemsProps} />
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
    </section>
  );
}
