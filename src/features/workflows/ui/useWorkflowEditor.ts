"use client";

import { useEffect, useRef, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { pauseWorkflowAction, publishWorkflowAction, saveWorkflowAction } from "../actions";
import { validateDefinition } from "../definition";
import { useGraphHistory } from "./useGraphHistory";

export type WorkflowDetail = RouterOutputs["workflows"]["get"];
type NoticeKey = "saved" | "published" | "pauseSaved" | "runStarted";
type ErrorKey = "fresh_auth_required" | "conflict" | "invalid" | "notReady" | "error" | "denied";

function leavingEditorLink(event: MouseEvent): HTMLAnchorElement | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  )
    return null;
  const link = event.target.closest("a[href]");
  if (
    !(link instanceof HTMLAnchorElement) ||
    link.hasAttribute("download") ||
    (link.target !== "" && link.target.toLowerCase() !== "_self")
  )
    return null;
  let destination: URL;
  try {
    destination = new URL(link.href, window.location.href);
  } catch {
    return null;
  }
  if (
    destination.origin !== window.location.origin ||
    (destination.pathname === window.location.pathname &&
      destination.search === window.location.search)
  )
    return null;
  return link;
}

export function useWorkflowEditor(initial: WorkflowDetail) {
  const t = useAppTranslations("workflows");
  const [name, setName] = useState(initial.name);
  const history = useGraphHistory(initial.draft);
  const { definition, setDefinition } = history;
  const [revision, setRevisionState] = useState(initial.revision);
  const revisionRef = useRef(initial.revision);
  function setRevision(value: number) {
    revisionRef.current = value;
    setRevisionState(value);
  }
  const [saved, setSaved] = useState(
    JSON.stringify({ name: initial.name, definition: initial.draft }),
  );
  const running = useRef(false);
  const [archivedAt, setArchivedAt] = useState(initial.archivedAt);
  const [capabilities, setCapabilities] = useState(initial.capabilities);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState(initial.active);
  const [number, setNumber] = useState(initial.publishedNumber);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<NoticeKey | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [leaveRequest, setLeaveRequest] = useState<{
    link: HTMLAnchorElement | null;
    href: string;
    continue?: () => void;
  } | null>(null);
  const replaying = useRef<HTMLAnchorElement | null>(null);
  const dirty = saved !== JSON.stringify({ name, definition });
  const validation = validateDefinition(definition);
  const issues = validation.ok ? [] : validation.error;

  // A successful save or undo can remove the reason for an open confirmation.
  if (!dirty && !pending && leaveRequest !== null) setLeaveRequest(null);

  useEffect(() => {
    if (!dirty && !pending) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    const protectLink = (event: MouseEvent) => {
      const link = leavingEditorLink(event);
      if (link === null) return;
      if (replaying.current === link) {
        replaying.current = null;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      setLeaveRequest((current) => current ?? { link, href: link.href });
    };
    window.addEventListener("beforeunload", protect);
    document.addEventListener("click", protectLink, true);
    return () => {
      window.removeEventListener("beforeunload", protect);
      document.removeEventListener("click", protectLink, true);
    };
  }, [dirty, pending]);

  function cancelLeave() {
    setLeaveRequest(null);
  }

  function confirmLeave() {
    if (leaveRequest === null) return;
    const { link, href, continue: continueDeparture } = leaveRequest;
    setLeaveRequest(null);
    if (continueDeparture !== undefined) {
      queueMicrotask(continueDeparture);
      return;
    }
    if (link === null) return;
    // Replay the original link after the themed dialog closes. Next retains its
    // normal navigation and history behavior; the exemption lasts one click.
    queueMicrotask(() => {
      if (
        !link.isConnected ||
        link.href !== href ||
        link.hasAttribute("download") ||
        (link.target !== "" && link.target.toLowerCase() !== "_self")
      )
        return;
      replaying.current = link;
      try {
        link.click();
      } finally {
        replaying.current = null;
      }
    });
  }

  function report(code: string) {
    if (code === "fresh_auth_required") {
      setError(code);
      return;
    }
    setError(
      code === ERROR_IDS.WORKFLOW_CONFLICT
        ? "conflict"
        : code === ERROR_IDS.WORKFLOW_INVALID
          ? "invalid"
          : code === ERROR_IDS.WORKFLOW_NOT_READY
            ? "notReady"
            : "error",
    );
  }
  async function save() {
    if (!dirty) return revision;
    const result = await saveWorkflowAction(
      { id: initial.id, name, definition, revision },
      readCsrfToken(),
    );
    if (!result.ok) {
      report(result.error);
      return null;
    }
    setRevision(result.value.revision);
    setName(result.value.name);
    history.adopt(result.value.draft);
    setSaved(JSON.stringify({ name: result.value.name, definition: result.value.draft }));
    return result.value.revision;
  }
  function requestDeparture(continueDeparture: () => void) {
    if (dirty || pending) {
      setLeaveRequest(
        (current) => current ?? { link: null, href: "", continue: continueDeparture },
      );
    } else continueDeparture();
  }
  async function command(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      await work();
    } finally {
      running.current = false;
      setPending(false);
    }
  }
  function applyLifecycle(
    row: Omit<WorkflowDetail, "capabilities">,
    operation: "archive" | "unarchive" | "restore",
  ) {
    setRevision(row.revision);
    setArchivedAt(row.archivedAt);
    setActive(row.active);
    setNumber(row.publishedNumber);
    if (operation === "archive") {
      setCapabilities({
        ...capabilities,
        edit: false,
        publish: false,
        run: false,
        restore: false,
        unarchive: capabilities.edit,
      });
    } else if (operation === "unarchive") {
      // Unarchive authorization establishes edit rights, but does not establish run/publish.
      setCapabilities({
        ...capabilities,
        edit: true,
        restore: true,
        publish: false,
        run: false,
        unarchive: false,
      });
    } else {
      setName(row.name);
      history.reset(row.draft);
      setSaved(JSON.stringify({ name: row.name, definition: row.draft }));
    }
  }
  function applyCurrentMetadata(row: WorkflowDetail) {
    if (row.id !== initial.id || row.revision < revisionRef.current) return;
    setAvailable(true);
    setCapabilities(row.capabilities);
    setArchivedAt(row.archivedAt);
    setActive(row.active);
    setNumber(row.publishedNumber);
    // A clean reconciliation adopts one complete saved baseline. Dirty input keeps its base.
    if (!dirty) {
      const baseline = JSON.stringify({ name: row.name, definition: row.draft });
      if (saved !== baseline) {
        setName(row.name);
        history.reset(row.draft);
        setSaved(baseline);
      }
      setRevision(row.revision);
    }
  }
  function revokeAccess() {
    setAvailable(false);
    setCapabilities({
      edit: false,
      publish: false,
      run: false,
      cancel: false,
      unarchive: false,
      duplicate: false,
      restore: false,
    });
  }
  // Explicit current reads reconcile metadata/baselines through applyCurrentMetadata.
  // A new workflow ID remounts the editor at the route boundary; local drafts survive
  // same-workflow RSC refreshes instead of being silently replaced from props.
  async function perform(operation: "save" | "publish" | "pause") {
    if (
      archivedAt !== null ||
      (operation === "publish" ? !capabilities.publish : !capabilities.edit)
    )
      return;
    if (dirty && !capabilities.edit) {
      setError("denied");
      return;
    }
    return command(async () => {
      setError(null);
      setNotice(null);
      try {
        const currentRevision = await save();
        if (currentRevision === null) return;
        if (operation === "publish") {
          const result = await publishWorkflowAction(initial.id, currentRevision, readCsrfToken());
          if (!result.ok) {
            report(result.error);
            return;
          }
          setNumber(result.value.number);
          setActive(true);
          setNotice("published");
        } else if (operation === "pause") {
          const result = await pauseWorkflowAction(initial.id, currentRevision, readCsrfToken());
          if (!result.ok) {
            report(result.error);
            return;
          }
          setRevision(result.value.revision);
          setActive(false);
          setNotice("pauseSaved");
        } else setNotice("saved");
      } catch {
        setError("error");
      }
    });
  }
  return {
    name,
    setName,
    definition,
    setDefinition,
    history,
    active,
    archivedAt,
    capabilities,
    available,
    revokeAccess,
    revision,
    applyLifecycle,
    applyCurrentMetadata,
    command,
    requestDeparture,
    number,
    pending,
    notice: notice === null || (dirty && notice === "saved") ? null : t(notice),
    setNotice,
    error: error === null ? null : error === "fresh_auth_required" ? error : t(error),
    dirty,
    leaveRequest,
    cancelLeave,
    confirmLeave,
    issues,
    perform,
  };
}
