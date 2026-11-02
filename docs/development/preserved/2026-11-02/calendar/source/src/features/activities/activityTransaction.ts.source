import { TransactionRollbackError } from "drizzle-orm";
import type { AppError } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { Result } from "@/types/result";

// An operational Result error must abort earlier domain writes too. Returning an Err
// directly from Drizzle's callback commits it, which is unsafe for personal-settings CAS.
export async function activityTransaction<T>(
  db: DbOrTx,
  run: (tx: DbOrTx) => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> {
  const failure: { value: Result<T, AppError> | null } = { value: null };
  try {
    return await db.transaction(async (tx) => {
      const result = await run(tx);
      if (!result.ok) {
        failure.value = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError && failure.value !== null) return failure.value;
    throw error;
  }
}
