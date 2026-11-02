import { expect, it } from "vitest";
import { parseNotifyPayload } from "./payload";

it("accepts a mailbox invalidation without inventing an email arrival or exposing message content", () => {
  const parsed = parseNotifyPayload({
    v: 1,
    channel: "user:owner",
    ts: new Date().toISOString(),
    actorId: null,
    type: "email_mailbox_changed",
    data: { accountId: "owned-account", body: "must not be relayed" },
  });
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.data).toEqual({ accountId: "owned-account" });
  expect(
    parseNotifyPayload({
      v: 1,
      channel: "user:owner",
      ts: new Date().toISOString(),
      actorId: null,
      type: "email_mailbox_changed",
      data: {},
    }).ok,
  ).toBe(false);
});
