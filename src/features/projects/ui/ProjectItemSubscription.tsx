"use client";

import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { ProjectWriteNotice } from "./ProjectTitleDialog";
import type { ProjectsTranslator } from "./projectMessages";

export function ProjectItemSubscription({
  projectId,
  itemId,
  labels,
}: {
  projectId: string;
  itemId: string;
  labels: ProjectsTranslator;
}) {
  const utils = trpc.useUtils();
  const key = { projectId, itemId };
  const status = trpc.internalProjects.profile.subscriptionStatus.useQuery(key);
  const toggle = trpc.internalProjects.profile.setSubscription.useMutation({
    onSuccess(result) {
      if (result.ok) utils.internalProjects.profile.subscriptionStatus.setData(key, result);
    },
  });
  const subscribed = status.data?.ok === true && status.data.value.subscribed;
  const Icon = subscribed ? BellOff : Bell;
  const problem =
    toggle.data?.ok === false
      ? toggle.data.error
      : toggle.isError || status.isError || status.data?.ok === false
        ? "project_unavailable"
        : null;

  return (
    <div className="shrink-0">
      <Button
        variant="outline"
        size="sm"
        disabled={status.data?.ok !== true || toggle.isPending}
        onClick={() =>
          toggle.mutate({ ...key, subscribed: !subscribed, csrfToken: readCsrfToken() })
        }
      >
        <Icon aria-hidden="true" className="size-4" />
        {labels(subscribed ? "workspace.unsubscribe" : "workspace.subscribe")}
      </Button>
      <ProjectWriteNotice error={problem} labels={labels} />
    </div>
  );
}
