import { sql } from "drizzle-orm";
import { check, customType, foreignKey, pgTable, uuid } from "drizzle-orm/pg-core";
import { internalProjectSettings } from "../schema";
import { maxStoredProjectCover } from "./contracts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const internalProjectCoverAssets = pgTable(
  "internal_project_cover_assets",
  {
    projectId: uuid("project_id").primaryKey(),
    version: uuid("version").notNull(),
    image: bytea("image").notNull(),
  },
  (table) => [
    foreignKey({
      name: "internal_project_cover_assets_project_id_fkey",
      columns: [table.projectId],
      foreignColumns: [internalProjectSettings.projectId],
    }).onDelete("cascade"),
    check(
      "internal_project_cover_assets_size_check",
      sql`octet_length(${table.image}) BETWEEN 1 AND ${sql.raw(String(maxStoredProjectCover))}`,
    ),
  ],
);
