import { expect, it } from "vitest";
import type { EquipmentAuditSummary, EquipmentAuditWorkspace } from "../contracts";
import { latestAuditWorkspace } from "./workspaceSnapshot";

const empty: EquipmentAuditWorkspace = { viewerId: "staff", sites: [], audits: [] };
const ownSite = {
  id: "site",
  name: "Workshop",
  canManage: true,
  locations: [],
  targets: [],
  categories: [],
  tags: [],
  auditors: [],
};

const initialAudit: EquipmentAuditSummary = {
  id: "audit",
  siteId: ownSite.id,
  version: 1,
  title: "Equipment count",
  status: "draft",
  archived: false,
  createdAt: "2026-11-22T09:00:00.000Z",
  dueAt: null,
  startedAt: null,
  completedAt: null,
  reviewedAt: null,
  assignees: [],
  progress: {
    expectedRows: 0,
    foundRows: 0,
    outstandingRows: 0,
    missingRows: 0,
    unexpectedRows: 0,
    expectedUnits: 0,
    foundUnits: 0,
    missingUnits: 0,
    unexpectedUnits: 0,
  },
};

it("keeps a completed action when an older render arrives and honors subsequent scope loss", () => {
  const oldRender = { ...empty, readAt: 20 };
  const saved = { ...empty, readAt: 30, sites: [ownSite] };
  const restricted = { ...empty, readAt: 40 };

  expect(latestAuditWorkspace(saved, oldRender)).toBe(saved);
  expect(latestAuditWorkspace(saved, restricted)).toBe(restricted);
  expect(latestAuditWorkspace(restricted, saved)).toBe(restricted);
});

it("keeps a versioned workspace across duplicates, legacy responses and another actor's action", () => {
  const saved = { ...empty, readAt: 30 };

  expect(latestAuditWorkspace(saved, { ...saved })).toBe(saved);
  expect(latestAuditWorkspace(saved, empty)).toBe(saved);
  expect(latestAuditWorkspace(saved, { ...saved, viewerId: "prior-viewer", readAt: 40 })).toBe(
    saved,
  );
});

it("accepts unversioned fixture action results for the current viewer", () => {
  const saved = { ...empty, sites: [ownSite] };
  expect(latestAuditWorkspace(empty, saved)).toBe(saved);
});

it("keeps a known audit version inside the latest scope and drops missing audits", () => {
  const known = { ...initialAudit, version: 2, title: "Workshop equipment count" };
  const current = {
    ...empty,
    readAt: 30,
    sites: [ownSite],
    audits: [known, { ...initialAudit, id: "removed" }],
  };
  const refreshed = {
    ...empty,
    readAt: 40,
    sites: [{ ...ownSite, canManage: false }],
    audits: [initialAudit],
  };
  expect(latestAuditWorkspace(current, refreshed)).toEqual({ ...refreshed, audits: [known] });
});
