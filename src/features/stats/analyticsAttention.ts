import { randomUUID } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { pipelines } from "@/db/schema";
import { activityAccountPreferences } from "@/features/activities/accountTimeZone";
import {
  NEXT_ACTION_QUEUE_DEFAULT_LIMIT,
  NEXT_ACTION_QUEUE_MAX_LIMIT,
} from "@/features/activities/next-action-queue/queueInput";
import { nextActionDealReportSql } from "@/features/activities/next-action-queue/queueSql";
import { currencyCode } from "@/features/currencies/currencySchema";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import type { OwnerScope } from "@/types/stats";
import { hydrateReportActor } from "./hydrateReportActor";
import { ownerScopeInput } from "./schemas";
import { visiblePipelinePredicate } from "./visiblePipelines";

export const ANALYTICS_ATTENTION_DEFINITION = "current-deal-next-action-queue-v1";
export const MAX_ANALYTICS_ATTENTION_MATCHES = 5_000;

export const analyticsAttentionInput = z.strictObject({
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .pipe(currencyCode),
  pipelineId: z
    .uuid()
    .transform((id) => id.toLowerCase())
    .nullable(),
  ownerScope: ownerScopeInput,
  limit: z
    .number()
    .int()
    .min(1)
    .max(NEXT_ACTION_QUEUE_MAX_LIMIT)
    .default(NEXT_ACTION_QUEUE_DEFAULT_LIMIT),
  offset: z.number().int().min(0).max(MAX_ANALYTICS_ATTENTION_MATCHES).default(0),
});

const utcInstant = z.iso.datetime({ precision: 6 });
const overdueEvidence = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("due-instant"), at: utcInstant }),
  z.strictObject({
    kind: z.literal("final-civil-day"),
    date: z.iso.date(),
    basis: z.enum(["recorded-civil", "legacy-zoned"]),
  }),
]);
const anchor = z.discriminatedUnion("rule", [
  z.strictObject({
    rule: z.literal("overdue"),
    activityId: z.guid(),
    dealId: z.guid(),
    evidence: overdueEvidence,
  }),
  z.strictObject({
    rule: z.literal("missing-next-step"),
    dealId: z.guid(),
    evidence: z.strictObject({ kind: z.literal("no-open-linked-activity") }),
  }),
]);
const count = z
  .number()
  .int()
  .min(0)
  .max(MAX_ANALYTICS_ATTENTION_MATCHES + 1);
const resultSchema = z.strictObject({
  scopeAvailable: z.boolean(),
  limited: z.boolean(),
  observedAt: utcInstant,
  total: count,
  overdue: count,
  missingNextStep: count,
  items: z.array(anchor).max(NEXT_ACTION_QUEUE_MAX_LIMIT),
});

type Request = z.output<typeof analyticsAttentionInput>;
type Envelope = z.output<typeof resultSchema>;
export type AnalyticsAttentionRequest = z.input<typeof analyticsAttentionInput>;
export type AnalyticsAttentionAnchor = z.output<typeof anchor>;

export type AnalyticsAttention =
  | { state: "permission" }
  | {
      state: "unavailable";
      reason: "invalid-scope" | "scope-unavailable" | "source-unavailable" | "match-limit";
    }
  | {
      state: "available";
      definition: typeof ANALYTICS_ATTENTION_DEFINITION;
      basis: "current-work";
      readId: string;
      observedAt: string;
      timeZone: string;
      scope: {
        currency: string;
        pipeline: "selected" | "all-visible";
        owner: OwnerScope["kind"];
      };
      total: number;
      counts: { overdueActivities: number; dealsWithoutNextStep: number };
      page: {
        offset: number;
        limit: number;
        complete: boolean;
        hasMore: boolean;
        rows: AnalyticsAttentionAnchor[];
      };
    };

function unavailable(
  reason: Extract<AnalyticsAttention, { state: "unavailable" }>["reason"],
): AnalyticsAttention {
  return { state: "unavailable", reason };
}

function ownerPermitted(actor: PermSetUser, scope: OwnerScope): boolean {
  return (
    scope.kind === "me" ||
    (scope.kind === "user" && scope.userId === actor.id) ||
    can(actor, "stats.viewOthers")
  );
}

function ownerSelection(actor: PermSetUser, scope: OwnerScope): { available: SQL; filter: SQL } {
  switch (scope.kind) {
    case "all":
      return { available: sql`true`, filter: sql`true` };
    case "me":
      return { available: sql`true`, filter: sql`d.owner_id = ${actor.id}::uuid` };
    case "user":
      return {
        available: sql`exists (
          select 1 from public.users u where u.id = ${scope.userId}::uuid and u.is_active
        )`,
        filter: sql`d.owner_id = ${scope.userId}::uuid`,
      };
    case "team":
      return {
        available: sql`exists (select 1 from public.teams t where t.id = ${scope.teamId}::uuid)`,
        filter: sql`exists (
          select 1 from public.team_members tm where tm.team_id = ${scope.teamId}::uuid
            and tm.user_id = d.owner_id
        )`,
      };
  }
}

function dealReportScope(actor: PermSetUser, input: Request) {
  const owners = ownerSelection(actor, input.ownerScope);
  const selected = input.pipelineId;
  const visible = visiblePipelinePredicate(actor) ?? sql`false`;
  const pipelineVisible =
    selected === null
      ? sql`true`
      : sql`exists (
    select 1 from ${pipelines} where ${pipelines.id} = ${selected}::uuid
      and not ${pipelines.isArchived} and (${visible})
  )`;
  const pipelineFilter = selected === null ? sql`true` : sql`d.pipeline_id = ${selected}::uuid`;
  return {
    available: sql`(${owners.available}) and (${pipelineVisible})`,
    dealFilter: sql`d.currency = ${input.currency} and (${owners.filter}) and (${pipelineFilter})`,
    maxMatches: MAX_ANALYTICS_ATTENTION_MATCHES,
  };
}

function coherentPage(row: Envelope, input: Request): boolean {
  const expectedRows = Math.min(input.limit, Math.max(0, row.total - input.offset));
  if (row.overdue + row.missingNextStep !== row.total || row.items.length !== expectedRows)
    return false;
  const keys = new Set(
    row.items.map((item) =>
      item.rule === "overdue" ? `activity:${item.activityId}` : `deal:${item.dealId}`,
    ),
  );
  const overdue = row.items.filter(({ rule }) => rule === "overdue").length;
  return (
    keys.size === row.items.length &&
    overdue <= row.overdue &&
    row.items.length - overdue <= row.missingNextStep
  );
}

function project(row: Envelope, input: Request, timeZone: string): AnalyticsAttention {
  if (!row.scopeAvailable) return unavailable("scope-unavailable");
  if (row.limited !== row.total > MAX_ANALYTICS_ATTENTION_MATCHES)
    return unavailable("source-unavailable");
  if (row.limited) return unavailable("match-limit");
  if (!coherentPage(row, input)) return unavailable("source-unavailable");
  return {
    state: "available",
    definition: ANALYTICS_ATTENTION_DEFINITION,
    basis: "current-work",
    readId: randomUUID(),
    observedAt: row.observedAt,
    timeZone,
    scope: {
      currency: input.currency,
      pipeline: input.pipelineId === null ? "all-visible" : "selected",
      owner: input.ownerScope.kind,
    },
    total: row.total,
    counts: { overdueActivities: row.overdue, dealsWithoutNextStep: row.missingNextStep },
    page: {
      offset: input.offset,
      limit: input.limit,
      complete: input.offset === 0 && row.items.length === row.total,
      hasMore: input.offset + row.items.length < row.total,
      rows: row.items,
    },
  };
}

async function readScopedAttention(
  tx: Db,
  requestActor: PermSetUser,
  input: Request,
  signal: AbortSignal,
  fixtureAsOf?: string,
): Promise<AnalyticsAttention> {
  await tx.execute(sql`SET LOCAL search_path = pg_catalog, public, pg_temp`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
  await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
  const actor = await hydrateReportActor(tx, requestActor, signal);
  if (actor === null || !ownerPermitted(actor, input.ownerScope)) return { state: "permission" };
  const { timeZone } = await activityAccountPreferences(tx, actor.id);
  signal.throwIfAborted();
  const result = await tx.execute(
    nextActionDealReportSql(
      actor,
      { limit: input.limit, offset: input.offset },
      timeZone,
      dealReportScope(actor, input),
      fixtureAsOf,
    ),
  );
  signal.throwIfAborted();
  const parsed = resultSchema.safeParse(result.rows[0]);
  return parsed.success ? project(parsed.data, input, timeZone) : unavailable("source-unavailable");
}

/**
 * Internal reader for current deal-linked work. The authenticated caller supplies its
 * server actor. One bounded SQL read produces scoped counts and anchors under the same
 * snapshot, rules and clock. Do not stitch separate page reads into an export.
 */
export async function readAnalyticsAttention(
  db: Db,
  actor: PermSetUser,
  input: AnalyticsAttentionRequest,
  signal: AbortSignal,
  fixtureAsOf?: Date,
): Promise<AnalyticsAttention> {
  signal.throwIfAborted();
  if (!actor.isActive) return { state: "permission" };
  const parsed = analyticsAttentionInput.safeParse(input);
  if (!parsed.success) return unavailable("invalid-scope");
  if (!("$client" in db) || !(db.$client instanceof Pool)) return unavailable("source-unavailable");
  try {
    const observed = await db.transaction(
      (tx) => readScopedAttention(tx, actor, parsed.data, signal, fixtureAsOf?.toISOString()),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    signal.throwIfAborted();
    return observed;
  } catch {
    signal.throwIfAborted();
    return unavailable("source-unavailable");
  }
}
