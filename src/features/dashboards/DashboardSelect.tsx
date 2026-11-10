"use client";

import {
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Kanban,
  LayoutDashboard,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CreatePipelineDialog } from "@/features/pipelines/CreatePipelineDialog";
import { cn } from "@/lib/utils";
import {
  type DashboardSelection,
  dashboardViewHref,
  isCurrentDashboard,
  type PipelineDashboardView,
} from "./dashboardViews";

export interface DashboardSelectProps {
  current: DashboardSelection | null;
  // Callers supply the existing permission-filtered pipeline list. The selector never widens it.
  pipelines: readonly { id: string; name: string }[];
  pipelineView?: PipelineDashboardView;
  canManagePipelines?: boolean;
}

export function DashboardSelect({
  current,
  pipelines,
  pipelineView = "board",
  canManagePipelines = false,
}: DashboardSelectProps): ReactNode {
  const t = useAppTranslations("shell.dashboardViews");
  const [createOpen, setCreateOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name =
    current?.kind === "performance"
      ? t("performance")
      : (pipelines.find(
          (pipeline) => current?.kind === "pipeline" && pipeline.id === current.pipelineId,
        )?.name ?? t("dashboard"));
  const performance: DashboardSelection = { kind: "performance" };
  const performanceCurrent = isCurrentDashboard(current, performance);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={t("selectCurrent", { name })}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LayoutDashboard aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <bdi dir="auto" className="max-w-48 truncate">
            {name}
          </bdi>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={t("select")}
          aria-labelledby={undefined}
          className="min-w-56 overflow-y-auto"
        >
          {pipelines.length > 0 && (
            <>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {t("pipelines")}
              </DropdownMenuLabel>
              {pipelines.map((pipeline) => {
                const selection: DashboardSelection = { kind: "pipeline", pipelineId: pipeline.id };
                const selected = isCurrentDashboard(current, selection);
                return (
                  <DropdownMenuItem
                    asChild
                    key={pipeline.id}
                    className={cn(selected && "bg-accent font-medium")}
                  >
                    <Link
                      href={dashboardViewHref(selection, pipelineView)}
                      prefetch={false}
                      aria-current={selected ? "page" : undefined}
                    >
                      <Kanban
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                      />
                      <bdi dir="auto" className="max-w-56 flex-1 truncate">
                        {pipeline.name}
                      </bdi>
                      {selected && (
                        <Check aria-hidden="true" className="ms-auto h-4 w-4 shrink-0" />
                      )}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem asChild className={cn(performanceCurrent && "bg-accent font-medium")}>
            <Link
              href={dashboardViewHref(performance)}
              prefetch={false}
              aria-current={performanceCurrent ? "page" : undefined}
            >
              <ChartNoAxesCombined
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground"
              />
              <span className="flex-1">{t("performance")}</span>
              {performanceCurrent && (
                <Check aria-hidden="true" className="ms-auto h-4 w-4 shrink-0" />
              )}
            </Link>
          </DropdownMenuItem>
          {canManagePipelines && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t("addPipeline")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canManagePipelines && (
        <CreatePipelineDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated="board"
          returnFocusTo={triggerRef}
        />
      )}
    </>
  );
}
