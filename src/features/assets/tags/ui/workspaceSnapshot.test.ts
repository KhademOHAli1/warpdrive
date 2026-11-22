import { expect, it } from "vitest";
import type { AssetTagWorkspace } from "../contracts";
import { latestTagWorkspace } from "./workspaceSnapshot";

const empty: AssetTagWorkspace = {
  sites: [],
  targets: [],
  batches: [],
  tags: [],
  events: [],
  scans: [],
  messages: [],
};

it("keeps a completed write when a pre-write server render arrives late", () => {
  const stale = { ...empty, readAt: 2 };
  const saved = {
    ...empty,
    readAt: 3,
    sites: [{ id: "site", code: "HQ", name: "Headquarters", canManage: true }],
  };
  const accessChanged = { ...empty, readAt: 4 };

  expect(latestTagWorkspace(saved, stale)).toBe(saved);
  expect(latestTagWorkspace(saved, accessChanged)).toBe(accessChanged);
  expect(latestTagWorkspace(accessChanged, saved)).toBe(accessChanged);
});

it("accepts unversioned fixture updates", () => {
  const updated = { ...empty };
  expect(latestTagWorkspace(empty, updated)).toBe(updated);
});
