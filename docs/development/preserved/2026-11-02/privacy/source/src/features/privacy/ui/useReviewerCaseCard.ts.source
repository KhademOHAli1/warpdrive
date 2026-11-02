"use client";

import { startTransition, useLayoutEffect, useRef, useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import { readPrivacyReviewerCaseAction } from "../reviewerActions";
import {
  nativeActionError,
  nativeBoundaryError,
  nativeReviewBoundary,
  nativeReviewFresh,
} from "./nativeSubjectReviewCardModel";
import { REQUEST_WAIT_MS, waitForRequest } from "./ownRequestFormModel";
import {
  emptyReviewerCaseCard,
  type ReviewerCaseCardProps,
  type ReviewerCaseCardView,
} from "./ReviewerCaseCardModel";

type Operation = { controller: AbortController; boundary: string };
export function useReviewerCaseCard(props: ReviewerCaseCardProps) {
  const [reviewerId] = useState(props.securityStatus.user.id);
  const boundary = nativeReviewBoundary(props);
  const [view, setView] = useState<ReviewerCaseCardView>(() => emptyReviewerCaseCard(boundary));
  const active = useRef<Operation | null>(null);
  if (view.boundary !== boundary) {
    setView({
      ...emptyReviewerCaseCard(boundary),
      engaged: view.engaged,
      error: view.engaged ? nativeBoundaryError(props, reviewerId) : null,
    });
  }
  useLayoutEffect(
    () => () => {
      if (active.current?.boundary === boundary) {
        active.current.controller.abort();
        active.current = null;
      }
    },
    [boundary],
  );
  const blocked =
    props.securityStatus.user.id !== reviewerId ||
    view.error === "account" ||
    view.error === "signedOut";
  function load() {
    if (active.current !== null || blocked || (props.securityUnavailable ?? false)) return;
    const operation = { controller: new AbortController(), boundary };
    active.current = operation;
    const signal = AbortSignal.any([
      operation.controller.signal,
      AbortSignal.timeout(REQUEST_WAIT_MS),
    ]);
    const current = () => active.current === operation && !operation.controller.signal.aborted;
    const update = (patch: Partial<ReviewerCaseCardView>) => {
      if (current())
        setView((previous) =>
          previous.boundary === boundary ? { ...previous, ...patch } : previous,
        );
    };
    setView({ ...emptyReviewerCaseCard(boundary), busy: true, engaged: true });
    startTransition(async () => {
      try {
        const security = await waitForRequest(props.refreshSecurity(signal), signal);
        signal.throwIfAborted();
        if (!current()) return;
        if (!security.ok) {
          update({ error: "unavailable" });
          return;
        }
        if (security.value === null) {
          update({ error: "signedOut" });
          return;
        }
        if (security.value.user.id !== reviewerId) {
          update({ error: "account" });
          return;
        }
        if (!security.value.emailVerified) {
          update({ error: "verifyEmail" });
          return;
        }
        if (!nativeReviewFresh(security.value)) {
          update({ error: "fresh" });
          return;
        }
        const result = await waitForRequest(
          readPrivacyReviewerCaseAction(readCsrfToken(), { caseId: props.caseId }, reviewerId),
          signal,
        );
        signal.throwIfAborted();
        if (!current()) return;
        if (!result.ok) {
          update({ error: nativeActionError(result.error) });
          return;
        }
        if (result.value.case.id !== props.caseId) {
          update({ error: "unavailable" });
          return;
        }
        update({ data: result.value, error: null });
      } catch {
        update({ data: null, error: "unavailable" });
      } finally {
        if (current()) {
          update({ busy: false });
          active.current = null;
        }
      }
    });
  }
  const denied = nativeBoundaryError(props, reviewerId) !== null || blocked;
  return {
    ...view,
    data: view.boundary === boundary && !denied ? view.data : null,
    disabled: view.busy || blocked || props.securityUnavailable === true,
    load,
  };
}
