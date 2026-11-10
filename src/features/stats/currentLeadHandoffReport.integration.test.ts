import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { convertLead } from "@/features/leads/leadConvert";
import { insertLead, session } from "@/features/leads/leadConvert.test-helpers";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { readCurrentLeadHandoffReport } from "./currentLeadHandoffReport";

const signal = () => AbortSignal.timeout(10_000);
const firstBerlinInstant = "2026-04-30T22:00:00Z";
const firstOutsideInstant = "2026-05-01T22:00:00Z";
const request = {
  from: "2026-05-01",
  to: "2026-05-01",
  currency: "EUR",
  ownerScope: { kind: "all" },
  // The resolved reporting preferences own the cut, not this cache-only field.
  timeZoneIdentity: "America/Los_Angeles",
} as const;

async function seedDestination(
  h: TestDb,
  ownerId: string,
  seeded: Awaited<ReturnType<typeof seedPipelineWithStages>>,
  archived = false,
): Promise<string> {
  const stage = seeded.stages[0];
  if (stage === undefined) throw new Error("Expected one fixture stage");
  const id = randomUUID();
  await h.pool.query(
    `INSERT INTO public.deals (id,title,owner_id,pipeline_id,stage_id,currency,
      visibility_level,archived_at)
     VALUES ($1,'Private destination',$2,$3,$4,'EUR','owner',$5::timestamptz)`,
    [id, ownerId, seeded.pipeline.id, stage.id, archived ? firstBerlinInstant : null],
  );
  return id;
}

test("reconciles current lead links, pending and unknown under both live endpoint permissions", async () => {
  const h = await makeTestDb();
  try {
    const groupId = randomUUID();
    const permissionSetId = randomUUID();
    await h.pool.query("INSERT INTO public.visibility_groups(id,name) VALUES($1,'Handoff gate')", [
      groupId,
    ]);
    await h.pool.query(
      "INSERT INTO public.permission_sets(id,name,flags) VALUES($1,'Handoff viewer',$2::jsonb)",
      [permissionSetId, JSON.stringify({ "stats.viewOthers": true })],
    );
    const viewer = await seedUser(h.db, { permissionSetId });
    const other = await seedUser(h.db);
    await h.pool.query(
      "INSERT INTO public.visibility_group_members(group_id,user_id) VALUES($1,$2)",
      [groupId, viewer.id],
    );
    await setPreferences(
      h.db,
      viewer.id,
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

    const publicPipeline = await seedPipelineWithStages(h.db, ["Initial"]);
    const restrictedPipeline = await seedPipelineWithStages(h.db, ["Restricted"], {
      visibilityGroupId: groupId,
    });
    const base = {
      createdAt: new Date(firstBerlinInstant),
      currency: "EUR",
      visibilityLevel: "owner",
    } as const;
    const original = await insertLead(h.db, viewer.id, { ...base, title: "Private source lead" });
    const conversion = await convertLead(
      h.db,
      session(viewer.id),
      {
        leadId: original.id,
        expectedUpdatedAt: original.updatedAt.toISOString(),
        pipelineId: publicPipeline.pipeline.id,
      },
      signal(),
    );
    if (!conversion.ok) throw new Error(`Native conversion failed: ${conversion.error.id}`);
    const destination = conversion.value.dealId;
    const witness = await h.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.change_logs
       WHERE entity_type='lead' AND entity_id=$1::uuid AND field='convertedDealId'
         AND old_value='null'::jsonb AND new_value=pg_catalog.to_jsonb($2::text)`,
      [original.id, destination],
    );
    expect(witness.rows).toEqual([{ count: 1 }]);

    // Deliberate legacy duplicate pointer. Counts use the distinct lead and deal grains.
    await insertLead(h.db, viewer.id, { ...base, convertedDealId: destination });
    await insertLead(h.db, viewer.id, base);
    await insertLead(h.db, viewer.id, { ...base, archivedAt: base.createdAt });
    const restricted = await seedDestination(h, viewer.id, restrictedPipeline);
    const archived = await seedDestination(h, viewer.id, publicPipeline, true);
    await insertLead(h.db, viewer.id, { ...base, convertedDealId: restricted });
    await insertLead(h.db, viewer.id, { ...base, convertedDealId: archived });
    await insertLead(h.db, other.id, { ...base, convertedDealId: destination });
    await insertLead(h.db, other.id, { ...base, visibilityLevel: "all" });
    await insertLead(h.db, viewer.id, { ...base, createdAt: new Date(firstOutsideInstant) });
    await insertLead(h.db, viewer.id, { ...base, currency: "USD" });
    await insertLead(h.db, viewer.id, { ...base, deletedAt: base.createdAt });

    const actor: PermSetUser = {
      id: viewer.id,
      type: "regular",
      isActive: true,
      groupIds: new Set([groupId]),
      flags: new Set(["stats.viewOthers"]),
    };
    const initial = await readCurrentLeadHandoffReport(h.db, actor, request, signal());
    expect(initial).toEqual({
      state: "available",
      definition: "current-lead-deal-link-v1",
      population: "current-visible-leads-created-in-period",
      destination: "current-visible-live-linked-deal",
      handoffHistory: "unqualified",
      firstResponseHistory: "unqualified",
      currency: "EUR",
      timeZone: "Europe/Berlin",
      effectiveOwnerScope: "all",
      counts: {
        eligibleLeads: 7,
        linkedLeads: 3,
        distinctLinkedDeals: 2,
        pendingUnlinkedLeads: 2,
        archivedUnlinkedLeads: 1,
        unavailableLinkedLeads: 1,
      },
    });
    expect(JSON.stringify(initial)).not.toContain(destination);
    expect(JSON.stringify(initial)).not.toContain(restricted);
    expect(JSON.stringify(initial)).not.toContain(original.id);

    await h.pool.query(
      "DELETE FROM public.visibility_group_members WHERE group_id=$1 AND user_id=$2",
      [groupId, viewer.id],
    );
    expect(await readCurrentLeadHandoffReport(h.db, actor, request, signal())).toMatchObject({
      counts: {
        eligibleLeads: 7,
        linkedLeads: 2,
        distinctLinkedDeals: 1,
        unavailableLinkedLeads: 2,
      },
    });
    await h.pool.query("UPDATE public.permission_sets SET flags='{}'::jsonb WHERE id=$1", [
      permissionSetId,
    ]);
    expect(await readCurrentLeadHandoffReport(h.db, actor, request, signal())).toMatchObject({
      effectiveOwnerScope: "me",
      counts: { eligibleLeads: 6, linkedLeads: 2, pendingUnlinkedLeads: 1 },
    });
    expect(
      await readCurrentLeadHandoffReport(
        h.db,
        actor,
        {
          ...request,
          pipelineId: publicPipeline.pipeline.id,
        },
        signal(),
      ),
    ).toEqual({ state: "scope-unavailable" });
    expect(
      await readCurrentLeadHandoffReport(
        h.db,
        actor,
        {
          ...request,
          from: "2026-04-01",
          to: "2026-04-01",
        },
        signal(),
      ),
    ).toMatchObject({
      state: "available",
      counts: {
        eligibleLeads: 0,
        linkedLeads: 0,
        distinctLinkedDeals: 0,
        pendingUnlinkedLeads: 0,
        archivedUnlinkedLeads: 0,
        unavailableLinkedLeads: 0,
      },
    });
    await h.pool.query("UPDATE public.users SET is_active=false WHERE id=$1", [viewer.id]);
    expect(await readCurrentLeadHandoffReport(h.db, actor, request, signal())).toEqual({
      state: "permission",
    });
  } finally {
    await h.close();
  }
});
