import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { newsletterPersonAddresses, persons, users } from "@/db/schema";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb } from "@/test/db";
import { addressDigest } from "./authority";
import { maxNewsletterAudiencePeople, type NewsletterGrant } from "./contracts";
import { readPersonNewsletterGrants } from "./service";

const provider = vi.hoisted(() => ({
  grants: vi.fn<(bindingIds: string[], purpose: number) => Promise<NewsletterGrant[]>>(),
}));
vi.mock("./engine", () => ({ connectNewsletterIdentity: () => Promise.resolve(provider) }));

test("reads a full CRM audience through bounded engine batches and excludes unavailable bindings", async () => {
  const fixture = await makeTestDb();
  try {
    const { db } = fixture;
    const viewerId = randomUUID();
    const privateOwnerId = randomUUID();
    await db.insert(users).values([
      { id: viewerId, email: "grant-viewer@example.test", name: "Audience viewer" },
      { id: privateOwnerId, email: "grant-owner@example.test", name: "Private owner" },
    ]);
    const signal = AbortSignal.timeout(15_000);
    const viewer = await hydrateActor(db, viewerId, signal);
    if (viewer === null) throw new Error("Synthetic audience viewer missing");
    const actor = { ...viewer, flags: new Set(["newsletter.view"] as const) };
    const listId = 17;
    const records = Array.from({ length: maxNewsletterAudiencePeople }, (_, index) => ({
      personId: randomUUID(),
      ownerId: index === 0 ? privateOwnerId : viewerId,
      staleAddress: index === 1,
      grant: {
        grantUuid: randomUUID(),
        bindingUuid: randomUUID(),
        subscriberId: index + 1,
        subscriberUuid: randomUUID(),
        email: `batch-${index}@example.test`,
        purposeListId: listId,
      } satisfies NewsletterGrant,
    }));
    const [hidden, stale] = records;
    if (hidden === undefined || stale === undefined) throw new Error("Synthetic bindings missing");
    await db.insert(persons).values(
      records.map(({ personId, ownerId, staleAddress, grant }) => ({
        id: personId,
        ownerId,
        name: "Synthetic contact",
        visibilityLevel: "owner",
        emails: [
          {
            label: "Work",
            value: staleAddress ? "current-address@example.test" : grant.email,
            primary: true,
          },
        ],
      })),
    );
    await db.insert(newsletterPersonAddresses).values(
      records.map(({ personId, grant }) => ({
        id: grant.bindingUuid,
        personId,
        actorId: viewerId,
        evidenceReference: "CRM-BATCH",
        addressDigest: addressDigest(grant.email),
        subscriberId: grant.subscriberId,
        subscriberUuid: grant.subscriberUuid,
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      })),
    );

    const byBinding = new Map(records.map(({ grant }) => [grant.bindingUuid, grant]));
    provider.grants.mockImplementation((bindingIds, purpose) => {
      expect(purpose).toBe(listId);
      expect(bindingIds.length).toBeLessThanOrEqual(400);
      expect(Buffer.byteLength(JSON.stringify({ bindingIds, listId: purpose }))).toBeLessThan(
        16 * 1024,
      );
      return Promise.resolve([
        ...bindingIds.map((bindingId) => {
          const grant = byBinding.get(bindingId);
          if (grant === undefined) throw new Error("Unexpected binding in synthetic engine");
          return grant;
        }),
        hidden.grant,
        stale.grant,
      ]);
    });

    const personIds = records.map(({ personId }) => personId);
    const grants = await readPersonNewsletterGrants(db, actor, personIds, listId, signal);
    const eligible = records.slice(2);
    expect(grants).toHaveLength(eligible.length);
    expect(new Set(grants.map(({ personId }) => personId))).toEqual(
      new Set(eligible.map(({ personId }) => personId)),
    );
    const batches = provider.grants.mock.calls.map(
      ([bindingIds]: [string[], number]) => bindingIds,
    );
    expect(batches.map((batch) => batch.length)).toEqual([400, 400, 198]);
    expect(new Set(batches.flat())).toEqual(
      new Set(eligible.map(({ grant }) => grant.bindingUuid)),
    );
    await expect(
      readPersonNewsletterGrants(db, actor, [...personIds, randomUUID()], listId, signal),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(provider.grants).toHaveBeenCalledTimes(3);
  } finally {
    await fixture.close();
  }
});
