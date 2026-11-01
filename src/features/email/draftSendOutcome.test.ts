import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import { draftSendOutcome } from "./draftSendOutcome";

const inFlight = () => ({
  attemptId: randomUUID(),
  status: "sending",
  submitted: true,
  scheduledAt: null,
  claimedAt: new Date().toISOString(),
  providerMessageId: null,
  messageId: null,
  deliveryState: "unknown",
  accepted: null,
  rejected: null,
  sentCopyState: null,
  sentCopyFolder: null,
});

describe("public in-flight send status", () => {
  it("keeps a live SMTP submission pending until its acknowledgment is known", () => {
    const outcome = draftSendOutcome(inFlight());
    expect(outcome?.status).toBe("pending");
    expect(outcome?.deliveryOutcome).toBeUndefined();
  });

  it.each([
    { status: "needs_review", claimedAt: null },
    { claimedAt: null },
    { claimedAt: new Date(Date.now() - (CLAIM_LEASE_SECONDS + 1) * 1000).toISOString() },
  ])("holds abandoned or expired unknown submissions for review: %j", (patch) => {
    expect(draftSendOutcome({ ...inFlight(), ...patch })).toMatchObject({
      status: "needs_review",
      deliveryOutcome: { state: "unknown" },
    });
  });

  it.each(["partial", "accepted"])(
    "keeps an established %s receipt visible during repair",
    (deliveryState) => {
      expect(draftSendOutcome({ ...inFlight(), deliveryState })).toMatchObject({
        status: "needs_review",
        deliveryOutcome: { state: deliveryState },
      });
    },
  );
});
