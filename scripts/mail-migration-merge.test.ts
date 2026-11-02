import { describe, expect, it } from "vitest";
import { appendForwardJournal, mergeSnapshot } from "./mail-migration-merge";

const base = {
  id: "168c84d2-83f8-4fe7-a5a0-99b5060dc9d7",
  prevId: "1183c1b4-465c-4171-ba80-e370babd455f",
  version: "7",
  dialect: "postgresql",
  tables: {
    "public.shared": {
      columns: { id: { type: "uuid" } },
      checkConstraints: { stable: { value: "id IS NOT NULL" } },
    },
  },
  enums: {},
  schemas: {},
  sequences: {},
  roles: {},
  policies: {},
  views: {},
  _meta: { columns: {}, tables: {}, schemas: {} },
};

describe("mail migration structural reconciliation", () => {
  it("retains disjoint platform tables and nested mail fields with a new chain", () => {
    const platform = structuredClone(base);
    const mail = structuredClone(base);
    const result = mergeSnapshot(
      base,
      {
        ...platform,
        tables: {
          ...platform.tables,
          "public.workflows": {
            columns: {},
            checkConstraints: { pinned: { value: "revision > 0" } },
          },
        },
      },
      {
        ...mail,
        tables: {
          "public.shared": {
            ...mail.tables["public.shared"],
            columns: { ...mail.tables["public.shared"].columns, provider: { type: "text" } },
          },
        },
      },
      "previous",
      "fresh",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: "fresh",
      prevId: "previous",
      tables: {
        "public.workflows": { checkConstraints: { pinned: { value: "revision > 0" } } },
        "public.shared": {
          columns: { id: { type: "uuid" }, provider: { type: "text" } },
          checkConstraints: { stable: { value: "id IS NOT NULL" } },
        },
      },
    });
  });

  it("stops at the exact conflicting shared field", () => {
    const p = { ...base, tables: { shared: { columns: { id: { type: "text" } } } } };
    const m = { ...base, tables: { shared: { columns: { id: { type: "bigint" } } } } };
    const b = { ...base, tables: { shared: { columns: { id: { type: "uuid" } } } } };
    expect(mergeSnapshot(b, p, m, "previous", "fresh")).toEqual({
      ok: false,
      error: { kind: "conflict", paths: ["/tables/shared/columns/id/type"] },
    });
  });

  it("does not union ordered arrays or hide delete/edit collisions", () => {
    const b = { ...base, tables: { t: { columns: ["account", "id"], check: "old" } } };
    const p = { ...base, tables: { t: { columns: ["id", "account"], check: "changed" } } };
    const m = { ...base, tables: { t: { columns: ["account", "provider"] } } };
    expect(mergeSnapshot(b, p, m, "previous", "fresh")).toEqual({
      ok: false,
      error: { kind: "conflict", paths: ["/tables/t/check", "/tables/t/columns"] },
    });
  });

  it("rejects incompatible snapshot versions and competing new objects", () => {
    expect(mergeSnapshot(base, { ...base, version: "8" }, base, "previous", "fresh").ok).toBe(
      false,
    );
    const p = { ...base, tables: { ...base.tables, duplicate: { name: "platform" } } };
    const m = { ...base, tables: { ...base.tables, duplicate: { name: "mail" } } };
    expect(mergeSnapshot(base, p, m, "previous", "fresh")).toEqual({
      ok: false,
      error: { kind: "conflict", paths: ["/tables/duplicate"] },
    });
  });

  it("preserves journal prefix bytes and makes every appended timestamp forward", () => {
    const prefix = JSON.stringify(
      {
        version: "7",
        dialect: "postgresql",
        entries: [
          {
            idx: 84,
            version: "7",
            when: 1793452709228,
            tag: "0084_visual_workflows",
            breakpoints: true,
          },
        ],
      },
      null,
      2,
    );
    const result = appendForwardJournal(prefix, ["0085_natural_deathstrike", "0086_military_loki"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text.startsWith(prefix.slice(0, prefix.lastIndexOf("\n  ]")))).toBe(true);
    expect(result.value.entries.map((entry) => [entry.idx, entry.when])).toEqual([
      [85, 1793452709229],
      [86, 1793452709230],
    ]);
    expect(JSON.parse(result.value.text).entries).toHaveLength(3);
  });
});
