/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from apps/web/components/cycles/transfer-issues-modal.tsx in Plane Community
 * v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { ProjectFailure } from "../contracts";
import { ProjectWriteNotice } from "../ui/ProjectTitleDialog";
import { projectsTranslator } from "../ui/projectMessages";
import { planningAdvancedLabels } from "./advancedMessages";
import type { PlanningCyclePhase, PlanningGroup } from "./contracts";
import { planningLabels } from "./messages";

export type RolloverDestination = { id: string; title: string; phase: PlanningCyclePhase };

export function PlanningCycleRollover({
  actorId,
  projectId,
  source,
  targets,
}: {
  actorId: string;
  projectId: string;
  source: PlanningGroup;
  targets: RolloverDestination[];
}) {
  const { locale, numberingSystem } = useLocalePreferences();
  const labels = planningAdvancedLabels[locale];
  const base = planningLabels[locale];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [targetCycleId, setTargetCycleId] = useState("");
  const [error, setError] = useState<ProjectFailure | null>(null);
  const transfer = trpc.internalProjects.planning.rolloverCycle.useMutation();
  const query = search.trim().toLocaleLowerCase(locale);
  const options = targets.filter(({ title }) => title.toLocaleLowerCase(locale).includes(query));
  const count = new Intl.NumberFormat(locale, { numberingSystem }).format(
    source.itemCount - source.closedCount,
  );

  async function submit() {
    setError(null);
    try {
      const result = await transfer.mutateAsync({
        projectId,
        sourceCycleId: source.id,
        targetCycleId,
        expectedActorId: actorId,
        csrfToken: readCsrfToken(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("project_unavailable");
    }
  }

  function changeOpen(next: boolean) {
    if (transfer.isPending) return;
    setOpen(next);
    if (next) {
      setSearch("");
      setTargetCycleId("");
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowRightLeft aria-hidden className="size-4" />
          {labels.transfer}
        </Button>
      </DialogTrigger>
      <DialogContent className={`${BLOCK_CLASS} ph-no-capture`}>
        <DialogHeader>
          <DialogTitle>{labels.transfer}</DialogTitle>
          <DialogDescription>{labels.transferDescription}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">
          {labels.available} {count}
        </p>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.noDestination}</p>
        ) : (
          <>
            <Input
              type="search"
              aria-label={labels.searchCycles}
              placeholder={labels.searchCycles}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <fieldset className="grid max-h-60 min-w-0 gap-1 overflow-y-auto">
              <legend className="sr-only">{labels.destination}</legend>
              {options.map((option) => (
                <Button
                  type="button"
                  key={option.id}
                  variant={targetCycleId === option.id ? "outline" : "ghost"}
                  className="h-auto min-h-9 justify-between whitespace-normal text-start"
                  aria-pressed={targetCycleId === option.id}
                  onClick={() => setTargetCycleId(option.id)}
                >
                  <bdi className="min-w-0 [overflow-wrap:anywhere]">{option.title}</bdi>
                  <Badge variant="outline">{base[option.phase]}</Badge>
                </Button>
              ))}
              {options.length === 0 && (
                <p className="text-sm text-muted-foreground">{labels.noCycleMatch}</p>
              )}
            </fieldset>
          </>
        )}
        <ProjectWriteNotice error={error} labels={projectsTranslator(locale, numberingSystem)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)} disabled={transfer.isPending}>
            {base.cancel}
          </Button>
          <Button
            disabled={!options.some(({ id }) => id === targetCycleId) || transfer.isPending}
            onClick={() => void submit()}
          >
            {labels.transfer}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
