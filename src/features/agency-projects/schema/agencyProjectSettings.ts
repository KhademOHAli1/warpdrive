import { sql } from "drizzle-orm";
import { boolean, check, pgTable } from "drizzle-orm/pg-core";

export const agencyProjectSettings = pgTable(
  "agency_project_settings",
  {
    id: boolean("id").primaryKey().default(true),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [check("agency_project_settings_singleton", sql`${table.id} = true`)],
);
