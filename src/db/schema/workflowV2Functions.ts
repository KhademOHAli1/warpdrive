import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BlockJson } from "@/features/blocks/contracts";
import type { InternalConnectionEndpoint } from "@/features/connections/connectionEndpoint";
import { users } from "./identity";

const encrypted = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// A workflow references an immutable function revision ID, never the mutable family head.
export const workflowV2LogicFunctions = pgTable(
  "workflow_v2_logic_functions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    revision: integer("revision").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sourceCode: text("source_code").notNull(),
    inputSchema: jsonb("input_schema").$type<BlockJson>().notNull(),
    outputSchema: jsonb("output_schema").$type<BlockJson>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_v2_function_revision_idx").on(table.familyId, table.revision),
    check("workflow_v2_function_positive_revision", sql`${table.revision}>0`),
  ],
);

// Keys are encrypted at rest and have a separate administrator-only write surface.
export const workflowV2RuntimeSettings = pgTable(
  "workflow_v2_runtime_settings",
  {
    id: boolean("id").primaryKey().default(true),
    aiBaseUrl: text("ai_base_url"),
    aiApiKey: encrypted("ai_api_key"),
    aiDefaultModel: text("ai_default_model"),
    aiModels: jsonb("ai_models").$type<string[]>().notNull().default([]),
    internalEndpoints: jsonb("internal_endpoints")
      .$type<InternalConnectionEndpoint[]>()
      .notNull()
      .default([]),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("workflow_v2_runtime_singleton", sql`${table.id}=true`)],
);
