import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "./schema";

// Next hot reload replaces this module while existing requests still retain its pool.
// Reuse one development pool so repeated edits cannot accumulate disconnected generations.
const runtime = globalThis as typeof globalThis & {
  warpdrivePostgres?: { connectionString: string; pool: Pool };
};
const cached = env.NODE_ENV === "development" ? runtime.warpdrivePostgres : undefined;
export const pool =
  cached?.connectionString === env.DATABASE_URL
    ? cached.pool
    : new Pool({ connectionString: env.DATABASE_URL });
if (env.NODE_ENV === "development")
  runtime.warpdrivePostgres = { connectionString: env.DATABASE_URL, pool };
export const db = drizzle(pool, { schema });

// Use the base NodePgDatabase type (without $client: Pool) so both the
// production db and the test db (plain NodePgDatabase) satisfy Db.
export type Db = NodePgDatabase<typeof schema>;
