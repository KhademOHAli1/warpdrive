"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { simulateWorkflowDraftAction } from "../actions";
import {
  type DraftSimulationErrorId,
  type DraftSimulationNodeType,
  type DraftSimulationReceipt,
  type DraftSimulationStep,
  draftSimulationNodeTypes,
} from "../draftSimulationReceipt";
import { portsFor } from "../graphPorts";
import { displayNodeName, nodeLabelKeys } from "../nodeNames";
import { type WorkflowDefinition, type WorkflowNode, workflowPortSchema } from "../schemas";
import { useConditionPortLabel } from "./conditionPortLabel";

export interface DraftTestSnapshot {
  readonly cutKey: string;
  readonly workflowId: string;
  readonly name: string;
  readonly definition: WorkflowDefinition;
}
type DealOption = { value: string; label: string };
interface DraftTestResult {
  readonly receipt: DraftSimulationReceipt;
  readonly recordLabel: string;
}

export function captureDraftTestSnapshot(
  workflowId: string,
  name: string,
  definition: WorkflowDefinition,
): DraftTestSnapshot {
  return Object.freeze({
    cutKey: crypto.randomUUID(),
    workflowId,
    name,
    definition: structuredClone(definition),
  });
}

const receiptKeys = [
  "source",
  "mode",
  "workflowId",
  "definitionDigest",
  "testedAt",
  "outcome",
  "steps",
];
const stepKeys = ["nodeId", "nodeType", "status", "errorId", "port", "waitResumeAt"];
const requiredStepKeys = ["nodeId", "nodeType", "status"];
const knownErrorIds = Object.values(ERROR_IDS);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length <= allowed.length && keys.every((key) => allowed.includes(key));
}
function isoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}
function draftNodeType(value: unknown): value is DraftSimulationNodeType {
  return draftSimulationNodeTypes.some((type) => type === value);
}
function knownErrorId(value: unknown): value is DraftSimulationErrorId {
  return knownErrorIds.some((id) => id === value);
}
function attachStepError(step: DraftSimulationStep, value: Record<string, unknown>): boolean {
  if (!Object.hasOwn(value, "errorId") || value.errorId === undefined) return true;
  if (step.status !== "failed" || !knownErrorId(value.errorId)) return false;
  step.errorId = value.errorId;
  return true;
}
function attachStepPort(
  step: DraftSimulationStep,
  value: Record<string, unknown>,
  node: WorkflowNode,
): boolean {
  if (!Object.hasOwn(value, "port") || value.port === undefined) return true;
  const port = workflowPortSchema.safeParse(value.port);
  if (!port.success) return false;
  if (
    (step.status === "succeeded" || node.type === "ifElse" || port.data.startsWith("branch:")) &&
    !portsFor(node).includes(port.data)
  )
    return false;
  step.port = port.data;
  return true;
}
function attachStepWait(step: DraftSimulationStep, value: Record<string, unknown>): boolean {
  if (!Object.hasOwn(value, "waitResumeAt") || value.waitResumeAt === undefined) return true;
  if (step.nodeType !== "delay" || !isoInstant(value.waitResumeAt)) return false;
  step.waitResumeAt = value.waitResumeAt;
  return true;
}
function readStep(
  value: unknown,
  nodes: ReadonlyMap<string, WorkflowNode>,
): DraftSimulationStep | null {
  if (!plainRecord(value) || !onlyKeys(value, stepKeys)) return null;
  if (!requiredStepKeys.every((key) => Object.hasOwn(value, key))) return null;
  const { nodeId, nodeType, status } = value;
  if (
    typeof nodeId !== "string" ||
    nodeId.length === 0 ||
    nodeId.length > 64 ||
    !draftNodeType(nodeType)
  )
    return null;
  if (status !== "succeeded" && status !== "failed") return null;
  const node = nodes.get(nodeId);
  if (node?.type !== nodeType) return null;
  const step: DraftSimulationStep = { nodeId, nodeType, status };
  return attachStepError(step, value) &&
    attachStepPort(step, value, node) &&
    attachStepWait(step, value)
    ? step
    : null;
}
function submittedNodes(snapshot: DraftTestSnapshot): Map<string, WorkflowNode> | null {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of snapshot.definition.nodes) {
    if (!draftNodeType(node.type) || nodes.has(node.id)) return null;
    nodes.set(node.id, node);
  }
  return nodes;
}
function readSteps(
  value: readonly unknown[],
  snapshot: DraftTestSnapshot,
): DraftSimulationStep[] | null {
  const nodes = submittedNodes(snapshot);
  if (nodes === null || value.length > 100) return null;
  const steps: DraftSimulationStep[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const step = readStep(raw, nodes);
    if (step === null || seen.has(step.nodeId)) return null;
    seen.add(step.nodeId);
    steps.push(step);
  }
  return steps;
}
function stepsMatchOutcome(
  steps: readonly DraftSimulationStep[],
  outcome: "completed" | "failed",
): boolean {
  if (steps.length === 0) return false;
  const failed = steps.findIndex((step) => step.status === "failed");
  return outcome === "completed" ? failed === -1 : failed === steps.length - 1;
}
function receiptRecord(value: unknown, snapshot: DraftTestSnapshot): DraftSimulationReceipt | null {
  if (!plainRecord(value) || !onlyKeys(value, receiptKeys)) return null;
  if (!receiptKeys.every((key) => Object.hasOwn(value, key))) return null;
  if (
    value.source !== "draft" ||
    value.mode !== "simulation" ||
    value.workflowId !== snapshot.workflowId
  )
    return null;
  const { definitionDigest, testedAt, outcome, steps: rawSteps } = value;
  if (typeof definitionDigest !== "string" || !/^[a-f0-9]{64}$/i.test(definitionDigest))
    return null;
  if (!isoInstant(testedAt) || (outcome !== "completed" && outcome !== "failed")) return null;
  if (!Array.isArray(rawSteps)) return null;
  const steps = readSteps(rawSteps, snapshot);
  if (steps === null) return null;
  if (!stepsMatchOutcome(steps, outcome)) return null;
  return {
    source: "draft",
    mode: "simulation",
    workflowId: snapshot.workflowId,
    definitionDigest,
    testedAt,
    outcome,
    steps,
  };
}
function readReceipt(value: unknown, snapshot: DraftTestSnapshot): DraftSimulationReceipt | null {
  try {
    return receiptRecord(value, snapshot);
  } catch {
    return null;
  }
}

function DraftTestResults({
  snapshot,
  result,
}: {
  snapshot: DraftTestSnapshot;
  result: DraftTestResult;
}) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  return (
    <section
      aria-label={t("draftSimulationResults")}
      className="min-w-0 space-y-3 rounded-md border p-3 text-sm"
    >
      <h3 className="font-medium">{t("draftSimulationResults")}</h3>
      <p role="status">
        {t(
          result.receipt.outcome === "completed"
            ? "draftSimulationCompleted"
            : "draftSimulationFailed",
        )}
      </p>
      <p dir="auto" className="break-words [overflow-wrap:anywhere]">
        {snapshot.name}
      </p>
      <p dir="auto" className="break-words [overflow-wrap:anywhere]">
        {t("draftSimulationRecord", { name: result.recordLabel })}
      </p>
      <p className="text-muted-foreground">
        {t("draftSimulationTestedAt", { date: fmt.dateTime(new Date(result.receipt.testedAt)) })}
      </p>
      <ol className="space-y-3">
        {result.receipt.steps.map((step, index) => {
          const node = snapshot.definition.nodes.find((item) => item.id === step.nodeId);
          const name =
            node === undefined ? t(nodeLabelKeys[step.nodeType]) : displayNodeName(node, locale);
          return (
            <li key={step.nodeId} className="min-w-0 space-y-1 rounded-md bg-muted/40 p-3">
              <p dir="auto" className="break-words font-medium [overflow-wrap:anywhere]">
                {t("draftSimulationStep", { number: fmt.number(index + 1), name })}
              </p>
              <p>{t(step.status === "succeeded" ? "status.succeeded" : "status.failed")}</p>
              {step.status === "failed" && <p>{t("draftSimulationStepFailed")}</p>}
              <DraftStepDetails step={step} node={node} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
function DraftStepDetails({ step, node }: { step: DraftSimulationStep; node?: WorkflowNode }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const portLabel = useConditionPortLabel();
  const branch =
    step.status === "succeeded" && step.nodeType === "condition" ? step.port : undefined;
  return (
    <>
      {branch === "true" && <p>{t("draftSimulationBranchTrue")}</p>}
      {branch === "false" && <p>{t("draftSimulationBranchFalse")}</p>}
      {step.status === "succeeded" && step.nodeType === "ifElse" && step.port !== undefined && (
        <p>{t("ifElseSelectedRoute", { route: portLabel(step.port, node) })}</p>
      )}
      {step.status === "succeeded" &&
        step.nodeType === "delay" &&
        step.waitResumeAt !== undefined && (
          <p>{t("draftSimulationResumeAt", { date: fmt.dateTime(new Date(step.waitResumeAt)) })}</p>
        )}
    </>
  );
}

export function DraftTestDialog({
  snapshot,
  onClose,
  onCloseAutoFocus,
}: {
  snapshot: DraftTestSnapshot;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  const [chosen, setChosen] = useState<DealOption | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<DraftTestResult | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, []);
  async function simulate() {
    if (inFlight.current || chosen === null) return;
    inFlight.current = true;
    const target = ++generation.current;
    const record = chosen;
    setPending(true);
    setError(false);
    setResult(null);
    try {
      const response = await simulateWorkflowDraftAction(
        {
          workflowId: snapshot.workflowId,
          definition: structuredClone(snapshot.definition),
          recordId: record.value,
        },
        readCsrfToken(),
      );
      if (!active.current || generation.current !== target) return;
      if (!response.ok) {
        setError(true);
        return;
      }
      const receipt = readReceipt(response.value, snapshot);
      if (receipt === null) {
        setError(true);
        return;
      }
      setResult({ receipt, recordLabel: record.label });
    } catch {
      if (active.current && generation.current === target) setError(true);
    } finally {
      if (active.current && generation.current === target) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("draftSimulation")}</DialogTitle>
          <DialogDescription>{t("draftSimulationHint")}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4 text-sm">
          <p dir="auto" className="break-words font-medium [overflow-wrap:anywhere]">
            {snapshot.name}
          </p>
          <p className="text-muted-foreground">{t("draftSimulationCaptured")}</p>
          <p>{t("draftSimulationRecordInput")}</p>
          <DraftDealPicker chosen={chosen} onChoose={setChosen} pending={pending} />
          <p className="text-muted-foreground">{t("draftSimulationTaskPreviews")}</p>
          <p className="text-muted-foreground">{t("draftSimulationWaits")}</p>
          <p className="text-muted-foreground">{t("draftSimulationAccess")}</p>
          {pending && <p role="status">{t("draftSimulationPending")}</p>}
          {error && (
            <p role="alert" className="text-destructive">
              {t("draftSimulationError")}
            </p>
          )}
          {result !== null && <DraftTestResults snapshot={snapshot} result={result} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={pending || chosen === null} onClick={() => void simulate()}>
            {t("confirmSimulation")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftDealPicker({
  chosen,
  onChoose,
  pending,
}: {
  chosen: DealOption | null;
  onChoose: (option: DealOption | null) => void;
  pending: boolean;
}) {
  const t = useAppTranslations("workflows");
  const [query, setQuery] = useState("");
  const search = trpc.search.query.useQuery(
    { q: query.trim().slice(0, 200) },
    { enabled: !pending && query.trim().length > 1 },
  );
  const options = (search.data?.deals ?? []).map((deal) => ({
    value: deal.id,
    label: deal.primary,
  }));
  if (chosen !== null && !options.some((option) => option.value === chosen.value))
    options.unshift(chosen);
  return (
    <>
      <Input
        dir="auto"
        aria-label={t("search")}
        placeholder={t("search")}
        maxLength={200}
        value={query}
        disabled={pending}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        value={chosen?.value ?? ""}
        ariaLabel={t("deal")}
        placeholder={t("deal")}
        options={options}
        disabled={pending || options.length === 0}
        onChange={(value) => onChoose(options.find((option) => option.value === value) ?? null)}
      />
      {query.trim().length < 2 && <p className="text-muted-foreground">{t("searchHint")}</p>}
      {search.isFetching && <p role="status">{t("searchLoading")}</p>}
      {query.trim().length > 1 && options.length === 0 && !search.isFetching && !search.isError && (
        <p role="status">{t("noResults")}</p>
      )}
      {search.isError && (
        <p role="alert" className="text-destructive">
          {t("loadError")}
        </p>
      )}
    </>
  );
}
