import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkRegistryCoverage, privacyRegistry, requireLifecycleCapability } from "./registry";
import {
  collectInventorySources,
  discoverInventorySources as discoverSources,
} from "./registryDiscovery";
import type { InventorySource } from "./registryTypes";

function discoverInventorySources(sources: InventorySource[]) {
  return discoverSources(sources, AbortSignal.timeout(30_000));
}

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("privacy inventory (P01A/P01B)", () => {
  it("classifies independently discovered production stores and effect boundaries", async () => {
    const sources = await collectInventorySources(root, AbortSignal.timeout(30_000));
    expect(sources.ok).toBe(true);
    if (!sources.ok) return;
    const discovered = discoverInventorySources(sources.value);
    expect(discovered.filter((item) => item.kind === "table").length).toBeGreaterThan(70);
    expect(discovered.some((item) => item.id === "table:change_logs")).toBe(true);
    expect(discovered.some((item) => item.kind === "writer")).toBe(true);
    expect(discovered.some((item) => item.kind === "queue")).toBe(true);
    expect(discovered.some((item) => item.kind === "objectNamespace")).toBe(true);
    expect(checkRegistryCoverage(discovered, privacyRegistry)).toEqual({
      ok: true,
      missing: [],
      invalid: [],
    });
  });

  it("binds every declared source review to its actual current bytes, including opaque UI and configuration", async () => {
    const stale: string[] = [];
    const signal = AbortSignal.timeout(30_000);
    for (const entry of privacyRegistry.entries) {
      for (const id of entry.ids) {
        const review = /^sourceReview:(.+)#([a-f0-9]{64})$/u.exec(id);
        if (review === null) continue;
        const source = await readFile(path.join(root, review[1]!), { signal });
        if (createHash("sha256").update(source).digest("hex") !== review[2]) stale.push(id);
      }
    }
    expect(stale).toEqual([]);
  });

  it.each([
    [
      "src/db/schema/new.ts",
      'export const added = pgTable("unreviewed_people", {});',
      "table:unreviewed_people",
    ],
    [
      "src/features/new/writer.ts",
      "await db.insert(unreviewedPeople).values(payload)",
      "writer:src/features/new/writer.ts#insert:unreviewedPeople",
    ],
    [
      "src/features/new/queue.ts",
      'const NEW_QUEUE = "unreviewed.send"; await boss.send(NEW_QUEUE, payload);',
      "queue:unreviewed.send",
    ],
    [
      "src/features/new/objects.ts",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source.
      "await storage.presignPost(`unreviewed/${id}`, mime, signal);",
      "objectNamespace:unreviewed/",
    ],
    [
      "src/features/new/objects.ts",
      "await storage.presignPost(dynamicKey, mime, signal);",
      "writer:src/features/new/objects.ts#presignPost:dynamicKey",
    ],
    [
      "src/features/new/remote.ts",
      'await fetch("https://unreviewed.example.test", { signal });',
      "external:src/features/new/remote.ts#fetch",
    ],
  ])("rejects an undeclared boundary in %s", (path, source, expected) => {
    const report = checkRegistryCoverage(
      discoverInventorySources([{ path, source }]),
      privacyRegistry,
    );
    expect(report.ok).toBe(false);
    expect(report.missing).toContain(expected);
  });

  it("does not confuse ownership with reviewed subject identity or claim unsupported erasure", () => {
    const people = privacyRegistry.entries.find((entry) => entry.ids.includes("table:persons"));
    expect(people?.subjectRelation).toContain("owner");
    expect(people?.subjectRelation).toContain("review");
    const result = requireLifecycleCapability(privacyRegistry, "table:change_logs", "erasure");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "capability_unavailable", task: "DPL-16" },
    });
    expect(requireLifecycleCapability(privacyRegistry, "table:missing", "export")).toMatchObject({
      ok: false,
      error: { code: "unclassified_store" },
    });
  });

  it("rejects incomplete or duplicate classifications rather than silently filling defaults", () => {
    const entry = privacyRegistry.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const duplicate = checkRegistryCoverage([], { ...privacyRegistry, entries: [entry, entry] });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.invalid).toContain(`duplicate:${entry.ids[0]}`);
    const incomplete = checkRegistryCoverage([], {
      ...privacyRegistry,
      entries: [{ ...entry, purpose: "" }],
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.invalid).toContain(`incomplete:${entry.ids[0]}`);
  });
});

describe("inventory boundary drift", () => {
  it("detects a changed queued payload even when its queue name stays constant", () => {
    const before = {
      path: "src/features/example/queue.ts",
      source: 'await boss.send("existing.send", { subjectId });',
    };
    const after = {
      ...before,
      source: 'await boss.send("existing.send", { subjectId, privateBody });',
    };
    const first = discoverInventorySources([before]).map((item) => item.id);
    const changed = discoverInventorySources([after]).map((item) => item.id);
    expect(changed.some((id) => !first.includes(id))).toBe(true);
  });

  it("detects changed object key namespaces in an existing helper", () => {
    const before = {
      path: "src/features/example/keys.ts",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is TypeScript source.
      source: "export function buildObjectKey(id: string) { return `confirmed/${id}`; }",
    };
    const after = { ...before, source: before.source.replace("confirmed/", "unreviewed/") };
    expect(discoverInventorySources([after]).map((item) => item.id)).not.toEqual(
      discoverInventorySources([before]).map((item) => item.id),
    );
  });
});

describe("SDK and raw SQL inventory", () => {
  it.each([
    [
      'await db.q("UPDATE people SET value=$1", values)',
      "writer:src/features/new/edge.ts#q:UPDATE people SET value=$1",
    ],
    ["posthog.identify(id, { email });", "external:src/features/new/edge.ts#identify"],
    ["posthog.init(key, { api_host: host });", "external:src/features/new/edge.ts#init"],
    ["cache.setQueryData(key, personalData);", "derived:src/features/new/edge.ts#setQueryData"],
    [
      'localStorage.getItem("old-personal-data");',
      "browserStore:src/features/new/edge.ts#old-personal-data",
    ],
  ])("requires classification for %s", (source, expected) => {
    const report = checkRegistryCoverage(
      discoverInventorySources([{ path: "src/features/new/edge.ts", source }]),
      privacyRegistry,
    );
    expect(report.ok).toBe(false);
    expect(report.missing).toContain(expected);
  });
});

describe("boundary configuration drift", () => {
  it("requires fresh source review when the file entity namespace allowlist changes", () => {
    const path = "src/constants/fileEntityTypes.ts";
    const first = discoverInventorySources([
      { path, source: 'export const FILE_ENTITY_TYPE = ["person"];' },
    ]);
    const changed = discoverInventorySources([
      { path, source: 'export const FILE_ENTITY_TYPE = ["person", "new-kind"];' },
    ]);
    expect(first).toHaveLength(1);
    expect(changed[0]?.id).not.toBe(first[0]?.id);
  });
});
