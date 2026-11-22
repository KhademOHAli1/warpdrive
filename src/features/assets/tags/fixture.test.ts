import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { runAssetTagFixture } from "./fixtureCommands";
import {
  knownFixtureTag,
  knownUnlinkedFixtureTag,
  projectAssetTagFixture,
  readAssetTagFixture,
} from "./fixtureData";
import {
  openOwnerContactFixture,
  scanAssetTagFixture,
  sendOwnerMessageFixture,
} from "./fixtureScans";
import { assetTagLink, assetTagText } from "./tagCodes";

const origin = "https://warpdrive.test";
const manager = "7e47fec2-9021-4e69-8d4a-d894b9095d8d";
const viewer = "c720251f-20b8-49b3-b3f0-eefc3d985735";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    crypto,
    btoa,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

function demo() {
  const workspace = projectAssetTagFixture(readAssetTagFixture(), true);
  const linked = workspace.tags.find(({ token }) => token === knownFixtureTag);
  const free = workspace.tags.find(({ token }) => token === knownUnlinkedFixtureTag);
  assert(linked?.assignment != null && free !== undefined);
  return { workspace, linked, assignment: linked.assignment, free };
}

it("issues a printable batch of one hundred unique site tags and replays the same receipt", () => {
  const { linked } = demo();
  const command = {
    type: "createBatch",
    requestId: crypto.randomUUID(),
    siteId: linked.siteId,
    count: 100,
    title: "Production instruments",
  };
  const result = runAssetTagFixture(true, command);
  assert(result.ok);
  const tags = result.value.tags.filter(({ batchId }) => batchId === result.batchId);
  expect(tags).toHaveLength(100);
  expect(new Set(tags.map(({ token }) => assetTagLink(origin, token))).size).toBe(100);
  expect(
    tags.every(({ assignment, siteId }) => assignment === null && siteId === linked.siteId),
  ).toBe(true);
  expect(runAssetTagFixture(true, command)).toEqual(result);
  expect(runAssetTagFixture(false, command)).toEqual({ ok: false, error: "unavailable" });
});

it("swaps a tag once, preserves both assignment events and removes old public contact", () => {
  const { linked, assignment, free } = demo();
  expect(openOwnerContactFixture(linked.token)).toBe(assignment.id);
  const command = {
    type: "swap",
    requestId: crypto.randomUUID(),
    tagId: free.id,
    previousTagId: linked.id,
    assignmentId: assignment.id,
  };
  const result = runAssetTagFixture(true, command);
  assert(result.ok);
  expect(result.value.tags.find(({ id }) => id === linked.id)?.assignment).toBeNull();
  expect(result.value.tags.find(({ id }) => id === free.id)?.assignment).toMatchObject({
    target: { kind: assignment.target.kind, id: assignment.target.id },
    ownerContact: false,
  });
  expect(result.value.events.map(({ kind }) => kind)).toEqual(["swap", "unlink", "claim"]);
  expect(openOwnerContactFixture(linked.token)).toBeNull();
  expect(openOwnerContactFixture(free.token)).toBeNull();
  expect(runAssetTagFixture(true, command)).toEqual(result);
  expect(runAssetTagFixture(true, { ...command, requestId: crypto.randomUUID() })).toEqual({
    ok: false,
    error: "state",
  });
});

it("deduplicates scans and captures opted-in coordinates only for managers to review", () => {
  const { linked, assignment } = demo();
  const raw = { identifier: assetTagText(linked.token), source: "manual", coordinates: null };
  const geo = { latitude: 50, longitude: 11, accuracy: 12 };
  const expected = { ok: true, tagId: linked.id, assignmentId: assignment.id };
  expect(scanAssetTagFixture(viewer, false, origin, raw)).toMatchObject(expected);
  expect(scanAssetTagFixture(viewer, false, origin, { ...raw, coordinates: geo })).toMatchObject(
    expected,
  );
  const state = readAssetTagFixture();
  expect(projectAssetTagFixture(state, false).scans).toMatchObject([{ coordinates: null }]);
  expect(projectAssetTagFixture(state, true).scans).toMatchObject([{ coordinates: geo }]);
  expect(
    scanAssetTagFixture(manager, true, origin, {
      ...raw,
      identifier: assetTagText("333333333333333333333C"),
    }),
  ).toEqual({ ok: false, error: "unavailable" });
});

it("records one anonymous owner message and restricts it to the managing view", () => {
  const { linked, assignment, free } = demo();
  const command = {
    requestId: crypto.randomUUID(),
    token: linked.token,
    replyTo: null,
    message: "Found a meter.",
  };
  expect(sendOwnerMessageFixture(command, assignment.id)).toEqual({ ok: true });
  expect(sendOwnerMessageFixture(command, assignment.id)).toEqual({ ok: true });
  const found = projectAssetTagFixture(readAssetTagFixture(), true).messages;
  expect(found).toMatchObject([{ tagId: linked.id, message: command.message, readAt: null }]);
  expect(projectAssetTagFixture(readAssetTagFixture(), false).messages).toEqual([]);
  expect(sendOwnerMessageFixture({ ...command, token: free.token }, assignment.id)).toEqual({
    ok: false,
    error: "unavailable",
  });
  const updated = runAssetTagFixture(true, {
    type: "markMessageRead",
    requestId: crypto.randomUUID(),
    messageId: command.requestId,
  });
  assert(updated.ok);
  expect(updated.value.messages[0]?.readAt).not.toBeNull();
});

it("rejects a public form retained across reassignment even when the tag opts back in", () => {
  const { linked, assignment, workspace } = demo();
  const next = workspace.targets.find(
    ({ id, siteId }) => id !== assignment.target.id && siteId === linked.siteId,
  );
  assert(next !== undefined);
  const original = openOwnerContactFixture(linked.token);
  assert(original !== null);
  assert(
    runAssetTagFixture(true, {
      type: "unlink",
      requestId: crypto.randomUUID(),
      tagId: linked.id,
      assignmentId: original,
    }).ok,
  );
  const nextClaim = runAssetTagFixture(true, {
    type: "claim",
    requestId: crypto.randomUUID(),
    tagId: linked.id,
    target: { kind: next.kind, id: next.id },
  });
  assert(nextClaim.ok);
  const active = nextClaim.value.tags.find(({ id }) => id === linked.id)?.assignment;
  assert(active != null && active.id !== original);
  assert(
    runAssetTagFixture(true, {
      type: "setOwnerContact",
      requestId: crypto.randomUUID(),
      tagId: linked.id,
      assignmentId: active.id,
      enabled: true,
    }).ok,
  );
  const message = {
    requestId: crypto.randomUUID(),
    token: linked.token,
    replyTo: null,
    message: "Old form.",
  };
  expect(sendOwnerMessageFixture(message, original)).toEqual({ ok: false, error: "unavailable" });
  expect(sendOwnerMessageFixture(message, active.id)).toEqual({ ok: true });
});

it("imports legacy IDs atomically and keeps a self-hosted alias bound to its stored origin", () => {
  const { linked, assignment, workspace } = demo();
  const candidates = workspace.targets.filter(
    ({ id, siteId }) => id !== assignment.target.id && siteId === linked.siteId,
  );
  const [first, second] = candidates;
  assert(first !== undefined && second !== undefined);
  const assigned = { kind: first.kind, id: first.id };
  const base = { type: "importLegacy", siteId: linked.siteId, title: "Legacy cards" };
  const firstSource = "https://warehouse.example.test";
  const secondSource = "https://engineering.example.test";
  const identifier = "meter0001x";
  const targets = [
    { identifier: `${firstSource}/qr/${identifier}`, target: assigned },
    { identifier: "invalid", target: { kind: second.kind, id: second.id } },
  ];
  expect(
    runAssetTagFixture(true, {
      ...base,
      requestId: crypto.randomUUID(),
      approvedLegacyOrigin: firstSource,
      entries: targets,
    }),
  ).toEqual({ ok: false, error: "invalid" });
  expect(readAssetTagFixture().tags).toHaveLength(2);
  assert(
    runAssetTagFixture(true, {
      ...base,
      requestId: crypto.randomUUID(),
      approvedLegacyOrigin: firstSource,
      entries: targets.slice(0, 1),
    }).ok,
  );
  assert(
    runAssetTagFixture(true, {
      ...base,
      requestId: crypto.randomUUID(),
      approvedLegacyOrigin: secondSource,
      entries: [
        {
          identifier: `${secondSource}/qr/meter0002y`,
          target: { kind: second.kind, id: second.id },
        },
      ],
    }).ok,
  );
  const scan = (value: string) =>
    scanAssetTagFixture(viewer, false, origin, {
      identifier: value,
      source: "manual",
      coordinates: null,
    });
  expect(scan(identifier)).toMatchObject({ ok: true, target: assigned });
  expect(scan(`${firstSource}/qr/${identifier}`)).toMatchObject({ ok: true, target: assigned });
  expect(scan(`${secondSource}/qr/${identifier}`)).toEqual({ ok: false, error: "unavailable" });
});
