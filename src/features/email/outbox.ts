import { sql } from "drizzle-orm";
import { env } from "@/config/env";
import { RECONCILE_WINDOW_MS } from "@/constants/email";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { StorageClient } from "@/features/files/storage";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import { gmailConnectionChanged } from "./gmailConnectionFence";
import { isGmailSendCurrent, releaseUnsubmittedGmailClaim } from "./gmailSendFence";
import { parseNotificationSendPurpose } from "./mailSendPurpose";
import { buildMime, deriveMessageId, type MimeAttachment, toRawBase64 } from "./mime";
import { reconcileNotificationGmail, recordNotificationGmailAck } from "./notificationGmailReceipt";
import { claim, loadAttempt, loadSendInputs, type SendPayload, stamp } from "./outboxClaim";
import { type AttemptRow, markSent, reconcile, type SendOutcome } from "./outboxReconcile";
import { type ReplyThreadHeaders, replyThreadHeaders } from "./replyHeaders";

// Resolve the RFC 5322 threading headers for a reply. The parent's Message-ID lives only in
// Gmail (we never stored the header), so it costs one metadata read per reply. A failed read
// degrades to Gmail-side threading via the threadId rather than failing an otherwise good send.
async function loadReplyThreadHeaders(
  gmail: GmailClient,
  parentGmailMessageId: string | null,
  gmailThreadId: string | null,
  signal: AbortSignal,
): Promise<ReplyThreadHeaders> {
  if (gmailThreadId === null || parentGmailMessageId === null) return {};
  const parent = await gmail.getMessage({ id: parentGmailMessageId, signal });
  signal.throwIfAborted();
  if (!parent.ok) return {};
  return replyThreadHeaders(parent.value);
}

// Classify a sendRaw failure. A definite pre-acceptance rejection is an HTTP 4xx: Gmail
// rejected the request and did NOT accept the message, so a retry is a safe fresh send.
// Everything else (5xx, network/timeout, or a schema-parse failure which only occurs on a
// 2xx body Gmail already accepted) is AMBIGUOUS and must reconcile, never blind re-send.
function isDefiniteRejection(error: AppError): boolean {
  const status = error.context?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

// Enqueue a send. The Message-ID header is the DETERMINISTIC id derived from
// (accountId, idempotencyKey): stable across retries so reconciliation can find a
// crashed-but-accepted send. Idempotent on (account_id, idempotency_key); if a sent
// row already exists it is reported as a replay.
export async function enqueueSend(
  db: DbOrTx,
  args: {
    accountId: string;
    idempotencyKey: string;
    payload: SendPayload;
    threadId?: string | null;
    scheduledAt?: Date | null;
    requiresPreparation?: boolean;
  },
): Promise<Result<{ attemptId: string; replay: boolean }, AppError>> {
  const header = deriveMessageId({
    accountId: args.accountId,
    idempotencyKey: args.idempotencyKey,
    domain: new URL(env.BASE_URL).hostname,
  });
  await db.execute(sql`
    INSERT INTO email_send_attempts (idempotency_key, message_id_header, account_id, thread_id, payload, status, scheduled_at, connection_generation, payload_prepared)
    SELECT ${args.idempotencyKey}, ${header}, id, ${args.threadId ?? null},
      ${JSON.stringify(args.payload)}::jsonb || jsonb_build_object('fromName',display_name),
      'pending', ${args.scheduledAt ?? null}, connection_generation, ${args.requiresPreparation !== true}
    FROM email_accounts WHERE id=${args.accountId}
    ON CONFLICT (account_id, idempotency_key) DO NOTHING
  `);

  const row = (
    await db.execute(sql`
      SELECT id, status FROM email_send_attempts
      WHERE account_id=${args.accountId} AND idempotency_key=${args.idempotencyKey}
    `)
  ).rows[0] as { id: string; status: string } | undefined;
  if (row === undefined) {
    return err(new AppError("E_DB_002", "enqueueSend found no attempt row", args));
  }
  return ok({ attemptId: row.id, replay: row.status === "sent" });
}

interface ProcessSendArgs {
  accountId: string;
  idempotencyKey: string;
  gmail: GmailClient;
  // Required so attachment sends cannot silently skip loading their bytes.
  storage: StorageClient;
  signal: AbortSignal;
  now?: number;
  windowMs?: number;
  expectedGeneration?: number;
}

// ops B6 steps 2 to 4. Exactly-once-effect under crashes: never blind re-send a row
// that may already have been accepted by Gmail; reconcile by deterministic Message-ID.
export async function processSendAttempt(
  db: Db,
  args: ProcessSendArgs,
): Promise<Result<SendOutcome, AppError>> {
  args.signal.throwIfAborted();
  const now = args.now ?? Date.now();
  const windowMs = args.windowMs ?? RECONCILE_WINDOW_MS;

  const existing = await loadAttempt(db, args.accountId, args.idempotencyKey);
  if (existing === undefined) {
    return err(
      new AppError("E_DB_002", "processSendAttempt: no attempt row", {
        accountId: args.accountId,
        idempotencyKey: args.idempotencyKey,
      }),
    );
  }
  // (a) replay short-circuit: already sent.
  if (existing.status === "sent") {
    const notification = await reconcileNotificationGmail(db, existing.id, args.signal);
    if (notification !== null) return ok(notification);
    return ok({ status: "sent", gmailMessageId: existing.gmail_message_id ?? undefined });
  }
  if (
    !(await isGmailSendCurrent(
      db,
      args.accountId,
      existing.connection_generation,
      args.signal,
      args.expectedGeneration,
    ))
  )
    return err(gmailConnectionChanged());

  // (c) branch on send_started_at: a stamped row may have been accepted -> reconcile,
  // never blind re-send. Do this BEFORE claiming so a stamped row can never re-send.
  if (existing.send_started_at !== null) {
    return reconcile(db, {
      attempt: existing,
      gmail: args.gmail,
      signal: args.signal,
      now,
      windowMs,
    });
  }

  // (b) token-guarded claim. A lost claim is expected contention (E_GMAIL_008), not an
  // API failure, so it does not pollute API-exhaustion metrics.
  const token = await claim(db, existing.id, args.signal);
  if (token === null)
    return err(new AppError("E_GMAIL_008", "attempt not claimable", { id: existing.id }));

  // Re-check under the claim: another worker may have stamped between load and claim.
  const claimed = await loadAttempt(db, args.accountId, args.idempotencyKey);
  if (claimed !== undefined && claimed.send_started_at !== null) {
    return reconcile(db, {
      attempt: claimed,
      gmail: args.gmail,
      signal: args.signal,
      now,
      windowMs,
    });
  }

  return submitClaimedAttempt(db, args, existing, token);
}

async function submitClaimedAttempt(
  db: Db,
  args: ProcessSendArgs,
  existing: AttemptRow,
  token: string,
): Promise<Result<SendOutcome, AppError>> {
  // (d) everything fallible that is NOT the send itself happens BEFORE the stamp. Once
  // send_started_at is committed a later failure can no longer be treated as definitely-unsent:
  // it routes into reconcile, which searches for a Message-ID that was never sent and parks the
  // attempt as needs_review. So load the inputs and resolve the reply's threading headers here.
  const inputs = await loadSendInputs(db, existing.id, args.accountId);
  if (inputs === undefined)
    return err(
      new AppError("E_DB_002", "send inputs not found", {
        accountId: args.accountId,
        idempotencyKey: args.idempotencyKey,
      }),
    );
  args.signal.throwIfAborted();
  const { from, payload, gmailThreadId, parentGmailMessageId } = inputs;
  const purpose =
    payload.systemPurpose === undefined
      ? null
      : parseNotificationSendPurpose(payload.systemPurpose);
  if (payload.systemPurpose !== undefined && purpose === null) {
    await releaseUnsubmittedGmailClaim(db, existing.id, token, args.signal);
    return err(
      new AppError(ERROR_IDS.NOTIF_SEND_PURPOSE_INVALID, "Gmail notification purpose is invalid"),
    );
  }

  const threading = await loadReplyThreadHeaders(
    args.gmail,
    parentGmailMessageId,
    gmailThreadId,
    args.signal,
  );

  // (e) stamp send_started_at and COMMIT before the Gmail send. A lost stamp race is
  // expected contention (E_GMAIL_008), not an API failure.
  const attResult = await fetchAttachmentBytes(payload, args.storage, args.signal);
  if (!attResult.ok) {
    await releaseUnsubmittedGmailClaim(db, existing.id, token, args.signal);
    return attResult;
  }
  const stamped = await stamp(db, existing.id, token, args.signal, args.expectedGeneration);
  if (!stamped) {
    await releaseUnsubmittedGmailClaim(db, existing.id, token, args.signal);
    return err(
      new AppError("E_GMAIL_008", "stamp race lost or mailbox authority changed", {
        id: existing.id,
      }),
    );
  }

  // (f) build MIME with the FIXED Message-ID, then send with NO DB tx held open.
  const mime = buildMime({
    from,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    messageId: existing.message_id_header,
    inReplyTo: threading.inReplyTo,
    references: threading.references,
    attachments: attResult.value.length > 0 ? attResult.value : undefined,
  });
  const sent = await args.gmail.sendRaw({
    rawBase64: toRawBase64(mime),
    threadId: gmailThreadId ?? undefined,
    signal: args.signal,
  });
  args.signal.throwIfAborted();

  if (!sent.ok) {
    if (isDefiniteRejection(sent.error)) {
      // DEFINITE pre-acceptance rejection (HTTP 4xx): Gmail did not accept the message, so
      // it is safe to retry as a fresh send. Clear send_started_at/claim_token (F12) so the
      // next attempt re-claims and re-sends instead of routing into reconcile (which would
      // search, find nothing, and eventually needs_review) and stranding a retryable send.
      await db.execute(sql`
        UPDATE email_send_attempts
        SET status='failed', error_id=${sent.error.id}, send_started_at=NULL, claim_token=NULL
        WHERE id=${existing.id}
      `);
    } else {
      // AMBIGUOUS failure (5xx, timeout, or a schema-parse failure on a 2xx body): Gmail may
      // have accepted the message. KEEP send_started_at so the next attempt reconciles by
      // the deterministic Message-ID rather than blind re-sending a possibly-delivered email
      // (F13). This is the original exactly-once path.
      await db.execute(sql`
        UPDATE email_send_attempts SET status='failed', error_id=${sent.error.id} WHERE id=${existing.id}
      `);
    }
    return ok({ status: "failed" });
  }

  if (purpose !== null) {
    const receipt = await recordNotificationGmailAck(db, {
      attemptId: existing.id,
      accountId: args.accountId,
      idempotencyKey: args.idempotencyKey,
      purpose,
      payload,
      providerMessageId: sent.value.id,
      signal: args.signal,
    });
    if (!receipt.ok) return receipt;
  } else await markSent(db, existing.id, sent.value.id, args.signal);
  return ok({ status: "sent", gmailMessageId: sent.value.id });
}

// Fetch raw bytes for every attachment in the payload from storage.
async function fetchAttachmentBytes(
  payload: SendPayload,
  storage: StorageClient,
  signal: AbortSignal,
): Promise<Result<MimeAttachment[], AppError>> {
  const result: MimeAttachment[] = [];
  for (const att of payload.attachments ?? []) {
    const bytes = await storage.getObjectBytes(att.s3Key, signal);
    if (!bytes.ok) return bytes;
    result.push({ filename: att.filename, contentType: att.contentType, bytes: bytes.value });
  }
  return ok(result);
}
