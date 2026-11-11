import { expect, it } from "vitest";
import {
  audienceApprovalLifetimeMs,
  signAudienceApproval,
  verifyAudienceApproval,
} from "./approval";

const now = 1_794_352_000_000;
const approved = {
  actor: "staff-1",
  campaignRevision: "2026-11-10T20:00:00Z",
  viewRevision: "2026-11-10T20:00:00Z",
  purposeList: 12,
  grants: ["first-grant", "second-grant"],
};

it("binds approval to the actor, exact campaign and view revisions, purpose, and grants", () => {
  const token = signAudienceApproval(approved, now);
  expect(verifyAudienceApproval(token, approved, now + 10)).toBe(true);
  for (const scope of [
    { ...approved, actor: "staff-2" },
    { ...approved, campaignRevision: "2026-11-10T20:01:00Z" },
    { ...approved, viewRevision: "2026-11-10T20:01:00Z" },
    { ...approved, purposeList: 13 },
    { ...approved, grants: ["first-grant", "new-consent-grant"] },
  ]) {
    expect(verifyAudienceApproval(token, scope, now + 10)).toBe(false);
  }
});

it("rejects expired, future, and malformed approvals", () => {
  const token = signAudienceApproval(approved, now);
  expect(verifyAudienceApproval(token, approved, now - 1)).toBe(false);
  expect(verifyAudienceApproval(token, approved, now + audienceApprovalLifetimeMs + 1)).toBe(false);
  expect(verifyAudienceApproval(token.slice(0, -2), approved, now)).toBe(false);
});
