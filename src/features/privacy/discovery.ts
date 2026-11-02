import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import {
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
} from "@/db/schema";
import { err, ok } from "@/types/result";
import { privacyStorageOperation } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { discoveryAdapters } from "./discoveryAdapters";
import { checkDiscoveryCoverage, DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { decodeDiscoveryCursor, encodeDiscoveryCursor } from "./discoveryCursor";
import { discoveryGraph } from "./discoveryGraph";
import {
  DISCOVERY_ADAPTER_TABLES,
  type DiscoveryCandidate,
  type DiscoveryConfidence,
  type DiscoverySubject,
} from "./discoveryTypes";
import { decodeIdentity } from "./identityPersistence";
import {
  type PrivacyActor,
  type PrivacyAuthorityTicket,
  withPrivacyAuthority,
} from "./permissions";

const MAX_PAGE_SIZE = 100;
const requestSchema = z.strictObject({
  caseId: z.uuid(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(4096)
    .optional(),
});

async function hasReviewCapability(
  db: Db,
  actor: PrivacyActor,
  caseId: string,
  signal: AbortSignal,
) {
  const [authority] = await db
    .select({ capabilities: privacyAuthority.capabilities })
    .from(privacyAuthority)
    .where(eq(privacyAuthority.userId, actor.userId));
  signal.throwIfAborted();
  const [member] = await db
    .select({
      capabilities: privacyCaseMembers.capabilities,
      revokedAt: privacyCaseMembers.revokedAt,
    })
    .from(privacyCaseMembers)
    .where(and(eq(privacyCaseMembers.caseId, caseId), eq(privacyCaseMembers.userId, actor.userId)));
  signal.throwIfAborted();
  return (
    authority?.capabilities.includes("case.review") === true &&
    member?.revokedAt === null &&
    member.capabilities.includes("case.review")
  );
}

async function knownCatalog(db: Db, signal: AbortSignal) {
  const stores = DISCOVERY_COVERAGE.map((entry) => entry.store);
  if (
    !checkDiscoveryCoverage(stores).ok ||
    discoveryAdapters.length !== DISCOVERY_ADAPTER_TABLES.length ||
    discoveryAdapters.some((adapter, index) => adapter.store !== DISCOVERY_ADAPTER_TABLES[index])
  )
    return false;
  const unknown = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' AND NOT ((schemaname='public' AND tablename IN (${sql.join(
      stores.map((store) => sql`${store}`),
      sql`,`,
    )})) OR schemaname='pgboss' OR (schemaname='drizzle' AND tablename='__drizzle_migrations')) LIMIT 1`,
  );
  signal.throwIfAborted();
  return unknown.rows.length === 0;
}

function basePage() {
  return {
    candidates: [] as DiscoveryCandidate[],
    nextCursor: null as string | null,
    complete: false as const,
    snapshot: "live_candidates" as const,
    coverage: DISCOVERY_COVERAGE,
    blockers: [
      ...DISCOVERY_COVERAGE.filter((entry) => entry.status !== "supported"),
      {
        store: "pgboss-managed-schema",
        status: "unsupported" as const,
        scope: "candidate_links_only" as const,
        reason:
          "Queue payloads need their separately inventoried runtime adapter and retention review; this reader does not scan or disclose them.",
      },
      {
        store: "object_versions_providers_backups",
        status: "unsupported" as const,
        scope: "candidate_links_only" as const,
        reason:
          "Object contents/versions, remote providers and backups need separate adapters and receipts; no external content is fetched.",
      },
      {
        store: "reviewed_scope",
        status: "review_required" as const,
        scope: "candidate_links_only" as const,
        reason:
          "Live candidate pages are not an immutable approved scope; ambiguous matches, historical aliases, untyped custom JSON, free text and third-party content need review.",
      },
    ],
  };
}

async function candidatePage(
  db: Db,
  subject: DiscoverySubject,
  ticket: PrivacyAuthorityTicket,
  caseId: string,
  limit: number,
  rawCursor: string | undefined,
  signal: AbortSignal,
) {
  const page = basePage();
  const cursor = rawCursor === undefined ? null : decodeDiscoveryCursor(rawCursor, caseId, ticket);
  if (cursor !== null && !cursor.ok) return cursor;
  const start = cursor === null ? 0 : DISCOVERY_ADAPTER_TABLES.indexOf(cursor.value.store);
  for (let index = start; index < discoveryAdapters.length; index++) {
    signal.throwIfAborted();
    const adapter = discoveryAdapters[index];
    if (adapter === undefined) return err("unclassified_store" as const);
    const after = cursor !== null && index === start ? cursor.value.afterId : null;
    const remaining = limit - page.candidates.length;
    const result = await db.execute<{
      id: string;
      relation: string;
      confidence: DiscoveryConfidence;
    }>(
      sql`${discoveryGraph(subject)} SELECT candidate.id,candidate.relation,candidate.confidence FROM (${adapter.query(subject)}) candidate WHERE (${after}::text IS NULL OR candidate.id>${after}::text) ORDER BY candidate.id LIMIT ${remaining}`,
    );
    signal.throwIfAborted();
    page.candidates.push(
      ...result.rows.map((row) => ({
        store: adapter.store,
        recordId: row.id,
        provenance: { relation: row.relation, source: adapter.source },
        confidence: row.confidence,
        reviewRequired: true as const,
      })),
    );
    if (page.candidates.length === limit) {
      const last = page.candidates.at(-1);
      if (last !== undefined)
        page.nextCursor = encodeDiscoveryCursor(caseId, ticket, last.store, last.recordId);
      break;
    }
  }
  return ok(page);
}

export async function listPrivacyDiscoveryPage(
  db: Db,
  actor: PrivacyActor,
  input: unknown,
  signal: AbortSignal,
) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return err("invalid_input" as const);
  const request = parsed.data;
  return privacyStorageOperation(signal, () =>
    withPrivacyAuthority(
      db,
      actor,
      { capability: "case.disclose", caseId: request.caseId },
      signal,
      async (tx, ticket) => {
        if (!(await hasReviewCapability(tx, actor, request.caseId, signal)))
          return err("forbidden" as const);
        const [privacyCase] = await tx
          .select({ status: privacyCases.status })
          .from(privacyCases)
          .where(eq(privacyCases.id, request.caseId));
        signal.throwIfAborted();
        if (privacyCase?.status !== "under_review") return err("case_not_reviewable" as const);
        if (!(await knownCatalog(tx, signal))) return err("unclassified_store" as const);
        const [proof] = await tx
          .select({ subjectEnc: privacyCaseVerifications.subjectEnc })
          .from(privacyCaseVerifications)
          .where(eq(privacyCaseVerifications.caseId, request.caseId));
        signal.throwIfAborted();
        if (proof?.subjectEnc === null || proof?.subjectEnc === undefined)
          return err("forbidden" as const);
        const subject = decodeIdentity(
          proof.subjectEnc,
          privacyIntakeSchema.shape.subject,
          request.caseId,
        );
        if (!subject.ok) return err("forbidden" as const);
        if (subject.value.kind === "external") {
          const page = basePage();
          page.blockers.push({
            store: "subject_binding",
            status: "review_required",
            scope: "candidate_links_only",
            reason:
              "An external subject needs reviewed record links or aliases; a recipient address alone does not identify CRM records.",
          });
          return ok(page);
        }
        return candidatePage(
          tx,
          subject.value,
          ticket,
          request.caseId,
          request.limit,
          request.cursor,
          signal,
        );
      },
    ),
  );
}
