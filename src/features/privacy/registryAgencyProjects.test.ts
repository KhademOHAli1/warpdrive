import { expect, test } from "vitest";
import { DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { privacyRegistry, requireLifecycleCapability } from "./registry";

test("agency project stores remain inventoried without unimplemented subject lifecycle authority", () => {
  for (const table of [
    "agency_projects",
    "agency_project_members",
    "agency_project_history",
    "agency_project_requests",
    "agency_project_settings",
  ]) {
    const id = `table:${table}`;
    const entry = privacyRegistry.entries.find((item) => item.ids.includes(id));
    expect(entry, id).toBeDefined();
    expect(DISCOVERY_COVERAGE.find((item) => item.store === table)).toMatchObject({
      status: "unsupported",
    });
    for (const operation of [
      "discovery",
      "export",
      "rectification",
      "restriction",
      "erasure",
      "retention",
    ] as const) {
      expect(requireLifecycleCapability(privacyRegistry, id, operation)).toMatchObject({
        ok: false,
        error: { code: "capability_unavailable" },
      });
    }
    expect(entry?.disclosure).toContain("membership");
    expect(entry?.retention).toContain("key");
  }
});
