import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { pipelines, savedFilters, teams, users } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { currentNativeActor, type NativeSessionRef } from "@/features/auth/currentNativeActor";
import { currencyCode } from "@/features/currencies/currencySchema";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { OwnerScope } from "@/types/stats";
import { visiblePipelinePredicate } from "./visiblePipelines";

export const SAVED_PERFORMANCE_REPORT_TARGET = "stats-performance-report";
export const SAVED_PERFORMANCE_REPORT_VERSION = 1;
export const MAX_SAVED_PERFORMANCE_REPORTS = 50;
const MAX_NAME_LENGTH = 120;
const MAX_DEFINITION_BYTES = 4_096;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

const uuid = z.uuid().transform((value) => value.toLowerCase());
const civilDate = z
  .string()
  .date()
  .refine((value) => !value.startsWith("0000-"));
const fixedOwnerScope = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("me") }),
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("user"), userId: uuid }),
  z.strictObject({ kind: z.literal("team"), teamId: uuid }),
]);

export const savedPerformanceDefinition = z
  .strictObject({
    version: z.literal(SAVED_PERFORMANCE_REPORT_VERSION),
    from: civilDate,
    to: civilDate,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .pipe(currencyCode),
    pipelineId: uuid.nullable(),
    ownerScope: fixedOwnerScope,
  })
  .refine(
    ({ from, to }) => {
      // Dates are canonical ISO civil labels. UTC is only the arithmetic container for the bound.
      const elapsedDays =
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
      return elapsedDays >= 0 && elapsedDays < MAX_RANGE_DAYS;
    },
    { path: ["to"], message: "The fixed range must cover at most 366 inclusive days" },
  );

const createInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_LENGTH)
    .refine((value) => !value.includes("\0")),
  definition: savedPerformanceDefinition,
});

export type SavedPerformanceDefinition = z.output<typeof savedPerformanceDefinition>;

// Supply from the authenticated server context. Session/actor IDs from a caller are not credentials.
export interface SavedPerformanceReportPrincipal {
  readonly session: NativeSessionRef;
  readonly actor: PermSetUser;
}

type UnavailableReason =
  | "authentication-required"
  | "invalid-input"
  | "not-found"
  | "unsupported-version"
  | "invalid-definition"
  | "scope-unavailable"
  | "source-unavailable"
  | "report-limit";

interface Unavailable<Reason extends UnavailableReason = UnavailableReason> {
  state: "unavailable";
  reason: Reason;
}

interface ReportSummary {
  id: string;
  name: string;
  definitionState: "version-1" | "unsupported-version";
}

type ListResult = { state: "listed"; reports: ReportSummary[]; truncated: boolean } | Unavailable;
type CreateResult = { state: "created"; id: string } | Unavailable;
type LoadResult =
  | { state: "loaded"; report: ReportSummary; definition: SavedPerformanceDefinition }
  | Unavailable<Exclude<UnavailableReason, "report-limit">>;
type RemoveResult = { state: "removed" } | Unavailable;

function unavailable<Reason extends UnavailableReason>(reason: Reason): Unavailable<Reason> {
  return { state: "unavailable", reason };
}

function privateTarget(ownerId: string) {
  return and(
    eq(savedFilters.targetEntity, SAVED_PERFORMANCE_REPORT_TARGET),
    eq(savedFilters.ownerId, ownerId),
    eq(savedFilters.isShared, false),
  );
}

const reportSummary = {
  id: savedFilters.id,
  name: sql<string>`pg_catalog.left(${savedFilters.name}, ${MAX_NAME_LENGTH})`,
  versionOne: sql<boolean>`
    (${savedFilters.definition}->'version') IS NOT DISTINCT FROM '1'::jsonb
  `,
};

function summary(row: { id: string; name: string; versionOne: boolean }): ReportSummary {
  return {
    id: row.id,
    name: row.name,
    definitionState: row.versionOne ? "version-1" : "unsupported-version",
  };
}

type AuthorityFailure = Unavailable<"authentication-required" | "source-unavailable">;
const AUTHORITY_EXPIRED = new Error("Saved Performance authority expired");

async function withActor<T>(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  signal: AbortSignal,
  operation: (tx: Db, live: PermSetUser) => Promise<T>,
): Promise<T | AuthorityFailure> {
  signal.throwIfAborted();
  if (
    !principal.actor.isActive ||
    principal.actor.id !== principal.session.userId ||
    !uuid.safeParse(principal.session.userId).success ||
    !uuid.safeParse(principal.session.sessionId).success
  )
    return unavailable("authentication-required");

  try {
    return await withCurrentAuthority(db, "read", signal, async (tx) => {
      const current = await currentNativeActor(tx, principal.session, signal);
      return current === null
        ? unavailable("authentication-required")
        : operation(tx, current.actor);
    });
  } catch (error) {
    signal.throwIfAborted();
    // Native query errors can include bound names and definitions in their messages.
    return unavailable(
      error === AUTHORITY_EXPIRED ? "authentication-required" : "source-unavailable",
    );
  }
}

function withMutationActor<T extends CreateResult | RemoveResult>(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  signal: AbortSignal,
  operation: (tx: Db, actor: PermSetUser) => Promise<T>,
): Promise<T | AuthorityFailure> {
  return withActor(db, principal, signal, async (tx, actor) => {
    const result = await operation(tx, actor);
    if (
      result.state !== "unavailable" &&
      (await currentNativeActor(tx, principal.session, signal)) === null
    )
      throw AUTHORITY_EXPIRED;
    return result;
  });
}

async function ownerAvailable(db: Db, request: PermSetUser, live: PermSetUser, scope: OwnerScope) {
  if (scope.kind === "me" || (scope.kind === "user" && scope.userId === live.id)) return true;
  if (!can(request, "stats.viewOthers") || !can(live, "stats.viewOthers")) return false;
  if (scope.kind === "all") return true;

  const rows =
    scope.kind === "user"
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, scope.userId), eq(users.isActive, true)))
          .limit(1)
      : await db.select({ id: teams.id }).from(teams).where(eq(teams.id, scope.teamId)).limit(1);
  return rows.length === 1;
}

async function scopeAvailable(
  db: Db,
  request: PermSetUser,
  live: PermSetUser,
  definition: SavedPerformanceDefinition,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (!(await ownerAvailable(db, request, live, definition.ownerScope))) return false;
  if (definition.pipelineId === null) return true;
  signal.throwIfAborted();
  const rows = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.id, definition.pipelineId),
        eq(pipelines.isArchived, false),
        visiblePipelinePredicate(request),
        visiblePipelinePredicate(live),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export function listSavedPerformanceReports(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  signal: AbortSignal,
): Promise<ListResult> {
  return withActor<ListResult>(db, principal, signal, async (tx, actor) => {
    const rows = await tx
      .select(reportSummary)
      .from(savedFilters)
      .where(privateTarget(actor.id))
      .orderBy(desc(savedFilters.createdAt), desc(savedFilters.id))
      .limit(MAX_SAVED_PERFORMANCE_REPORTS + 1);
    return {
      state: "listed",
      reports: rows.slice(0, MAX_SAVED_PERFORMANCE_REPORTS).map(summary),
      truncated: rows.length > MAX_SAVED_PERFORMANCE_REPORTS,
    };
  });
}

export async function createSavedPerformanceReport(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  input: unknown,
  signal: AbortSignal,
): Promise<CreateResult> {
  signal.throwIfAborted();
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return unavailable("invalid-input");
  const { name, definition } = parsed.data;
  return withMutationActor<CreateResult>(db, principal, signal, async (tx, actor) => {
    // The authority fence precedes the owner-specific lock. READ COMMITTED makes the
    // following capped population read see the previous concurrent creator's insert.
    await tx.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('warpdrive:stats-performance-report-v1'), pg_catalog.hashtext(${actor.id})
      )
    `);
    if (!(await scopeAvailable(tx, principal.actor, actor, definition, signal)))
      return unavailable("scope-unavailable");

    const present = await tx
      .select({ id: savedFilters.id })
      .from(savedFilters)
      .where(privateTarget(actor.id))
      .limit(MAX_SAVED_PERFORMANCE_REPORTS);
    if (present.length >= MAX_SAVED_PERFORMANCE_REPORTS) return unavailable("report-limit");

    signal.throwIfAborted();
    const [created] = await tx
      .insert(savedFilters)
      .values({
        name,
        definition,
        ownerId: actor.id,
        targetEntity: SAVED_PERFORMANCE_REPORT_TARGET,
        isShared: false,
        favorite: false,
      })
      .returning({ id: savedFilters.id });
    if (created === undefined)
      throw new AppError(ERROR_IDS.DB_INSERT_FAILED, "Saved Performance insert returned no ID");
    return { state: "created", id: created.id };
  });
}

export async function loadSavedPerformanceReport(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  id: string,
  signal: AbortSignal,
): Promise<LoadResult> {
  signal.throwIfAborted();
  const reportId = uuid.safeParse(id);
  if (!reportId.success) return unavailable("invalid-input");
  return withActor<LoadResult>(db, principal, signal, (tx, actor) =>
    loadSavedPerformanceReportInSnapshot(tx, principal.actor, actor, reportId.data, signal),
  );
}

/** Internal exact read for the caller's already authenticated transaction. */
export async function loadSavedPerformanceReportInSnapshot(
  tx: Db,
  requestActor: PermSetUser,
  actor: PermSetUser,
  reportId: string,
  signal: AbortSignal,
): Promise<LoadResult> {
  signal.throwIfAborted();
  if (!requestActor.isActive || !actor.isActive || requestActor.id !== actor.id)
    return unavailable("authentication-required");
  const [row] = await tx
    .select({
      ...reportSummary,
      definition: sql<unknown>`
      CASE WHEN ${reportSummary.versionOne} AND pg_catalog.octet_length(${savedFilters.definition}::text) <= ${MAX_DEFINITION_BYTES}
        THEN ${savedFilters.definition}
      END
    `,
    })
    .from(savedFilters)
    .where(and(privateTarget(actor.id), eq(savedFilters.id, reportId)))
    .limit(1);
  if (row === undefined) return unavailable("not-found");
  if (!row.versionOne) return unavailable("unsupported-version");
  const parsed = savedPerformanceDefinition.safeParse(row.definition);
  if (!parsed.success) return unavailable("invalid-definition");
  if (!(await scopeAvailable(tx, requestActor, actor, parsed.data, signal)))
    return unavailable("scope-unavailable");

  return { state: "loaded", report: summary(row), definition: parsed.data };
}

export async function removeSavedPerformanceReport(
  db: Db,
  principal: SavedPerformanceReportPrincipal,
  id: string,
  signal: AbortSignal,
): Promise<RemoveResult> {
  signal.throwIfAborted();
  const reportId = uuid.safeParse(id);
  if (!reportId.success) return unavailable("invalid-input");
  return withMutationActor<RemoveResult>(db, principal, signal, async (tx, actor) => {
    const [deleted] = await tx
      .delete(savedFilters)
      .where(and(privateTarget(actor.id), eq(savedFilters.id, reportId.data)))
      .returning({ id: savedFilters.id });
    return deleted === undefined ? unavailable("not-found") : { state: "removed" };
  });
}
