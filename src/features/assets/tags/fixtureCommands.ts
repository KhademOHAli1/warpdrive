import {
  type AssetTagCommand,
  type AssetTagError,
  type AssetTagResult,
  type AssetTagTarget,
  type AssetTagTargetRef,
  assetTagCommand,
} from "./contracts";
import {
  type AssetTagFixtureState,
  type FixtureAssignment,
  type FixtureResultIds,
  type FixtureTag,
  fixtureAssetTagTargets,
  projectAssetTagFixture,
  readAssetTagFixture,
  writeAssetTagFixture,
} from "./fixtureData";
import { parseLegacyTagIdentifier } from "./legacyImport";

type FixtureChange = {
  state: AssetTagFixtureState;
  targets: AssetTagTarget[];
  now: string;
};

class FixtureTagFailure extends Error {
  constructor(readonly code: AssetTagError) {
    super(code);
  }
}

function fail(code: AssetTagError): never {
  throw new FixtureTagFailure(code);
}

function newToken() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  return window
    .btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .slice(0, -2);
}

function tagFrom({ state }: FixtureChange, id: string) {
  return state.tags.find((row) => row.id === id) ?? fail("unavailable");
}

function sameTarget(first: AssetTagTargetRef, second: AssetTagTargetRef) {
  return first.kind === second.kind && first.id === second.id;
}

function currentAssignment(tag: FixtureTag, assignmentId: string) {
  if (tag.assignment?.id !== assignmentId) fail("state");
  return tag.assignment;
}

function bindingEvent(
  change: FixtureChange,
  tag: FixtureTag,
  assignment: FixtureAssignment,
  kind: AssetTagFixtureState["events"][number]["kind"],
) {
  change.state.events.unshift({
    id: crypto.randomUUID(),
    tagId: tag.id,
    assignmentId: assignment.id,
    target: assignment.target,
    kind,
    at: change.now,
  });
}

function bindTag(
  change: FixtureChange,
  tag: FixtureTag,
  target: AssetTagTargetRef,
  kind: "claim" | "import" | "swap",
) {
  if (tag.assignment !== null) fail("state");
  if (!change.targets.some((row) => row.siteId === tag.siteId && sameTarget(row, target)))
    fail("unavailable");
  if (
    change.state.tags.some(
      ({ assignment }) => assignment !== null && sameTarget(assignment.target, target),
    )
  )
    fail("conflict");
  const assignment = {
    id: crypto.randomUUID(),
    target,
    assignedAt: change.now,
    ownerContact: false,
  };
  tag.assignment = assignment;
  bindingEvent(change, tag, assignment, kind);
}

type BatchCommand = Extract<AssetTagCommand, { type: "createBatch" | "importLegacy" }>;

function requireRoom(state: AssetTagFixtureState, count: number) {
  if (state.batches.length >= 500 || state.tags.length + count > 2_000) fail("state");
}

function addBatch(change: FixtureChange, { type, siteId, title }: BatchCommand) {
  const batch = {
    id: crypto.randomUUID(),
    siteId,
    title,
    source: type === "createBatch" ? ("printed" as const) : ("imported" as const),
    createdAt: change.now,
  };
  change.state.batches.unshift(batch);
  return batch;
}

function appendTag(
  { state }: FixtureChange,
  { id: batchId, siteId }: { id: string; siteId: string },
  ordinal: number,
  legacy: FixtureTag["legacy"] = null,
) {
  const tag = {
    id: crypto.randomUUID(),
    token: newToken(),
    siteId,
    batchId,
    ordinal,
    legacy,
    assignment: null,
  };
  state.tags.push(tag);
  return tag;
}

function importBatch(
  change: FixtureChange,
  command: Extract<BatchCommand, { type: "importLegacy" }>,
) {
  requireRoom(change.state, command.entries.length);
  const batch = addBatch(change, command);
  const existing = new Set(
    change.state.tags.flatMap(({ legacy }) => (legacy === null ? [] : [legacy.id])),
  );
  command.entries.forEach(({ identifier, target }, index) => {
    const legacy = parseLegacyTagIdentifier(identifier, command.approvedLegacyOrigin);
    if (legacy === null) fail("invalid");
    if (existing.has(legacy.id)) fail("conflict");
    existing.add(legacy.id);
    bindTag(change, appendTag(change, batch, index + 1, legacy), target, "import");
  });
  return batch.id;
}

function makeBatch(change: FixtureChange, command: BatchCommand) {
  if (!projectAssetTagFixture(change.state, true).sites.some(({ id }) => id === command.siteId))
    fail("unavailable");
  if (command.type === "importLegacy") return importBatch(change, command);
  requireRoom(change.state, command.count);
  const batch = addBatch(change, command);
  for (let index = 0; index < command.count; index += 1) appendTag(change, batch, index + 1);
  return batch.id;
}

type TagCommand = Exclude<AssetTagCommand, BatchCommand | { type: "markMessageRead" }>;

function moveBinding(
  change: FixtureChange,
  tag: FixtureTag,
  { previousTagId, assignmentId }: Extract<TagCommand, { type: "swap" }>,
) {
  const previous = tagFrom(change, previousTagId);
  if (tag.siteId !== previous.siteId) fail("unavailable");
  if (tag.id === previous.id || tag.assignment !== null) fail("state");
  const assignment = currentAssignment(previous, assignmentId);
  previous.assignment = null;
  bindingEvent(change, previous, assignment, "unlink");
  bindTag(change, tag, assignment.target, "swap");
}

function changeTag(change: FixtureChange, command: TagCommand) {
  const tag = tagFrom(change, command.tagId);
  if (command.type === "claim") bindTag(change, tag, command.target, "claim");
  else if (command.type === "swap") moveBinding(change, tag, command);
  else {
    const assignment = currentAssignment(tag, command.assignmentId);
    if (command.type === "setOwnerContact") {
      assignment.ownerContact = command.enabled;
      bindingEvent(change, tag, assignment, "owner_contact");
    } else {
      tag.assignment = null;
      bindingEvent(change, tag, assignment, "unlink");
    }
  }
  return tag.id;
}

function applyChange(change: FixtureChange, command: AssetTagCommand): FixtureResultIds {
  if (command.type === "createBatch" || command.type === "importLegacy")
    return { batchId: makeBatch(change, command), tagId: null };
  if (command.type === "markMessageRead") {
    const message = change.state.messages.find(({ id }) => id === command.messageId);
    if (message === undefined) fail("unavailable");
    message.readAt ??= change.now;
    return { batchId: null, tagId: message.tagId };
  }
  return { batchId: null, tagId: changeTag(change, command) };
}

export function runAssetTagFixture(canManage: boolean, raw: unknown): AssetTagResult {
  if (!canManage) return { ok: false, error: "unavailable" };
  const parsed = assetTagCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data: command } = parsed;
  const stored = readAssetTagFixture();
  const signature = JSON.stringify(command);
  const prior = stored.receipts[command.requestId];
  if (prior !== undefined)
    return prior.signature === signature
      ? { ok: true, value: projectAssetTagFixture(stored, true), ...prior.focus }
      : { ok: false, error: "conflict" };

  try {
    const state = structuredClone(stored);
    const focus = applyChange(
      { state, targets: fixtureAssetTagTargets(true), now: new Date().toISOString() },
      command,
    );
    state.receipts[command.requestId] = { signature, focus };
    writeAssetTagFixture(state);
    return { ok: true, value: projectAssetTagFixture(state, true), ...focus };
  } catch (error) {
    if (error instanceof FixtureTagFailure) return { ok: false, error: error.code };
    throw error;
  }
}
