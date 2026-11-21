import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { organizations } from "@/db/schema/organizations";
import { toVisibleRecord } from "@/features/contacts/orgsRepo";
import { directorySites } from "@/features/locations/schema";
import {
  operationsSiteCapabilities,
  readOperationsSiteGrants,
} from "@/features/operations-access/scope";
import { canSee } from "@/features/permissions/canSee";
import type { HydratedActor } from "@/server/hydrateActor";
import { canHoldInventory } from "../catalog/eligibility";
import { type CatalogItemPolicy, catalogItemPolicies } from "../catalog/policy";
import { inventoryPartProfiles } from "../catalog/schema";
import { inventoryItems } from "../schema";
import type { SourcingError, SourcingPart, SourcingSite } from "./contracts";

export class SourcingFailure extends Error {
  constructor(readonly code: SourcingError) {
    super(code);
  }
}

export function failSourcing(code: SourcingError): never {
  throw new SourcingFailure(code);
}

export async function lockSourcingRecords(
  tx: Db,
  siteId: string,
  itemId: string,
  mode: "read" | "write",
  signal: AbortSignal,
) {
  // Scope reads lock sourcing records before resolving CRM visibility, so a later
  // CRM permission change cannot expose a new offer or price in a mixed snapshot.
  const key = `${siteId}:${itemId}`;
  await tx.execute(
    mode === "read"
      ? sql`SELECT pg_advisory_xact_lock_shared(hashtext('warpdrive-inventory-sourcing'), hashtext(${key}))`
      : sql`SELECT pg_advisory_xact_lock(hashtext('warpdrive-inventory-sourcing'), hashtext(${key}))`,
  );
  signal.throwIfAborted();
}

export async function readSourcingSites(tx: Db, actor: HydratedActor): Promise<SourcingSite[]> {
  const admin = actor.type === "admin";
  const grants = admin ? [] : await readOperationsSiteGrants(tx, actor.id);
  const allowed = grants
    .filter(({ role }) => role === "buyer" || role === "cost_viewer")
    .map(({ siteId }) => siteId);
  const sites = await tx
    .select()
    .from(directorySites)
    .where(admin ? undefined : inArray(directorySites.id, allowed))
    .orderBy(asc(directorySites.code), asc(directorySites.id));
  return sites.map((site) => {
    const capabilities = operationsSiteCapabilities(grants, admin, site.id);
    return {
      ...site,
      canBuy: capabilities.canBuy && !site.archived,
      canViewCosts: capabilities.canViewCosts,
      canEditCosts: capabilities.canBuy && capabilities.canViewCosts && !site.archived,
    };
  });
}

export function canSourcePart(policy: CatalogItemPolicy) {
  return canHoldInventory(policy) && !policy.locked && policy.flags.purchasable;
}

export async function readSourcingParts(tx: Db, actor: HydratedActor): Promise<SourcingPart[]> {
  const policies = await catalogItemPolicies(tx);
  const rows = await tx
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      revision: inventoryItems.revision,
      unit: inventoryPartProfiles.unit,
    })
    .from(inventoryItems)
    .leftJoin(inventoryPartProfiles, eq(inventoryPartProfiles.itemId, inventoryItems.id));
  return rows
    .flatMap(({ id, name, revision, unit }) => {
      const policy = policies.get(id);
      if (policy === undefined || (actor.type !== "admin" && policy.visibility !== "staff")) {
        return [];
      }
      return [
        {
          id,
          name,
          revision,
          unit: unit ?? ("each" as const),
          code: policy.code,
          canSource: canSourcePart(policy),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.code.localeCompare(b.code) ||
        a.revision.localeCompare(b.revision) ||
        a.id.localeCompare(b.id),
    );
}

export async function requireVisibleSourcingOrganizations(
  tx: Db,
  actor: HydratedActor,
  ids: readonly string[],
) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  // CRM may change visibility or soft-delete an organization outside the sourcing fence.
  const rows = await tx
    .select()
    .from(organizations)
    .where(inArray(organizations.id, uniqueIds))
    .orderBy(asc(organizations.id))
    .for("share");
  if (
    rows.length !== uniqueIds.length ||
    rows.some((row) => row.deletedAt !== null || !canSee(actor, toVisibleRecord(row)))
  ) {
    failSourcing("unavailable");
  }
}
