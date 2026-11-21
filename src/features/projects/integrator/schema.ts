import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "@/db/schema/identity";
import type { ProjectIntegratorAccess } from "./contracts";

export const projectIntegratorKeys = pgTable(
  "project_integrator_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceSlug: text("workspace_slug").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    hint: text("hint").notNull(),
    access: text("access").$type<ProjectIntegratorAccess>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("project_integrator_keys_workspace_token_key").on(table.workspaceSlug, table.tokenHash),
    check(
      "project_integrator_keys_workspace_check",
      sql`${table.workspaceSlug} ~ '^[a-z][a-z0-9-]{0,62}$'`,
    ),
    check("project_integrator_keys_name_check", sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check("project_integrator_keys_hash_check", sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check("project_integrator_keys_hint_check", sql`${table.hint} ~ '^[A-Za-z0-9_-]{4}$'`),
    check("project_integrator_keys_access_check", sql`${table.access} IN ('read', 'write')`),
    index("project_integrator_keys_user_workspace_idx").on(
      table.userId,
      table.workspaceSlug,
      table.createdAt,
    ),
  ],
);
