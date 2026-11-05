import { expect, it } from "vitest";
import { DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { privacyRegistry, requireLifecycleCapability } from "./registry";

const tables = [
  "company_profiles",
  "company_legal_entities",
  "company_operations",
  "company_assets",
  "workspace_work_profiles",
  "work_types",
  "work_stages",
  "work_items",
  "work_operations",
  "work_installations",
];
it("classifies company/work stores without claiming unimplemented subject lifecycle adapters", () => {
  for (const table of tables) {
    const id = `table:${table}`;
    const entry = privacyRegistry.entries.find((item) => item.ids.includes(id));
    expect(entry, id).toBeDefined();
    expect(DISCOVERY_COVERAGE.find((item) => item.store === table)).toMatchObject({
      status: "unsupported",
    });
    expect(requireLifecycleCapability(privacyRegistry, id, "erasure")).toMatchObject({
      ok: false,
      error: { code: "capability_unavailable" },
    });
  }
});
