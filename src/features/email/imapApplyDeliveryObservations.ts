import { and, eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { emailMessages } from "@/db/schema/email";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { ingestDeliveryReports } from "./deliveryObservationIngest";
import type { RawParsedMail } from "./providers/rawMimeTypes";

export async function applyImapDeliveryObservations(
  tx: DbOrTx,
  args: { accountId: string; messageId: string; parsed: RawParsedMail },
  signal: AbortSignal,
): Promise<Result<void, AppError>> {
  signal.throwIfAborted();
  if (args.parsed.deliveryReports.length === 0) return ok(undefined);
  const [source] = await tx
    .select({ direction: emailMessages.direction })
    .from(emailMessages)
    .where(and(eq(emailMessages.id, args.messageId), eq(emailMessages.accountId, args.accountId)));
  signal.throwIfAborted();
  if (source === undefined)
    return err(
      new AppError(
        ERROR_IDS.MAIL_DELIVERY_OBSERVATION_FAILED,
        "IMAP observation source unavailable",
        {
          reason: "source_unavailable",
        },
      ),
    );
  // An accepted SMTP Sent copy can contain a forwarded report. It is not inbound evidence.
  if (source.direction !== "inbound") return ok(undefined);
  const stored = await ingestDeliveryReports(
    tx,
    {
      accountId: args.accountId,
      sourceMessageId: args.messageId,
      parts: args.parsed.deliveryReports,
    },
    signal,
  );
  signal.throwIfAborted();
  return stored.ok
    ? ok(undefined)
    : err(
        new AppError(ERROR_IDS.MAIL_DELIVERY_OBSERVATION_FAILED, "IMAP observation ingest failed", {
          reason: stored.error,
        }),
      );
}
