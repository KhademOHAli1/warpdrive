import { describe, expect, it } from "vitest";
import { collectInventorySources, discoverInventorySources } from "./registryDiscovery";

describe("inventory cancellation and read errors", () => {
  it("returns a bounded operational failure for an unavailable source root", async () => {
    await expect(
      collectInventorySources("/nonexistent-warpdrive-source", AbortSignal.timeout(1000)),
    ).resolves.toEqual({
      ok: false,
      error: { code: "inventory_read_failed" },
    });
  });

  it("preserves cancellation instead of classifying it as an ordinary read failure", async () => {
    const signal = AbortSignal.abort();
    await expect(
      collectInventorySources("/nonexistent-warpdrive-source", signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(() => discoverInventorySources([], signal)).toThrow();
  });
});

describe("schema aliases and non-public tables", () => {
  it.each([
    [
      'import { pgTable as define } from "drizzle-orm/pg-core"; export const people = define("unreviewed_people", {});',
      "table:unreviewed_people",
    ],
    [
      'import { pgSchema } from "drizzle-orm/pg-core"; const privateSchema = pgSchema("custom"); export const people = privateSchema.table("unreviewed_people", {});',
      "table:custom.unreviewed_people",
    ],
  ])("discovers %s without assuming every table is public", (source, id) => {
    expect(
      discoverInventorySources(
        [{ path: "src/db/schema/added.ts", source }],
        AbortSignal.timeout(1000),
      ).map((item) => item.id),
    ).toContain(id);
  });
});

describe("filesystem and socket effect boundaries", () => {
  it.each([
    [
      'await Bun.write("private-records.json", contents);',
      "writer:src/features/new/edge.ts#write:private-records.json",
    ],
    ["socket.send(personalPayload);", "writer:src/features/new/edge.ts#send:personalPayload"],
  ])("discovers %s", (source, id) => {
    expect(
      discoverInventorySources(
        [{ path: "src/features/new/edge.ts", source }],
        AbortSignal.timeout(1000),
      ).map((item) => item.id),
    ).toContain(id);
  });
});

describe("imported Node transport and filesystem boundaries", () => {
  it.each([
    [
      'import { request as sendTls } from "node:https"; sendTls(target, options);',
      "external:src/features/new/edge.ts#https.request",
    ],
    [
      'import * as transport from "node:http"; transport.get(target);',
      "external:src/features/new/edge.ts#http.get",
    ],
    [
      'import { open as openConfig } from "node:fs/promises"; await openConfig(configPath, "r");',
      "objectNamespace:filesystem:src/features/new/edge.ts#open:configPath",
    ],
    [
      'import filesystem from "node:fs"; filesystem.readFileSync("subject.json");',
      "objectNamespace:filesystem:src/features/new/edge.ts#readFileSync:subject.json",
    ],
  ])("discovers imported boundary %s", (source, id) => {
    expect(
      discoverInventorySources(
        [{ path: "src/features/new/edge.ts", source }],
        AbortSignal.timeout(1000),
      ).map((item) => item.id),
    ).toContain(id);
  });
});
