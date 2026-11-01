"use client";

import { Check, Circle } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { displayNodeName } from "../nodeNames";
import { NodeSummary } from "./NodeSummary";
import type { RevealNode } from "./ResponsiveViewport";
import { WorkflowCanvas } from "./WorkflowCanvas";

export type RunDetail = RouterOutputs["workflows"]["run"];
export function RunTrace({ detail }: { detail: RunDetail }) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const [selected, setSelected] = useState(detail.definition.nodes[0]?.id ?? "start");
  const [reveal, setReveal] = useState<RevealNode>();
  const completed = new Set(detail.steps.map((step) => step.nodeId));
  const node = detail.definition.nodes.find((item) => item.id === selected);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 px-5">
        <Badge
          variant={
            detail.status === "succeeded"
              ? "success"
              : detail.status === "failed"
                ? "destructive"
                : "secondary"
          }
        >
          {t(`status.${detail.status}`)}
        </Badge>
        <span className="text-sm">{t("version", { number: detail.number })}</span>
        <span className="text-xs text-muted-foreground">
          {t(detail.mode === "simulation" ? "simulationMode" : "liveMode")}
        </span>
        <time className="text-xs text-muted-foreground" dateTime={detail.createdAt.toISOString()}>
          {fmt.dateTime(detail.createdAt)}
        </time>
      </div>
      <p className="px-5 text-xs leading-5 text-muted-foreground">
        {t(detail.mode === "simulation" ? "simulationTraceHint" : "liveTraceHint")}
      </p>
      {detail.status === "failed" && (
        <p role="alert" className="px-5 text-sm text-destructive">
          {t("runError")} <bdi className="font-mono text-xs">{detail.errorId}</bdi>
        </p>
      )}
      <div className="grid min-h-[500px] overflow-hidden border-t xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <WorkflowCanvas
          definition={detail.definition}
          selected={selected}
          selectedEdge={null}
          onSelect={setSelected}
          onSelectEdge={() => undefined}
          onChange={() => undefined}
          onProblem={() => undefined}
          editable={false}
          invalidNodes={new Set()}
          layoutRevision={0}
          reveal={reveal}
          completedNodes={completed}
        />
        <aside className="space-y-5 border-t p-5 xl:min-h-0 xl:overflow-y-auto xl:border-s xl:border-t-0">
          <div>
            <h3 className="text-sm font-semibold">{t("executedPath")}</h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{t("traceHint")}</p>
          </div>
          <ol className="space-y-2" aria-label={t("steps")}>
            {detail.definition.nodes.map((item, index) => {
              const step = detail.steps.find((entry) => entry.nodeId === item.id);
              const Icon = step === undefined ? Circle : Check;
              return (
                <li key={item.id}>
                  <Button
                    variant={selected === item.id ? "outline" : "ghost"}
                    aria-pressed={selected === item.id}
                    className="h-auto min-h-10 w-full justify-start whitespace-normal py-2 text-start"
                    onClick={() => {
                      setSelected(item.id);
                      setReveal((previous) => ({ id: item.id, nonce: (previous?.nonce ?? 0) + 1 }));
                    }}
                  >
                    <Icon
                      className={
                        step === undefined
                          ? "size-4 shrink-0 text-muted-foreground"
                          : "size-4 shrink-0 text-success"
                      }
                    />
                    <span className="min-w-0">
                      <bdi className="block break-words text-xs">
                        {fmt.number(index + 1)} · {displayNodeName(item, locale)}
                      </bdi>
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                        {step === undefined
                          ? detail.nextNodeId === item.id && detail.status === "failed"
                            ? t("stoppedHere")
                            : t("stepNotReached")
                          : step.simulated
                            ? t("stepSimulated")
                            : t("stepCompleted")}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ol>
          {node !== undefined && (
            <div className="border-t pt-4">
              <h3 dir="auto" className="text-sm font-semibold">
                {displayNodeName(node, locale)}
              </h3>
              <NodeSummary node={node} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
