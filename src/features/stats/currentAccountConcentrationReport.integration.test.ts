import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { deals, organizationRelations, organizations, persons } from "@/db/schema";
import { type SeededPipeline, seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { readCurrentAccountConcentrationReport } from "./currentAccountConcentrationReport";
import { dealPerformance } from "./dealPerformance";

const signal = () => AbortSignal.timeout(15_000);
const from = "2026-05-01";
const firstInstant = new Date("2026-04-30T22:00:00Z");
const outsideInstant = new Date("2026-05-01T22:00:00Z");
const scope = {
  from,
  to: from,
  currency: "EUR",
  pipelineId: null,
  ownerScope: { kind: "all" },
  timeZoneIdentity: "America/Los_Angeles",
} as const;

function stageFields(seed: SeededPipeline) {
  const stage = seed.stages[0];
  if (stage === undefined) throw new Error("Expected a fixture stage");
  return { pipelineId: seed.pipeline.id, stageId: stage.id };
}

async function fixture(h: TestDb) {
  const permissionSetId = randomUUID();
  await h.pool.query(
    `INSERT INTO public.permission_sets(id,name,flags)
     VALUES($1,'Account fixture','{"stats.viewOthers":true}'::jsonb)`,
    [permissionSetId],
  );
  const owner = await seedUser(h.db, { permissionSetId });
  const other = await seedUser(h.db);
  const sessionId = randomUUID();
  await h.pool.query(
    `INSERT INTO public.sessions(id,token_hash,user_id,expires_at,auth_method,assurance)
     VALUES($1,$2,$3,pg_catalog.clock_timestamp() + interval '1 hour','legacy','legacy')`,
    [sessionId, `account-fixture-${sessionId}`, owner.id],
  );
  await setPreferences(
    h.db,
    owner.id,
    {
      timezone: "Europe/Berlin",
      ui: {
        localePreferences: {
          locale: "en",
          calendar: "gregory",
          timeZone: "Europe/Berlin",
          timeZoneMode: "manual",
        },
      },
    },
    signal(),
  );
  const actor = await hydrateActor(h.db, owner.id, signal());
  if (actor === null) throw new Error("Expected an active fixture actor");
  const principal = { actor, session: { userId: owner.id, sessionId } };
  const pipeline = await seedPipelineWithStages(h.db, ["Negotiation"]);

  async function org(overrides: Partial<typeof organizations.$inferInsert> = {}) {
    const id = randomUUID();
    await h.db.insert(organizations).values({
      name: "Private account label",
      ownerId: owner.id,
      visibilityLevel: "owner",
      ...overrides,
      id,
    });
    return id;
  }
  async function win(
    orgId: string | null,
    value: string | null,
    overrides: Partial<typeof deals.$inferInsert> = {},
  ) {
    const id = randomUUID();
    await h.db.insert(deals).values({
      title: "Private deal title",
      ownerId: owner.id,
      visibilityLevel: "owner",
      ...stageFields(pipeline),
      status: "won",
      wonTime: firstInstant,
      createdAt: new Date("2026-04-01T10:00:00Z"),
      currency: "EUR",
      orgId,
      value,
      ...overrides,
      id,
    });
    return id;
  }
  return { principal, owner, other, permissionSetId, org, win };
}

test("reconciles exact signed nominal wins per direct organization without related-account rollup", async () => {
  const h = await makeTestDb();
  try {
    const f = await fixture(h);
    const largest = await f.org();
    const child = await f.org();
    await h.db.insert(organizationRelations).values({
      sourceOrgId: largest,
      targetOrgId: child,
      relationType: "parent",
    });
    const firstPerson = randomUUID();
    const secondPerson = randomUUID();
    await h.db.insert(persons).values([
      {
        id: firstPerson,
        name: "Private contact",
        orgId: child,
        ownerId: f.owner.id,
        visibilityLevel: "owner",
      },
      {
        id: secondPerson,
        name: "Private contact",
        orgId: largest,
        ownerId: f.owner.id,
        visibilityLevel: "owner",
      },
    ]);
    const firstDeal = await f.win(largest, "100.0001", { personId: firstPerson });
    await f.win(largest, "-0.0002", { personId: secondPerson });
    await f.win(child, "20");
    for (const amount of ["10", "5", "4", "3", "0", "-2"]) await f.win(await f.org(), amount);

    const group = randomUUID();
    await h.pool.query("INSERT INTO public.visibility_groups(id,name) VALUES($1,'Restricted')", [
      group,
    ]);
    const restricted = await seedPipelineWithStages(h.db, ["Restricted"], {
      visibilityGroupId: group,
    });
    await f.win(largest, "777", stageFields(restricted));
    await f.win(largest, "777", { ownerId: f.other.id });
    await f.win(largest, "777", { archivedAt: firstInstant });
    await f.win(largest, "777", { deletedAt: firstInstant });
    await f.win(largest, "777", { wonTime: outsideInstant });
    await f.win(largest, "777", { currency: "USD" });
    await f.win(largest, "777", { status: "open", wonTime: null });
    const canonical = await dealPerformance(
      h.db,
      f.principal.actor,
      {
        ...scope,
        owners: { everyone: true },
        timeZone: "Europe/Berlin",
      },
      signal(),
    );
    expect(canonical.won).toEqual({ count: 9, value: "139.9999" });

    const report = await readCurrentAccountConcentrationReport(h.db, f.principal, scope, signal());
    expect(report).toEqual({
      state: "available",
      definition: "current-linked-organization-won-nominal-v1",
      currency: "EUR",
      from,
      to: from,
      timeZone: "Europe/Berlin",
      effectiveOwnerScope: "all",
      coverage: {
        eligibleWonDeals: 9,
        linkedWonDeals: 9,
        unresolvedWonDeals: 0,
        linkedOrganizations: 8,
        multiWonLinkedOrganizations: 1,
        linkedWonDealsWithValue: 9,
        linkedWonDealsWithoutValue: 0,
      },
      linkedKnownNominalNet: "139.9999",
      concentration: {
        state: "available",
        positiveNetOrganizations: 6,
        zeroNetOrganizations: 1,
        negativeNetOrganizations: 1,
        positiveNetDenominator: "141.9999",
        largestNetNumerator: "99.9999",
        topFiveNetNumerator: "138.9999",
      },
    });
    for (const withheld of [
      largest,
      child,
      firstDeal,
      firstPerson,
      "Private deal title",
      "Private account label",
    ])
      expect(JSON.stringify(report)).not.toContain(withheld);
    expect(
      await readCurrentAccountConcentrationReport(
        h.db,
        f.principal,
        { ...scope, pipelineId: restricted.pipeline.id },
        signal(),
      ),
    ).toEqual({ state: "scope-unavailable" });
  } finally {
    await h.close();
  }
});

test("withholds concentration for unknown organization or value and rechecks live authority", async () => {
  const h = await makeTestDb();
  try {
    const f = await fixture(h);
    const group = randomUUID();
    await h.pool.query("INSERT INTO public.visibility_groups(id,name) VALUES($1,'Account group')", [
      group,
    ]);
    await h.pool.query(
      "INSERT INTO public.visibility_group_members(group_id,user_id) VALUES($1,$2)",
      [group, f.owner.id],
    );
    const actor = await hydrateActor(h.db, f.owner.id, signal());
    if (actor === null) throw new Error("Expected an active group member");
    const principal = { ...f.principal, actor };
    const visible = await f.org({
      ownerId: f.other.id,
      visibilityLevel: "group",
      visibilityGroupId: group,
    });
    const hidden = await f.org({ ownerId: f.other.id });
    const deleted = await f.org({ deletedAt: firstInstant });
    const dangling = randomUUID();
    await f.win(visible, "13.5001");
    await f.win(visible, null);
    await f.win(hidden, "999.1111");
    await f.win(deleted, "888.2222");
    await f.win(dangling, "777.3333");
    await f.win(null, "666.4444");
    await f.win(visible, "1.0002", { ownerId: f.other.id, visibleToUserIds: [f.owner.id] });
    const read = () => readCurrentAccountConcentrationReport(h.db, principal, scope, signal());
    const report = await read();
    expect(report).toMatchObject({
      state: "available",
      coverage: {
        eligibleWonDeals: 7,
        linkedWonDeals: 3,
        unresolvedWonDeals: 4,
        linkedOrganizations: 1,
        multiWonLinkedOrganizations: 1,
        linkedWonDealsWithValue: 2,
        linkedWonDealsWithoutValue: 1,
      },
      linkedKnownNominalNet: "14.5003",
      concentration: { state: "withheld", reason: "unresolved-organization" },
    });
    for (const withheld of [
      hidden,
      deleted,
      dangling,
      "999.1111",
      "888.2222",
      "777.3333",
      "666.4444",
    ])
      expect(JSON.stringify(report)).not.toContain(withheld);
    await h.pool.query(
      "DELETE FROM public.visibility_group_members WHERE group_id=$1 AND user_id=$2",
      [group, f.owner.id],
    );
    expect(await read()).toMatchObject({
      coverage: { eligibleWonDeals: 7, linkedWonDeals: 0, unresolvedWonDeals: 7 },
      linkedKnownNominalNet: null,
    });
    await h.pool.query("UPDATE public.permission_sets SET flags='{}'::jsonb WHERE id=$1", [
      f.permissionSetId,
    ]);
    expect(await read()).toMatchObject({
      effectiveOwnerScope: "me",
      coverage: { eligibleWonDeals: 6, linkedWonDeals: 0, unresolvedWonDeals: 6 },
    });

    const own = await f.org();
    const june = new Date("2026-06-01T13:00:00Z");
    const juneScope = { ...scope, from: "2026-06-01", to: "2026-06-01" };
    const missing = await f.win(own, null, { wonTime: june });
    expect(
      await readCurrentAccountConcentrationReport(h.db, principal, juneScope, signal()),
    ).toMatchObject({
      linkedKnownNominalNet: null,
      concentration: { state: "withheld", reason: "missing-nominal-value" },
    });
    await h.pool.query("UPDATE public.deals SET value=0 WHERE id=$1", [missing]);
    await f.win(await f.org(), "-0.0001", { wonTime: june });
    expect(
      await readCurrentAccountConcentrationReport(h.db, principal, juneScope, signal()),
    ).toMatchObject({
      linkedKnownNominalNet: "-0.0001",
      concentration: {
        state: "no-positive-net",
        positiveNetOrganizations: 0,
        zeroNetOrganizations: 1,
        negativeNetOrganizations: 1,
      },
    });
    expect(
      await readCurrentAccountConcentrationReport(
        h.db,
        principal,
        { ...juneScope, from: "2026-06-02", to: "2026-06-02" },
        signal(),
      ),
    ).toMatchObject({
      coverage: { eligibleWonDeals: 0, linkedWonDeals: 0 },
      linkedKnownNominalNet: null,
      concentration: { state: "empty" },
    });
    await h.pool.query(
      "UPDATE public.sessions SET revoked_at=pg_catalog.clock_timestamp() WHERE id=$1",
      [principal.session.sessionId],
    );
    expect(await read()).toEqual({ state: "permission" });
  } finally {
    await h.close();
  }
});
