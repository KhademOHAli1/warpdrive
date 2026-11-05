"use client";

import { Check, Circle, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import { NodeSummary } from "./NodeSummary";
import type { RevealNode } from "./ResponsiveViewport";
import { RunRecovery } from "./RunRecovery";
import { WaitTimestamp } from "./WaitTimestamp";
import { WorkflowCanvas } from "./WorkflowCanvas";

export type RunDetail = RouterOutputs["workflows"]["run"];

function IteratorOccurrences({ steps }: { steps: RunDetail["steps"] }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const summary = steps.find((step) => step.iteratorSummary !== undefined)?.iteratorSummary;
  return (
    <>
      {summary !== undefined && (
        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
          {t("iteratorSummary", {
            processed: fmt.number(summary.processedCount),
            failed: fmt.number(summary.failedCount),
          })}
        </span>
      )}
      {steps.flatMap((step) =>
        step.iterationIndex === undefined
          ? []
          : [
              <span
                className="mt-1 block text-[11px] font-normal text-muted-foreground"
                key={step.iterationIndex}
              >
                {t("iteratorItemNumber", { number: fmt.number(step.iterationIndex + 1) })} ·{" "}
                {t(
                  step.outcome === "failed"
                    ? "status.failed"
                    : step.simulated
                      ? "stepSimulated"
                      : "stepCompleted",
                )}
              </span>,
            ],
      )}
    </>
  );
}
export function RunTrace({ detail, workflowId }: { detail: RunDetail; workflowId?: string }) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const [selected, setSelected] = useState(
    (detail.status === "waiting" || detail.status === "failed") && detail.nextNodeId !== null
      ? detail.nextNodeId
      : (detail.definition.nodes[0]?.id ?? "start"),
  );
  const [reveal, setReveal] = useState<RevealNode>();
  const completed = new Set(
    detail.steps.filter((step) => step.outcome !== "failed").map((step) => step.nodeId),
  );
  const node = detail.definition.nodes.find((item) => item.id === selected);
  const waitingForForm = detail.definition.nodes.some(
    (item) => item.id === detail.nextNodeId && item.type === "human.form",
  );
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
      {detail.status === "waiting" && waitingForForm && (
        <p className="px-5 text-sm text-muted-foreground">
          {t(detail.formExpired === true ? "humanFormExpired" : "humanFormWaiting")}
        </p>
      )}
      {detail.status === "waiting" && !waitingForForm && (
        <p className="px-5 text-sm text-muted-foreground">
          <WaitTimestamp value={detail.resumeAt} label={t("scheduledResume")} />
          <span className="mt-1 block text-xs">{t("waitRecoveryHint")}</span>
        </p>
      )}
      {detail.status === "failed" && (
        <p role="alert" className="px-5 text-sm text-destructive">
          {detail.errorId === ERROR_IDS.WORKFLOW_FORM_EXPIRED ? (
            t("humanFormExpired")
          ) : (
            <>
              {t("runError")} <bdi className="font-mono text-xs">{detail.errorId}</bdi>
            </>
          )}
        </p>
      )}
      {workflowId !== undefined && detail.recovery !== undefined && (
        <div className="px-5">
          <RunRecovery
            workflowId={workflowId}
            runId={detail.id}
            status={detail.status}
            recovery={detail.recovery}
            detailed
            nodeName={(id) => {
              const item = detail.definition.nodes.find((entry) => entry.id === id);
              return item === undefined ? undefined : displayNodeName(item, locale);
            }}
          />
        </div>
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
            {orderedWorkflowNodes(detail.definition).map((item, index) => {
              const occurrences = detail.steps.filter((entry) => entry.nodeId === item.id);
              const step =
                occurrences.find((entry) => entry.outcome !== "failed") ?? occurrences[0];
              const Icon = step === undefined ? Circle : step.outcome === "failed" ? X : Check;
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
                          : step.outcome === "failed"
                            ? "size-4 shrink-0 text-destructive"
                            : "size-4 shrink-0 text-success"
                      }
                    />
                    <span className="min-w-0">
                      <bdi className="block break-words text-xs">
                        {fmt.number(index + 1)} · {displayNodeName(item, locale)}
                      </bdi>
                      <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                        {step === undefined
                          ? detail.nextNodeId === item.id && detail.status === "waiting"
                            ? t("stepWaiting")
                            : detail.nextNodeId === item.id && detail.status === "failed"
                              ? t("stoppedHere")
                              : t("stepNotReached")
                          : step.outcome === "failed"
                            ? t("status.failed")
                            : step.simulated
                              ? t("stepSimulated")
                              : t("stepCompleted")}
                      </span>
                      <IteratorOccurrences steps={occurrences} />
                      {item.type === "record.delete" && step?.recordDeleted === true && (
                        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                          {t(step.simulated ? "recordWouldBeDeleted" : "recordWasDeleted")}
                        </span>
                      )}
                      {item.type === "delay" && step?.simulated === true && (
                        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                          {t("simulatedWait")}
                        </span>
                      )}
                      {item.type === "delay" && step?.waitResumeAt !== undefined && (
                        <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                          <WaitTimestamp
                            value={step.waitResumeAt}
                            label={t(step.simulated ? "simulatedResume" : "scheduledResume")}
                          />
                        </span>
                      )}
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
              <NodeSummary node={node} definition={detail.definition} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
