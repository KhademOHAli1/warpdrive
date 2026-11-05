import { z } from "zod";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { companyCancellationSchema } from "./contracts";
import { openCompany } from "./crypto";
import { readCompany } from "./repository";
import type { companyOperations } from "./schema";

export const isLegalCompanyAction = (kind: string) =>
  ["save_legal_entity", "archive_legal_entity", "save_payer_preferences"].includes(
    kind.replace(/^(?:cancel|canceled):/u, ""),
  );
export async function companyReceiptValue(
  db: Db,
  actor: PermSetUser,
  row: typeof companyOperations.$inferSelect,
  signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted();
  if (row.kind === "cancel:save_details" || row.kind === "cancel:save_branding") {
    const ack = openCompany(
      row.responseCiphertext,
      `operation:${row.requestId}`,
      companyCancellationSchema,
    );
    // The original actor might have since lost legal access. Never return that old overview.
    return ack.status === "completed"
      ? { ...ack, result: await readCompany(db, actor, signal) }
      : ack;
  }
  return isLegalCompanyAction(row.kind) ||
    row.kind.startsWith("cancel:") ||
    row.kind.startsWith("canceled:")
    ? openCompany(row.responseCiphertext, `operation:${row.requestId}`, z.unknown())
    : readCompany(db, actor, signal);
}
