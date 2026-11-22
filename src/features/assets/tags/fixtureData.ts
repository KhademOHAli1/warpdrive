import { z } from "zod";
import { assetsFixture } from "../fixtures";
import {
  type AssetTagRecord,
  type AssetTagTarget,
  type AssetTagWorkspace,
  assetTagCoordinates,
  assetTagTargetRef,
} from "./contracts";

const storageKey = "warpdrive-asset-tag-fixture-v1";
const id = z.uuid();
const time = z.iso.datetime();
const assignment = z.strictObject({
  id,
  target: assetTagTargetRef,
  assignedAt: time,
  ownerContact: z.boolean(),
});
const tag = z.strictObject({
  id,
  siteId: id,
  batchId: id,
  ordinal: z.number().int().min(1).max(100),
  token: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  legacy: z.strictObject({ id: z.string(), origin: z.string().nullable() }).nullable(),
  assignment: assignment.nullable(),
});
const batch = z.strictObject({
  id,
  siteId: id,
  title: z.string().max(100),
  source: z.enum(["printed", "imported"]),
  createdAt: time,
});
const event = z.strictObject({
  id,
  tagId: id,
  assignmentId: id,
  target: assetTagTargetRef,
  kind: z.enum(["claim", "unlink", "swap", "import", "owner_contact"]),
  at: time,
});
const scan = z.strictObject({
  id,
  tagId: id,
  assignmentId: id,
  actorId: id,
  source: z.enum(["printed_link", "manual", "camera"]),
  at: time,
  coordinates: assetTagCoordinates.nullable(),
});
const message = z.strictObject({
  id,
  tagId: id,
  assignmentId: id,
  at: time,
  replyTo: z.email().nullable(),
  message: z.string().max(2_000),
  readAt: time.nullable(),
});
const resultIds = z.strictObject({ batchId: id.nullable(), tagId: id.nullable() });
const receipt = z.strictObject({ signature: z.string().max(64_000), focus: resultIds });
const state = z.strictObject({
  batches: z.array(batch).max(500),
  tags: z.array(tag).max(2_000),
  events: z.array(event).max(10_000),
  scans: z.array(scan).max(5_000),
  messages: z.array(message).max(1_000),
  receipts: z.record(id, receipt),
});

export type AssetTagFixtureState = z.infer<typeof state>;
export type FixtureTag = z.infer<typeof tag>;
export type FixtureAssignment = z.infer<typeof assignment>;
export type FixtureResultIds = z.infer<typeof resultIds>;

const seedTime = "2026-06-01T09:00:00.000Z";
const seedBatch = "b6a07cc5-049f-4d26-adc9-dc61df54475a";
const linkedTag = "991717cf-350b-46e1-bdee-59b5158e4eba";
const unlinkedTag = "bd06c037-3516-4a78-a73e-f5446002bde2";
const linkedAssignment = "4a5c43aa-e2fc-4e7f-8769-b2236b3a7df9";
export const knownFixtureTag = "222222222222222222222A";
export const knownUnlinkedFixtureTag = "222222222222222222222B";

export function fixtureAssetTagTargets(canManage: boolean): AssetTagTarget[] {
  const { sites, records } = assetsFixture(canManage);
  const targets = records
    .filter(({ archivedAt }) => archivedAt === null)
    .map(
      ({ siteId, id: recordId, name, code }): AssetTagTarget => ({
        kind: "asset",
        siteId,
        id: recordId,
        title: name,
        subtitle: code,
        href: `/assets?assetId=${recordId}`,
        canManage,
      }),
    );
  const primary = sites[0];
  if (primary !== undefined)
    targets.push({
      kind: "kit",
      id: "a46b832e-8f7c-4c6a-9249-0c751d9cc63d",
      siteId: primary.id,
      title: "Commissioning tool kit",
      subtitle: "TOOL-KIT",
      href: null,
      canManage,
    });
  return targets;
}

function fixtures(): AssetTagFixtureState {
  const first = fixtureAssetTagTargets(true)[0];
  const blank = { batches: [], tags: [], events: [], scans: [], messages: [], receipts: {} };
  if (first === undefined) return blank;
  const target = { kind: first.kind, id: first.id };
  const { siteId } = first;
  return {
    ...blank,
    batches: [
      { id: seedBatch, siteId, title: "Equipment tags", source: "printed", createdAt: seedTime },
    ],
    tags: [
      {
        id: linkedTag,
        siteId,
        batchId: seedBatch,
        ordinal: 1,
        token: knownFixtureTag,
        legacy: null,
        assignment: { id: linkedAssignment, target, assignedAt: seedTime, ownerContact: true },
      },
      {
        id: unlinkedTag,
        siteId,
        batchId: seedBatch,
        ordinal: 2,
        token: knownUnlinkedFixtureTag,
        legacy: null,
        assignment: null,
      },
    ],
    events: [
      {
        id: "8ef33f1e-dad5-4864-a9f4-23424ee23495",
        kind: "claim",
        tagId: linkedTag,
        assignmentId: linkedAssignment,
        target,
        at: seedTime,
      },
    ],
  };
}

let memory: AssetTagFixtureState | undefined;

export function readAssetTagFixture(): AssetTagFixtureState {
  try {
    const encoded = window.sessionStorage.getItem(storageKey);
    if (encoded === null) return fixtures();
    const parsed = state.safeParse(JSON.parse(encoded));
    return parsed.success ? parsed.data : fixtures();
  } catch {
    // The explicit fixture continues in memory if browser storage is disabled.
  }
  return memory ?? fixtures();
}

export function writeAssetTagFixture(next: AssetTagFixtureState) {
  memory = next;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Browser storage can be disabled even for an authenticated demo.
  }
}

function resolvedTags(stored: AssetTagFixtureState, targets: AssetTagTarget[], canManage: boolean) {
  return stored.tags.flatMap((tag): AssetTagRecord[] => {
    const current = tag.assignment;
    if (current === null) return canManage ? [{ ...tag, assignment: null }] : [];
    const target = targets.find(
      (entry) =>
        entry.kind === current.target.kind &&
        entry.id === current.target.id &&
        entry.siteId === tag.siteId,
    );
    return target === undefined ? [] : [{ ...tag, assignment: { ...current, target } }];
  });
}

export function projectAssetTagFixture(
  stored: AssetTagFixtureState,
  canManage: boolean,
): AssetTagWorkspace {
  const sites = assetsFixture(canManage).sites;
  const targets = fixtureAssetTagTargets(canManage);
  const tags = resolvedTags(stored, targets, canManage);
  const visibleTags = new Map(tags.map((tag) => [tag.id, tag.assignment?.id]));
  return {
    sites,
    targets,
    tags,
    batches: canManage
      ? stored.batches
      : stored.batches.filter(({ id }) => tags.some(({ batchId }) => id === batchId)),
    events: stored.events.filter(
      (event) => canManage || visibleTags.get(event.tagId) === event.assignmentId,
    ),
    scans: stored.scans.flatMap(({ id, tagId, assignmentId, source, at, coordinates }) => {
      if (!canManage && visibleTags.get(tagId) !== assignmentId) return [];
      return [{ id, tagId, assignmentId, source, at, coordinates: canManage ? coordinates : null }];
    }),
    messages: canManage ? stored.messages : [],
  };
}
