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
type ErrorKey = "fresh_auth_required" | "conflict" | "invalid" | "notReady" | "error";

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
  const [revision, setRevision] = useState(initial.revision);
  const [saved, setSaved] = useState(
    JSON.stringify({ name: initial.name, definition: initial.draft }),
  );
  const [active, setActive] = useState(initial.active);
  const [number, setNumber] = useState(initial.publishedNumber);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<NoticeKey | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [leaveRequest, setLeaveRequest] = useState<{
    link: HTMLAnchorElement;
    href: string;
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
    const { link, href } = leaveRequest;
    setLeaveRequest(null);
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
  async function perform(operation: "save" | "publish" | "pause") {
    setPending(true);
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
    } finally {
      setPending(false);
    }
  }
  return {
    name,
    setName,
    definition,
    setDefinition,
    history,
    active,
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
