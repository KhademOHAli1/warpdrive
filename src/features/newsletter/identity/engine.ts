import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createListmonkClient } from "../listmonkClient";

const prefix = "/api/warpdrive/crm-identity";
const id = z.number().int().positive().safe();
const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const challenge = z.object({
  id: uuid,
  bindingId: uuid,
  purpose: z.enum(["identity", "newsletter"]),
  subscriberId: id,
  subscriberUuid: uuid,
  email: z.email(),
  listId: id.nullable(),
  expiresAt: instant,
  verifiedAt: instant.nullable(),
  state: z.enum(["pending", "verified", "confirmed", "expired", "detached"]),
});
const grant = z.object({
  grantUuid: uuid,
  bindingUuid: uuid,
  subscriberId: id,
  subscriberUuid: uuid,
  email: z.email(),
  purposeListId: id,
});
const revocation = z.object({
  id: uuid,
  grantUuid: uuid,
  bindingUuid: uuid,
  purposeListId: id,
  scopeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  occurredAt: instant,
});
export type EngineConsentRevocation = z.output<typeof revocation>;
const erasure = z.object({ id: uuid, bindingId: uuid, erasedAt: instant });
const minimalLists = z.object({
  results: z.array(
    z.object({
      id,
      name: z.string(),
      status: z.enum(["active", "archived"]),
      optin: z.enum(["single", "double"]),
    }),
  ),
});
const subscriber = z.object({
  id,
  uuid,
  email: z.email(),
  status: z.enum(["enabled", "disabled", "blocklisted"]),
  lists: z
    .array(
      z.object({
        id,
        name: z.string(),
        optin: z.enum(["single", "double"]),
        status: z.enum(["active", "archived"]),
        subscription_status: z.enum(["unconfirmed", "confirmed", "unsubscribed"]),
      }),
    )
    .nullish(),
});

export type EngineIdentityChallenge = z.output<typeof challenge>;
export type EngineErasureReceipt = z.output<typeof erasure>;

export function isEngineConflict(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "CONFLICT";
}

async function missing<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function connectNewsletterIdentity(signal: AbortSignal) {
  const client = createListmonkClient(signal);
  const capability = z
    .object({ crmIdentity: z.literal(1), consentEvents: z.literal(1) })
    .safeParse(await client.json("GET", "/api/warpdrive-capabilities"));
  if (!capability.success) throw new TRPCError({ code: "PRECONDITION_FAILED" });
  return {
    issue: async (body: {
      id: string;
      bindingId: string;
      purpose: "identity" | "newsletter";
      email: string;
      listId: number | null;
    }) => challenge.parse(await client.json("POST", `${prefix}/challenges`, { body })),
    challenge: (id: string) =>
      missing(async () => challenge.parse(await client.json("GET", `${prefix}/challenges/${id}`))),
    revoke: async (id: string) =>
      z.literal(true).parse(await client.json("POST", `${prefix}/bindings/${id}/revoke`)),
    grants: async (bindingIds: string[], listId: number) =>
      z
        .array(grant)
        .parse(await client.json("POST", `${prefix}/grants`, { body: { bindingIds, listId } })),
    revocations: async () =>
      z
        .array(revocation)
        .max(50)
        .parse(await client.json("GET", `${prefix}/revocations`)),
    acknowledgeRevocations: async (ids: string[]) =>
      z
        .literal(true)
        .parse(await client.json("POST", `${prefix}/revocations/ack`, { body: { ids } })),
    erasure: (id: string) =>
      missing(async () => erasure.parse(await client.json("GET", `${prefix}/erasures/${id}`))),
    erase: async (id: string, bindingId: string) =>
      erasure.parse(await client.json("POST", `${prefix}/erasures`, { body: { id, bindingId } })),
    subscriber: (id: number) =>
      missing(async () => subscriber.parse(await client.json("GET", `/api/subscribers/${id}`))),
    eligibleLists: async () =>
      minimalLists
        .parse(
          await client.json("GET", "/api/lists", {
            query: new URLSearchParams({
              page: "1",
              per_page: "100",
              status: "active",
              optin: "double",
            }),
          }),
        )
        .results.filter((list) => list.status === "active" && list.optin === "double")
        .map(({ id, name }) => ({ id, name })),
  };
}
