import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { assert, expect, test } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  canonicalFolder,
  freshMigrationDb,
  installPrefix,
  ledger,
} from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { deals, organizations, pipelines, stages } from "@/db/schema";
import { agencyProjectSettings } from "@/features/agency-projects/schema/agencyProjectSettings";
import type { NativeSessionRef } from "@/features/auth/currentNativeActor";
import { listDeals } from "@/features/deals/dealRepo";
import { directorySites } from "@/features/locations/schema";
import { createInternalProject, readInternalProject } from "@/features/projects/service";
import { makeTestDb, type TestDb } from "@/test/db";
import { inventoryPartProfiles } from "../catalog/schema";
import { readCatalogWorkspace } from "../catalog/service";
import { readInventoryWorkspace } from "../reads";
import { runInventoryCommand } from "../service";
import { incumbentRows, signal } from "../warehouse/operations/structures.test-helpers";
import { readWarehouseWorkspace } from "../warehouse/service";
import { calculateStockUnits, chooseSourcingTier } from "./contracts";
import { inventorySupplierPriceTiers } from "./schema";
import {
  createSourcingActor,
  seedSourcing,
  setRole,
  sourceCommand,
  sourcing,
} from "./sourcing.test-helpers";

const unavailable = { ok: false, error: "unavailable" };

type Fixture = Awaited<ReturnType<typeof seedSourcing>>;

function scopeFor(f: Fixture) {
  return { siteId: f.source.siteId, itemId: f.child.itemId };
}

async function workspace(h: TestDb, who: NativeSessionRef, scope: ReturnType<typeof scopeFor>) {
  const result = await sourcing(h, who, scope);
  assert(result.ok);
  return result.value;
}

async function manufacturerPart(h: TestDb, f: Fixture, who: NativeSessionRef, scope = scopeFor(f)) {
  expect(
    await sourceCommand(h, who, scope, {
      type: "saveManufacturer",
      id: null,
      expectedVersion: null,
      organizationId: f.manufacturer,
      partNumber: "IA-DRV-750",
    }),
  ).toEqual({ ok: true });
  const [manufacturer] = (await workspace(h, who, scope)).manufacturers;
  assert(manufacturer !== undefined);
  return manufacturer;
}

function newOffer(
  supplierOrganizationId: string,
  manufacturerPartId: string | null,
  partNumber: string,
) {
  return {
    type: "saveOffer",
    id: null,
    expectedVersion: null,
    supplierOrganizationId,
    manufacturerPartId,
    partNumber,
    packQuantity: 25,
    approved: true,
    available: true,
  } as const;
}

async function firstOffer(h: TestDb, f: Fixture, who: NativeSessionRef) {
  const scope = scopeFor(f);
  const manufacturer = await manufacturerPart(h, f, who, scope);
  const command = newOffer(f.firstSupplier, manufacturer.id, "DIST-IA-750");
  expect(await sourceCommand(h, who, scope, command)).toEqual({ ok: true });
  const [offer] = (await workspace(h, who, scope)).offers;
  assert(offer !== undefined);
  return { offer, command, manufacturer };
}

test("links two suppliers to one manufacturer part and keeps offer identity through deactivation and approval", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const scope = scopeFor(f);
    const buyer = await createSourcingActor(h, f.admin, "Buyer", scope.siteId, "buyer");
    const { offer: original, command, manufacturer } = await firstOffer(h, f, buyer);
    const alternative = {
      ...newOffer(f.secondSupplier, manufacturer.id, "BACKUP-IA-750"),
      approved: false,
    };
    const alternativeRequest = { ...alternative, requestId: randomUUID() };
    expect(await sourceCommand(h, buyer, scope, alternativeRequest)).toEqual({ ok: true });
    expect(await sourceCommand(h, buyer, scope, alternativeRequest)).toEqual({ ok: true });
    expect(
      await sourceCommand(h, buyer, scope, { ...alternativeRequest, packQuantity: 26 }),
    ).toEqual({ ok: false, error: "conflict" });

    const before = await workspace(h, buyer, scope);
    expect(before.manufacturers).toMatchObject([
      { id: manufacturer.id, organizationId: f.manufacturer, partNumber: "IA-DRV-750" },
    ]);
    expect(before.offers).toHaveLength(2);
    expect(before.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: original.id,
          supplierOrganizationId: f.firstSupplier,
          manufacturerPartId: manufacturer.id,
          packQuantity: 25,
          stockUnit: "each",
          approved: true,
          available: true,
        }),
        expect.objectContaining({
          supplierOrganizationId: f.secondSupplier,
          manufacturerPartId: manufacturer.id,
          packQuantity: 25,
          approved: false,
          available: true,
        }),
      ]),
    );
    const backup = before.offers.find(
      ({ supplierOrganizationId }) => supplierOrganizationId === f.secondSupplier,
    );
    assert(backup !== undefined);
    expect(calculateStockUnits(3, original.packQuantity)).toBe(75);
    expect(calculateStockUnits(0, original.packQuantity)).toBeNull();
    expect(calculateStockUnits(1_000_000, 1_000_000)).toBeNull();

    const disable = {
      ...command,
      id: original.id,
      expectedVersion: original.version,
      available: false,
    };
    expect(await sourceCommand(h, buyer, scope, disable)).toEqual({ ok: true });
    expect(await sourceCommand(h, buyer, scope, { ...disable, available: true })).toEqual({
      ok: false,
      error: "stale",
    });
    expect(
      await sourceCommand(h, buyer, scope, {
        ...alternative,
        id: backup.id,
        expectedVersion: backup.version,
        approved: true,
      }),
    ).toEqual({ ok: true });
    const changed = await workspace(h, buyer, scope);
    expect(changed.offers).toHaveLength(2);
    expect(changed.offers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: original.id,
          available: false,
          version: original.version + 1,
        }),
        expect.objectContaining({ id: backup.id, approved: true, available: true }),
      ]),
    );

    expect(
      await sourceCommand(h, buyer, scope, {
        ...disable,
        expectedVersion: original.version + 1,
        available: true,
      }),
    ).toEqual({ ok: true });
    expect(
      (await workspace(h, buyer, scope)).offers.find(({ id }) => id === original.id),
    ).toMatchObject({
      available: true,
      version: original.version + 2,
    });

    await h.db
      .update(directorySites)
      .set({ archived: true })
      .where(eq(directorySites.id, scope.siteId));
    const archived = await workspace(h, buyer, scope);
    expect(archived.sites).toMatchObject([{ id: scope.siteId, archived: true, canBuy: false }]);
    expect(archived.offers).toHaveLength(2);
    expect(
      await sourceCommand(h, buyer, scope, { ...disable, expectedVersion: original.version + 2 }),
    ).toEqual(unavailable);
  } finally {
    await h.close();
  }
});

test("scopes monetary data and price mutations separately and rechecks access on replay", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const scope = scopeFor(f);
    const buyer = await createSourcingActor(
      h,
      f.admin,
      "Buyer and remote cost reviewer",
      scope.siteId,
      "buyer",
    );
    await setRole(h, f.admin, buyer, f.remote.siteId, "cost_viewer");
    const reviewer = await createSourcingActor(
      h,
      f.admin,
      "Cost reviewer",
      scope.siteId,
      "cost_viewer",
    );
    const priceEditor = await createSourcingActor(
      h,
      f.admin,
      "Buyer who can edit prices",
      scope.siteId,
      "buyer",
      "cost_viewer",
    );
    const warehouse = await createSourcingActor(
      h,
      f.admin,
      "Warehouse manager",
      scope.siteId,
      "warehouse_manager",
    );
    const { offer, command } = await firstOffer(h, f, buyer);
    const firstTier = {
      type: "setPriceTier",
      offerId: offer.id,
      minPacks: 1,
      currency: "EUR",
      amount: "112.1234",
      requestId: randomUUID(),
    };
    const volumeTier = { ...firstTier, minPacks: 3, amount: "104.9876", requestId: randomUUID() };
    const swissTier = {
      ...volumeTier,
      currency: "CHF",
      amount: "91.2345",
      requestId: randomUUID(),
    };
    const override = { type: "setCostOverride", cost: { currency: "EUR", amount: "7.6543" } };

    expect(await sourceCommand(h, buyer, scope, firstTier)).toEqual(unavailable);
    expect(await sourceCommand(h, reviewer, scope, firstTier)).toEqual(unavailable);
    expect(await sourceCommand(h, warehouse, scope, firstTier)).toEqual(unavailable);
    expect(
      await sourceCommand(h, reviewer, scope, { ...command, partNumber: "REVIEWER-EDIT" }),
    ).toEqual(unavailable);
    expect(await sourceCommand(h, buyer, { ...scope, siteId: f.remote.siteId }, firstTier)).toEqual(
      unavailable,
    );
    expect(await sourcing(h, warehouse, scope)).toEqual(unavailable);
    expect(await readWarehouseWorkspace(h.db, warehouse, {}, signal())).toMatchObject({
      ok: true,
      value: {
        positions: expect.arrayContaining([
          expect.objectContaining({ id: f.lot.positionId, onHand: 10, reserved: 4 }),
        ]),
      },
    });

    for (const tier of [firstTier, volumeTier, volumeTier, swissTier]) {
      expect(await sourceCommand(h, priceEditor, scope, tier)).toEqual({ ok: true });
    }
    expect(await sourceCommand(h, priceEditor, scope, override)).toEqual({ ok: true });

    const visible = await workspace(h, reviewer, scope);
    assert(visible.pricing !== undefined);
    expect(visible.pricing.tiers).toHaveLength(3);
    expect(visible.pricing.override).toEqual(override.cost);
    expect(chooseSourcingTier(visible.pricing.tiers, offer.id, "EUR", 2)).toMatchObject({
      amount: "112.1234",
      currency: "EUR",
      minPacks: 1,
    });
    expect(chooseSourcingTier(visible.pricing.tiers, offer.id, "EUR", 3)).toMatchObject({
      amount: "104.9876",
      currency: "EUR",
      minPacks: 3,
    });
    expect(chooseSourcingTier(visible.pricing.tiers, offer.id, "CHF", 3)).toMatchObject({
      amount: "91.2345",
      currency: "CHF",
      minPacks: 3,
    });
    expect(chooseSourcingTier(visible.pricing.tiers, offer.id, "USD", 3)).toBeNull();

    const redacted = await workspace(h, buyer, scope);
    expect(redacted).not.toHaveProperty("pricing");
    for (const confidential of ["112.1234", "104.9876", "91.2345", "7.6543", '"EUR"', '"CHF"']) {
      expect(JSON.stringify(redacted)).not.toContain(confidential);
    }
    expect(
      (await workspace(h, buyer, { ...scope, siteId: f.remote.siteId })).pricing?.tiers,
    ).toEqual([]);

    const stockedBeforePackChange = await incumbentRows(h);
    const priceTiers = inventorySupplierPriceTiers;
    const storedTiers = () =>
      h.db
        .select()
        .from(priceTiers)
        .where(eq(priceTiers.offerId, offer.id))
        .orderBy(asc(priceTiers.currency), asc(priceTiers.minPacks));
    const pricesBeforePackChange = await storedTiers();
    expect(pricesBeforePackChange).toHaveLength(3);
    const changePack = { ...command, id: offer.id, expectedVersion: offer.version };
    expect(await sourceCommand(h, buyer, scope, { ...changePack, packQuantity: 50 })).toEqual({
      ok: true,
    });

    const revisedQuote = await workspace(h, reviewer, scope);
    const [resized] = revisedQuote.offers;
    assert(resized !== undefined);
    expect(resized).toMatchObject({ id: offer.id, packQuantity: 50 });
    expect(revisedQuote.pricing).toEqual({ tiers: [], override: override.cost });
    expect(await storedTiers()).toEqual(pricesBeforePackChange);

    expect(
      await sourceCommand(h, buyer, scope, { ...changePack, expectedVersion: resized.version }),
    ).toEqual({ ok: true });
    const restoredQuote = await workspace(h, reviewer, scope);
    const [restoredOffer] = restoredQuote.offers;
    assert(restoredOffer !== undefined);
    expect(restoredOffer).toMatchObject({ id: offer.id, packQuantity: 25 });
    expect(restoredQuote.manufacturers).toEqual(visible.manufacturers);
    expect(restoredQuote.pricing).toEqual(visible.pricing);
    expect(await storedTiers()).toEqual(pricesBeforePackChange);
    expect(await incumbentRows(h)).toEqual(stockedBeforePackChange);

    expect(
      await sourceCommand(h, buyer, scope, {
        ...command,
        id: offer.id,
        expectedVersion: restoredOffer.version,
        available: false,
      }),
    ).toEqual({ ok: true });
    expect((await workspace(h, reviewer, scope)).pricing).toEqual(visible.pricing);

    await setRole(h, f.admin, priceEditor, scope.siteId, "cost_viewer", false);
    expect(await sourceCommand(h, priceEditor, scope, volumeTier)).toEqual(unavailable);
    expect(
      await sourceCommand(h, priceEditor, scope, { ...volumeTier, amount: "12.2222" }),
    ).toEqual(unavailable);
    expect(await workspace(h, priceEditor, scope)).not.toHaveProperty("pricing");
    expect((await workspace(h, reviewer, scope)).pricing).toEqual(visible.pricing);
  } finally {
    await h.close();
  }
});

test("keeps organization and part scope current and preserves legacy Inventory, CRM and Projects projections", async () => {
  const h = await makeTestDb();
  try {
    const f = await seedSourcing(h);
    const scope = scopeFor(f);
    const buyer = await createSourcingActor(
      h,
      f.admin,
      "Buyer with costs",
      scope.siteId,
      "buyer",
      "cost_viewer",
    );
    const { offer, manufacturer } = await firstOffer(h, f, buyer);
    const inaccessible = newOffer(randomUUID(), manufacturer.id, "UNAVAILABLE-OFFER");
    const denial = await sourceCommand(h, buyer, scope, inaccessible);
    expect(denial.ok).toBe(false);
    for (const supplierOrganizationId of [f.privateSupplier, f.deletedSupplier]) {
      expect(
        await sourceCommand(h, buyer, scope, { ...inaccessible, supplierOrganizationId }),
      ).toEqual(denial);
    }

    const otherScope = { ...scope, siteId: f.remote.siteId };
    const remoteManufacturer = await manufacturerPart(h, f, f.admin, otherScope);
    expect(
      await sourceCommand(h, buyer, scope, {
        ...inaccessible,
        supplierOrganizationId: f.secondSupplier,
        manufacturerPartId: remoteManufacturer.id,
      }),
    ).toMatchObject({ ok: false });
    expect(await sourcing(h, buyer, otherScope)).toEqual(unavailable);

    const [pipeline] = await h.db
      .insert(pipelines)
      .values({ name: "Instrument inquiries" })
      .returning();
    assert(pipeline !== undefined);
    const [stage] = await h.db
      .insert(stages)
      .values({ pipelineId: pipeline.id, name: "Quote" })
      .returning();
    assert(stage !== undefined);
    const [deal] = await h.db
      .insert(deals)
      .values({
        title: "Visible instrumentation inquiry",
        ownerId: buyer.userId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        visibilityLevel: "owner",
        orgId: f.firstSupplier,
      })
      .returning();
    assert(deal !== undefined);
    await h.db
      .insert(agencyProjectSettings)
      .values({ id: true, enabled: true })
      .onConflictDoUpdate({
        target: agencyProjectSettings.id,
        set: { enabled: true },
      });
    const project = await createInternalProject(
      h.db,
      f.admin,
      { id: randomUUID(), title: "Private drawing project" },
      signal(),
    );
    assert(project.ok);

    const legacyProjections = async () => ({
      catalog: await readCatalogWorkspace(h.db, buyer, {}, signal()),
      warehouse: await readWarehouseWorkspace(h.db, buyer, {}, signal()),
      inventory: await readInventoryWorkspace(h.db, buyer, null, signal()),
      crm: await listDeals(
        h.db,
        {
          userId: buyer.userId,
          isAdmin: false,
          isActive: true,
          sessionLive: true,
          visibilityGroupIds: [],
        },
        { pipelineId: pipeline.id, limit: 5, offset: 0 },
        signal(),
      ),
      deal: await readInventoryWorkspace(h.db, buyer, deal.id, signal()),
      ownerProject: await readInternalProject(h.db, f.admin, project.value.id, signal()),
      buyerProject: await readInternalProject(h.db, buyer, project.value.id, signal()),
    });
    const before = await legacyProjections();
    expect(before.crm.rows).toMatchObject([{ id: deal.id }]);
    expect(before.deal).toMatchObject({ ok: true, value: { deal: { id: deal.id } } });
    expect(before.ownerProject.ok).toBe(true);
    expect(before.buyerProject).toEqual({ ok: false, error: "project_unavailable" });
    expect(
      await sourceCommand(h, buyer, scope, {
        type: "setPriceTier",
        offerId: offer.id,
        currency: "CHF",
        minPacks: 3,
        amount: "654321.9876",
      }),
    ).toEqual({ ok: true });
    expect(await legacyProjections()).toEqual(before);

    // CRM writers may change visibility without going through Inventory.
    await h.db
      .update(organizations)
      .set({ visibilityLevel: "owner" })
      .where(eq(organizations.id, f.firstSupplier));
    const hidden = await workspace(h, buyer, scope);
    expect(hidden.organizations.map(({ id }) => id)).not.toContain(f.firstSupplier);
    expect(hidden.offers).toEqual([]);
    expect(hidden.pricing?.tiers).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain("654321.9876");
    expect((await workspace(h, f.admin, scope)).offers).toMatchObject([{ id: offer.id }]);

    await h.db
      .update(inventoryPartProfiles)
      .set({ visibility: "admin" })
      .where(eq(inventoryPartProfiles.itemId, scope.itemId));
    expect(await sourcing(h, buyer, scope)).toEqual(unavailable);
    expect((await workspace(h, f.admin, scope)).offers).toMatchObject([{ id: offer.id }]);
  } finally {
    await h.close();
  }
});

test("upgrades populated 0134 stock and reservations while retaining existing site grants", async () => {
  const h = await freshMigrationDb();
  try {
    await installPrefix(h, 135);
    const f = await seedSourcing(h);
    const scope = scopeFor(f);
    const buyer = await createSourcingActor(h, f.admin, "Incumbent buyer", scope.siteId, "buyer");
    const before = await incumbentRows(h);
    const previous = await ledger(h);
    expect(previous).toHaveLength(135);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    const migrations = await readCanonicalMigrations(canonicalFolder, signal());
    assert(migrations.ok);
    const after = await ledger(h);
    expect(after).toHaveLength(migrations.value.length);
    expect(migrations.value[135]?.tag).toMatch(/^0135_/);
    expect(after[135]?.hash).toBe(migrations.value[135]?.hash);
    expect(after.slice(0, 135)).toEqual(previous);
    expect(await incumbentRows(h)).toEqual(before);
    expect((await applyMigrations(h.db, signal(), canonicalFolder)).ok).toBe(true);
    expect(await ledger(h)).toEqual(after);

    await firstOffer(h, f, buyer);
    expect(await incumbentRows(h)).toEqual(before);
    expect(
      await runInventoryCommand(
        h.db,
        f.admin,
        { type: "ship", requestId: randomUUID(), orderId: f.orderId, revision: 1 },
        null,
        signal(),
      ),
    ).toMatchObject({ ok: true });
  } finally {
    await h.close();
  }
});
