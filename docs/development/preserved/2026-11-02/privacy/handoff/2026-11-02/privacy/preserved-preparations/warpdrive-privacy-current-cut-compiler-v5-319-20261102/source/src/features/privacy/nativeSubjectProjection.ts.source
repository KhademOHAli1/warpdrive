import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { persons, users } from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import { disclosureFieldSchemas, MAX_CONTACT_POINTS, MAX_FIELD_TEXT } from "./disclosureFields";
import type { PrivacyNativeSubjectRecord } from "./nativeSubjectReviewTypes";

type Projection<Row extends PrivacyNativeSubjectRecord> = Row extends PrivacyNativeSubjectRecord
  ? Pick<Row, "store" | "recordType" | "values">
  : never;
export type NativeSubjectProjection = Projection<PrivacyNativeSubjectRecord>;
export type NativeSubjectProjectionFailure =
  | "source_unavailable"
  | "source_invalid"
  | "source_limit";

const MAX_CONTACT_JSON_BYTES = 8_388_608;
const personSchema = z.strictObject(disclosureFieldSchemas.person);
const userSchema = z.strictObject(disclosureFieldSchemas.user);
type SourceFailure = Exclude<NativeSubjectProjectionFailure, "source_unavailable">;

// This returns a static failure before transferring the projected values to the driver.
// It does not bound PostgreSQL's memory while inspecting or rendering a TOASTed JSON value.
const contactFailure = sql<SourceFailure | null>`CASE
  WHEN jsonb_typeof(${persons.emails}) IS DISTINCT FROM 'array'
    OR jsonb_typeof(${persons.phones}) IS DISTINCT FROM 'array'
    THEN 'source_invalid'
  WHEN char_length(${persons.name}) > ${MAX_FIELD_TEXT}
    OR char_length(${persons.firstName}) > ${MAX_FIELD_TEXT}
    OR char_length(${persons.lastName}) > ${MAX_FIELD_TEXT}
    OR char_length(${persons.primaryEmail}::text) > ${MAX_FIELD_TEXT}
    OR CASE WHEN jsonb_typeof(${persons.emails}) = 'array'
      THEN jsonb_array_length(${persons.emails}) > ${MAX_CONTACT_POINTS} ELSE false END
    OR CASE WHEN jsonb_typeof(${persons.phones}) = 'array'
      THEN jsonb_array_length(${persons.phones}) > ${MAX_CONTACT_POINTS} ELSE false END
    OR octet_length(${persons.emails}::text) > ${MAX_CONTACT_JSON_BYTES}
    OR octet_length(${persons.phones}::text) > ${MAX_CONTACT_JSON_BYTES}
    THEN 'source_limit'
  ELSE NULL
END`;

const userFailure = sql<SourceFailure | null>`CASE
  WHEN char_length(${users.name}) > ${MAX_FIELD_TEXT}
    OR char_length(${users.email}::text) > ${MAX_FIELD_TEXT}
    THEN 'source_limit'
  ELSE NULL
END`;

async function loadContact(
  tx: Db,
  referenceId: string,
  signal: AbortSignal,
): Promise<Result<NativeSubjectProjection, NativeSubjectProjectionFailure>> {
  const [preflight] = await tx
    .select({ failure: contactFailure })
    .from(persons)
    .where(eq(persons.id, referenceId))
    .limit(1)
    .for("share");
  signal.throwIfAborted();
  if (preflight === undefined) return err("source_unavailable");
  if (preflight.failure !== null) return err(preflight.failure);
  const [row] = await tx
    .select({
      id: persons.id,
      name: persons.name,
      firstName: persons.firstName,
      lastName: persons.lastName,
      primaryEmail: persons.primaryEmail,
      emails: persons.emails,
      phones: persons.phones,
      createdAt: persons.createdAt,
      updatedAt: persons.updatedAt,
      deletedAt: persons.deletedAt,
    })
    .from(persons)
    .where(eq(persons.id, referenceId))
    .limit(1);
  signal.throwIfAborted();
  if (row === undefined) return err("source_unavailable");
  const parsed = personSchema.safeParse(row);
  if (!parsed.success)
    return err(
      parsed.error.issues.some((issue) => issue.code === "too_big")
        ? "source_limit"
        : "source_invalid",
    );
  return ok({ store: "persons", recordType: "person", values: parsed.data });
}

async function loadUser(
  tx: Db,
  referenceId: string,
  signal: AbortSignal,
): Promise<Result<NativeSubjectProjection, NativeSubjectProjectionFailure>> {
  const [preflight] = await tx
    .select({ failure: userFailure })
    .from(users)
    .where(eq(users.id, referenceId))
    .limit(1)
    .for("share");
  signal.throwIfAborted();
  if (preflight === undefined) return err("source_unavailable");
  if (preflight.failure !== null) return err(preflight.failure);
  const [row] = await tx
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, referenceId))
    .limit(1);
  signal.throwIfAborted();
  if (row === undefined) return err("source_unavailable");
  const parsed = userSchema.safeParse(row);
  if (!parsed.success)
    return err(
      parsed.error.issues.some((issue) => issue.code === "too_big")
        ? "source_limit"
        : "source_invalid",
    );
  return ok({ store: "users", recordType: "user", values: parsed.data });
}

// The authority owner supplies its current verified subject and an existing transaction.
// FOR SHARE must remain held through the caller's final authority checks and response binding.
export async function loadNativeSubjectProjection(
  tx: Db,
  subject: { kind: "contact" | "user"; referenceId: string },
  signal: AbortSignal,
): Promise<Result<NativeSubjectProjection, NativeSubjectProjectionFailure>> {
  signal.throwIfAborted();
  return subject.kind === "contact"
    ? loadContact(tx, subject.referenceId, signal)
    : loadUser(tx, subject.referenceId, signal);
}
