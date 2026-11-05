import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { auditEvents, settings } from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { companyDetailsSchema, companyOverviewSchema, legalEntitySchema } from "./contracts";
import { getCompanyMemberProjection } from "./repository";
import { companyLegalEntities, companyOperations, companyProfiles } from "./schema";
import { CompanyService } from "./service";

let h: TestDb;
let actor: PermSetUser;
const signal = () => AbortSignal.timeout(10000);
beforeEach(async () => {
  h = await makeTestDb();
  const u = await seedUser(h.db, { isAdmin: true });
  actor = { id: u.id, isActive: true, type: "admin", flags: new Set(), groupIds: new Set() };
});
afterEach(async () => h.close());
const run = <T>(fn: (service: CompanyService) => Promise<T>) =>
  withCurrentAuthority(h.db, "read", signal(), (tx) => fn(new CompanyService(tx, signal())));
const details = (name = "Studio") => companyDetailsSchema.parse({ companyName: name });
const saveDetails = (name = "Studio", revision = 0, requestId = randomUUID()) => ({
  action: "save_details" as const,
  requestId,
  expectedRevision: revision,
  details: details(name),
});

it("persists optional profile, atomically mirrors name and never mutates base currency", async () => {
  await h.db.insert(settings).values({ id: true, companyName: "Before", baseCurrency: "EUR" });
  const command = saveDetails();
  const saved = await run((s) => s.execute(actor, command));
  expect(saved.ok).toBe(true);
  if (!saved.ok) return;
  expect(companyOverviewSchema.parse(saved.value)).toMatchObject({
    detailsRevision: 1,
    baseCurrency: "EUR",
    details: { companyName: "Studio", intendedTeamSize: null },
  });
  const [setting] = await h.db.select().from(settings);
  expect(setting).toMatchObject({ companyName: "Studio", baseCurrency: "EUR" });
  const [stored] = await h.db.select().from(companyProfiles);
  expect(stored?.detailsCiphertext).not.toContain("Studio");
  const replay = await run((s) => s.execute(actor, command));
  expect(replay.ok).toBe(true);
  expect(await h.db.select().from(companyOperations)).toHaveLength(1);
  expect(
    await h.db.select().from(auditEvents).where(eq(auditEvents.action, "company.save_details")),
  ).toHaveLength(1);
  expect(
    await run((s) => s.execute(actor, { ...command, details: details("Mutated") })),
  ).toMatchObject({ ok: false, error: { code: "replay_conflict" } });
});

it("rejects stale sibling writes while independent branding remains editable", async () => {
  expect((await run((s) => s.execute(actor, saveDetails()))).ok).toBe(true);
  expect(await run((s) => s.execute(actor, saveDetails("Lost", 0)))).toMatchObject({
    ok: false,
    error: { code: "conflict" },
  });
  expect(
    (
      await run((s) =>
        s.execute(actor, {
          action: "save_branding",
          requestId: randomUUID(),
          expectedRevision: 0,
          branding: {
            iconAssetId: null,
            logoAssetId: null,
            accentColor: "#000000",
            fit: "contain",
          },
        }),
      )
    ).ok,
  ).toBe(true);
  const overview = await run((s) => s.overview(actor));
  expect(overview).toMatchObject({
    ok: true,
    value: {
      detailsRevision: 1,
      brandingRevision: 1,
      details: { companyName: "Studio" },
      branding: { foregroundColor: "#ffffff" },
    },
  });
});

it("keeps legal data private, partial readiness honest, and payer refs explicit", async () => {
  const result = await run((s) =>
    s.execute(actor, {
      action: "save_legal_entity",
      requestId: randomUUID(),
      expectedRevision: 0,
      id: null,
      data: {
        legalName: "Private Legal GmbH",
        country: "DE",
        issuerDefaults: { iban: "DE89370400440532013000" },
      },
    }),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const legal = legalEntitySchema.parse(result.value);
  expect(legal.readiness.status).toBe("incomplete");
  expect(legal.provenance.verification).toBe("self_reported");
  const [row] = await h.db.select().from(companyLegalEntities);
  expect(row?.dataCiphertext).not.toContain("Private Legal");
  expect(JSON.stringify(await getCompanyMemberProjection(h.db, signal()))).not.toContain("DE8937");
  const regular = {
    ...actor,
    type: "regular" as const,
    flags: new Set(["company.profile.manage"] as const),
  };
  const overview = await run((s) => s.overview(regular));
  expect(overview).toMatchObject({
    ok: true,
    value: { legalEntities: [], payerPreferences: null, payerRevision: null },
  });
  expect(
    await run((s) =>
      s.execute(regular, {
        action: "save_legal_entity",
        requestId: randomUUID(),
        expectedRevision: 0,
        id: null,
        data: { legalName: "Denied", country: "DE" },
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect(
    (
      await run((s) =>
        s.execute(actor, {
          action: "save_payer_preferences",
          requestId: randomUUID(),
          expectedRevision: 0,
          preferences: { payerLegalEntityId: legal.id },
        }),
      )
    ).ok,
  ).toBe(true);
  expect(
    await run((s) =>
      s.execute(actor, {
        action: "archive_legal_entity",
        requestId: randomUUID(),
        expectedRevision: 1,
        id: legal.id,
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: "conflict" } });
  expect(JSON.stringify(await h.db.select().from(auditEvents))).not.toContain("DE8937");
});

it("records scoped trusted provenance and resets it after manual editing", async () => {
  const command = saveDetails();
  await run((s) =>
    s.execute(actor, command, {
      kind: "registry",
      provider: "GLEIF",
      checkedAt: new Date().toISOString(),
      checkedFields: ["companyName"],
      verification: "provider_checked",
    }),
  );
  const saved = await run((s) => s.overview(actor));
  expect(saved).toMatchObject({
    ok: true,
    value: { provenance: { verification: "provider_checked", checkedFields: ["companyName"] } },
  });
  await run((s) => s.execute(actor, saveDetails("Manual", 1)));
  expect(await run((s) => s.overview(actor))).toMatchObject({
    ok: true,
    value: { provenance: { verification: "self_reported", checkedFields: [] } },
  });
});

it("rolls back mirrored settings, private profile and receipt when audit fails", async () => {
  await h.db.insert(settings).values({ id: true, companyName: "Original", baseCurrency: "EUR" });
  await h.db.execute(
    sql`ALTER TABLE audit_events ADD CONSTRAINT company_test_reject_audit CHECK (action NOT LIKE 'company.%') NOT VALID`,
  );
  expect(await run((s) => s.execute(actor, saveDetails("Must rollback")))).toMatchObject({
    ok: false,
    error: { code: "write_failed" },
  });
  const [row] = await h.db.select().from(settings);
  expect(row?.companyName).toBe("Original");
  expect(await h.db.select().from(companyProfiles)).toHaveLength(0);
  expect(await h.db.select().from(companyOperations)).toHaveLength(0);
});

it("limits receipt recovery to original actor and rechecks live permissions", async () => {
  const command = saveDetails();
  await run((s) => s.execute(actor, command));
  const other = { ...actor, id: randomUUID() };
  expect(await run((s) => s.operation(other, command.requestId))).toMatchObject({
    ok: false,
    error: { code: "not_found" },
  });
  expect(
    await run((s) =>
      s.operation({ ...actor, type: "regular", flags: new Set() }, command.requestId),
    ),
  ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  expect((await run((s) => s.operation(actor, command.requestId))).ok).toBe(true);
});

it("tombstones unknown original UUIDs and returns completed ACK without undoing committed work", async () => {
  const original = saveDetails();
  const canceled = await run((s) =>
    s.execute(actor, {
      action: "cancel_operation",
      requestId: randomUUID(),
      operationId: original.requestId,
      operationAction: "save_details",
    }),
  );
  expect(canceled).toMatchObject({
    ok: true,
    value: { operationId: original.requestId, status: "canceled" },
  });
  expect(await run((s) => s.execute(actor, original))).toMatchObject({
    ok: false,
    error: { code: "replay_conflict" },
  });
  const actual = saveDetails("Committed");
  expect((await run((s) => s.execute(actor, actual))).ok).toBe(true);
  expect(
    await run((s) =>
      s.execute(actor, {
        action: "cancel_operation",
        requestId: randomUUID(),
        operationId: actual.requestId,
        operationAction: "save_details",
      }),
    ),
  ).toMatchObject({
    ok: true,
    value: { status: "completed", result: { details: { companyName: "Committed" } } },
  });
  expect(
    await run((s) =>
      s.execute(
        { ...actor, id: randomUUID() },
        {
          action: "cancel_operation",
          requestId: randomUUID(),
          operationId: actual.requestId,
          operationAction: "save_details",
        },
      ),
    ),
  ).toMatchObject({ ok: false, error: { code: "not_found" } });
});

it("redacts completed profile-cancellation receipts when the original actor loses legal access", async () => {
  const legal = await run((s) =>
    s.execute(actor, {
      action: "save_legal_entity",
      requestId: randomUUID(),
      expectedRevision: 0,
      id: null,
      data: { legalName: "Private scope fixture", country: "DE" },
    }),
  );
  expect(legal.ok).toBe(true);
  const original = saveDetails();
  expect((await run((s) => s.execute(actor, original))).ok).toBe(true);
  const cancel = {
    action: "cancel_operation",
    requestId: randomUUID(),
    operationId: original.requestId,
    operationAction: "save_details",
  };
  expect(await run((s) => s.execute(actor, cancel))).toMatchObject({
    ok: true,
    value: {
      status: "completed",
      result: { legalEntities: [{ data: { legalName: "Private scope fixture" } }] },
    },
  });
  const profileOnly = {
    ...actor,
    type: "regular" as const,
    flags: new Set(["company.profile.manage"] as const),
  };
  const result = await run((s) => s.operation(profileOnly, cancel.requestId));
  expect(result).toMatchObject({
    ok: true,
    value: { status: "completed", result: { legalEntities: [], payerPreferences: null } },
  });
});
