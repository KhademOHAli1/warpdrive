"use client";
import { useState } from "react";
import type { EmailVisibility } from "../threadVisibility";
import type { AttachedFile } from "./AttachmentList";
import type { ComposerProps } from "./ComposerProps";
export function useComposerFields({
  draft,
  prefill,
  defaultToList,
}: Pick<ComposerProps, "draft" | "prefill"> & { defaultToList: string[] }) {
  const [toList, setToList] = useState<string[]>(draft?.to ?? prefill?.to ?? defaultToList);
  const [ccList, setCcList] = useState<string[]>(draft?.cc ?? prefill?.cc ?? []);
  const [bccList, setBccList] = useState<string[]>(draft?.bcc ?? []);
  const [subject, setSubject] = useState(draft?.subject ?? prefill?.subject ?? "");
  const [body, setBody] = useState(draft?.bodyHtml ?? prefill?.bodyHtml ?? "");
  const [trackOpens, setTrackOpens] = useState(draft?.trackOpens ?? false);
  const [trackLinks, setTrackLinks] = useState(draft?.trackLinks ?? false);
  const [visibility, setVisibility] = useState<EmailVisibility>(draft?.visibility ?? "shared");
  const [addAsActivity, setAddAsActivity] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insertToken, setInsertToken] = useState<{ text: string; seq: number } | undefined>(
    undefined,
  );
  const [recipientsNonce, setRecipientsNonce] = useState(0);
  const [attachments, setAttachments] = useState<AttachedFile[]>(draft?.attachments ?? []);
  function reset(resetSignature: () => void): void {
    setToList(defaultToList);
    setCcList([]);
    setBccList([]);
    setSubject("");
    resetSignature();
    setTrackOpens(false);
    setTrackLinks(false);
    setVisibility("shared");
    setAddAsActivity(false);
    setInsertToken(undefined);
    setRecipientsNonce((value) => value + 1);
    setAttachments([]);
  }
  return {
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
    trackOpens,
    setTrackOpens,
    trackLinks,
    setTrackLinks,
    visibility,
    setVisibility,
    addAsActivity,
    setAddAsActivity,
    sending,
    setSending,
    uploading,
    setUploading,
    error,
    setError,
    insertToken,
    setInsertToken,
    recipientsNonce,
    attachments,
    setAttachments,
    reset,
  };
}
