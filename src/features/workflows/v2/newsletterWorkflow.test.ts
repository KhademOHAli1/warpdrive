import { describe, expect, it } from "vitest";
import { findSharedBlock } from "@/features/blocks/catalog";
import { validateResolvedBlockConfig } from "@/features/blocks/schemas";
import { validWorkflowV2Trigger } from "./readiness";

const personId = "51fab8a3-0660-44a3-9bf4-0c2b36f9a40b";
const linkId = "fbc1ba9a-09dd-4c3b-906f-3ad09b2e0531";

describe("newsletter workflow contracts", () => {
  it("registers governed effects and accepts only opaque target identifiers", () => {
    expect(findSharedBlock("NEWSLETTER_CONSENT_STATUS")?.effect).toBe("external");
    expect(findSharedBlock("NEWSLETTER_INVITE")?.effect).toBe("external");
    expect(
      validateResolvedBlockConfig("NEWSLETTER_CONSENT_STATUS", { personId, listId: 4 }).success,
    ).toBe(true);
    expect(
      validateResolvedBlockConfig("NEWSLETTER_INVITE", { personId, linkId, listId: 4 }).success,
    ).toBe(true);
    expect(
      validateResolvedBlockConfig("NEWSLETTER_INVITE", {
        personId,
        linkId,
        listId: 4,
        email: "arbitrary@example.test",
      }).success,
    ).toBe(false);
  });

  it("accepts only verified event trigger configurations", () => {
    expect(validWorkflowV2Trigger({ type: "newsletter.identity.verified", config: {} })).toBe(true);
    expect(
      validWorkflowV2Trigger({ type: "newsletter.consent.confirmed", config: { listId: 4 } }),
    ).toBe(true);
    expect(
      validWorkflowV2Trigger({ type: "newsletter.consent.confirmed", config: { listId: "4" } }),
    ).toBe(false);
    expect(
      validWorkflowV2Trigger({
        type: "newsletter.identity.verified",
        config: { objectName: "person" },
      }),
    ).toBe(false);
  });
});
