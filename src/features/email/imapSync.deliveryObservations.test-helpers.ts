import { createHash } from "node:crypto";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deliveryMachinePart, seedDeliveryAttempt } from "./deliveryObservation.test-helpers";
import { runImapSyncJob } from "./imapSync";
import { IMAP_SYNC_NOW, imapSyncFixture } from "./imapSync.test-helpers";

export const NATIVE_REPORT_BODY = "گزارش دریافت‌شده / Empfangener Bericht";
export const NATIVE_REPORT_FILENAME = "Angebot.pdf";

export type NativeReportMode = "valid" | "malformed" | "ordinary";

function base64(content: Buffer): string {
  return (
    content
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? ""
  );
}

function nativeReportMime(args: {
  accountId: string;
  recipient: string;
  attemptId: string;
  messageIdHeader: string;
  machine: Buffer | null;
}): Buffer {
  const boundary = `native-dsn-${args.accountId}`;
  const parts = [
    "From: Mailer Daemon <mailer-daemon@example.test>",
    `To: ${args.recipient}`,
    "Subject: Native delivery report",
    "Date: Sat, 31 Oct 2026 13:00:00 +0000",
    `Message-ID: <${boundary}@example.test>`,
    `X-Warpdrive-Send-Attempt: ${args.attemptId}`,
    `Original-Message-ID: ${args.messageIdHeader}`,
    "MIME-Version: 1.0",
    args.machine === null
      ? `Content-Type: multipart/mixed; boundary="${boundary}"`
      : `Content-Type: multipart/report; report-type=global-delivery-status; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(Buffer.from(NATIVE_REPORT_BODY)),
  ];
  if (args.machine !== null) {
    parts.push(
      `--${boundary}`,
      "Content-Type: message/global-delivery-status",
      "Content-Transfer-Encoding: base64",
      "",
      base64(args.machine),
    );
  }
  parts.push(
    `--${boundary}`,
    "Content-Type: application/pdf",
    `Content-Disposition: attachment; filename="${NATIVE_REPORT_FILENAME}"`,
    "Content-Transfer-Encoding: base64",
    "",
    base64(Buffer.from("%PDF-1.7")),
    `--${boundary}--`,
    "",
  );
  return Buffer.from(parts.join("\r\n"));
}

export async function nativeDeliveryObservationFixture(
  db: Db,
  mode: NativeReportMode,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const f = await imapSyncFixture(db);
  try {
    signal.throwIfAborted();
    const attempt = await seedDeliveryAttempt(db, f.accountId);
    signal.throwIfAborted();
    const machine =
      mode === "ordinary"
        ? null
        : mode === "malformed"
          ? Buffer.from([0xc0, 0xaf])
          : Buffer.from(
              deliveryMachinePart()
                .content.toString("utf8")
                .replace("forged-envelope-id", attempt.attemptId)
                .replace(
                  "Reporting-MTA:",
                  `Original-Message-ID: ${attempt.messageIdHeader}\r\nReporting-MTA:`,
                ),
            );
    const source = nativeReportMime({
      accountId: f.accountId,
      recipient: f.runtime.emailAddress,
      attemptId: attempt.attemptId,
      messageIdHeader: attempt.messageIdHeader,
      machine,
    });
    const inbox = f.server.state.folders.get("INBOX");
    if (inbox === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Missing native report fixture inbox");
    inbox.messages = [{ uid: 1, flags: [], date: IMAP_SYNC_NOW, source }];
    return {
      ...f,
      attempt,
      inbox,
      machine,
      attachmentPartKey: machine === null ? "2" : "3",
      contentHash: machine === null ? null : createHash("sha256").update(machine).digest("hex"),
      contentBytes: machine?.byteLength ?? 0,
      sync: (operationSignal: AbortSignal) =>
        runImapSyncJob(
          db,
          { accountId: f.accountId, signal: operationSignal, now: IMAP_SYNC_NOW },
          f.deps,
        ),
    };
  } catch (error) {
    await f.server.close();
    throw error;
  }
}
