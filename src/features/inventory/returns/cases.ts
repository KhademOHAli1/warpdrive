import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { directorySites } from "@/features/locations/schema";
import { salesOrderLines, salesOrders, salesShipmentLines } from "../sales/schema";
import type { ReturnCommand } from "./contracts";
import { failReturn } from "./failure";
import {
  type ReturnCaseRow,
  returnCases,
  returnCommercial,
  returnLines,
  returnReceipts,
} from "./schema";
import { readCaseLines, readCaseReceipts, readReturnSourceLines } from "./source";

type SaveDraft = Extract<ReturnCommand, { type: "saveDraft" }>;
type DraftFields = Pick<SaveDraft, "siteId" | "reference" | "note" | "charges" | "lines">;

async function requireReturnSite(tx: Db, siteId: string) {
  const [site] = await tx
    .select({ id: directorySites.id })
    .from(directorySites)
    .where(and(eq(directorySites.id, siteId), eq(directorySites.archived, false)));
  if (site === undefined) failReturn("unavailable");
}

async function preparedReturnLines(
  tx: Db,
  shipmentId: string,
  lines: DraftFields["lines"],
  ignoreCaseId?: string,
) {
  const source = new Map(
    (await readReturnSourceLines(tx, shipmentId, ignoreCaseId)).map((row) => [row.packed.id, row]),
  );
  return lines.map((line) => {
    const packed = source.get(line.shipmentLineId);
    if (packed === undefined || packed.packed.eventId === null || !packed.packed.checked)
      failReturn("unavailable");
    if (line.quantity > packed.eligible) failReturn("stock");
    return { ...line, itemId: packed.packed.itemId };
  });
}

export async function saveReturnDraft(
  tx: Db,
  actorId: string,
  id: string,
  shipmentId: string,
  orderId: string,
  values: DraftFields,
  existing: ReturnCaseRow | null,
) {
  if (existing !== null && existing.status !== "draft") failReturn("state");
  const { lines: requested, ...header } = values;
  await requireReturnSite(tx, header.siteId);
  const lines = await preparedReturnLines(tx, shipmentId, requested, existing?.id);
  if (existing === null)
    await tx.insert(returnCases).values({ id, shipmentId, orderId, ...header, createdBy: actorId });
  else {
    await tx.update(returnCases).set(header).where(eq(returnCases.id, id));
    await tx.delete(returnLines).where(eq(returnLines.caseId, id));
  }
  if (lines.length > 0)
    await tx
      .insert(returnLines)
      .values(lines.map((line) => ({ ...line, caseId: id, shipmentId, orderId })));
}

export async function duplicateReturn(
  tx: Db,
  actorId: string,
  source: ReturnCaseRow,
  id: string,
  reference: string,
) {
  const available = new Map(
    (await readReturnSourceLines(tx, source.shipmentId)).map(({ packed, eligible }) => [
      packed.id,
      eligible,
    ]),
  );
  const lines = (await readCaseLines(tx, source.id)).flatMap(
    ({ shipmentLineId, quantity, reason }) => {
      const eligible = Math.min(available.get(shipmentLineId) ?? 0, quantity);
      return eligible === 0 ? [] : [{ shipmentLineId, quantity: eligible, reason }];
    },
  );
  await saveReturnDraft(
    tx,
    actorId,
    id,
    source.shipmentId,
    source.orderId,
    { siteId: source.siteId, reference, note: source.note, charges: source.charges, lines },
    null,
  );
}

export async function issueReturn(tx: Db, row: ReturnCaseRow) {
  if (row.status !== "draft") failReturn("state");
  await requireReturnSite(tx, row.siteId);
  const lines = await readCaseLines(tx, row.id);
  if (lines.length === 0) failReturn("invalid");
  await preparedReturnLines(tx, row.shipmentId, lines, row.id);
  await tx
    .update(returnCases)
    .set({ status: "issued", issuedAt: sql`clock_timestamp()` })
    .where(eq(returnCases.id, row.id));
}

export function unresolvedReturn(receipt: { physical: string }) {
  return receipt.physical === "quarantine" || receipt.physical === "repair";
}

export async function finishReturn(tx: Db, row: ReturnCaseRow, complete: boolean) {
  if (row.status !== "issued" && row.status !== "onHold" && (complete || row.status !== "draft"))
    failReturn("state");
  const [receipts, lines] = await Promise.all([
    readCaseReceipts(tx, row.id),
    readCaseLines(tx, row.id),
  ]);
  if (receipts.some(unresolvedReturn)) failReturn("state");
  if (
    complete &&
    lines.reduce((sum, line) => sum + line.quantity, 0) !==
      receipts.reduce((sum, receipt) => sum + receipt.quantity, 0)
  )
    failReturn("state");
  await tx
    .update(returnCases)
    .set({ status: complete ? "completed" : "cancelled" })
    .where(eq(returnCases.id, row.id));
}

function fixedAmount(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(4, "0")}`);
}

export async function recordCommercialReturn(
  tx: Db,
  actorId: string,
  row: ReturnCaseRow,
  command: Extract<ReturnCommand, { type: "commercial" }>,
) {
  const [basis] = await tx
    .select({
      quantity: returnReceipts.quantity,
      price: salesOrderLines.unitPrice,
      currency: salesOrders.currency,
    })
    .from(returnReceipts)
    .innerJoin(salesShipmentLines, eq(salesShipmentLines.id, returnReceipts.shipmentLineId))
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, salesShipmentLines.lineId))
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId))
    .where(and(eq(returnReceipts.id, command.receiptId), eq(returnReceipts.caseId, row.id)));
  if (basis === undefined) failReturn("unavailable");
  if (command.kind === "refund") {
    if (command.amount === null) failReturn("invalid");
    const amount = fixedAmount(command.amount);
    if (amount <= 0n || amount > fixedAmount(basis.price) * BigInt(basis.quantity))
      failReturn("invalid");
  } else if (command.amount !== null) failReturn("invalid");
  const [created] = await tx
    .insert(returnCommercial)
    .values({
      receiptId: command.receiptId,
      kind: command.kind,
      amount: command.amount,
      reference: command.reference,
      reason: command.reason,
      currency: basis.currency,
      actorId,
    })
    .onConflictDoNothing()
    .returning({ id: returnCommercial.receiptId });
  if (created === undefined) failReturn("conflict");
}
