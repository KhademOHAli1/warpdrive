import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import {
  deals,
  leads,
  newsletterAttributedWins,
  newsletterDealSources,
  newsletterExposureReceipts,
  newsletterLeadSources,
  newsletterPersonAddresses,
  persons,
  privacyCases,
  users,
} from "@/db/schema";
import { seedPipelineWithStages } from "@/db/testing/factories";
import { markWon, reopenDeal } from "@/features/deal-workspace/wonLost";
import { createLead, type LeadSession } from "@/features/leads/leadActions";
import { convertLead } from "@/features/leads/leadConvert";
import { authorityFixture, authoritySignal } from "@/features/privacy/authority.test-helpers";
import { encryptPrivacy } from "@/features/privacy/crypto";
import { verifyPrivacyCaseIdentity } from "@/features/privacy/identityReview";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { addressDigest } from "./authority";
import { approveNewsletterErasure, executeNewsletterErasure } from "./erasure";

const provider = vi.hoisted(() => ({ erasure: vi.fn(), erase: vi.fn() }));
vi.mock("./engine", () => ({ connectNewsletterIdentity: () => Promise.resolve(provider) }));

const address = "target-erase@example.test";
const otherAddress = "different-binding@example.test";
const campaignId = 21;

async function exposure(db: Db, personId: string, linkId: string) {
  const id = randomUUID();
  await db.insert(newsletterExposureReceipts).values({
    id,
    personId,
    linkId,
    campaignId,
    grantId: randomUUID(),
    purposeListId: 4,
    acceptedAt: new Date(Date.now() - 2_000),
  });
  return id;
}

async function sourceDeal(
  db: Db,
  session: LeadSession,
  personId: string,
  pipelineId: string,
  sourceId?: string,
) {
  const created = await createLead(
    db,
    session,
    {
      title: "Synthetic lead",
      personId,
      sourceChannel: "campaign",
      sourceChannelId: String(campaignId),
      newsletterExposureId: sourceId,
    },
    authoritySignal(),
  );
  if (!created.ok) throw created.error;
  const leadId = created.value.id;
  const converted = await convertLead(
    db,
    session,
    {
      leadId,
      expectedUpdatedAt: created.value.updatedAt.toISOString(),
      pipelineId,
    },
    authoritySignal(),
  );
  if (!converted.ok) throw converted.error;
  return { leadId, dealId: converted.value.dealId };
}

async function sourceFields(db: Db, ids: { leadId: string; dealId: string }) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, ids.leadId));
  const [deal] = await db.select().from(deals).where(eq(deals.id, ids.dealId));
  return { lead, deal };
}

test("approved erasure removes exact binding lineage and native source fields without removing CRM records", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const reviewer = await authorityFixture(fixture, [
      "case.review",
      "case.erase.approve",
      "case.erase.execute",
    ]);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, reviewer.user.id));
    const actor = await hydrateActor(db, reviewer.user.id, authoritySignal());
    if (actor === null) throw new Error("Synthetic erasure reviewer missing");
    const session: LeadSession = {
      userId: actor.id,
      isAdmin: true,
      isActive: true,
      sessionLive: true,
      visibilityGroupIds: [],
      primaryVisibilityGroupId: null,
      flags: {},
    };
    const personId = randomUUID();
    const linkId = randomUUID();
    const otherLinkId = randomUUID();
    await db.insert(persons).values({
      id: personId,
      name: "Synthetic contact",
      ownerId: actor.id,
      visibilityLevel: "all",
      emails: [address, otherAddress].map((value) => ({ label: "Work", value, primary: false })),
    });
    await db.insert(newsletterPersonAddresses).values(
      [
        { id: linkId, email: address },
        { id: otherLinkId, email: otherAddress },
      ].map(({ id, email }, index) => ({
        id,
        personId,
        actorId: actor.id,
        evidenceReference: "CRM-24",
        addressDigest: addressDigest(email),
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(Date.now() - 10_000),
        subscriberId: index + 5,
        subscriberUuid: randomUUID(),
      })),
    );

    const subject = { kind: "contact", referenceId: personId };
    const recipient = { channel: "email", address };
    const privacyCaseId = reviewer.privacyCase.id;
    await db
      .update(privacyCases)
      .set({
        kind: "erasure",
        metadataEnc: encryptPrivacy(
          JSON.stringify({
            intakeKey: reviewer.privacyCase.intakeKey,
            kind: "erasure",
            locale: "en",
            subject,
            recipient,
            summary: "Synthetic exact newsletter binding erasure",
          }),
          { caseId: privacyCaseId, purpose: "intake" },
        ),
      })
      .where(eq(privacyCases.id, privacyCaseId));
    const verified = await verifyPrivacyCaseIdentity(
      db,
      reviewer.actor,
      {
        caseId: privacyCaseId,
        expectedVersion: 1,
        commandId: randomUUID(),
        subject,
        recipient,
        evidence: {
          trustedChannel: "organizational_record",
          evidenceRef: "Synthetic exact binding review",
          observedAt: new Date().toISOString(),
          confirmedSubject: true,
          confirmedRecipient: true,
        },
      },
      authoritySignal(),
    );
    expect(verified.ok).toBe(true);

    const { pipeline } = await seedPipelineWithStages(db, ["Open"]);
    const exactExposure = await exposure(db, personId, linkId);
    const otherExposure = await exposure(db, personId, otherLinkId);
    const target = await sourceDeal(db, session, personId, pipeline.id, exactExposure);
    const edited = await sourceDeal(db, session, personId, pipeline.id, exactExposure);
    const unrelated = await sourceDeal(db, session, personId, pipeline.id, otherExposure);
    const authored = await sourceDeal(db, session, personId, pipeline.id);
    await db
      .update(leads)
      .set({ sourceChannel: "referral", sourceChannelId: "authored-lead" })
      .where(eq(leads.id, edited.leadId));
    await db
      .update(deals)
      .set({ sourceChannel: "referral", sourceChannelId: "authored-deal" })
      .where(eq(deals.id, edited.dealId));
    for (const ids of [target, edited, unrelated]) {
      expect((await markWon(db, actor, ids.dealId, authoritySignal())).ok).toBe(true);
    }
    expect(await db.select().from(newsletterAttributedWins)).toHaveLength(3);
    const beforeTarget = await sourceFields(db, target);
    const input = { operationId: randomUUID(), personId, linkId, privacyCaseId };
    await expect(
      approveNewsletterErasure(db, actor, reviewer.actor, input, authoritySignal()),
    ).resolves.toEqual({ id: input.operationId, state: "pending" });

    provider.erasure.mockResolvedValueOnce(null);
    provider.erase.mockRejectedValueOnce(new Error("Synthetic lost erasure response"));
    await expect(
      executeNewsletterErasure(db, actor, reviewer.actor, input, authoritySignal()),
    ).resolves.toEqual({ id: input.operationId, state: "unknown" });
    expect(await db.select().from(newsletterExposureReceipts)).toHaveLength(2);
    expect(await sourceFields(db, target)).toEqual(beforeTarget);

    provider.erasure.mockResolvedValueOnce({
      id: input.operationId,
      bindingId: linkId,
      erasedAt: new Date(),
    });
    await expect(
      executeNewsletterErasure(db, actor, reviewer.actor, input, authoritySignal()),
    ).resolves.toEqual({ id: input.operationId, state: "erased" });
    await expect(
      executeNewsletterErasure(db, actor, reviewer.actor, input, authoritySignal()),
    ).resolves.toEqual({ id: input.operationId, state: "erased" });
    expect(provider.erase).toHaveBeenCalledTimes(1);
    expect(
      await db.select({ id: newsletterExposureReceipts.id }).from(newsletterExposureReceipts),
    ).toEqual([{ id: otherExposure }]);
    expect(
      await db.select({ leadId: newsletterLeadSources.leadId }).from(newsletterLeadSources),
    ).toEqual([{ leadId: unrelated.leadId }]);
    expect(
      await db.select({ dealId: newsletterDealSources.dealId }).from(newsletterDealSources),
    ).toEqual([{ dealId: unrelated.dealId }]);
    expect(
      await db.select({ dealId: newsletterAttributedWins.dealId }).from(newsletterAttributedWins),
    ).toEqual([{ dealId: unrelated.dealId }]);

    const scrubbed = await sourceFields(db, target);
    expect(scrubbed.lead).toMatchObject({
      id: target.leadId,
      personId,
      convertedDealId: target.dealId,
      sourceChannel: null,
      sourceChannelId: null,
      sourceOrigin: "manually_created",
    });
    expect(scrubbed.deal).toMatchObject({
      id: target.dealId,
      personId,
      status: "won",
      sourceChannel: null,
      sourceChannelId: null,
    });
    expect(
      (scrubbed.lead?.updatedAt.getTime() ?? 0) > (beforeTarget.lead?.updatedAt.getTime() ?? 0),
    ).toBe(true);
    expect(await sourceFields(db, edited)).toMatchObject({
      lead: { sourceChannel: "referral", sourceChannelId: "authored-lead" },
      deal: { sourceChannel: "referral", sourceChannelId: "authored-deal" },
    });
    for (const ids of [unrelated, authored]) {
      expect(await sourceFields(db, ids)).toMatchObject({
        lead: { sourceChannel: "campaign", sourceChannelId: String(campaignId) },
        deal: { sourceChannel: "campaign", sourceChannelId: String(campaignId) },
      });
    }
    expect((await reopenDeal(db, actor, target.dealId, authoritySignal())).ok).toBe(true);
    expect((await markWon(db, actor, target.dealId, authoritySignal())).ok).toBe(true);
    expect(
      await db.select({ dealId: newsletterAttributedWins.dealId }).from(newsletterAttributedWins),
    ).toEqual([{ dealId: unrelated.dealId }]);
  } finally {
    await fixture.close();
  }
});
