import { describe, expect, it } from "vitest";
import { checkRegistryCoverage, privacyRegistry, requireLifecycleCapability } from "./registry";

describe("fail-closed registry declarations", () => {
  it("rejects an entry with no store identifiers", () => {
    const entry = privacyRegistry.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(checkRegistryCoverage([], { version: 1, entries: [{ ...entry, ids: [] }] }).ok).toBe(
      false,
    );
  });

  it("does not permit a supported operation from an invalid or unexplained registry", () => {
    const entry = privacyRegistry.entries[0];
    const id = entry?.ids[0];
    expect(id).toBeDefined();
    if (entry === undefined || id === undefined) return;
    const capabilities = {
      ...entry.capabilities,
      export: { status: "supported" as const, reason: " ", task: "DPL-08" },
    };
    expect(
      requireLifecycleCapability(
        { version: 1, entries: [{ ...entry, capabilities }] },
        id,
        "export",
      ).ok,
    ).toBe(false);
    expect(
      requireLifecycleCapability(
        {
          version: 0,
          entries: [
            {
              ...entry,
              capabilities: {
                ...capabilities,
                export: { ...capabilities.export, reason: "Qualified evidence" },
              },
            },
          ],
        },
        id,
        "export",
      ).ok,
    ).toBe(false);
  });
});
