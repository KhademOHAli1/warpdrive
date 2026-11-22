import { z } from "zod";
import { assetsFixture } from "@/features/assets/fixtures";
import { inventoryFixture } from "@/features/inventory/fixtures";
import { locationsFixture } from "@/features/locations/fixtures";
import {
  type LabelCommand,
  type LabelRecord,
  type LabelResult,
  type LabelsWorkspace,
  type LabelTarget,
  type LabelTargetRef,
  labelCommand,
  labelTargetRef,
  type ScanInput,
  type ScanResult,
  scanInput,
} from "./contracts";
import { isInternalLabelCode, labelFormats, normalizeLabel, parseScannedLabel } from "./formats";

const stringId = z.uuid();
const label = z.strictObject({
  id: stringId,
  format: z.enum(labelFormats),
  value: z.string().min(1).max(4_096),
  target: labelTargetRef,
  source: z.enum(["internal", "external"]),
  createdAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
});

const storedState = z.strictObject({
  labels: z.array(label).max(1_000),
  receipts: z.record(
    stringId,
    z.strictObject({ signature: z.string().max(5_000), focusId: stringId }),
  ),
});

type FixtureData = z.infer<typeof storedState>;

function demoTargets(canManage: boolean): LabelTarget[] {
  const equipment = assetsFixture(canManage).records.filter((record) => record.archivedAt === null);
  const parts = inventoryFixture(undefined).items;
  return [
    ...equipment.map(
      (record): LabelTarget => ({
        kind: "asset",
        id: record.id,
        title: record.name,
        subtitle: record.code,
        href: `/assets?assetId=${record.id}`,
        canManage,
      }),
    ),
    ...locationsFixture.locations.map(
      (location): LabelTarget => ({
        kind: "location",
        id: location.id,
        title: location.name,
        subtitle: location.code,
        href: null,
        canManage,
      }),
    ),
    ...parts.map(
      (part): LabelTarget => ({
        kind: "part",
        id: part.id,
        title: part.name,
        subtitle: part.sku,
        href: `/inventory?itemId=${part.id}`,
        canManage,
      }),
    ),
    {
      kind: "kit",
      id: "0ec2d593-a42c-47e5-9829-3b0290931417",
      title: "Control cabinet wiring kit",
      subtitle: "WIRE-KIT",
      href: null,
      canManage,
    },
    {
      kind: "stock_position",
      id: "c0889809-45df-4c89-9085-a99f04605903",
      title: "DIN-rail I/O module",
      subtitle: "Serial IO24-0001 · Bin A-01",
      href: null,
      canManage,
    },
    {
      kind: "release",
      id: "5f033782-651f-4809-8768-4ed351b82f7b",
      title: "DIN-rail I/O module",
      subtitle: "Approved revision A",
      href: null,
      canManage,
    },
    {
      kind: "supplier_offer",
      id: "84daa434-3e25-470f-997e-ff6ff78fda3b",
      title: "Factory Components · Controller PCB",
      subtitle: "FC-IO-24-A",
      href: null,
      canManage,
    },
  ];
}

function seededState(): FixtureData {
  return {
    labels: [
      {
        id: "11e83c58-39d3-4f9d-93a2-6c1ec3b2afe6",
        target: { kind: "asset", id: "1f07c542-849d-42d9-85c0-56b3ced383fd" },
        format: "qr",
        source: "internal",
        value: "wd-label:v1:111111111111111111111A",
        createdAt: "2026-11-20T09:00:00.000Z",
        retiredAt: null,
      },
    ],
    receipts: {},
  };
}

function keyFor(actorId: string) {
  return `warpdrive.label-fixture.${actorId}`;
}

const inMemory = new Map<string, FixtureData>();

function read(actorId: string): FixtureData {
  const key = keyFor(actorId);
  const mounted = inMemory.get(key);
  if (mounted !== undefined) return mounted;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) {
      const parsed = storedState.safeParse(JSON.parse(raw) as unknown);
      if (parsed.success) {
        inMemory.set(key, parsed.data);
        return parsed.data;
      }
    }
  } catch {
    // The current document still works when the browser disables session storage.
  }
  return seededState();
}

function save(actorId: string, state: FixtureData) {
  const key = keyFor(actorId);
  inMemory.set(key, state);
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Keep the same data in the current document even without session storage.
  }
}

function sameTarget(a: LabelTargetRef, b: LabelTargetRef) {
  return a.kind === b.kind && a.id === b.id;
}

function project(data: FixtureData, canManage: boolean): LabelsWorkspace {
  const targets = demoTargets(canManage);
  const labels = data.labels.flatMap((record): LabelRecord[] => {
    const target = targets.find((candidate) => sameTarget(candidate, record.target));
    return target === undefined ? [] : [{ ...record, target }];
  });
  return { targets, labels };
}

export function readLabelFixture(actorId: string, canManage: boolean) {
  return project(read(actorId), canManage);
}

export function resetLabelFixture(actorId: string, canManage: boolean) {
  const seed = seededState();
  save(actorId, seed);
  return project(seed, canManage);
}

function newOpaqueLabel() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `wd-label:v1:${btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "")}`;
}

type FixtureChange =
  | { labels: FixtureData["labels"]; focusId: string }
  | Extract<LabelResult, { ok: false }>;

function retireLabel(
  labels: FixtureData["labels"],
  workspace: LabelsWorkspace,
  labelId: string,
): FixtureChange {
  const existing = workspace.labels.find(({ id }) => id === labelId);
  if (existing?.target.canManage !== true) return { ok: false, error: "unavailable" };
  if (existing.retiredAt !== null) return { ok: false, error: "state" };
  const retiredAt = new Date().toISOString();
  return {
    focusId: existing.id,
    labels: labels.map((entry) => (entry.id === existing.id ? { ...entry, retiredAt } : entry)),
  };
}

function change(
  labels: FixtureData["labels"],
  command: LabelCommand,
  workspace: LabelsWorkspace,
): FixtureChange {
  if (command.type === "retire") return retireLabel(labels, workspace, command.labelId);
  const target = workspace.targets.find((candidate) => sameTarget(candidate, command.target));
  if (target?.canManage !== true) return { ok: false, error: "unavailable" };

  if (command.type === "issue") {
    const existing = workspace.labels.find(
      (entry) =>
        sameTarget(target, entry.target) && entry.source === "internal" && entry.retiredAt === null,
    );
    if (existing !== undefined) return { labels, focusId: existing.id };
  }
  const source = command.type === "issue" ? "internal" : "external";
  const format = command.type === "issue" ? "qr" : command.format;
  const input = command.type === "issue" ? newOpaqueLabel() : command.value;
  const normalized = normalizeLabel(format, input);
  if (normalized === null || (source === "external" && isInternalLabelCode(normalized.value)))
    return { ok: false, error: "invalid" };
  const existing = labels.find(
    (entry) => normalizeLabel(entry.format, entry.value)?.key === normalized.key,
  );
  if (existing !== undefined) return { ok: false, error: "conflict" };
  if (labels.length >= 1_000) return { ok: false, error: "state" };
  const id = crypto.randomUUID();
  return {
    focusId: id,
    labels: [
      ...labels,
      {
        id,
        target: command.target,
        format,
        source,
        value: normalized.value,
        createdAt: new Date().toISOString(),
        retiredAt: null,
      },
    ],
  };
}

export function runLabelFixture(
  actorId: string,
  canManage: boolean,
  raw: LabelCommand,
): LabelResult {
  const parsed = labelCommand.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!canManage) return { ok: false, error: "unavailable" };
  const data = read(actorId);
  const workspace = project(data, canManage);
  const command = parsed.data;
  const signature = JSON.stringify(command);
  const prior = data.receipts[command.requestId];
  if (prior !== undefined)
    return prior.signature !== signature
      ? { ok: false, error: "conflict" }
      : { ok: true, value: workspace, focusId: prior.focusId };
  const result = change(data.labels, command, workspace);
  if ("ok" in result) return result;
  const next = {
    labels: result.labels,
    receipts: { ...data.receipts, [command.requestId]: { signature, focusId: result.focusId } },
  };
  save(actorId, next);
  return { ok: true, value: project(next, canManage), focusId: result.focusId };
}

export function resolveLabelFixture(
  actorId: string,
  canManage: boolean,
  origin: string,
  raw: ScanInput,
): ScanResult {
  const parsed = scanInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const input = parseScannedLabel(parsed.data.value, origin, parsed.data.format);
  if (input === null) return { ok: false, error: "invalid" };
  const resolved = readLabelFixture(actorId, canManage).labels.find(
    (record) =>
      record.retiredAt === null && normalizeLabel(record.format, record.value)?.key === input.key,
  );
  return resolved === undefined
    ? { ok: false, error: "unavailable" }
    : { ok: true, label: resolved };
}
