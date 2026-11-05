import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { config, subscription } from "./fixtures.test-support";
import { syntheticStripe } from "./provider.test-support";
import { BillingService } from "./service";
import { DrizzleBillingStore } from "./store";
import type { VerifiedStripeEvent } from "./stripe/schemas";

let h: Awaited<ReturnType<typeof makeTestDb>>;
const signal = new AbortController().signal;
let store: DrizzleBillingStore;
let provider: ReturnType<typeof syntheticStripe>;
let service: BillingService;
const actor = { id: "22222222-2222-4222-8222-222222222222", authorize: () => Promise.resolve() };
const command = (requestId = randomUUID()) => ({
  action: "checkout" as const,
  requestId,
  interval: "monthly" as const,
  totalSeats: 5,
  profile: {
    name: "Synthetic GmbH",
    email: "billing@example.test",
    address: { line1: "Testweg 1", city: "Berlin", postalCode: "10115", country: "DE" },
  },
});

beforeAll(async () => {
  h = await makeTestDb();
  await h.pool.query(
    "INSERT INTO settings (id,company_name) VALUES (true,'Existing company') ON CONFLICT (id) DO NOTHING",
  );
  const prior = await h.pool.query("SELECT row_to_json(s) AS row FROM settings s");
  // Private proposal fixture only. Integration must generate/admit the next canonical migration.
  await h.pool.query(
    readFileSync(new URL("../../../docs/billing/schema-proposal.sql", import.meta.url), "utf8"),
  );
  expect((await h.pool.query("SELECT row_to_json(s) AS row FROM settings s")).rows).toEqual(
    prior.rows,
  );
});
afterAll(async () => {
  if (h !== undefined) await h.close();
});
beforeEach(async () => {
  await h.pool.query(
    "TRUNCATE billing_audit_events, billing_webhook_receipts, billing_operations, billing_accounts",
  );
  store = new DrizzleBillingStore(h.db, signal);
  provider = syntheticStripe(config, signal);
  service = new BillingService(store, provider.gateway, config);
});

describe("durable workspace billing", () => {
  it("persists a server-owned customer and replays the same checkout without a duplicate", async () => {
    const input = command();
    const first = await service.checkout(input, actor);
    const again = await service.checkout(input, actor);
    expect(first.id).toBe(again.id);
    expect(provider.state.customersCreated).toBe(1);
    expect(provider.state.checkoutsCreated).toBe(1);
    expect((await store.readAccount(false))?.customerId).toBe("cus_synthetic");
  });
  it("rejects concurrent different checkouts and does not create two subscriptions", async () => {
    const results = await Promise.allSettled([
      service.checkout(command(), actor),
      service.checkout(command(), actor),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(provider.state.customersCreated).toBe(1);
    expect(provider.state.checkoutsCreated).toBe(1);
  });
  it("retains the operation after a lost Stripe reply and retries the same provider key", async () => {
    const input = command();
    provider.state.throwAfterCheckout = true;
    await expect(service.checkout(input, actor)).rejects.toThrow();
    expect((await store.readAccount(false))?.checkoutOperationId).not.toBeNull();
    await service.checkout(input, actor);
    expect(provider.state.checkoutsCreated).toBe(1);
  });
  it("does not reuse an operation ID for different quantities", async () => {
    const input = command();
    await service.checkout(input, actor);
    await expect(service.checkout({ ...input, totalSeats: 6 }, actor)).rejects.toMatchObject({
      code: "request_conflict",
    });
  });
  it("rejects another Stripe customer's invoice", async () => {
    await service.checkout(command(), actor);
    await expect(service.document("invoice", "in_foreign", actor.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("deduplicates events and re-fetches current state for reordered delivery", async () => {
    await service.checkout(command(), actor);
    const sub = subscription();
    sub.metadata.warpdrive_account_id = provider.state.accountId;
    provider.state.subscriptions = [sub];
    const event: VerifiedStripeEvent = {
      id: "evt_lateDeleted",
      object: "event",
      type: "customer.subscription.deleted",
      livemode: false,
      api_version: "2026-10-28.endive",
      created: 1_000_000_000,
      data: { object: { id: sub.id, customer: "cus_synthetic", status: "canceled" } },
    };
    await service.webhook(event, "a".repeat(64));
    expect(await service.webhook(event, "a".repeat(64))).toEqual({ duplicate: true });
    expect((await store.readAccount(false))?.subscription?.status).toBe("active");
    expect(
      (
        await h.pool.query<{ count: string }>(
          "SELECT count(*) AS count FROM billing_webhook_receipts",
        )
      ).rows[0]?.count,
    ).toBe("1");
  });
  it("keeps current seat capacity while additional payment is pending", async () => {
    await service.checkout(command(), actor);
    const sub = subscription();
    sub.metadata.warpdrive_account_id = provider.state.accountId;
    provider.state.subscriptions = [sub];
    await service.overview();
    const preview = await service.previewSeats(7);
    provider.state.pendingSeatPayment = true;
    const result = await service.changeSeats(preview.quote, randomUUID(), actor);
    expect(result.pending).toBe(true);
    expect(result.subscription.purchasedSeats).toBe(5);
  });
});
