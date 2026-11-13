import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import {
  applicationPoolOptions,
  type CachedApplicationPool,
  poolProfileKey,
  reuseApplicationPool,
} from "./corePoolProfile";
import * as schema from "./schema";

// Next hot reload replaces this module while existing requests still retain its pool.
// Reuse one development pool so repeated edits cannot accumulate disconnected generations.
const runtime = globalThis as typeof globalThis & {
  warpdrivePostgres?: CachedApplicationPool;
};
const options = applicationPoolOptions(env.DATABASE_URL, env);
const profileKey = poolProfileKey(options);
const cached = env.NODE_ENV === "development" ? runtime.warpdrivePostgres : undefined;
export const pool = reuseApplicationPool(cached, options) ?? new Pool(options);
if (env.NODE_ENV === "development") runtime.warpdrivePostgres = { profileKey, pool };
export const db = drizzle(pool, { schema });

// Use the base NodePgDatabase type (without $client: Pool) so both the
// production db and the test db (plain NodePgDatabase) satisfy Db.
export type Db = NodePgDatabase<typeof schema>;
