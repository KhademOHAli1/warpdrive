import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import {
  newsletterIdentityCommands as commands,
  newsletterPersonEvents as events,
  newsletterPersonAddresses as links,
  persons,
  users,
} from "@/db/schema";
import { makeTestDb } from "@/test/db";
import { addressDigest } from "./authority";
import type { EngineConsentRevocation } from "./engine";
import { synchronizeNewsletterIdentity, synchronizeNewsletterRevocations } from "./events";

const provider = vi.hoisted(() => ({
  revocations: vi.fn<() => Promise<EngineConsentRevocation[]>>(),
  acknowledgeRevocations: vi.fn<(ids: string[]) => Promise<boolean>>(),
}));
vi.mock("./engine", () => ({ connectNewsletterIdentity: () => Promise.resolve(provider) }));
vi.mock("../listmonkClient", () => ({ newsletterConfigured: () => true }));
afterEach(() => vi.resetAllMocks());

async function bindingFixture(db: Db, state: "pending" | "confirmed" = "confirmed") {
  const actorId = randomUUID();
  const personId = randomUUID();
  const bindingUuid = randomUUID();
  const grantUuid = randomUUID();
  const subscriberId = 13;
  const subscriberUuid = randomUUID();
  const listId = 7;
  const occurredAt = new Date();
  await db.insert(users).values({
    id: actorId,
    name: "Former consent operator",
    email: "operator@example.test",
    isActive: false,
  });
  await db.insert(persons).values({
    id: personId,
    name: "Synthetic contact",
    visibilityLevel: "owner",
    ownerId: actorId,
    emails: [{ label: "Work", value: "reviewed@example.test", primary: true }],
  });
  await db.insert(links).values({
    id: bindingUuid,
    personId,
    actorId,
    evidenceReference: "CRM-REVOCATION",
    addressDigest: addressDigest("reviewed@example.test"),
    subscriberId,
    subscriberUuid,
    verifiedAt: new Date(Date.now() - 10_000),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(commands).values({
    id: grantUuid,
    linkId: bindingUuid,
    listId,
    actorId,
    kind: "invite",
    state,
    resolvedAt: state === "pending" ? null : new Date(),
  });
  const event: EngineConsentRevocation = {
    id: randomUUID(),
    grantUuid,
    bindingUuid,
    purposeListId: listId,
    scopeDigest: createHash("sha256")
      .update([bindingUuid, grantUuid, subscriberId, subscriberUuid, listId].join(":"))
      .digest("hex"),
    occurredAt,
  };
  provider.revocations.mockResolvedValue([event]);
  provider.acknowledgeRevocations.mockResolvedValue(true);
  return { event, personId };
}

const signal = () => AbortSignal.timeout(10_000);

test("polls confirmed links and persists a revocation before acknowledging, including lost-ack replay", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db);
    provider.acknowledgeRevocations.mockImplementationOnce(async (ids) => {
      expect(ids).toEqual([event.id]);
      expect(await db.select().from(events)).toMatchObject([
        { id: event.id, grantId: event.grantUuid },
      ]);
      throw new Error("Synthetic lost acknowledgement");
    });
    await expect(synchronizeNewsletterIdentity(db, signal())).rejects.toThrow(
      "lost acknowledgement",
    );
    expect(provider.revocations).toHaveBeenCalledTimes(1);
    await synchronizeNewsletterIdentity(db, signal());
    expect(await db.select().from(events)).toMatchObject([
      {
        id: event.id,
        event: "newsletter.consent.revoked",
        sourceDigest: event.scopeDigest,
        deliveredAt: null,
      },
    ]);
    expect(await db.select().from(events)).toHaveLength(1);
    expect(provider.acknowledgeRevocations).toHaveBeenCalledTimes(2);
  } finally {
    await fixture.close();
  }
});

test("a revocation resolves a still-pending invite without projecting a later confirmation", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db, "pending");
    await synchronizeNewsletterRevocations(db, signal());
    expect(await db.select().from(commands)).toMatchObject([
      { id: event.grantUuid, state: "suppressed", resolvedAt: event.occurredAt },
    ]);
    expect(await db.select().from(events)).toMatchObject([{ event: "newsletter.consent.revoked" }]);
    expect(provider.acknowledgeRevocations).toHaveBeenCalledWith([event.id]);
  } finally {
    await fixture.close();
  }
});

test("rejects unrelated binding, invite, purpose and subscriber scopes before storing an event", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db);
    const unrelated = [
      { ...event, id: randomUUID(), bindingUuid: randomUUID() },
      { ...event, id: randomUUID(), grantUuid: randomUUID() },
      { ...event, id: randomUUID(), purposeListId: 8 },
      { ...event, id: randomUUID(), scopeDigest: "f".repeat(64) },
    ];
    provider.revocations.mockResolvedValue([...unrelated, event]);
    await synchronizeNewsletterRevocations(db, signal());
    expect(await db.select().from(events)).toHaveLength(1);
    expect(await db.select().from(events)).toMatchObject([{ id: event.id }]);
    expect(provider.acknowledgeRevocations).toHaveBeenCalledWith([
      ...unrelated.map(({ id }) => id),
      event.id,
    ]);
  } finally {
    await fixture.close();
  }
});

test("rolls back event and command together on a database failure and leaves engine acknowledgement pending", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db, "pending");
    await db.execute(sql`CREATE FUNCTION reject_synthetic_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic revocation transaction failure'; END; $$`);
    await db.execute(sql`CREATE TRIGGER reject_synthetic_revocation BEFORE UPDATE
      ON newsletter_identity_commands FOR EACH ROW EXECUTE FUNCTION reject_synthetic_revocation()`);
    await expect(synchronizeNewsletterRevocations(db, signal())).rejects.toThrow();
    expect(await db.select().from(events)).toHaveLength(0);
    expect(await db.select().from(commands)).toMatchObject([{ state: "pending" }]);
    expect(provider.acknowledgeRevocations).not.toHaveBeenCalled();
    await db.execute(sql`DROP TRIGGER reject_synthetic_revocation ON newsletter_identity_commands`);
    await synchronizeNewsletterRevocations(db, signal());
    expect(await db.select().from(events)).toHaveLength(1);
    expect(provider.acknowledgeRevocations).toHaveBeenCalledWith([event.id]);
  } finally {
    await fixture.close();
  }
});

test("engine erasure tombstones never repopulate wiped local event history", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db);
    await db.delete(commands).where(eq(commands.id, event.grantUuid));
    await db
      .update(links)
      .set({
        addressDigest: Buffer.alloc(32),
        subscriberId: null,
        subscriberUuid: null,
        verifiedAt: null,
        detachedAt: new Date(),
        detachedReason: "erasure",
      })
      .where(eq(links.id, event.bindingUuid));
    await synchronizeNewsletterRevocations(db, signal());
    expect(await db.select().from(events)).toHaveLength(0);
    expect(provider.acknowledgeRevocations).toHaveBeenCalledWith([event.id]);
  } finally {
    await fixture.close();
  }
});

test("database rejects revocation evidence with a missing scope digest", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const { event } = await bindingFixture(db);
    await expect(
      db.insert(events).values({
        id: event.id,
        linkId: event.bindingUuid,
        listId: event.purposeListId,
        grantId: event.grantUuid,
        event: "newsletter.consent.revoked",
        sourceDigest: null,
        occurredAt: event.occurredAt,
      }),
    ).rejects.toThrow();
    expect(await db.select().from(events)).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});
