import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Db } from "@/db/client";
import { deals, leads, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { markWon, reopenDeal } from "@/features/deal-workspace/wonLost";
import { createLead, type LeadSession } from "@/features/leads/leadActions";
import { convertLead } from "@/features/leads/leadConvert";
import type { PermSetUser } from "@/features/permissions/effective";
import { addressDigest } from "../identity/authority";
import { newsletterPersonAddresses } from "../schema/personAddresses";
import {
  newsletterAttributedWins,
  newsletterDealSources,
  newsletterExposureReceipts,
  newsletterLeadSources,
} from "./schema";

const signal = () => AbortSignal.timeout(10_000);
const campaignId = 21;

async function seedExposure(db: Db) {
  const user = await seedUser(db, { isAdmin: true });
  const session: LeadSession = {
    userId: user.id,
    isAdmin: true,
    isActive: true,
    sessionLive: true,
    visibilityGroupIds: [],
    primaryVisibilityGroupId: null,
    flags: {},
  };
  const personId = randomUUID();
  const wrongPersonId = randomUUID();
  const linkId = randomUUID();
  const deliveryId = randomUUID();
  const address = "accepted@example.test";
  await db.insert(persons).values([
    {
      id: personId,
      ownerId: user.id,
      visibilityLevel: "all",
      name: "Verified contact",
      emails: [{ value: address, primary: true, label: "Work" }],
    },
    { id: wrongPersonId, ownerId: user.id, visibilityLevel: "all", name: "Different contact" },
  ]);
  await db.insert(newsletterPersonAddresses).values({
    id: linkId,
    personId,
    actorId: user.id,
    evidenceReference: "CASE-1",
    addressDigest: addressDigest(address),
    expiresAt: new Date(Date.now() + 60_000),
    verifiedAt: new Date(Date.now() - 10_000),
    subscriberId: 9,
    subscriberUuid: randomUUID(),
  });
  await db.insert(newsletterExposureReceipts).values({
    id: deliveryId,
    personId,
    linkId,
    campaignId,
    grantId: randomUUID(),
    purposeListId: 4,
    acceptedAt: new Date(Date.now() - 2_000),
  });
  return { session, personId, wrongPersonId, deliveryId };
}

it("carries a reviewed same-Person newsletter source through a lead, conversion and one native win", async () => {
  await withTestDb(async (db) => {
    const { session, personId, wrongPersonId, deliveryId } = await seedExposure(db);
    const actor: PermSetUser = {
      id: session.userId,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const rejected = await createLead(
      db,
      session,
      {
        title: "Cross-person claim",
        personId: wrongPersonId,
        newsletterExposureId: deliveryId,
      },
      signal(),
    );
    expect(rejected.ok).toBe(false);
    const created = await createLead(
      db,
      session,
      {
        title: "Source reviewed",
        personId,
        newsletterExposureId: deliveryId,
      },
      signal(),
    );
    if (!created.ok) throw created.error;
    expect(
      await db
        .select({
          leadId: newsletterLeadSources.leadId,
          exposureId: newsletterLeadSources.exposureId,
        })
        .from(newsletterLeadSources),
    ).toEqual([{ leadId: created.value.id, exposureId: deliveryId }]);
    const { pipeline } = await seedPipelineWithStages(db, ["Open"]);
    const converted = await convertLead(
      db,
      session,
      {
        leadId: created.value.id,
        expectedUpdatedAt: created.value.updatedAt.toISOString(),
        pipelineId: pipeline.id,
      },
      signal(),
    );
    if (!converted.ok) throw converted.error;
    const { dealId } = converted.value;
    expect(await db.select().from(newsletterDealSources)).toEqual([
      { dealId, leadId: created.value.id, exposureId: deliveryId },
    ]);
    expect((await markWon(db, actor, dealId, signal())).ok).toBe(true);
    const first = await db.select().from(newsletterAttributedWins);
    expect(first).toHaveLength(1);
    expect(first[0]?.dealId).toBe(dealId);
    expect((await reopenDeal(db, actor, dealId, signal())).ok).toBe(true);
    expect((await markWon(db, actor, dealId, signal())).ok).toBe(true);
    expect(await db.select().from(newsletterAttributedWins)).toEqual(first);
    expect(
      (await db.select({ status: deals.status }).from(deals).where(eq(deals.id, dealId)))[0]
        ?.status,
    ).toBe("won");
  });
});

it("clears the generated campaign source for a different Person and carries a manual source", async () => {
  await withTestDb(async (db) => {
    const { session, personId, wrongPersonId, deliveryId } = await seedExposure(db);
    const { pipeline } = await seedPipelineWithStages(db, ["Open"]);
    const source = { sourceChannel: "campaign", sourceChannelId: String(campaignId) };
    const cases = [
      {
        title: "Reviewed newsletter source",
        exposureId: deliveryId,
        expectedSource: { sourceChannel: null, sourceChannelId: null },
      },
      { title: "Manual source", exposureId: undefined, expectedSource: source },
    ];

    for (const { title, exposureId, expectedSource } of cases) {
      const created = await createLead(
        db,
        session,
        { title, personId, ...source, newsletterExposureId: exposureId },
        signal(),
      );
      if (!created.ok) throw created.error;
      const lead = created.value;
      const [reassigned] = await db
        .update(leads)
        .set({ personId: wrongPersonId })
        .where(eq(leads.id, lead.id))
        .returning({ updatedAt: leads.updatedAt });
      if (reassigned === undefined) throw new Error("Expected the lead to be reassigned");
      const converted = await convertLead(
        db,
        session,
        {
          leadId: lead.id,
          expectedUpdatedAt: reassigned.updatedAt.toISOString(),
          pipelineId: pipeline.id,
        },
        signal(),
      );
      if (!converted.ok) throw converted.error;
      const [deal] = await db.select().from(deals).where(eq(deals.id, converted.value.dealId));
      expect(deal).toMatchObject({ personId: wrongPersonId, ...expectedSource });
    }

    expect(await db.select().from(newsletterDealSources)).toEqual([]);
  });
});
