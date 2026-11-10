"use client";

import { Layers3 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Select } from "@/components/ui/Select";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { KpiResults } from "@/features/goals/ui/KpiResults";
import { useKpiWorkspace } from "@/features/goals/ui/useKpiWorkspace";

export function KpiPerformance({
  today,
  canManage,
}: {
  today: string;
  canManage: boolean;
}): ReactNode {
  const S = useKpiHubMessages();
  const [on, setOn] = useState(today);
  const { data, error, loading, reload } = useKpiWorkspace(on);
  const [scheme, setScheme] = useState("all");
  const schemes = Array.from(
    new Set(
      (data?.goals ?? [])
        .map((r) => r.goal.schemeId)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  );
  const activeScheme = scheme === "all" || schemes.includes(scheme) ? scheme : "all";
  const rows = (data?.goals ?? []).filter(
    (r) => activeScheme === "all" || r.goal.schemeId === activeScheme,
  );
  return (
    <section aria-label={S.title} className="space-y-3 border-t bg-card py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Layers3 aria-hidden className="size-4 text-muted-foreground" />
            {S.title}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {S.readScope}
          </p>
        </div>
        {canManage && (
          <Link
            href="/settings/goals"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {S.library}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{S.asOf}</p>
          <DatePicker ariaLabel={S.asOf} value={on} onChange={(v) => setOn(v ?? on)} />
        </div>
        {schemes.length > 0 && (
          <Select
            ariaLabel={S.scorecards}
            value={activeScheme}
            onChange={setScheme}
            options={[
              { value: "all", label: S.scorecards },
              ...schemes.map((id, index) => ({
                value: id,
                label:
                  data?.schemeLabels?.find((s) => s.id === id)?.name ??
                  data?.schemes.find((s) => s.id === id)?.name ??
                  `${S.scorecards} ${index + 1}`,
              })),
            ]}
          />
        )}
      </div>
      {loading ? (
        <p role="status" className="py-5 text-sm text-muted-foreground">
          {S.loading}
        </p>
      ) : error !== null ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="text-sm text-muted-foreground">
            {error === "E_KPI_NOT_READY" ? S.notReady : S.failed}
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            {S.retry}
          </Button>
        </div>
      ) : rows.length > 0 ? (
        <KpiResults rows={rows} />
      ) : (
        <div className="border-y px-3 py-6 text-center">
          <p className="text-sm font-medium">{S.emptyGoals}</p>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
            {S.emptyGoalsBody}
          </p>
        </div>
      )}
    </section>
  );
}
