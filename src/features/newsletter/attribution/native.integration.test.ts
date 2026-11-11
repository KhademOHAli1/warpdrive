import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { leads, permissionSets, persons } from "@/db/schema";
import { createNativeDeal } from "@/features/deals/nativeCreate";
import { creationFixture, creationSignal } from "@/features/deals/nativeCreate.test-helpers";
import { makeTestDb } from "@/test/db";
import { addressDigest } from "../identity/authority";
import { newsletterPersonAddresses } from "../schema/personAddresses";
import { createLeadFromNewsletterExposure } from "./native";
import { newsletterDealSources, newsletterExposureReceipts, newsletterLeadSources } from "./schema";

const engine = vi.hoisted(() => ({ read: vi.fn(), connect: vi.fn() }));
vi.mock("./engine", () => ({ connectNewsletterAttribution: engine.connect }));

it("creates a lead and source once under concurrent native requests and replays through a transport outage", async () => {
  const h = await makeTestDb();
  try {
    const fixture = await creationFixture(h);
    const personId = randomUUID();
    const bindingId = randomUUID();
    const deliveryId = randomUUID();
    const grantId = randomUUID();
    const address = "source-proof@example.test";
    await h.db
      .update(permissionSets)
      .set({ flags: { "deal.create": true, "newsletter.view": true } })
      .where(eq(permissionSets.id, fixture.permissionSetId));
    await h.db.insert(persons).values({
      id: personId,
      ownerId: fixture.user.id,
      visibilityLevel: "all",
      name: "Source fixture",
      emails: [{ value: address, label: "Work", primary: true }],
    });
    await h.db.insert(newsletterPersonAddresses).values({
      id: bindingId,
      personId,
      addressDigest: addressDigest(address),
      actorId: fixture.user.id,
      evidenceReference: "CASE-2",
      expiresAt: new Date(Date.now() + 60_000),
      verifiedAt: new Date(Date.now() - 3_000),
      subscriberId: 9,
      subscriberUuid: randomUUID(),
    });
    const source = {
      bindingId,
      deliveryId,
      grantId,
      purposeListId: 3,
      campaignId: 2,
      campaignName: "Fixture campaign",
      acceptedAt: new Date(Date.now() - 1_000),
    };
    engine.connect.mockReset().mockResolvedValue(engine.read);
    engine.read.mockReset().mockResolvedValue([source]);
    const input = {
      personId,
      bindingId,
      deliveryId,
      title: "Reviewed source",
      operationId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      createLeadFromNewsletterExposure(h.db, fixture.who, input, creationSignal()),
      createLeadFromNewsletterExposure(h.db, fixture.who, input, creationSignal()),
    ]);
    expect(first.id).not.toBeNull();
    expect(second).toEqual(first);
    expect(await h.db.select().from(leads)).toHaveLength(1);
    expect(await h.db.select().from(newsletterExposureReceipts)).toHaveLength(1);
    expect(await h.db.select().from(newsletterLeadSources)).toHaveLength(1);

    engine.connect.mockClear().mockRejectedValue(new Error("Synthetic engine outage"));
    expect(
      await createLeadFromNewsletterExposure(h.db, fixture.who, input, creationSignal()),
    ).toEqual(first);
    await expect(
      createLeadFromNewsletterExposure(
        h.db,
        fixture.who,
        { ...input, title: "Different intent" },
        creationSignal(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(engine.connect).not.toHaveBeenCalled();
    const direct = await createNativeDeal(
      h.db,
      fixture.who,
      {
        ...fixture.input,
        deal: { ...fixture.input.deal, personId, newsletterExposureId: deliveryId },
      },
      creationSignal(),
    );
    expect(direct.ok).toBe(true);
    expect(await h.db.select().from(newsletterDealSources)).toMatchObject([
      { exposureId: deliveryId, leadId: null },
    ]);
  } finally {
    await h.close();
  }
});
