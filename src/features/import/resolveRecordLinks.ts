import { and, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { deals, organizations, persons } from "@/db/schema";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { Result } from "@/types/result";
import { err, ok } from "@/types/result";
import type { ImportActor } from "./commit";
import type { RowError } from "./commitHelpers";
import { classifyMapping, type ImportContext, linkedRecordUnavailable } from "./externalIds";
import { liveVisibility } from "./recordVisibility";

export interface RecordLinkValues {
  dealPipedriveId?: string | undefined;
  personPipedriveId?: string | undefined;
  orgPipedriveId?: string | undefined;
  dealTitle?: string | undefined;
  personName?: string | undefined;
  orgName?: string | undefined;
}

export interface ResolvedRecordLinks {
  dealId: string | null;
  personId: string | null;
  orgId: string | null;
}

type NameTable = typeof deals | typeof persons | typeof organizations;

type LinkEntity = "deal" | "person" | "organization";

interface LinkSpec {
  entity: LinkEntity;
  plural: string;
  idKey: keyof RecordLinkValues;
  nameKey: keyof RecordLinkValues;
  matchByName: (value: string, signal: AbortSignal) => Promise<string[]>;
}

type LinkOutcome = Result<string | null, RowError[]>;

function present(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function unknownRecord(spec: LinkSpec, field: string, label: string): RowError[] {
  return [
    { field, message: `unknown Pipedrive ${spec.entity} ${label}: import ${spec.plural} first` },
  ];
}

async function resolveById(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  spec: LinkSpec,
  externalId: string,
  signal: AbortSignal,
): Promise<LinkOutcome> {
  const field = String(spec.idKey);
  const mapping = await classifyMapping(tx, actor, ctx.source, spec.entity, externalId, signal);
  if (mapping.state === "visible") return ok(mapping.localId);
  if (mapping.state === "invisible") return err(linkedRecordUnavailable(field));
  return err(unknownRecord(spec, field, externalId));
}

async function resolveByName(
  tx: DbOrTx,
  actor: ImportActor,
  spec: LinkSpec,
  name: string,
  signal: AbortSignal,
): Promise<LinkOutcome> {
  const field = String(spec.nameKey);
  const candidates = await spec.matchByName(name, signal);
  const visible = await liveVisibility(tx, actor, spec.entity, candidates, signal);
  const matches = candidates.filter((id) => visible.get(id) === true);
  if (matches.length === 0) return err(unknownRecord(spec, field, `"${name}"`));
  if (matches.length > 1) {
    return err([{ field, message: `ambiguous ${spec.entity}: ${name}` }]);
  }
  return ok(matches[0] ?? null);
}

function resolveOne(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  spec: LinkSpec,
  values: RecordLinkValues,
  signal: AbortSignal,
): Promise<LinkOutcome> {
  const externalId = present(values[spec.idKey]);
  if (externalId !== null) return resolveById(tx, actor, ctx, spec, externalId, signal);
  const name = present(values[spec.nameKey]);
  if (name !== null) return resolveByName(tx, actor, spec, name, signal);
  return Promise.resolve(ok(null));
}

async function matchByName(
  tx: DbOrTx,
  table: NameTable,
  nameColumn: PgColumn,
  value: string,
  signal: AbortSignal,
): Promise<string[]> {
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(sql`lower(${nameColumn}) = lower(${value})`, isNull(table.deletedAt)));
  signal.throwIfAborted();
  return rows.map((r) => r.id);
}

function specsFor(tx: DbOrTx): LinkSpec[] {
  return [
    {
      entity: "deal",
      plural: "deals",
      idKey: "dealPipedriveId",
      nameKey: "dealTitle",
      matchByName: (v, signal) => matchByName(tx, deals, deals.title, v, signal),
    },
    {
      entity: "person",
      plural: "people",
      idKey: "personPipedriveId",
      nameKey: "personName",
      matchByName: (v, signal) => matchByName(tx, persons, persons.name, v, signal),
    },
    {
      entity: "organization",
      plural: "organizations",
      idKey: "orgPipedriveId",
      nameKey: "orgName",
      matchByName: (v, signal) => matchByName(tx, organizations, organizations.name, v, signal),
    },
  ];
}

export async function resolveRecordLinks(
  tx: DbOrTx,
  actor: ImportActor,
  ctx: ImportContext,
  values: RecordLinkValues,
  signal: AbortSignal,
): Promise<Result<ResolvedRecordLinks, RowError[]>> {
  const [dealSpec, personSpec, orgSpec] = specsFor(tx) as [LinkSpec, LinkSpec, LinkSpec];
  const deal = await resolveOne(tx, actor, ctx, dealSpec, values, signal);
  const person = await resolveOne(tx, actor, ctx, personSpec, values, signal);
  const org = await resolveOne(tx, actor, ctx, orgSpec, values, signal);
  const errors = [deal, person, org].flatMap((r) => (r.ok ? [] : r.error));
  if (errors.length > 0) return err(errors);
  return ok({
    dealId: deal.ok ? deal.value : null,
    personId: person.ok ? person.value : null,
    orgId: org.ok ? org.value : null,
  });
}
