"use client";

import { useRef, useState } from "react";
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
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { type RouterOutputs, trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { runWorkflowAction } from "../actions";
import { LiveRunReview, type LiveRunReviewContext } from "./LiveRunReview";
import { projectLiveRunEffects } from "./liveRunEffectSummary";

type Mode = "simulation" | "live";
type DealOption = { value: string; label: string };
type Workflow = RouterOutputs["workflows"]["get"];
type Version = RouterOutputs["workflows"]["version"];
type ReadFlags = { isFetching: boolean; isError: boolean; isPlaceholderData: boolean };
interface LivePublication {
  readonly versionId: string;
  readonly review: LiveRunReviewContext;
}
interface RunCommand {
  readonly workflowId: string;
  readonly requestKey: string;
  readonly recordId: string;
  readonly mode: Mode;
  readonly reviewedVersionId?: string;
}
interface Submission {
  readonly command: RunCommand;
  readonly review: LiveRunReviewContext | null;
}

function freshRead(read: ReadFlags): boolean {
  return !read.isFetching && !read.isError && !read.isPlaceholderData;
}

function currentPublication(
  workflowId: string,
  chosen: DealOption | null,
  workflow: Workflow | undefined,
  version: Version | undefined,
  fresh: boolean,
): LivePublication | null {
  if (!fresh || chosen === null || workflow === undefined || version === undefined) return null;
  if (
    workflow.id !== workflowId ||
    !workflow.active ||
    workflow.archivedAt !== null ||
    !workflow.capabilities.run ||
    workflow.publishedNumber !== version.number
  )
    return null;
  const effects = projectLiveRunEffects(version.definition);
  if (effects === null) return null;
  return {
    versionId: version.id,
    review: {
      publicationName: version.name,
      publicationNumber: version.number,
      recordLabel: chosen.label,
      effects,
    },
  };
}

function useLivePublication(workflowId: string, chosen: DealOption | null, enabled: boolean) {
  const workflow = trpc.workflows.get.useQuery(
    { id: workflowId },
    { enabled, staleTime: 0, refetchOnMount: "always", placeholderData: undefined },
  );
  const number = workflow.data?.publishedNumber;
  const version = trpc.workflows.version.useQuery(
    { id: workflowId, versionNumber: number ?? 1 },
    {
      enabled: enabled && typeof number === "number",
      staleTime: 0,
      refetchOnMount: "always",
      placeholderData: undefined,
    },
  );
  const targetKey = JSON.stringify([workflowId, number ?? null]);
  const [target, setTarget] = useState({ key: targetKey, generation: 0 });
  const currentTarget =
    target.key === targetKey ? target : { key: targetKey, generation: target.generation + 1 };
  if (currentTarget !== target) setTarget(currentTarget);
  const [reloadTarget, setReloadTarget] = useState<typeof target | null>(null);
  const reloading = reloadTarget === currentTarget;
  const loading = workflow.isFetching || version.isFetching;
  const publication = currentPublication(
    workflowId,
    chosen,
    workflow.data,
    version.data,
    enabled && freshRead(workflow) && freshRead(version),
  );
  async function reload() {
    if (loading || reloading) return;
    const requestedTarget = currentTarget;
    setReloadTarget(requestedTarget);
    try {
      await workflow.refetch({ cancelRefetch: false, throwOnError: false });
      await version.refetch({ cancelRefetch: false, throwOnError: false });
    } catch {
      return;
    } finally {
      setReloadTarget((current) => (current === requestedTarget ? null : current));
    }
  }
  return { publication, loading, reloading, reload };
}

function useLiveAcknowledgement(cut: string | null) {
  const [review, setReview] = useState({ cut, acknowledged: false, changed: false });
  const current = review.cut === cut;
  // Reset in the same fiber, so even a cut that changes back cannot revive an old acknowledgement.
  if (!current)
    setReview({ cut, acknowledged: false, changed: review.changed || review.acknowledged });
  return {
    acknowledged: current && review.acknowledged,
    changed: review.changed || (!current && review.acknowledged),
    acknowledge(checked: boolean) {
      if (cut !== null) setReview({ cut, acknowledged: checked, changed: false });
    },
  };
}

function prepareSubmission(
  workflowId: string,
  requestKey: string,
  mode: Mode,
  chosen: DealOption | null,
  publication: LivePublication | null,
  acknowledged: boolean,
): Submission | null {
  if (chosen === null) return null;
  const command = { workflowId, requestKey, recordId: chosen.value, mode };
  if (mode === "simulation") return { command: Object.freeze(command), review: null };
  if (publication === null || !acknowledged) return null;
  return {
    command: Object.freeze({ ...command, reviewedVersionId: publication.versionId }),
    review: publication.review,
  };
}

function LiveReviewReadState({
  chosen,
  loading,
  reloading,
  reload,
}: {
  chosen: boolean;
  loading: boolean;
  reloading: boolean;
  reload: () => Promise<void>;
}) {
  const t = useAppTranslations("workflows");
  if (!chosen)
    return <p className="text-sm text-muted-foreground">{t("liveReviewChooseRecord")}</p>;
  if (loading) return <p role="status">{t("loading")}</p>;
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">
        {t("liveReviewUnavailable")}
      </p>
      <Button variant="outline" disabled={reloading} onClick={() => void reload()}>
        {t("liveReviewReload")}
      </Button>
    </div>
  );
}

function RunReviewContent({
  mode,
  review,
  chosen,
  loading,
  reloading,
  reload,
  acknowledged,
  changed,
  locked,
  frozen,
  onAcknowledgedChange,
}: {
  mode: Mode;
  review: LiveRunReviewContext | null;
  chosen: boolean;
  loading: boolean;
  reloading: boolean;
  reload: () => Promise<void>;
  acknowledged: boolean;
  changed: boolean;
  locked: boolean;
  frozen: boolean;
  onAcknowledgedChange: (checked: boolean) => void;
}) {
  if (mode !== "live") return null;
  if (review === null)
    return (
      <LiveReviewReadState
        chosen={chosen}
        loading={loading}
        reloading={reloading}
        reload={reload}
      />
    );
  return (
    <LiveRunReview
      review={review}
      acknowledged={acknowledged}
      changed={changed}
      disabled={locked}
      frozen={frozen}
      onAcknowledgedChange={onAcknowledgedChange}
    />
  );
}

function submissionLabel(
  error: boolean,
  mode: Mode,
): "retry" | "confirmSimulation" | "confirmLive" {
  if (error) return "retry";
  return mode === "simulation" ? "confirmSimulation" : "confirmLive";
}

export function RunDialog({
  workflowId,
  mode,
  onClose,
  onStarted,
  onCloseAutoFocus,
}: {
  workflowId: string;
  mode: Mode;
  onClose: () => void;
  onStarted: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useAppTranslations("workflows");
  const [chosen, setChosen] = useState<DealOption | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [finished, setFinished] = useState(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const submitted = useRef<Submission | null>(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const displayMode = submission?.command.mode ?? mode;
  const displayWorkflowId = submission?.command.workflowId ?? workflowId;
  const read = useLivePublication(
    displayWorkflowId,
    chosen,
    displayMode === "live" && submission === null,
  );
  const cut =
    read.publication === null
      ? null
      : JSON.stringify([
          workflowId,
          mode,
          chosen?.value,
          read.publication.versionId,
          read.publication.review,
        ]);
  const acknowledgement = useLiveAcknowledgement(cut);
  const nextSubmission = prepareSubmission(
    workflowId,
    key,
    mode,
    chosen,
    read.publication,
    acknowledgement.acknowledged,
  );
  const canSubmit = submission !== null || nextSubmission !== null;
  const displayedReview =
    submission === null ? (read.publication?.review ?? null) : submission.review;
  async function run() {
    if (inFlight.current || completed.current) return;
    const command = submitted.current ?? nextSubmission;
    if (command === null) return;
    submitted.current = command;
    setSubmission(command);
    inFlight.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await runWorkflowAction(command.command, readCsrfToken());
      if (!result.ok) {
        setError(true);
        return;
      }
      completed.current = true;
      setFinished(true);
      onStarted();
    } catch {
      if (!completed.current) setError(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t("runTitle")}</DialogTitle>
          <DialogDescription>
            {t(displayMode === "simulation" ? "simulationHint" : "liveHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("publishedHint")}
          </p>
          <RunDealPicker
            chosen={chosen}
            onChoose={setChosen}
            locked={pending || submission !== null}
          />
          <RunReviewContent
            mode={displayMode}
            review={displayedReview}
            chosen={chosen !== null}
            loading={read.loading}
            reloading={read.reloading}
            reload={read.reload}
            acknowledged={submission !== null || acknowledgement.acknowledged}
            changed={acknowledgement.changed}
            locked={pending || submission !== null}
            frozen={submission !== null}
            onAcknowledgedChange={acknowledgement.acknowledge}
          />
          {submission !== null && (
            <p className="text-sm text-muted-foreground">{t("testSubmissionFrozen")}</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("testSubmissionError")}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || finished || !canSubmit} onClick={() => void run()}>
              {t(submissionLabel(error, displayMode))}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunDealPicker({
  chosen,
  onChoose,
  locked,
}: {
  chosen: DealOption | null;
  onChoose: (option: DealOption | null) => void;
  locked: boolean;
}) {
  const t = useAppTranslations("workflows");
  const [query, setQuery] = useState("");
  const search = trpc.search.query.useQuery(
    { q: query.trim().slice(0, 200) },
    { enabled: !locked && query.trim().length > 1 },
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
        value={query}
        maxLength={200}
        disabled={locked}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        value={chosen?.value ?? ""}
        ariaLabel={t("deal")}
        placeholder={t("deal")}
        options={options}
        disabled={locked || options.length === 0}
        onChange={(value) => onChoose(options.find((option) => option.value === value) ?? null)}
      />
      {query.trim().length < 2 && (
        <p className="text-sm text-muted-foreground">{t("searchHint")}</p>
      )}
      {search.isFetching && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("searchLoading")}
        </p>
      )}
      {query.trim().length > 1 && options.length === 0 && !search.isFetching && !search.isError && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("noResults")}
        </p>
      )}
      {search.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("loadError")}
        </p>
      )}
    </>
  );
}
