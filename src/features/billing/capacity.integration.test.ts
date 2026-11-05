import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "@/db/schema";
import { withCurrentAuthority } from "@/features/auth/currentAuthority";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb } from "@/test/db";
import { config } from "./fixtures.test-support";
import { syntheticStripe } from "./provider.test-support";
import { BillingService } from "./service";
import { DrizzleBillingStore } from "./store";

let h: Awaited<ReturnType<typeof makeTestDb>>;
const admin: PermSetUser = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const target = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.insert(users).values([
    { id: admin.id, name: "Billing admin", email: "billing-admin@example.test", isAdmin: true },
    { id: target, name: "Inactive", email: "inactive@example.test", isActive: false },
  ]);
});
afterAll(async () => {
  if (h !== undefined) await h.close();
});

function latch() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

it("holds the runtime authority fence from active-user admission through the Stripe mutation", async () => {
  const signal = AbortSignal.timeout(10_000);
  const store = new DrizzleBillingStore(h.db, signal);
  const provider = syntheticStripe(config, signal);
  const service = new BillingService(store, provider.gateway, config);
  const entered = latch();
  const release = latch();
  const original = provider.gateway.createCheckout.bind(provider.gateway);
  vi.spyOn(provider.gateway, "createCheckout").mockImplementation(async (...args) => {
    entered.resolve();
    await release.promise;
    expect(await store.activeUserCount()).toBe(1);
    return original(...args);
  });
  // This is the same outer fence used by billingHttp.authorized, independent of
  // the separate committed operation transactions and synthetic provider I/O.
  const purchase = withCurrentAuthority(h.db, "read", signal, () =>
    service.checkout(
      {
        action: "checkout",
        requestId: "33333333-3333-4333-8333-333333333333",
        interval: "monthly",
        totalSeats: 1,
        profile: {
          name: "Synthetic",
          email: "billing@example.test",
          address: {
            line1: "Testweg 1",
            city: "Berlin",
            postalCode: "10115",
            country: "DE",
          },
        },
      },
      { id: admin.id, authorize: () => Promise.resolve() },
    ),
  );
  await entered.promise;
  const activation = setUserActive(h.db, admin, { userId: target, isActive: true }, signal);
  const observed = activation.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  try {
    await expect
      .poll(
        async () => {
          const rows = await h.pool.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted
          AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
          AND classid=((hashtext('warpdrive-current-authority')::bigint & 4294967295)::oid)
          AND objid=((hashtext('actor-v1')::bigint & 4294967295)::oid) AND objsubid=2
      `);
          return rows.rows[0]?.count;
        },
        { timeout: 1500 },
      )
      .toBe(1);
    expect(await store.activeUserCount()).toBe(1);
  } finally {
    release.resolve();
    await purchase;
  }
  expect(await observed).toEqual({ result: { ok: true, value: true } });
  expect(await store.activeUserCount()).toBe(2);
});
