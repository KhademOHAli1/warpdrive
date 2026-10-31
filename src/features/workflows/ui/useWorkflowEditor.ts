"use client";

import { useEffect, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { RouterOutputs } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { pauseWorkflowAction, publishWorkflowAction, saveWorkflowAction } from "../actions";
import { validateDefinition } from "../definition";

export type WorkflowDetail = RouterOutputs["workflows"]["get"];
export function useWorkflowEditor(initial: WorkflowDetail) {
  const t = useAppTranslations("workflows");
  const [name, setName] = useState(initial.name);
  const [definition, setDefinition] = useState(initial.draft);
  const [revision, setRevision] = useState(initial.revision);
  const [saved, setSaved] = useState(
    JSON.stringify({ name: initial.name, definition: initial.draft }),
  );
  const [active, setActive] = useState(initial.active);
  const [number, setNumber] = useState(initial.publishedNumber);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = saved !== JSON.stringify({ name, definition });
  const validation = validateDefinition(definition);
  const issues = validation.ok ? [] : validation.error;

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);

  function report(code: string) {
    if (code === "fresh_auth_required") {
      setError(code);
      return;
    }
    setError(
      t(
        code === ERROR_IDS.WORKFLOW_CONFLICT
          ? "conflict"
          : code === ERROR_IDS.WORKFLOW_INVALID
            ? "invalid"
            : code === ERROR_IDS.WORKFLOW_NOT_READY
              ? "notReady"
              : "error",
      ),
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
    setDefinition(result.value.draft);
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
        setNotice(t("published"));
      } else if (operation === "pause") {
        const result = await pauseWorkflowAction(initial.id, currentRevision, readCsrfToken());
        if (!result.ok) {
          report(result.error);
          return;
        }
        setRevision(result.value.revision);
        setActive(false);
        setNotice(t("paused"));
      } else setNotice(t("saved"));
    } catch {
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }
  return {
    name,
    setName,
    definition,
    setDefinition,
    active,
    number,
    pending,
    notice,
    setNotice,
    error,
    dirty,
    issues,
    perform,
  };
}
