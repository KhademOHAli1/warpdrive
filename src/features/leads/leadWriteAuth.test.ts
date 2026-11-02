import { describe, expect, it } from "vitest";
import type { LeadSession } from "./leadActions";
import { canLeadAction } from "./leadWriteAuth";

const ownerId = "00000000-0000-0000-0000-000000000001";
const viewerId = "00000000-0000-0000-0000-000000000002";
const lead = {
  ownerId,
  visibilityLevel: "all" as const,
  visibilityGroupId: null,
  visibleToUserIds: [],
};

function session(userId: string, flags: Record<string, boolean>): LeadSession {
  return {
    userId,
    isAdmin: false,
    isActive: true,
    sessionLive: true,
    visibilityGroupIds: [],
    managedUserIds: [],
    primaryVisibilityGroupId: null,
    flags,
  };
}

describe("lead write authorization", () => {
  it("does not treat read visibility or deal.create as an edit grant", () => {
    const viewer = session(viewerId, { "deal.create": true });
    expect(canLeadAction(viewer, "deal.edit", lead)).toBe(false);
    expect(canLeadAction(viewer, "deal.delete", lead)).toBe(false);
  });

  it("honors own, any, and distinct delete capabilities", () => {
    expect(canLeadAction(session(ownerId, { "deal.edit_own": true }), "deal.edit", lead)).toBe(
      true,
    );
    expect(canLeadAction(session(viewerId, { "deal.edit_own": true }), "deal.edit", lead)).toBe(
      false,
    );
    expect(canLeadAction(session(viewerId, { "deal.edit_any": true }), "deal.edit", lead)).toBe(
      true,
    );
    expect(canLeadAction(session(ownerId, { "deal.edit_own": true }), "deal.delete", lead)).toBe(
      false,
    );
    expect(canLeadAction(session(ownerId, { "deal.delete_own": true }), "deal.delete", lead)).toBe(
      true,
    );
  });

  it("rejects an inactive or expired actor even if an edit flag is present", () => {
    const active = session(ownerId, { "deal.edit_any": true });
    expect(canLeadAction({ ...active, isActive: false }, "deal.edit", lead)).toBe(false);
    expect(canLeadAction({ ...active, sessionLive: false }, "deal.edit", lead)).toBe(false);
  });
});
