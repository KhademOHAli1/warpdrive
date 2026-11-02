import { Pool } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import {
  checkout,
  type Outcome,
  observe,
  retainCleanup,
  uncertain,
} from "./privateIntakeLocalReadConnection";
import { ownPrivateReadLifecycle } from "./privateIntakeLocalReadLifecycle";
import { cleanupPrivateRead, performPrivateRead } from "./privateIntakeLocalReadTransaction";

function selectOutcome<Value>(
  primary: Outcome<Value>,
  cleaned: Outcome<void>,
  signal: AbortSignal,
): Value {
  if (!cleaned.ok) {
    if (!primary.ok && primary.error !== signal.reason) {
      retainCleanup(primary.error, uncertain("release", cleaned.error));
      throw primary.error;
    }
    const cause = primary.ok
      ? cleaned.error
      : new AggregateError([primary.error, cleaned.error], "Private read cleanup uncertain");
    throw uncertain("release", cause);
  }
  if (!primary.ok) throw primary.error;
  return primary.value;
}

// The capability is private to local read state, with no shared pool fallback.
export async function withPrivateIntakeLocalReadLocks<Value>(
  db: Db,
  signal: AbortSignal,
  work: (tx: DbOrTx) => Promise<Value>,
): Promise<Value> {
  signal.throwIfAborted();
  const pool: unknown = "$client" in db ? db.$client : undefined;
  if (!(pool instanceof Pool))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Private read requires a public PostgreSQL Pool");
  const client = await checkout(pool, signal, "checkout");
  const life = ownPrivateReadLifecycle(client, signal);
  const primary = await observe(performPrivateRead(life, pool, work));
  const cleaned = await observe(cleanupPrivateRead(life));
  return selectOutcome(primary, cleaned, signal);
}
