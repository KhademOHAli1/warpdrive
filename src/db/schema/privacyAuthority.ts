import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { privacyCases } from "./privacyCases";

export const privacyAuthority = pgTable(
  "privacy_authority",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    generation: integer("generation").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("privacy_authority_capabilities", sql`jsonb_typeof(${t.capabilities}) = 'array'`),
    check("privacy_authority_generation", sql`${t.generation} > 0`),
  ],
);

export const privacyCaseMembers = pgTable(
  "privacy_case_members",
  {
    caseId: uuid("case_id")
      .notNull()
      .references(() => privacyCases.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    generation: integer("generation").notNull().default(1),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.userId] }),
    check("privacy_case_member_capabilities", sql`jsonb_typeof(${t.capabilities}) = 'array'`),
    check("privacy_case_member_generation", sql`${t.generation} > 0`),
  ],
);
