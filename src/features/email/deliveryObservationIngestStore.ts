import { and, eq, sql } from "drizzle-orm";
import { emailDeliveryReports } from "@/db/schema/emailDeliveryObservations";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type {
  PreparedDeliveryObservationBatch,
  PreparedDeliveryObservationPart,
} from "./deliveryObservationIngestPrepare";

type SourceIdentity = Pick<PreparedDeliveryObservationBatch, "accountId" | "sourceMessageId">;

export async function lockDeliveryObservationSource(
  tx: DbOrTx,
  input: SourceIdentity,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  // Keep the parent alive before taking its child lock, matching the account-purge order.
  const account = await tx.execute(sql`SELECT id FROM email_accounts
    WHERE id=${input.accountId} FOR KEY SHARE`);
  signal.throwIfAborted();
  if (account.rows.length !== 1) return false;
  const source = await tx.execute(sql`SELECT id FROM email_messages
    WHERE id=${input.sourceMessageId} AND account_id=${input.accountId}
      AND direction='inbound' FOR NO KEY UPDATE`);
  signal.throwIfAborted();
  return source.rows.length === 1;
}

async function storedDeliveryObservationReplay(
  tx: DbOrTx,
  input: SourceIdentity,
  part: PreparedDeliveryObservationPart,
  signal: AbortSignal,
): Promise<Result<string | null, "conflict">> {
  signal.throwIfAborted();
  const [existing] = await tx
    .select({
      id: emailDeliveryReports.id,
      contentHash: emailDeliveryReports.contentHash,
      contentBytes: emailDeliveryReports.contentBytes,
      mediaType: emailDeliveryReports.mediaType,
      provenance: emailDeliveryReports.provenance,
    })
    .from(emailDeliveryReports)
    .where(
      and(
        eq(emailDeliveryReports.accountId, input.accountId),
        eq(emailDeliveryReports.sourceMessageId, input.sourceMessageId),
        eq(emailDeliveryReports.partKey, part.partKey),
      ),
    )
    .limit(1);
  signal.throwIfAborted();
  if (existing === undefined) return ok(null);
  if (
    existing.contentHash !== part.contentHash ||
    existing.contentBytes !== part.contentBytes ||
    existing.mediaType !== part.mediaType ||
    existing.provenance !== part.provenance
  )
    return err("conflict");
  return ok(existing.id);
}

export async function storeDeliveryObservationPart(
  tx: DbOrTx,
  input: SourceIdentity,
  part: PreparedDeliveryObservationPart,
  signal: AbortSignal,
): Promise<Result<string | null, "conflict" | "unknown">> {
  signal.throwIfAborted();
  // Only an unknown malformed part may be skipped. A changed known part is a conflict.
  if (part.kind === "skipped") return storedDeliveryObservationReplay(tx, input, part, signal);
  const [inserted] = await tx
    .insert(emailDeliveryReports)
    .values({
      accountId: input.accountId,
      sourceMessageId: input.sourceMessageId,
      partKey: part.partKey,
      mediaType: part.parsed.mediaType,
      provenance: part.parsed.provenance,
      contentHash: part.contentHash,
      contentBytes: part.contentBytes,
      parsed: part.parsed,
    })
    .onConflictDoNothing({
      target: [
        emailDeliveryReports.accountId,
        emailDeliveryReports.sourceMessageId,
        emailDeliveryReports.partKey,
      ],
    })
    .returning({ id: emailDeliveryReports.id });
  signal.throwIfAborted();
  if (inserted !== undefined) return ok(inserted.id);
  const replay = await storedDeliveryObservationReplay(tx, input, part, signal);
  return replay.ok && replay.value === null ? err("unknown") : replay;
}
