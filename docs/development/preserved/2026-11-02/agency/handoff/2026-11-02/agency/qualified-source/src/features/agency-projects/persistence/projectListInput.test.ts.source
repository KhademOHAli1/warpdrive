import { describe, expect, it } from "vitest";
import {
  projectListFilterKey,
  projectListFilterSchema,
  projectListRequestSchema,
} from "./projectListInput";

const ownerId = "abcdefab-1234-4abc-8def-1234567890ab";
const anchorId = "bcdefabc-2345-4bcd-9efa-234567890abc";

// Ingress only. These tests cannot prove SQL paging or native list admission.
describe("project-list versioned request and saved-filter boundary", () => {
  it("defaults to the three open states and explicit null selectors, without closed or archived rows", () => {
    expect(projectListRequestSchema.parse({ filters: { schemaVersion: 1 } })).toEqual({
      filters: {
        schemaVersion: 1,
        states: ["planned", "active", "on-hold"],
        ownerUserId: null,
        anchor: null,
      },
      pageSize: 25,
      cursor: null,
    });
  });

  it("retains every explicitly selected state in stable declared order", () => {
    expect(
      projectListFilterSchema.parse({
        schemaVersion: 1,
        states: ["archived", "canceled", "on-hold", "completed", "active", "planned"],
      }).states,
    ).toEqual(["planned", "active", "on-hold", "completed", "canceled", "archived"]);
    expect(
      projectListFilterSchema.parse({ schemaVersion: 1, states: ["archived"] }).states,
    ).toEqual(["archived"]);
  });

  it("normalizes native IDs and equivalent saved-filter ordering to one continuation key", () => {
    const first = projectListFilterSchema.parse({
      anchor: { id: anchorId.toUpperCase(), kind: "organization" },
      states: ["archived", "active"],
      ownerUserId: ownerId.toUpperCase(),
      schemaVersion: 1,
    });
    const equivalent = projectListFilterSchema.parse({
      schemaVersion: 1,
      states: ["active", "archived"],
      ownerUserId: ownerId,
      anchor: { kind: "organization", id: anchorId },
    });
    expect(first).toEqual(equivalent);
    expect(projectListFilterKey(first)).toBe(
      '{"schemaVersion":1,"states":["active","archived"],"ownerUserId":"' +
        ownerId +
        '","anchor":{"kind":"organization","id":"' +
        anchorId +
        '"}}',
    );
    expect(projectListFilterKey(first)).toBe(projectListFilterKey(equivalent));
  });

  it.each([
    { name: "missing filter version", value: {} },
    { name: "future filter version", value: { schemaVersion: 2 } },
    { name: "string filter version", value: { schemaVersion: "1" } },
    { name: "null filter", value: null },
    { name: "array filter", value: [] },
    { name: "empty states", value: { schemaVersion: 1, states: [] } },
    { name: "unknown state", value: { schemaVersion: 1, states: ["all"] } },
    { name: "duplicate states", value: { schemaVersion: 1, states: ["active", "active"] } },
    { name: "non-array states", value: { schemaVersion: 1, states: "active" } },
    { name: "null states", value: { schemaVersion: 1, states: null } },
    { name: "invalid owner", value: { schemaVersion: 1, ownerUserId: "all" } },
    {
      name: "unsupported anchor",
      value: { schemaVersion: 1, anchor: { kind: "user", id: ownerId } },
    },
    { name: "invalid anchor ID", value: { schemaVersion: 1, anchor: { kind: "deal", id: "" } } },
    {
      name: "extra anchor operator",
      value: {
        schemaVersion: 1,
        anchor: { kind: "person", id: anchorId, operator: "or" },
      },
    },
    { name: "legacy financial filter", value: { schemaVersion: 1, currency: "EUR" } },
    { name: "unknown filter operator", value: { schemaVersion: 1, operator: "or" } },
  ])("rejects a $name instead of widening its saved view", ({ value }) => {
    expect(projectListFilterSchema.safeParse(value).success).toBe(false);
    expect(projectListRequestSchema.safeParse({ filters: value }).success).toBe(false);
  });

  it.each(["actorUserId", "sessionId", "isAdmin", "canRead", "moduleEnabled", "privacyAllowed"])(
    "rejects browser authority field %s at both request and saved-filter boundaries",
    (field) => {
      expect(
        projectListRequestSchema.safeParse({
          filters: { schemaVersion: 1 },
          [field]: true,
        }).success,
      ).toBe(false);
      expect(projectListFilterSchema.safeParse({ schemaVersion: 1, [field]: true }).success).toBe(
        false,
      );
    },
  );

  it.each([1, 100])("accepts the explicit page boundary %i", (pageSize) => {
    expect(
      projectListRequestSchema.parse({ filters: { schemaVersion: 1 }, pageSize }).pageSize,
    ).toBe(pageSize);
  });

  it.each([0, 101, -1, 1.5, "25", null])("rejects invalid page size %j", (pageSize) => {
    expect(
      projectListRequestSchema.safeParse({
        filters: { schemaVersion: 1 },
        pageSize,
      }).success,
    ).toBe(false);
  });

  it.each([{}, { pageSize: 25 }, { filters: { schemaVersion: 1 }, total: true }])(
    "rejects a missing filter or unknown request option: %j",
    (value) => {
      expect(projectListRequestSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(["", "a".repeat(2_049), 12, {}])("rejects invalid cursor envelope %j", (cursor) => {
    expect(
      projectListRequestSchema.safeParse({
        filters: { schemaVersion: 1 },
        cursor,
      }).success,
    ).toBe(false);
  });

  it("retains a supplied opaque cursor for separate strict decoding", () => {
    const cursor = "eyJzY2hlbWFWZXJzaW9uIjoxfQ";
    expect(projectListRequestSchema.parse({ filters: { schemaVersion: 1 }, cursor }).cursor).toBe(
      cursor,
    );
  });
});
