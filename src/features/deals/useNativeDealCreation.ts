"use client";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { AddDealState } from "./addDealState";
import { createNativeDealAction, readNativeDealCreationAction } from "./nativeCreateAction";
import { type NativeDealIntentV1, nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import type { NativeDealCreateFailure } from "./nativeCreateTypes";
import {
  claimCreationAttempt,
  clearRetainedCreation,
  creationAttemptHeld,
  type RetainedDealCreation,
  readRetainedCreation,
  releaseCreationAttempt,
  retainCreation,
  settleRejectedCreation,
  subscribeRetainedCreation,
} from "./retainedCreation";

export interface PreparedDealCreation {
  form: AddDealState;
  currency: string;
  valueLocale: Locale;
  deal: NativeDealIntentV1;
}
interface Options {
  onCreated: (id: string, title: string) => void | Promise<void>;
  onClose: () => void;
  openDetails: boolean;
  suppressDetailNav: boolean;
  restoreForm: (form: AddDealState, currency: string, valueLocale: Locale) => void;
}
type PendingCreation = Extract<RetainedDealCreation, { phase: "submitting" | "unknown" }>;
const phaseMessages = {
  contact_pending: null,
  contact_unknown: "nativeCreate.contactUnknown",
  contact_rejected: "nativeCreate.contactRejected",
  submitting: null,
  unknown: "nativeCreate.unknown",
  created: "nativeCreate.refreshFailed",
} as const;
export function useNativeDealCreation(options: Options) {
  const { actorId, isCurrent } = useNativeActor();
  const operation = useSyncExternalStore(
    subscribeRetainedCreation,
    () => readRetainedCreation(actorId),
    () => null,
  );
  const pending = useSyncExternalStore(
    subscribeRetainedCreation,
    () => creationAttemptHeld(actorId),
    () => false,
  );
  const [error, setError] = useState<string | null>(null);
  const [hiddenTitle, setHiddenTitle] = useState<string | null>(null);
  const translate = useAppTranslations("sales");
  const router = useRouter();

  async function reconcile(saved: Extract<RetainedDealCreation, { phase: "created" }>) {
    if (!isCurrent()) return;
    if (saved.deal === null) {
      clearRetainedCreation(saved.actorId, saved.id);
      setHiddenTitle(saved.form.title);
      return;
    }
    // Current-ID/current-pipeline acknowledgement, never original open-board membership.
    // The read-only entry also revalidates the operation's receipt/linkage after row locks.
    const fresh = await readNativeDealCreationAction(saved.input, readCsrfToken());
    if (!isCurrent()) return;
    if (!fresh.ok) {
      setError(translate("nativeCreate.refreshFailed"));
      return;
    }
    if (fresh.deal === null) {
      clearRetainedCreation(saved.actorId, saved.id);
      setHiddenTitle(saved.form.title);
      return;
    }
    if (fresh.deal.id !== saved.deal.id) {
      setError(translate("nativeCreate.refreshFailed"));
      return;
    }
    await options.onCreated(fresh.deal.id, saved.input.deal.title);
    if (!isCurrent()) return;
    clearRetainedCreation(saved.actorId, saved.id);
    options.onClose();
    if (options.openDetails && !options.suppressDetailNav) router.push(`/deals/${fresh.deal.id}`);
  }

  function handleDispatchFailure(
    saved: PendingCreation,
    held: RetainedDealCreation,
    result: NativeDealCreateFailure,
  ) {
    if (held.phase === "created") {
      if (isCurrent()) setError(translate("nativeCreate.refreshFailed"));
      return;
    }
    const rejected =
      result.outcome === "not_created" &&
      !saved.uncertain &&
      settleRejectedCreation(saved.actorId, saved.id);
    if (rejected) {
      if (isCurrent()) options.restoreForm(saved.form, saved.currency, saved.valueLocale);
    } else retainCreation({ ...saved, phase: "unknown", uncertain: true });
    if (isCurrent())
      setError(
        translate(rejected ? "nativeCreate.rejected" : "nativeCreate.denied", {
          id: result.error.id,
        }),
      );
  }

  async function dispatch(saved: PendingCreation) {
    const result = await createNativeDealAction(saved.input, readCsrfToken());
    const held = readRetainedCreation(saved.actorId);
    if (held?.id !== saved.id) return;
    if (!result.ok) {
      handleDispatchFailure(saved, held, result);
      return;
    }
    const completed = { ...saved, phase: "created" as const, deal: result.deal };
    const remembered = retainCreation(completed);
    if (remembered.id !== saved.id || remembered.phase !== "created") return;
    await reconcile(remembered);
  }

  function handleUncertainAttempt(accountId: string) {
    const current = readRetainedCreation(accountId);
    if (current?.phase === "created") {
      if (isCurrent()) setError(translate("nativeCreate.refreshFailed"));
    } else if (current?.phase === "submitting" || current?.phase === "unknown") {
      retainCreation({ ...current, phase: "unknown", uncertain: true });
      if (isCurrent()) setError(translate("nativeCreate.unknown"));
    } else if (isCurrent()) setError(translate("nativeCreate.invalid"));
  }

  function restoreContactsForReview(
    saved: Extract<RetainedDealCreation, { contact: "org" | "person" }>,
  ) {
    // Explicitly choose existing contacts after an unknown contact outcome; never resend it.
    options.restoreForm(
      {
        ...saved.form,
        ...(saved.contact === "org"
          ? { orgMode: "existing", orgId: "", newOrgName: "" }
          : { personMode: "existing", personId: "", newPersonName: "" }),
      },
      saved.currency,
      saved.valueLocale,
    );
    clearRetainedCreation(saved.actorId, saved.id);
    setError(translate("nativeCreate.selectExisting"));
  }

  async function submit(prepare: (id: string) => Promise<PreparedDealCreation | null>) {
    if (actorId === null || !isCurrent()) return;
    const attempt = claimCreationAttempt(actorId);
    if (attempt === null) return;
    setError(null);
    let saved = readRetainedCreation(actorId);
    try {
      if (saved?.phase === "contact_pending") return;
      if (saved?.phase === "contact_unknown" || saved?.phase === "contact_rejected") {
        restoreContactsForReview(saved);
        return;
      }
      if (saved?.phase === "created") {
        await reconcile(saved);
        return;
      }
      if (saved === null) {
        const id = crypto.randomUUID();
        const prepared = await prepare(id);
        if (prepared === null || !isCurrent()) return;
        const input = nativeDealCreateEnvelopeV1.parse({
          protocolVersion: 1,
          expectedActorId: actorId,
          creationOperationId: id,
          deal: prepared.deal,
        });
        saved = retainCreation({
          id,
          actorId,
          form: prepared.form,
          currency: prepared.currency,
          valueLocale: prepared.valueLocale,
          input,
          phase: "submitting",
          uncertain: false,
        });
      }
      if (saved.phase === "submitting" || saved.phase === "unknown") {
        retainCreation({ ...saved, phase: "submitting" });
        await dispatch(saved);
      }
    } catch {
      handleUncertainAttempt(actorId);
    } finally {
      // Document-wide ownership is released by its exact token even after actor unmount.
      releaseCreationAttempt(attempt);
    }
  }
  const phaseMessageKey = operation === null ? null : phaseMessages[operation.phase];
  const phaseMessage = phaseMessageKey === null ? null : translate(phaseMessageKey);
  const submitLabel =
    operation?.phase === "created"
      ? translate("nativeCreate.refresh")
      : operation?.phase === "contact_unknown" || operation?.phase === "contact_rejected"
        ? translate("nativeCreate.chooseExisting")
        : operation?.phase === "unknown"
          ? translate("nativeCreate.retry")
          : undefined;
  return {
    actorId,
    isCurrent,
    operation,
    pending,
    error: error ?? phaseMessage,
    setError,
    hiddenTitle,
    submitLabel,
    submit,
  };
}
