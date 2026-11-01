import { TransactionRollbackError } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { prepareDeliveryObservations } from "./deliveryObservationIngestPrepare";
import {
  lockDeliveryObservationSource,
  storeDeliveryObservationPart,
} from "./deliveryObservationIngestStore";
import type { DeliveryObservationError } from "./deliveryObservationTypes";
import type { RawDeliveryReportPart } from "./providers/rawMimeTypes";

export interface DeliveryObservationIngestInput {
  accountId: string;
  sourceMessageId: string;
  parts: readonly RawDeliveryReportPart[];
}

export interface DeliveryObservationIngested {
  reportIds: string[];
  skipped: number;
}

// Unregistered domain storage only. Receiving adapters must supply decoded machine parts.
export async function ingestDeliveryReports(
  db: DbOrTx,
  input: unknown,
  signal: AbortSignal,
): Promise<Result<DeliveryObservationIngested, DeliveryObservationError>> {
  signal.throwIfAborted();
  const prepared = prepareDeliveryObservations(input, signal);
  if (!prepared.ok) return prepared;
  let rollbackReason: DeliveryObservationError | undefined;
  try {
    const result = await db.transaction(
      async (tx): Promise<Result<DeliveryObservationIngested, DeliveryObservationError>> => {
        if (!(await lockDeliveryObservationSource(tx, prepared.value, signal)))
          return err("not_found");
        const reportIds: string[] = [];
        let skipped = 0;
        for (const part of prepared.value.parts) {
          const stored = await storeDeliveryObservationPart(tx, prepared.value, part, signal);
          if (!stored.ok) {
            rollbackReason = stored.error;
            return tx.rollback();
          }
          if (stored.value === null) skipped += 1;
          else reportIds.push(stored.value);
        }
        signal.throwIfAborted();
        return ok({ reportIds, skipped });
      },
    );
    signal.throwIfAborted();
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (rollbackReason !== undefined && error instanceof TransactionRollbackError)
      return err(rollbackReason);
    throw error;
  }
}
