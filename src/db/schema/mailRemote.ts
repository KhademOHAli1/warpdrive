import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { emailAccounts, emailMessages } from "./email";

export const mailFolders = pgTable(
  "mail_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    uidValidity: text("uid_validity"),
    lastUid: bigint("last_uid", { mode: "number" }).notNull().default(0),
    reconcileAfterUid: bigint("reconcile_after_uid", { mode: "number" }).notNull().default(0),
    historyDays: integer("history_days").notNull().default(90),
    historySince: timestamp("history_since", { withTimezone: true }),
    readOnly: boolean("read_only"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastErrorKind: text("last_error_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mail_folders_account_path_uq").on(table.accountId, table.path),
    unique("mail_folders_id_account_uq").on(table.id, table.accountId),
  ],
);

export const mailMessageLocators = pgTable(
  "mail_message_locators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").notNull(),
    uidValidity: text("uid_validity").notNull(),
    uid: bigint("uid", { mode: "number" }).notNull(),
    messageId: uuid("message_id"),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    active: boolean("active").notNull().default(true),
    skippedReason: text("skipped_reason").$type<
      "message_too_large" | "invalid_message" | "message_missing"
    >(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("mail_locators_folder_epoch_uid_uq").on(table.folderId, table.uidValidity, table.uid),
    index("mail_locators_message_account_idx").on(table.messageId, table.accountId),
    foreignKey({
      columns: [table.folderId, table.accountId],
      foreignColumns: [mailFolders.id, mailFolders.accountId],
      name: "mail_locator_folder_same_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.messageId, table.accountId],
      foreignColumns: [emailMessages.id, emailMessages.accountId],
      name: "mail_locator_message_same_account_fk",
    }).onDelete("cascade"),
    check("mail_locator_uid_positive", sql`${table.uid} > 0 AND ${table.uid} <= 4294967295`),
  ],
);
