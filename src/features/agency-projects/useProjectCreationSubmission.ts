import { useEffect, useRef, useState } from "react";
import { type ProjectCreateInput, projectCreateInputSchema } from "./projectCreationInput";
import type {
  ProjectCreationAttempt,
  ProjectCreationFormProps,
  ProjectCreationOutcome,
} from "./projectCreationUiTypes";

type SubmissionKind =
  | "idle"
  | "invalid"
  | "submitting"
  | "unknown"
  | "rejected"
  | "unavailable"
  | "created";
type SubmissionState = {
  kind: SubmissionKind;
  attempt: ProjectCreationAttempt | null;
  invalidTitle: boolean;
  invalidOwner: boolean;
};
const initialState: SubmissionState = {
  kind: "idle",
  attempt: null,
  invalidTitle: false,
  invalidOwner: false,
};

export function useProjectCreationSubmission(props: ProjectCreationFormProps) {
  const initialAttempt = props.draft.attempt ?? null;
  const [state, setState] = useState<SubmissionState>(() => ({
    ...initialState,
    kind: initialAttempt === null ? "idle" : "unknown",
    attempt: initialAttempt,
  }));
  const alive = useRef(true);
  const active = useRef<AbortController | null>(null);
  const captured = useRef<ProjectCreationAttempt | null>(initialAttempt);
  const completed = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, []);

  function ownerIsAvailable(ownerUserId: string): boolean {
    return props.owners.some((owner) => owner.id.toLowerCase() === ownerUserId);
  }

  function clearAttempt(request: ProjectCreationAttempt): void {
    props.onDraftChange({ ...props.draft, input: { ...request.rawInput }, attempt: null });
  }

  function isLive(controller: AbortController): boolean {
    return alive.current && !controller.signal.aborted;
  }

  function isCurrent(controller: AbortController): boolean {
    return isLive(controller) && active.current === controller;
  }

  async function execute(
    request: ProjectCreationAttempt,
    controller: AbortController,
  ): Promise<void> {
    let outcome: ProjectCreationOutcome;
    try {
      outcome = await props.submit(request.payload, controller.signal);
    } catch {
      outcome = { ok: false, error: "unknown" };
    }
    if (!isCurrent(controller)) return;
    active.current = null;
    if (outcome.ok) {
      completed.current = true;
      captured.current = null;
      setState({ ...initialState, kind: "created", attempt: request });
      clearAttempt(request);
      if (isLive(controller)) props.onCreated(outcome.value.projectId);
    } else if (outcome.error === "unknown") {
      setState({ ...initialState, kind: "unknown", attempt: request });
    } else {
      captured.current = null;
      setState({ ...initialState, kind: outcome.error });
      clearAttempt(request);
    }
  }

  function submit(): void {
    if (active.current !== null || completed.current || !alive.current) return;
    let request = captured.current ?? props.draft.attempt;
    if (request === null) {
      // One ingress parse. Uncertain retries reuse this exact normalized value.
      const parsed = projectCreateInputSchema.safeParse(props.draft.input);
      if (!parsed.success) {
        setState({
          ...initialState,
          kind: "invalid",
          invalidTitle: parsed.error.issues.some((issue) => issue.path[0] === "title"),
          invalidOwner: parsed.error.issues.some((issue) => issue.path[0] === "ownerUserId"),
        });
        return;
      }
      if (!ownerIsAvailable(parsed.data.ownerUserId)) {
        setState({ ...initialState, kind: "invalid", invalidOwner: true });
        return;
      }
      request = Object.freeze({
        payload: Object.freeze({ ...parsed.data }),
        rawInput: Object.freeze({ ...props.draft.input }),
      });
    }
    captured.current = request;
    if (!ownerIsAvailable(request.payload.ownerUserId)) {
      setState({ ...initialState, kind: "unknown", attempt: request });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ ...initialState, kind: "submitting", attempt: request });
    // Retain the attempt in the parent before I/O: abort never proves a write did not commit.
    props.onDraftChange({ ...props.draft, input: { ...request.rawInput }, attempt: request });
    if (!isCurrent(controller)) return;
    void execute(request, controller);
  }

  const parentAttempt = state.attempt ?? props.draft.attempt;
  const visibleState: SubmissionState =
    state.attempt === null && parentAttempt !== null
      ? { ...state, kind: "unknown", attempt: parentAttempt }
      : state;
  const locked = ["submitting", "unknown", "created"].includes(visibleState.kind);
  const retryUnavailable =
    visibleState.kind === "unknown" &&
    visibleState.attempt !== null &&
    !ownerIsAvailable(visibleState.attempt.payload.ownerUserId);
  function edit(input: Partial<Pick<ProjectCreateInput, "title" | "ownerUserId">>): void {
    if (locked) return;
    setState(initialState);
    props.onDraftChange({ ...props.draft, input: { ...props.draft.input, ...input } });
  }

  return {
    state: visibleState,
    locked,
    retryUnavailable,
    draft: { ...props.draft, input: visibleState.attempt?.rawInput ?? props.draft.input },
    submit,
    edit,
  };
}
