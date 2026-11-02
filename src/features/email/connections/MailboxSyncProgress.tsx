"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { RAW_MIME_LIMITS } from "../providers/rawMimeTypes";
import { mailboxConnectionMessages, mailboxConnectionTranslator } from "./messages";
import type { MailboxConnectionView } from "./types";

const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;
export function MailboxSyncProgress({
  progress,
}: {
  progress: MailboxConnectionView["syncProgress"];
}): React.ReactNode {
  const preferences = useLocalePreferences();
  const format = useFormatters();
  const L = mailboxConnectionMessages(preferences.locale);
  const t = mailboxConnectionTranslator(preferences.locale, preferences.numberingSystem);
  if (progress === undefined) return null;
  const reasons = [
    { key: "skipMessageTooLarge" as const, count: progress.skipReasons?.messageTooLarge ?? 0 },
    { key: "skipInvalidMessage" as const, count: progress.skipReasons?.invalidMessage ?? 0 },
    { key: "skipMessageMissing" as const, count: progress.skipReasons?.messageMissing ?? 0 },
  ].filter((reason) => reason.count > 0);
  const parsingSkipped =
    (progress.skipReasons?.messageTooLarge ?? 0) > 0 ||
    (progress.skipReasons?.invalidMessage ?? 0) > 0;
  return (
    <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
      <p role="status">
        {progress.total === null
          ? t("progressUnknown", { processed: format.number(progress.processed) })
          : t("progressKnown", {
              processed: format.number(progress.processed),
              total: format.number(progress.total),
            })}
      </p>
      {progress.skipped !== undefined && progress.skipped > 0 && (
        <p>{t("skippedCount", { count: format.number(progress.skipped) })}</p>
      )}
      {reasons.length > 0 && (
        <ul aria-label={L.skippedReasonDetails} className="space-y-0.5">
          {reasons.map((reason) => (
            <li key={reason.key}>{t(reason.key, { count: format.number(reason.count) })}</li>
          ))}
        </ul>
      )}
      {parsingSkipped && (
        <p className="max-w-prose text-pretty">
          {t("parsingLimits", {
            messageLimit: format.number(RAW_MIME_LIMITS.messageBytes / MEBIBYTE),
            attachmentLimit: format.number(RAW_MIME_LIMITS.attachmentBytes / MEBIBYTE),
            bodyLimit: format.number(RAW_MIME_LIMITS.bodyBytes / MEBIBYTE),
            headerLimit: format.number(RAW_MIME_LIMITS.headerBytes / KIBIBYTE),
            attachmentCount: format.number(RAW_MIME_LIMITS.attachmentCount),
          })}
        </p>
      )}
    </div>
  );
}
