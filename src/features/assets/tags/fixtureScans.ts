import type { ScanInput, ScanResult } from "@/features/physical-labels/contracts";
import {
  type AssetTagContactResult,
  type AssetTagScanResult,
  assetTagContactInput,
  assetTagScanInput,
} from "./contracts";
import {
  type AssetTagFixtureState,
  projectAssetTagFixture,
  readAssetTagFixture,
  writeAssetTagFixture,
} from "./fixtureData";
import { parseLegacyTagIdentifier } from "./legacyImport";
import { assetTagText, isAssetTagToken, parseAssetTagIdentifier } from "./tagCodes";

const invalid = { ok: false, error: "invalid" } as const;
const unavailable = { ok: false, error: "unavailable" } as const;
const scanDedupeMs = 30_000;

function legacyMatch(state: AssetTagFixtureState, raw: string) {
  const shared = parseLegacyTagIdentifier(raw);
  if (shared !== null) return state.tags.find(({ legacy }) => legacy?.id === shared.id);
  return state.tags.find(
    ({ legacy }) =>
      legacy?.origin != null && parseLegacyTagIdentifier(raw, legacy.origin)?.id === legacy.id,
  );
}

function exactTag(state: AssetTagFixtureState, raw: string, origin: string, printedLink: boolean) {
  const token = printedLink && isAssetTagToken(raw) ? raw : parseAssetTagIdentifier(raw, origin);
  if (token === null) return legacyMatch(state, raw);
  return state.tags.find((record) => record.token === token);
}

type StoredScan = AssetTagFixtureState["scans"][number];

function registerScan(state: AssetTagFixtureState, rest: Omit<StoredScan, "id" | "at">) {
  const now = Date.now();
  const existing = state.scans.find(
    (record) =>
      record.actorId === rest.actorId &&
      record.tagId === rest.tagId &&
      record.assignmentId === rest.assignmentId &&
      now - Date.parse(record.at) <= scanDedupeMs,
  );
  if (existing !== undefined) {
    if (existing.coordinates !== null || rest.coordinates === null) return;
    writeAssetTagFixture({
      ...state,
      scans: state.scans.map((record) =>
        record.id === existing.id ? { ...record, coordinates: rest.coordinates } : record,
      ),
    });
    return;
  }
  writeAssetTagFixture({
    ...state,
    scans: [
      { ...rest, id: crypto.randomUUID(), at: new Date(now).toISOString() },
      ...state.scans.slice(0, 4_999),
    ],
  });
}

export function scanAssetTagFixture(
  actorId: string,
  canManage: boolean,
  origin: string,
  raw: unknown,
): AssetTagScanResult {
  const input = assetTagScanInput.safeParse(raw);
  if (!input.success) return invalid;
  const { identifier, source, coordinates } = input.data;
  const state = readAssetTagFixture();
  const hint = exactTag(state, identifier, origin, source === "printed_link");
  const tag = projectAssetTagFixture(state, canManage).tags.find(({ id }) => id === hint?.id);
  if (tag?.assignment == null) return unavailable;

  const { id: assignmentId, target } = tag.assignment;
  registerScan(state, { actorId, tagId: tag.id, assignmentId, source, coordinates });
  return { ok: true, target, tagId: tag.id, assignmentId };
}

export function scanTagFromLabelFixture(
  actorId: string,
  canManage: boolean,
  origin: string,
  input: ScanInput,
): ScanResult | undefined {
  const state = readAssetTagFixture();
  const hint = exactTag(state, input.value, origin, false);
  if (hint === undefined) return undefined;
  const result = scanAssetTagFixture(actorId, canManage, origin, {
    identifier: input.value,
    source: input.format === undefined ? "manual" : "camera",
    coordinates: null,
  });
  if (!result.ok) return result;
  const assignedAt = hint.assignment?.assignedAt;
  if (assignedAt === undefined) return unavailable;
  return {
    ok: true,
    label: {
      id: result.tagId,
      target: result.target,
      source: "internal",
      format: "qr",
      value: assetTagText(hint.token),
      createdAt: assignedAt,
      retiredAt: null,
    },
  };
}

export function openOwnerContactFixture(token: string) {
  const tag = readAssetTagFixture().tags.find((item) => item.token === token);
  return tag?.assignment?.ownerContact === true ? tag.assignment.id : null;
}

export function sendOwnerMessageFixture(
  raw: unknown,
  assignmentId: string | null,
): AssetTagContactResult {
  const parsed = assetTagContactInput.safeParse(raw);
  if (!parsed.success) return invalid;
  const { requestId, token, replyTo, message } = parsed.data;
  const state = readAssetTagFixture();
  const tag = state.tags.find((item) => item.token === token);
  if (tag?.assignment?.ownerContact !== true || tag.assignment.id !== assignmentId)
    return unavailable;
  if (state.messages.some(({ id }) => id === requestId)) return { ok: true };
  if (state.messages.length >= 1_000) return unavailable;
  writeAssetTagFixture({
    ...state,
    messages: [
      {
        id: requestId,
        tagId: tag.id,
        assignmentId: tag.assignment.id,
        replyTo,
        message,
        at: new Date().toISOString(),
        readAt: null,
      },
      ...state.messages,
    ],
  });
  return { ok: true };
}
