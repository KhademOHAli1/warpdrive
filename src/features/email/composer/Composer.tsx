"use client";

import { useMemo, useRef, useState } from "react";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useInterfacePrefs } from "@/features/identity/InterfacePrefsProvider";
import { trpc } from "@/lib/trpc-client";
import type { SendEmailOutcome } from "@/types/mail";
import { ComposerErrorAlert } from "./ComposerErrorAlert";
import { ComposerForm } from "./ComposerForm";
import { ComposerHeader } from "./ComposerHeader";
import type { ComposerProps } from "./ComposerProps";
import { resolveComposerLinks } from "./composerLinks";
import { DraftSaveStatus } from "./DraftSaveStatus";
import { dealDefaultRecipients } from "./dealRecipients";
import { MailboxDraftCopyDialog } from "./MailboxDraftCopyDialog";
import { resolveComposerThreadId } from "./resolveThreadId";
import { SendReviewNotice } from "./SendReviewNotice";
import { useComposerFields } from "./useComposerFields";
import { useComposerMailboxes } from "./useComposerMailboxes";
import { useComposerMailboxMessages } from "./useComposerMailboxMessages";
import { useComposerReceipt } from "./useComposerReceipt";
import { buildSendHandlers } from "./useComposerSend";
import { useComposerSignature } from "./useComposerSignature";
import { useDraftAutosave } from "./useDraftAutosave";
import { useMailboxDraftCopy } from "./useMailboxDraftCopy";

export function Composer({
  accountId,
  fromAddress,
  mailboxes,
  context,
  threadId,
  linkDealId,
  draft,
  prefill,
  onSent,
  onClose,
}: ComposerProps): React.ReactNode {
  const E = useEmailMessages();
  const L = useComposerMailboxMessages();
  const [activeAccountId, setActiveAccountId] = useState(draft?.accountId ?? accountId);
  const [activeDraftId, setActiveDraftId] = useState(draft?.id);
  const [sendIntentId, setSendIntentId] = useState(
    () => draft?.sendIntentId ?? crypto.randomUUID(),
  );
  const intentRef = useRef(sendIntentId);
  const [outcome, setOutcome] = useState<SendEmailOutcome | null>(draft?.sendOutcome ?? null);
  const senderContainer = useRef<HTMLDivElement>(null);
  const mailboxData = useComposerMailboxes(mailboxes);
  const currentMailbox = mailboxData.mailboxes.find((mailbox) => mailbox.id === activeAccountId);
  const currentAddress =
    currentMailbox?.emailAddress ?? (activeAccountId === accountId ? fromAddress : undefined);
  const canUseMailbox =
    !mailboxData.known ||
    (currentMailbox?.status === "connected" && currentMailbox.capabilities.send);

  const resolvedThreadId = resolveComposerThreadId(threadId, draft?.threadId, context);
  const links = resolveComposerLinks({ context, linkDealId, draft });
  const { prefillParticipantsAsRecipients } = useInterfacePrefs();

  const defaultToList: string[] =
    context?.kind === "deal" ? dealDefaultRecipients(context, prefillParticipantsAsRecipients) : [];

  const fields = useComposerFields({ draft, prefill, defaultToList });
  const {
    toList,
    ccList,
    bccList,
    subject,
    body,
    setBody,
    trackOpens,
    trackLinks,
    visibility,
    addAsActivity,
    sending,
    setSending,
    uploading,
    error,
    setError,
    attachments,
  } = fields;
  const attachmentInputs = useMemo(
    () => attachments.map((attachment) => ({ fileId: attachment.fileId })),
    [attachments],
  );

  const { data: signatures = [] } = trpc.email.signatures.list.useQuery();

  // Activity types resolve the email typeId for add-as-activity (available in deal + inbox context).
  const { data: activityTypes = [] } = trpc.activities.listTypes.useQuery();

  // Signature: embeds the default into the body on a fresh compose (C3), else carries the id for the
  // server to append on a reply/forward/legacy draft. See useComposerSignature.
  const { signatureId, sendSignatureId, applySignature, resetSignature } = useComposerSignature({
    signatures: sending || outcome !== null ? [] : signatures,
    setBody,
    // Decided from the initial props (not the live body) so a fast typist cannot flip a fresh
    // compose into the prefill branch before the signatures query resolves.
    startedWithBody: (draft?.bodyHtml ?? prefill?.bodyHtml ?? "") !== "",
    resumingDraft: draft !== undefined,
  });

  function resetDraft(): void {
    fields.reset(resetSignature);
    setOutcome(null);
    const intent = crypto.randomUUID();
    intentRef.current = intent;
    setSendIntentId(intent);
  }

  // Shared with the autosave hook so delete-on-send targets the id autosave created/resumed.
  const draftIdRef = useRef<string | undefined>(draft?.id);
  // Shared in-flight save promise: lets send await a racing autosave before deleting the draft.
  const draftInFlightRef = useRef<Promise<void> | null>(null);
  const snapshot = {
    accountId: activeAccountId,
    threadId: resolvedThreadId ?? null,
    subject,
    body,
    toList,
    ccList,
    visibility,
    linkDealId: links.linkDealId,
    linkPersonId: links.linkPersonId,
    bccList,
    attachments: attachmentInputs,
    sendIntentId,
    trackOpens,
    trackLinks,
    enabled: outcome === null,
    initialDraftId: activeDraftId,
    draftIdRef,
    inFlightRef: draftInFlightRef,
  };
  const autosave = useDraftAutosave(snapshot);
  const copy = useMailboxDraftCopy({
    snapshot,
    autosave,
    locked: resolvedThreadId !== undefined || sending || uploading || outcome !== null,
    onCopied: (target, draftId, intent) => {
      setActiveAccountId(target.id);
      setActiveDraftId(draftId);
      intentRef.current = intent;
      setSendIntentId(intent);
      setError(null);
    },
  });
  const receipt = useComposerReceipt({
    accountId: activeAccountId,
    intentId: sendIntentId,
    outcome,
    onOutcome: setOutcome,
    onNewIntent: (intent) => {
      intentRef.current = intent;
      setSendIntentId(intent);
      setOutcome(null);
      setError(null);
      autosave.resume();
    },
  });
  const readOnly = sending || copy.busy || outcome !== null;

  // buildSendHandlers reads draftIdRef/inFlightRef only inside the click handlers it returns (at
  // event time, not this render), so the rule's warning here is a false positive.
  // eslint-disable-next-line react-hooks/refs -- refs are read inside the returned handlers, not now
  const { handleSend, handleSendLater, acknowledgeAccepted } = buildSendHandlers({
    messages: E,
    idempotencyKeyRef: intentRef,
    beforeSend: autosave.flush,
    draftSaveError: L.saveError,
    setOutcome,
    accountId: activeAccountId,
    resolvedThreadId,
    toList,
    ccList,
    bccList,
    subject,
    body,
    trackOpens,
    trackLinks,
    visibility,
    // C3: when the signature is embedded in `body`, sendSignatureId is "" (no server re-append);
    // for a forward/reply/legacy draft it is the selected id so the server appends it.
    signatureId: sendSignatureId,
    attachments: attachmentInputs,
    context,
    linkDealId: links.linkDealId,
    linkPersonId: links.linkPersonId,
    activityTypes,
    addAsActivity,
    setSending,
    setError,
    resetDraft,
    onSent,
    draftIdRef,
    inFlightRef: draftInFlightRef,
  });

  const attachEntityId = context?.kind === "deal" ? context.dealId : activeAccountId;
  const attachEntityType =
    context?.kind === "deal" ? ("deal" as const) : ("email_message" as const);

  return (
    <section
      aria-label={E._extra.compose_email}
      className="rounded-md border border-border bg-background p-3 flex flex-col gap-2 text-sm"
    >
      <ComposerHeader
        fromAddress={currentAddress}
        accountId={activeAccountId}
        mailboxes={mailboxData.mailboxes}
        onMailboxChange={(id) => {
          const target = mailboxData.mailboxes.find((mailbox) => mailbox.id === id);
          if (target !== undefined) copy.request(target);
        }}
        senderLocked={resolvedThreadId !== undefined}
        senderDisabled={readOnly || uploading}
        senderContainerRef={senderContainer}
        onClose={
          onClose === undefined
            ? undefined
            : () => {
                if (outcome === null && !sending) resetDraft();
                onClose();
              }
        }
      />
      <ComposerErrorAlert error={error} onDismiss={() => setError(null)} />
      <DraftSaveStatus status={autosave.status} onRetry={autosave.retry} />
      {mailboxData.error && (
        <p role="status" className="text-xs text-muted-foreground">
          {L.mailboxesError}{" "}
          <button type="button" className="text-action hover:underline" onClick={mailboxData.retry}>
            {L.retry}
          </button>
        </p>
      )}
      {!canUseMailbox && (outcome === null || outcome.status === "failed") && (
        <p role="alert" className="text-sm text-destructive">
          {L.senderUnavailable}{" "}
          <a href="/settings/email-sync" className="text-action hover:underline">
            {L.openConnections}
          </a>
        </p>
      )}
      {outcome !== null && (
        <SendReviewNotice
          outcome={outcome}
          busy={sending || receipt.busy}
          error={receipt.error}
          onCheck={() => void receipt.check()}
          onRetry={canUseMailbox ? () => void handleSend() : undefined}
          onEdit={receipt.canEdit ? () => receipt.setEditOpen(true) : undefined}
          editOpen={receipt.editOpen}
          onEditOpenChange={receipt.setEditOpen}
          onConfirmEdit={() => void receipt.confirmEdit()}
          onDone={() => void acknowledgeAccepted()}
          onKeepDraft={onClose}
        />
      )}
      <ComposerForm
        fields={fields}
        context={context}
        resolvedThreadId={resolvedThreadId}
        links={links}
        signatures={signatures}
        signatureId={signatureId}
        applySignature={applySignature}
        readOnly={readOnly}
        canSend={toList.length > 0 && !uploading && canUseMailbox && outcome === null && !copy.busy}
        onSend={() => void handleSend()}
        onSendLater={(at) => void handleSendLater(at)}
        onDiscard={() => {
          resetDraft();
          setError(null);
        }}
        attachEntityId={attachEntityId}
        attachEntityType={attachEntityType}
      />
      <MailboxDraftCopyDialog
        open={copy.pending !== null}
        sourceAddress={currentAddress ?? ""}
        targetAddress={copy.pending?.target.emailAddress ?? ""}
        busy={copy.busy}
        error={copy.error}
        onCancel={copy.cancel}
        onConfirm={() => void copy.confirm()}
        onReturnFocus={() =>
          senderContainer.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus()
        }
      />
    </section>
  );
}
