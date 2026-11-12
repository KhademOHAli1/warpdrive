import type { Pool, PoolConfig } from "pg";
import type { CoreEnvironment } from "@/config/coreEnv";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

function rejectConnection(): never {
  throw new AppError(
    ERROR_IDS.RUNTIME_CORE_API_CONFIGURATION_INVALID,
    "Invalid Core database profile",
  );
}

/** pg reparses DSN query parameters after explicit options; prohibit budget overrides. */
export function coreDatabaseRole(connectionString: string): string {
  if (!URL.canParse(connectionString)) rejectConnection();
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hash !== "" ||
    url.hostname === "" ||
    url.username === "" ||
    url.pathname.length <= 1
  )
    rejectConnection();
  for (const key of url.searchParams.keys())
    if (!["sslmode", "sslnegotiation", "sslrootcert", "sslcert", "sslkey"].includes(key))
      rejectConnection();
  try {
    return decodeURIComponent(url.username);
  } catch {
    return rejectConnection();
  }
}

export function applicationPoolOptions(
  connectionString: string,
  profile: CoreEnvironment,
): PoolConfig {
  if (profile.RUNTIME_COMPONENT !== "core-api") return { connectionString };
  coreDatabaseRole(connectionString);
  return {
    connectionString,
    application_name: "warpdrive-core-api",
    max: profile.CORE_DB_MAX,
    connectionTimeoutMillis: profile.CORE_DB_CONNECT_MS,
    statement_timeout: profile.CORE_DB_STATEMENT_MS,
    query_timeout: profile.CORE_DB_QUERY_MS,
    lock_timeout: profile.CORE_DB_LOCK_MS,
    // Provider I/O inside existing domain transactions must not terminate the session.
    idle_in_transaction_session_timeout: 0,
    options: "-c idle_in_transaction_session_timeout=0",
    keepAlive: true,
    keepAliveInitialDelayMillis: 1_000,
  };
}

/** Include the effective configuration so a hot reload cannot reuse a different budget. */
export function poolProfileKey(options: PoolConfig): string {
  return JSON.stringify(options);
}

export type CachedApplicationPool = { pool: Pool; profileKey?: string; connectionString?: string };

export function reuseApplicationPool(
  cached: CachedApplicationPool | undefined,
  options: PoolConfig,
): Pool | undefined {
  if (cached === undefined) return undefined;
  if (cached.profileKey === poolProfileKey(options)) return cached.pool;
  // Adopt the old legacy cache shape only when its complete original configuration matches.
  if (
    cached.profileKey === undefined &&
    Object.keys(options).length === 1 &&
    cached.connectionString === options.connectionString
  )
    return cached.pool;
  // Existing requests can still own the old generation. Do not accumulate a new pool beside it.
  throw new AppError(ERROR_IDS.DB_READ_FAILED, "Database profile changed; restart the process");
}
