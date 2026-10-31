import { index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { importBatches } from "./importBatches";

export const importExternalIds = pgTable(
  "import_external_ids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    entity: text("entity").notNull(),
    externalId: text("external_id").notNull(),
    localId: uuid("local_id").notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_external_ids_source_entity_external_unique").on(
      t.source,
      t.entity,
      t.externalId,
    ),
    index("import_external_ids_batch_idx").on(t.batchId),
    index("import_external_ids_entity_local_idx").on(t.entity, t.localId),
  ],
);

export type ImportExternalId = typeof importExternalIds.$inferSelect;
export type NewImportExternalId = typeof importExternalIds.$inferInsert;
