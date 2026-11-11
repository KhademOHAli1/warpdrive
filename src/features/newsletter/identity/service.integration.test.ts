import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import type { env as runtimeEnv } from "@/config/env";
import type { Db } from "@/db/client";
import { newsletterIdentityCommands, newsletterPersonAddresses, persons, users } from "@/db/schema";
import { mergePersons } from "@/features/contacts/merge";
import { updatePerson } from "@/features/contacts/personsRepo";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { listPersonNewsletterEvents } from "./events";
import { readPersonNewsletter, requestNewsletterInvite } from "./service";
import { beginNewsletterProof, reconcileNewsletterIdentity } from "./write";

const provider = vi.hoisted(() => ({
  issue: vi.fn(),
  challenge: vi.fn(),
  revoke: vi.fn(),
  eligibleLists: vi.fn(),
  subscriber: vi.fn(),
  grants: vi.fn(),
}));

vi.mock("@/config/env", async (original) => {
  const loaded = await original<{ env: typeof runtimeEnv }>();
  return { ...loaded, env: { ...loaded.env, NEWSLETTER_DELIVERY_ENABLED: true } };
});

vi.mock("./engine", () => ({
  connectNewsletterIdentity: () => Promise.resolve(provider),
  isEngineConflict: () => false,
}));

afterEach(() => vi.resetAllMocks());

const email = "reviewed@example.test";
const personEmail = { label: "Work", value: email };
const signal = () => AbortSignal.timeout(10_000);

async function actorFixture(db: Db) {
  const id = randomUUID();
  await db
    .insert(users)
    .values({ id, email: `${id}@example.test`, name: "Synthetic reviewer", isAdmin: true });
  const actor = await hydrateActor(db, id, signal());
  if (actor === null) throw new Error("Synthetic admin is missing");
  return { ...actor, primaryVisibilityGroupId: null };
}

async function personFixture(db: Db, ownerId: string) {
  const id = randomUUID();
  await db.insert(persons).values({
    id,
    name: "Synthetic contact",
    ownerId,
    visibilityLevel: "owner",
    emails: [personEmail],
    primaryEmail: email,
  });
  return id;
}

function challenge(id: string, bindingId = id) {
  return {
    id,
    bindingId,
    purpose: bindingId === id ? "identity" : "newsletter",
    subscriberId: 55,
    subscriberUuid: "e8c65122-a16b-4c35-82f8-6d67755cd870",
    email,
    listId: bindingId === id ? null : 7,
    expiresAt: new Date(Date.now() + 60_000),
    verifiedAt: null,
    state: "pending",
  };
}

async function verifiedFixture(db: Db, actor: PermSetUser, personId: string) {
  const id = randomUUID();
  const proof = challenge(id);
  provider.issue.mockResolvedValueOnce(proof);
  await beginNewsletterProof(
    db,
    actor,
    { operationId: id, personId, address: email, evidenceReference: "CRM-55" },
    signal(),
  );
  provider.challenge.mockResolvedValueOnce({ ...proof, state: "verified", verifiedAt: new Date() });
  await reconcileNewsletterIdentity(db, actor, personId, id, signal());
  return { id, proof };
}

test("an engine proof attaches an exact Person and projects one minimal historical event", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const actor = await actorFixture(db);
    const personId = await personFixture(db, actor.id);
    const { id, proof } = await verifiedFixture(db, actor, personId);
    const [row] = await db
      .select()
      .from(newsletterPersonAddresses)
      .where(eq(newsletterPersonAddresses.id, id));
    expect(row?.addressDigest).toHaveLength(32);
    expect(JSON.stringify(row)).not.toContain(email);
    expect(row).toMatchObject({ personId, subscriberUuid: proof.subscriberUuid });
    await expect(reconcileNewsletterIdentity(db, actor, personId, id, signal())).resolves.toEqual({
      id,
      state: "verified",
    });
    expect(await listPersonNewsletterEvents(db, actor, personId, signal())).toMatchObject([
      { id, personId, linkId: id, listId: null, event: "newsletter.identity.verified" },
    ]);
    const other: PermSetUser = {
      ...actor,
      type: "regular",
      id: randomUUID(),
      flags: new Set(["newsletter.view"]),
    };
    await expect(readPersonNewsletter(db, other, personId, signal())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    await fixture.close();
  }
});

test("an uncertain invite retains its operation and only the matching confirmation emits an event", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const actor = await actorFixture(db);
    const personId = await personFixture(db, actor.id);
    const { id: linkId } = await verifiedFixture(db, actor, personId);
    const operationId = randomUUID();
    const originRunId = randomUUID();
    const input = { operationId, personId, linkId, listId: 7, originRunId };
    provider.issue.mockRejectedValueOnce(new Error("Synthetic transport uncertainty"));
    await expect(requestNewsletterInvite(db, actor, input, signal())).resolves.toEqual({
      id: operationId,
      state: "unknown",
    });
    await expect(
      requestNewsletterInvite(db, actor, { ...input, listId: 8 }, signal()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(newsletterIdentityCommands)).toMatchObject([
      { id: operationId, state: "pending" },
    ]);
    provider.challenge.mockResolvedValueOnce({
      ...challenge(operationId, linkId),
      state: "confirmed",
      verifiedAt: new Date(),
    });
    await expect(
      reconcileNewsletterIdentity(db, actor, personId, operationId, signal()),
    ).resolves.toEqual({ id: operationId, state: "confirmed" });
    expect(await listPersonNewsletterEvents(db, actor, personId, signal())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: operationId,
          originRunId,
          event: "newsletter.consent.confirmed",
          listId: 7,
        }),
      ]),
    );
  } finally {
    await fixture.close();
  }
});

test("address changes and Person merges fence existing engine grants before committing", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const actor = await actorFixture(db);
    const survivorId = await personFixture(db, actor.id);
    const mergedId = await personFixture(db, actor.id);
    const { id: mergedLink } = await verifiedFixture(db, actor, mergedId);
    provider.revoke.mockRejectedValueOnce(new Error("Synthetic engine unavailable"));
    await expect(
      mergePersons(db, actor, { survivorId, mergedId, fieldChoices: {} }, signal()),
    ).resolves.toMatchObject({ ok: false });
    const [original] = await db.select().from(persons).where(eq(persons.id, mergedId));
    expect(original?.deletedAt).toBeNull();
    provider.revoke.mockResolvedValue(true);
    await expect(
      mergePersons(db, actor, { survivorId, mergedId, fieldChoices: {} }, signal()),
    ).resolves.toMatchObject({ ok: true });
    expect(provider.revoke).toHaveBeenLastCalledWith(mergedLink);
    const [retained] = await db
      .select()
      .from(newsletterPersonAddresses)
      .where(eq(newsletterPersonAddresses.id, mergedLink));
    expect(retained).toMatchObject({ personId: mergedId, detachedReason: "person_merged" });
    const { id: survivorLink } = await verifiedFixture(db, actor, survivorId);
    await expect(
      updatePerson(
        db,
        actor,
        {
          id: survivorId,
          emails: [{ label: "Work", value: "replacement@example.test", primary: true }],
        },
        signal(),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(provider.revoke).toHaveBeenLastCalledWith(survivorLink);
    const [detached] = await db
      .select()
      .from(newsletterPersonAddresses)
      .where(eq(newsletterPersonAddresses.id, survivorLink));
    expect(detached).toMatchObject({ personId: survivorId, detachedReason: "address_removed" });
  } finally {
    await fixture.close();
  }
});
