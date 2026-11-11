import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { notes, persons } from "@/db/schema";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { addressDigest } from "@/features/newsletter/identity/authority";
import {
  newsletterPersonAddresses,
  newsletterPersonEvents,
} from "@/features/newsletter/schema/personAddresses";
import type { PermSetUser } from "@/features/permissions/effective";
import { contactTimeline } from "./contactTimeline";
import { personNewsletterMessages } from "./personNewsletterMessages";

const engine = vi.hoisted(() => ({ read: vi.fn(), connect: vi.fn() }));
vi.mock("@/features/newsletter/attribution/engine", () => ({
  connectNewsletterAttribution: () => engine.connect(),
}));
const signal = () => AbortSignal.timeout(10_000);
beforeEach(() => {
  engine.read.mockReset();
  engine.connect.mockReset().mockResolvedValue(engine.read);
});

it("projects verified SMTP acceptance and durable revocation with current newsletter and Person access", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db, { isAdmin: true });
    const actor: PermSetUser = {
      id: user.id,
      type: "admin",
      isActive: true,
      flags: new Set(),
      groupIds: new Set(),
    };
    const personId = randomUUID();
    const linkId = randomUUID();
    const deliveryId = randomUUID();
    const revokedEventId = randomUUID();
    const acceptedAt = new Date(Date.now() - 2_000);
    const address = "accepted@example.test";
    await db.insert(persons).values({
      id: personId,
      name: "Campaign timeline contact",
      ownerId: user.id,
      visibilityLevel: "all",
      emails: [{ value: address, label: "Work", primary: true }],
    });
    await db.insert(notes).values({
      entityType: "person",
      entityId: personId,
      authorId: user.id,
      body: "Existing timeline note",
    });
    await db.insert(newsletterPersonAddresses).values({
      id: linkId,
      personId,
      actorId: user.id,
      evidenceReference: "CASE-1",
      addressDigest: addressDigest(address),
      subscriberId: 9,
      subscriberUuid: randomUUID(),
      verifiedAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await db.insert(newsletterPersonEvents).values({
      id: revokedEventId,
      linkId,
      listId: 4,
      event: "newsletter.consent.revoked",
      grantId: randomUUID(),
      sourceDigest: "a1".repeat(32),
      occurredAt: new Date(Date.now() - 1_000),
    });
    engine.read.mockResolvedValue([
      {
        deliveryId,
        campaignId: 21,
        campaignName: "Campaign <with authored text>",
        bindingId: linkId,
        grantId: randomUUID(),
        purposeListId: 4,
        acceptedAt,
      },
    ]);
    const timeline = await contactTimeline(db, actor, "person", personId, signal(), "de");
    const accepted = timeline.items.find(
      ({ id }) => id === `newsletter:delivery:${linkId}:${deliveryId}`,
    );
    expect(accepted).toMatchObject({
      kind: "event",
      at: acceptedAt,
      label: "Kampagne vom Mailserver angenommen · Campaign <with authored text>",
      actorName: null,
    });
    expect(timeline.items.find(({ id }) => id === `newsletter:${revokedEventId}`)).toMatchObject({
      label: personNewsletterMessages.de.events["newsletter.consent.revoked"],
    });
    expect((await contactTimeline(db, actor, "person", personId, signal(), "de")).items).toEqual(
      timeline.items,
    );

    engine.connect.mockRejectedValue(new Error("Synthetic engine outage"));
    const unavailable = await contactTimeline(db, actor, "person", personId, signal());
    expect(unavailable.items.some(({ kind }) => kind === "note")).toBe(true);
    expect(unavailable.items.some(({ id }) => id === `newsletter:${revokedEventId}`)).toBe(true);
    expect(unavailable.items.some(({ id }) => id.startsWith("newsletter:delivery:"))).toBe(false);

    engine.connect.mockResolvedValue(engine.read);
    engine.read.mockRejectedValue(new Error("Synthetic campaign evidence read outage"));
    const failedRead = await contactTimeline(db, actor, "person", personId, signal());
    expect(failedRead.items.some(({ kind }) => kind === "note")).toBe(true);
    expect(failedRead.items.some(({ id }) => id.startsWith("newsletter:delivery:"))).toBe(false);

    engine.read.mockClear();
    const withoutNewsletter = { ...actor, type: "regular" as const };
    const unprivileged = await contactTimeline(db, withoutNewsletter, "person", personId, signal());
    expect(unprivileged.items.some(({ kind }) => kind === "note")).toBe(true);
    expect(unprivileged.items.some(({ id }) => id.startsWith("newsletter:"))).toBe(false);
    expect(engine.read).not.toHaveBeenCalled();

    await db.update(persons).set({ deletedAt: new Date() }).where(eq(persons.id, personId));
    expect((await contactTimeline(db, actor, "person", personId, signal())).items).toEqual([]);
    expect(engine.read).not.toHaveBeenCalled();
  });
});
