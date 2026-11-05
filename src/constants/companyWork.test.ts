import { expect, it } from "vitest";
import { ERROR_IDS } from "./errorIds";
import { GLOBAL_FLAGS, HIGH_RISK_FLAGS, REGULAR_DEFAULT_FLAGS } from "./permissionFlags";

it("registers company/work capabilities without silently granting them to regular members", () => {
  for (const flag of [
    "company.profile.manage",
    "company.legal.manage",
    "work.view",
    "work.create",
    "work.change",
    "work.manage",
  ] as const) {
    expect(GLOBAL_FLAGS).toContain(flag);
    expect(REGULAR_DEFAULT_FLAGS[flag]).toBe(false);
  }
  expect(HIGH_RISK_FLAGS).toContain("company.legal.manage");
  expect(HIGH_RISK_FLAGS).toContain("work.manage");
});
it("assigns distinct stable identifiers to company and work failure causes", () => {
  expect(ERROR_IDS).toMatchObject({
    COMPANY_DENIED: "E_COMPANY_001",
    COMPANY_INPUT_INVALID: "E_COMPANY_002",
    COMPANY_CONFLICT: "E_COMPANY_003",
    COMPANY_NOT_FOUND: "E_COMPANY_004",
    COMPANY_STORAGE_UNAVAILABLE: "E_COMPANY_005",
    COMPANY_ASSET_INVALID: "E_COMPANY_006",
    COMPANY_PROVIDER_UNAVAILABLE: "E_COMPANY_007",
    COMPANY_REPLAY_CONFLICT: "E_COMPANY_008",
    COMPANY_WRITE_FAILED: "E_COMPANY_009",
    WORK_DENIED: "E_WORK_001",
    WORK_INPUT_INVALID: "E_WORK_002",
    WORK_CONFLICT: "E_WORK_003",
    WORK_NOT_FOUND: "E_WORK_004",
    WORK_PREVIEW_STALE: "E_WORK_005",
    WORK_REPLAY_CONFLICT: "E_WORK_006",
    WORK_IN_USE: "E_WORK_007",
    WORK_WRITE_FAILED: "E_WORK_008",
  });
});
