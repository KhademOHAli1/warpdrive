"use client";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { AttachButton } from "./AttachButton";
import { AttachmentList } from "./AttachmentList";
import { ComposerFooter } from "./ComposerFooter";
import type { ComposerContext } from "./composer.types";
import { mergeRecipientEmail } from "./composerLinks";
import { InsertToolbar } from "./InsertToolbar";
import { RecipientsRow } from "./RecipientsRow";
import { RichTextBody } from "./RichTextBodyLazy";
import { SignatureDropdown } from "./SignatureDropdown";
import { SubjectRow } from "./SubjectRow";
import type { useComposerFields } from "./useComposerFields";

export function ComposerForm({
  fields,
  context,
  resolvedThreadId,
  links,
  signatures,
  signatureId,
  applySignature,
  readOnly,
  canSend,
  onSend,
  onSendLater,
  onDiscard,
  attachEntityId,
  attachEntityType,
}: {
  fields: ReturnType<typeof useComposerFields>;
  context?: ComposerContext;
  resolvedThreadId?: string;
  links: { linkDealId?: string; linkPersonId?: string };
  signatures: { id: string; name: string }[];
  signatureId: string;
  applySignature: (id: string) => void;
  readOnly: boolean;
  canSend: boolean;
  onSend: () => void;
  onSendLater: (at: Date) => void;
  onDiscard: () => void;
  attachEntityId: string;
  attachEntityType: "deal" | "email_message";
}): React.ReactNode {
  const E = useEmailMessages();
  const {
    toList,
    setToList,
    ccList,
    setCcList,
    bccList,
    setBccList,
    subject,
    setSubject,
    body,
    setBody,
    insertToken,
    setInsertToken,
    recipientsNonce,
    attachments,
    setAttachments,
    setUploading,
    sending,
    trackOpens,
    setTrackOpens,
    trackLinks,
    setTrackLinks,
    visibility,
    setVisibility,
    addAsActivity,
    setAddAsActivity,
  } = fields;
  return (
    <fieldset disabled={readOnly} className="contents">
      <RecipientsRow
        key={recipientsNonce}
        to={toList}
        onToChange={setToList}
        cc={ccList}
        onCcChange={setCcList}
        bcc={bccList}
        onBccChange={setBccList}
      />
      <SubjectRow value={subject} onChange={setSubject} />
      <div className="flex items-center gap-2">
        <InsertToolbar
          key={`toolbar-${recipientsNonce}`}
          onSubjectChange={setSubject}
          subjectLocked={resolvedThreadId !== undefined}
          onBodyChange={setBody}
          context={context}
          onInsertField={(text) => setInsertToken((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }))}
          subject={subject}
          bodyHtml={body}
          recipientEmail={mergeRecipientEmail(toList, ccList, bccList)}
          personId={links.linkPersonId ?? null}
          dealId={links.linkDealId ?? null}
        />
        <SignatureDropdown
          signatures={signatures.map((s) => ({ id: s.id, name: s.name }))}
          value={signatureId}
          onChange={applySignature}
        />
      </div>
      <RichTextBody
        key={`body-${recipientsNonce}`}
        html={body}
        readOnly={readOnly}
        onChange={setBody}
        ariaLabel={E._extra.email_body}
        insertToken={insertToken}
        frameClassName="rounded-md border border-border bg-background text-sm"
        contentClassName="min-h-40 [&_.ProseMirror]:min-h-40"
      />
      <AttachmentList
        attachments={attachments}
        onRemove={(fileId) => setAttachments((prev) => prev.filter((a) => a.fileId !== fileId))}
      />
      <div className="flex items-center gap-2">
        <AttachButton
          entityType={attachEntityType}
          entityId={attachEntityId}
          onAttached={(file) => setAttachments((prev) => [...prev, file])}
          onUploadingChange={setUploading}
        />
        <div className="flex-1">
          <ComposerFooter
            canSend={canSend}
            sending={sending}
            onSend={onSend}
            onDiscard={onDiscard}
            trackOpens={trackOpens}
            onTrackOpensChange={setTrackOpens}
            trackLinks={trackLinks}
            onTrackLinksChange={setTrackLinks}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            // Show the privacy picker only for a NEW compose. On a reply (existing thread) the send
            // path preserves that thread's visibility, so the picker would be inert (codex P2); the
            // reader's thread-privacy toggle governs an existing thread instead.
            showVisibility={resolvedThreadId === undefined}
            // Available from both deal and inbox context; a non-deal send logs a
            // standalone activity (see fireActivity in useComposerSend.ts).
            showAddAsActivity={true}
            addAsActivity={addAsActivity}
            onAddAsActivityChange={setAddAsActivity}
            onSendLater={onSendLater}
          />
        </div>
      </div>
    </fieldset>
  );
}
