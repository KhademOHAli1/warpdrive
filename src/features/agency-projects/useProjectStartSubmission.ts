import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectReceipt } from "./persistence/projectRepositoryTypes";
import type { ProjectStartInput } from "./persistence/projectStartInput";
import type { ProjectStartOutcome, ProjectWorkspaceSummaryProps } from "./projectWorkspaceTypes";

type StartKind =
  | "idle"
  | "submitting"
  | "unknown"
  | "rejected"
  | "unavailable"
  | "conflict"
  | "started";
type StartState = {
  kind: StartKind;
  attempt: ProjectStartInput | null;
  refreshing: boolean;
  refreshUnavailable: boolean;
};

function sameCommand(left: ProjectStartInput | null, right: ProjectStartInput): boolean {
  return (
    left !== null &&
    left.projectId === right.projectId &&
    left.intentId === right.intentId &&
    left.expectedRevision === right.expectedRevision
  );
}

function retainedAttempt(
  captured: ProjectStartInput | null,
  parent: ProjectStartInput | null,
  settled: ProjectStartInput | null,
): ProjectStartInput | null {
  if (captured !== null) return captured;
  return parent !== null && sameCommand(settled, parent) ? null : parent;
}

function mayBegin(
  props: ProjectWorkspaceSummaryProps,
  readStale: boolean,
  completed: ProjectStartInput | null,
  conflictingRevision: number | null,
): boolean {
  return (
    props.canStart &&
    !readStale &&
    !sameCommand(completed, props.draft.input) &&
    props.project?.state === "planned" &&
    props.project.revision === props.draft.input.expectedRevision &&
    props.project.revision !== conflictingRevision
  );
}

export function useProjectStartSubmission(props: ProjectWorkspaceSummaryProps) {
  const [state, setState] = useState<StartState>(() => ({
    kind: props.draft.attempt === null ? "idle" : "unknown",
    attempt: props.draft.attempt,
    refreshing: false,
    refreshUnavailable: false,
  }));
  const [receipt, setReceipt] = useState<ProjectReceipt | null>(null);
  // State drives rendering; the matching refs below guard events before React commits updates.
  const [completedCommand, setCompletedCommand] = useState<ProjectStartInput | null>(null);
  const [settledCommand, setSettledCommand] = useState<ProjectStartInput | null>(null);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const latest = useRef(props);
  const alive = useRef(true);
  const active = useRef<AbortController | null>(null);
  const captured = useRef(props.draft.attempt);
  const completed = useRef<ProjectStartInput | null>(null);
  const settled = useRef<ProjectStartInput | null>(null);
  const conflictingRevision = useRef<number | null>(null);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);

  const readStale =
    receipt !== null && props.project !== null && props.project.revision < receipt.revision;

  function isCurrent(controller: AbortController): boolean {
    return alive.current && !controller.signal.aborted && active.current === controller;
  }

  async function execute(request: ProjectStartInput, controller: AbortController): Promise<void> {
    let outcome: ProjectStartOutcome;
    try {
      outcome = await props.start(request, controller.signal);
    } catch {
      outcome = { ok: false, error: "unknown" };
    }
    if (!isCurrent(controller)) return;
    active.current = null;
    if (!outcome.ok && outcome.error === "unknown") {
      setState({ kind: "unknown", attempt: request, refreshing: false, refreshUnavailable: false });
      return;
    }
    captured.current = null;
    settled.current = request;
    setSettledCommand(request);
    const kind = outcome.ok ? "started" : outcome.error;
    if (kind === "conflict") {
      conflictingRevision.current = request.expectedRevision;
      setConflictRevision(request.expectedRevision);
    }
    if (outcome.ok) {
      completed.current = request;
      setCompletedCommand(request);
      setReceipt(outcome.value);
    }
    setState({ kind, attempt: null, refreshing: false, refreshUnavailable: false });
    const current = latest.current;
    if (sameCommand(current.draft.attempt, request)) {
      current.onDraftChange({ ...current.draft, attempt: null });
    }
    if (outcome.ok && alive.current && !controller.signal.aborted) {
      latest.current.onStarted(outcome.value);
    }
  }

  function submit(): void {
    if (!alive.current || active.current !== null) return;
    const retained = retainedAttempt(captured.current, props.draft.attempt, settled.current);
    if (
      retained === null &&
      !mayBegin(props, readStale, completed.current, conflictingRevision.current)
    )
      return;
    const input = retained ?? props.draft.input;
    if (sameCommand(completed.current, input)) return;
    const request = Object.freeze({
      projectId: input.projectId,
      intentId: input.intentId,
      expectedRevision: input.expectedRevision,
    });
    const controller = new AbortController();
    active.current = controller;
    captured.current = request;
    setState({
      kind: "submitting",
      attempt: request,
      refreshing: false,
      refreshUnavailable: false,
    });
    // Cancellation cannot prove noncommit. The parent must retain this identity before I/O.
    props.onDraftChange({ ...props.draft, attempt: request });
    if (!isCurrent(controller)) return;
    void execute(request, controller);
  }

  async function executeRefresh(controller: AbortController): Promise<void> {
    let unavailable = true;
    try {
      const result = await latest.current.refresh(controller.signal);
      unavailable = !result.ok;
    } catch {
      // The last permitted snapshot remains visible; transport diagnostics stay private.
    }
    if (!isCurrent(controller)) return;
    active.current = null;
    setState((current) => ({ ...current, refreshing: false, refreshUnavailable: unavailable }));
  }

  function refresh(): void {
    if (!alive.current || active.current !== null) return;
    const controller = new AbortController();
    active.current = controller;
    setState((current) => ({ ...current, refreshing: true, refreshUnavailable: false }));
    void executeRefresh(controller);
  }

  const attempt = retainedAttempt(state.attempt, props.draft.attempt, settledCommand);
  const settledKind =
    state.kind === "started" && !sameCommand(completedCommand, props.draft.input)
      ? "idle"
      : state.kind;
  const visibleKind = attempt !== null && state.kind !== "submitting" ? "unknown" : settledKind;
  return {
    ...state,
    kind: visibleKind,
    readStale,
    canSubmit:
      attempt !== null
        ? !sameCommand(completedCommand, attempt)
        : mayBegin(props, readStale, completedCommand, conflictRevision),
    submit,
    refresh,
  };
}
