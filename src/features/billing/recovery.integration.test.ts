import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDb } from "@/test/db";
import type { BillingAccount, BillingCommand, BillingOperation } from "./contracts";
import { processBillingEvent } from "./events";
import { config, subscription } from "./fixtures.test-support";
import { billingAccounts, billingOperations } from "./schema";
import { BillingService } from "./service";
import { DrizzleBillingStore } from "./store";
import type {
  StripeCheckout,
  StripeCustomer,
  StripeSubscription,
  VerifiedStripeEvent,
} from "./stripe";

const actor = { id: "22222222-2222-4222-8222-222222222222", authorize: () => Promise.resolve() };
const signal = new AbortController().signal;
const accountId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";
const checkoutInput: Extract<BillingCommand, { action: "checkout" }> = {
  action: "checkout",
  requestId,
  interval: "monthly",
  totalSeats: 2,
  profile: {
    name: "Synthetic GmbH",
    email: "billing@example.test",
    address: { line1: "Testweg 1", city: "Berlin", postalCode: "10115", country: "DE" },
  },
};
const checkoutFingerprint = createHash("sha256")
  .update(
    JSON.stringify({ interval: checkoutInput.interval, totalSeats: checkoutInput.totalSeats }),
  )
  .digest("hex");

let h: Awaited<ReturnType<typeof makeTestDb>>;

beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  if (h !== undefined) await h.close();
});
beforeEach(async () => {
  await h.pool.query(
    "TRUNCATE billing_audit_events, billing_webhook_receipts, billing_operations, billing_accounts",
  );
});

async function seedAccount(account: BillingAccount) {
  await h.db.insert(billingAccounts).values({
    id: account.id,
    livemode: account.livemode,
    customerId: account.customerId,
    checkoutOperationId: account.checkoutOperationId,
    seatOperationId: account.seatOperationId,
    subscription: account.subscription,
    syncState: account.syncState,
    syncedAt: account.syncedAt,
  });
}

async function seedOperation(operation: BillingOperation) {
  await h.db.insert(billingOperations).values(operation);
}

function customer(id: string): StripeCustomer {
  return {
    id,
    object: "customer",
    livemode: false,
    metadata: { warpdrive_account_id: accountId },
    name: "Synthetic GmbH",
    email: "billing@example.test",
  };
}

function checkout(operationId: string, subscriptionId: string): StripeCheckout {
  return {
    id: "cs_recovered",
    object: "checkout.session",
    livemode: false,
    customer: "cus_synthetic",
    subscription: subscriptionId,
    client_reference_id: accountId,
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    url: "https://checkout.stripe.com/c/recovered",
    expires_at: 2_000_000_000,
    metadata: {
      warpdrive_account_id: accountId,
      warpdrive_operation_key: `warpdrive:checkout:${operationId}`,
    },
  };
}

type BillingGateway = ConstructorParameters<typeof BillingService>[1];
function gateway(input: {
  customer: StripeCustomer;
  subscriptions?: StripeSubscription[];
  retrievedSubscriptions?: StripeSubscription[];
  checkouts?: StripeCheckout[];
  replacementCustomers?: StripeCustomer[];
}) {
  const createCheckout = vi.fn();
  const createCustomer = vi.fn();
  const api = {
    validatePrices: vi.fn().mockResolvedValue(undefined),
    retrieveCustomer: vi.fn().mockResolvedValue(input.customer),
    retrieveSubscription: vi.fn((id: string) => {
      const found = (input.retrievedSubscriptions ?? input.subscriptions ?? []).find(
        (item) => item.id === id,
      );
      return found === undefined
        ? Promise.reject(new Error(`missing synthetic subscription ${id}`))
        : Promise.resolve(found);
    }),
    listSubscriptions: vi.fn().mockResolvedValue({
      data: input.subscriptions ?? [],
      has_more: false,
      next_cursor: null,
    }),
    retrieveCheckout: vi.fn((id: string) => {
      const found = (input.checkouts ?? []).find((item) => item.id === id);
      return found === undefined
        ? Promise.reject(new Error(`missing synthetic checkout ${id}`))
        : Promise.resolve(found);
    }),
    listCheckouts: vi.fn().mockResolvedValue({
      data: input.checkouts ?? [],
      has_more: false,
      next_cursor: null,
    }),
    searchCustomers: vi.fn().mockResolvedValue(input.replacementCustomers ?? []),
    createCheckout,
    createCustomer,
  } as unknown as BillingGateway;
  return { api, createCheckout, createCustomer };
}

async function expectExpiredSubscriptionOwnershipRejected(
  mutate: (sub: StripeSubscription) => void,
) {
  const expiredCheckoutId = "cs_expired_foreign";
  const oldOperation: BillingOperation = {
    id: "88888888-8888-4888-8888-888888888888",
    accountId,
    kind: "checkout",
    requestKey: "old-checkout",
    fingerprint: "o".repeat(64),
    startedAt: new Date(),
    resourceId: expiredCheckoutId,
  };
  await seedAccount({
    id: accountId,
    livemode: false,
    customerId: "cus_synthetic",
    checkoutOperationId: oldOperation.id,
    seatOperationId: null,
    subscription: null,
    syncState: "never",
    syncedAt: null,
  });
  await seedOperation(oldOperation);
  const foreign = subscription();
  foreign.status = "canceled";
  mutate(foreign);
  const expired: StripeCheckout = {
    ...checkout(oldOperation.id, foreign.id),
    id: expiredCheckoutId,
    status: "expired",
    subscription: foreign.id,
  };
  const provider = gateway({
    customer: customer("cus_synthetic"),
    subscriptions: [],
    retrievedSubscriptions: [foreign],
    checkouts: [expired],
  });
  provider.createCheckout.mockResolvedValue({
    id: "cs_new_purchase",
    object: "checkout.session",
    livemode: false,
    customer: "cus_synthetic",
    subscription: null,
    client_reference_id: accountId,
    mode: "subscription",
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/c/new-purchase",
    expires_at: 2_000_000_000,
    metadata: { warpdrive_account_id: accountId },
  });
  const store = new DrizzleBillingStore(h.db, signal);
  const service = new BillingService(store, provider.api, config);

  await expect(service.checkout(checkoutInput, actor)).rejects.toMatchObject({
    code: "reconciliation_required",
  });
  expect(provider.createCheckout).not.toHaveBeenCalled();
  expect(await store.readAccount(false)).toMatchObject({
    id: accountId,
    checkoutOperationId: oldOperation.id,
  });
  const row = await h.pool.query<{ request_key: string; resource_id: string | null }>(
    "SELECT request_key, resource_id FROM billing_operations WHERE id = $1",
    [oldOperation.id],
  );
  expect(row.rows[0]).toEqual({
    request_key: oldOperation.requestKey,
    resource_id: oldOperation.resourceId,
  });
}

describe("billing recovery against PostgreSQL", () => {
  it("recovers a completed checkout whose local operation lost its Stripe reply", async () => {
    const current = subscription();
    const operation: BillingOperation = {
      id: "55555555-5555-4555-8555-555555555555",
      accountId,
      kind: "checkout",
      requestKey: requestId,
      fingerprint: checkoutFingerprint,
      startedAt: new Date(),
      resourceId: null,
    };
    await seedAccount({
      id: accountId,
      livemode: false,
      customerId: "cus_synthetic",
      checkoutOperationId: operation.id,
      seatOperationId: null,
      subscription: null,
      syncState: "never",
      syncedAt: null,
    });
    await seedOperation(operation);
    const recovered = checkout(operation.id, current.id);
    const provider = gateway({
      customer: customer("cus_synthetic"),
      subscriptions: [current],
      checkouts: [recovered],
    });
    const store = new DrizzleBillingStore(h.db, signal);
    const service = new BillingService(store, provider.api, config);

    await expect(service.checkout(checkoutInput, actor)).resolves.toEqual(recovered);
    expect(provider.createCheckout).not.toHaveBeenCalled();
    const row = await h.pool.query<{ resource_id: string | null }>(
      "SELECT resource_id FROM billing_operations WHERE id = $1",
      [operation.id],
    );
    expect(row.rows[0]?.resource_id).toBe(recovered.id);
    await expect(service.overview()).resolves.toMatchObject({
      pendingCheckout: {
        id: recovered.id,
        status: recovered.status,
        url: null,
        expiresAt: recovered.expires_at,
      },
    });
  });

  it("retires a deleted customer binding and blocks checkout until explicit repair", async () => {
    await seedAccount({
      id: accountId,
      livemode: false,
      customerId: "cus_synthetic",
      checkoutOperationId: randomUUID(),
      seatOperationId: randomUUID(),
      subscription: null,
      syncState: "current",
      syncedAt: new Date(),
    });
    const event: VerifiedStripeEvent = {
      id: "evt_customer_deleted",
      object: "event",
      type: "customer.deleted",
      livemode: false,
      api_version: "2026-10-28.endive",
      created: 2_000_000_000,
      data: { object: { id: "cus_synthetic" } },
    };
    const store = new DrizzleBillingStore(h.db, signal);
    await expect(
      processBillingEvent(store, false, event, "a".repeat(64), vi.fn(), () => new Date()),
    ).resolves.toEqual({ processed: true });
    const deleted = await store.readAccount(false);
    expect(deleted).toMatchObject({
      customerId: null,
      checkoutOperationId: null,
      seatOperationId: null,
      subscription: null,
      syncState: "needs_review",
    });

    const provider = gateway({ customer: customer("cus_synthetic") });
    const service = new BillingService(store, provider.api, config);
    await expect(service.checkout(checkoutInput, actor)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    expect(provider.createCustomer).not.toHaveBeenCalled();
  });

  it("rebinds only an exact metadata-matched replacement during reconciliation", async () => {
    const operation: BillingOperation = {
      id: "77777777-7777-4777-8777-777777777777",
      accountId,
      kind: "customer",
      requestKey: "initial",
      fingerprint: "f".repeat(64),
      startedAt: new Date(),
      resourceId: "cus_deleted",
    };
    await seedAccount({
      id: accountId,
      livemode: false,
      customerId: null,
      checkoutOperationId: null,
      seatOperationId: null,
      subscription: null,
      syncState: "needs_review",
      syncedAt: new Date(),
    });
    await seedOperation(operation);
    const replacement = customer("cus_replacement");
    const provider = gateway({
      customer: replacement,
      replacementCustomers: [replacement],
    });
    const store = new DrizzleBillingStore(h.db, signal);
    const service = new BillingService(store, provider.api, config);

    await expect(service.reconcile(actor)).resolves.toMatchObject({ recovered: true });
    expect((await store.readAccount(false))?.customerId).toBe(replacement.id);
    expect((await store.readAccount(false))?.syncState).toBe("current");
    const row = await h.pool.query<{ resource_id: string | null }>(
      "SELECT resource_id FROM billing_operations WHERE id = $1",
      [operation.id],
    );
    expect(row.rows[0]?.resource_id).toBe(replacement.id);
  });

  it("rejects an expired checkout carrying a foreign subscription before a new purchase", async () => {
    await expectExpiredSubscriptionOwnershipRejected((foreign) => {
      foreign.customer = "cus_other_workspace";
    });
  });

  it("rejects an expired checkout carrying a wrong-mode subscription before a new purchase", async () => {
    await expectExpiredSubscriptionOwnershipRejected((foreign) => {
      foreign.livemode = true;
    });
  });
});
