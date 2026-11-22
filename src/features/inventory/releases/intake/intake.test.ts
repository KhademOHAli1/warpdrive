import { createHash } from "node:crypto";
import { assert, expect, test, vi } from "vitest";
import { releaseBomMaxBytes } from "../bomCsv";
import { releaseFixtureMaxFileBytes } from "../contracts";
import {
  type ExportIntakeBinding,
  type ExportIntakeResult,
  type ExportManifest,
  type ExportManifestFile,
  exportIntakeMaxFiles,
  exportManifestMaxBytes,
} from "./contracts";
import { createExportIntakeFixture } from "./fixture";
import { parseExportManifest, validateExportBundle } from "./manifest";

const released = { itemId: "product-1", releaseId: "release-A", sku: "IO-24-DIN", revision: "A" };
const draft = { ...released, releaseId: "release-B", revision: "B" };
const content = "(kicad_pcb (version 20240108))";
const name = "board.kicad_pcb";
const source: ExportManifestFile = {
  kind: "pcbSource",
  name,
  sizeBytes: Buffer.byteLength(content),
  sha256: createHash("sha256").update(content).digest("hex"),
};

function manifest(files: ExportManifestFile[] = [source], target = draft): ExportManifest {
  return {
    schemaVersion: 1,
    exporter: { name: "kicad", version: "9.0.2", sourceRevision: "a4b22be" },
    target: { sku: target.sku, revision: target.revision },
    files,
  };
}

function accept<T>(result: ExportIntakeResult<T>): T {
  assert(result.ok);
  return result.value;
}

function parse(body: unknown) {
  return parseExportManifest(JSON.stringify(body), draft);
}

function deterministicFixture(
  getTargetState: (target: ExportIntakeBinding) => "draft" | "approved" | null,
) {
  let id = 0;
  let second = 0;
  return createExportIntakeFixture({
    getTargetState,
    failFirstReady: true,
    now: () => new Date(Date.UTC(2026, 10, 22, 6, 0, ++second)).toISOString(),
    makeId: () => `demo-${++id}`,
  });
}

test("requires a strict version-1 envelope, unambiguous keys, a bounded UTF-8 body and the exact draft", () => {
  expect(accept(parse(manifest()))).toEqual(manifest());
  expect(
    accept(parse(manifest([{ ...source, sha256: source.sha256.toUpperCase() }]))).files,
  ).toEqual([source]);
  for (const body of [
    { ...manifest(), schemaVersion: 2 },
    { ...manifest(), exporter: { ...manifest().exporter, fetch: "https://example.test" } },
    { ...manifest(), files: [{ ...source, url: "https://example.test" }] },
    { ...manifest(), files: [{ ...source, sha256: `${source.sha256}\n` }] },
    { ...manifest(), target: { ...manifest().target, revision: "B\n" } },
    { ...manifest(), files: [] },
  ]) {
    expect(parse(body)).toEqual({ ok: false, issues: [{ code: "manifest" }] });
  }
  const duplicateKey = JSON.stringify(manifest()).replace(
    '"schemaVersion":1',
    '"schema\\u0056ersion":0,"schemaVersion":1',
  );
  expect(parseExportManifest(duplicateKey, draft)).toEqual({
    ok: false,
    issues: [{ code: "manifest" }],
  });
  expect(
    parseExportManifest(`{"name":"${"é".repeat(exportManifestMaxBytes / 2)}"}`, draft),
  ).toEqual({
    ok: false,
    issues: [{ code: "manifest" }],
  });
  expect(parse(manifest([source], released))).toEqual({
    ok: false,
    issues: [{ code: "wrongTarget" }],
  });
});

test("allows individually typed KiCad project inputs and rejects role mismatch, paths and folded aliases", () => {
  const inputs = [
    source,
    { ...source, name: "project.kicad_sch" },
    { ...source, name: "BOARD.KICAD_PRO" },
  ];
  expect(accept(parse(manifest(inputs))).files).toEqual(inputs);
  for (const invalid of [
    "../board.kicad_pcb",
    "sub\\board.kicad_pcb",
    "sub／board.kicad_pcb",
    "a.zip",
  ]) {
    expect(parse(manifest([{ ...source, name: invalid }]))).toMatchObject({
      ok: false,
      issues: [{ code: "fileType" }],
    });
  }
  expect(parse(manifest([{ ...source, name: "board.gbr", kind: "pcbFabrication" }]))).toEqual({
    ok: false,
    issues: [{ code: "fileType", file: "board.gbr" }],
  });
  expect(
    parse(
      manifest([
        { ...source, name: "Straße.kicad_pcb" },
        { ...source, name: "STRASSE.KICAD_PCB" },
      ]),
    ),
  ).toEqual({
    ok: false,
    issues: [{ code: "duplicateFile", file: "STRASSE.KICAD_PCB" }],
  });
});

test("enforces single BOM, per-role ceilings, entry count and the inclusive package limit", () => {
  const bom: ExportManifestFile = {
    ...source,
    kind: "manufacturingBom",
    name: "parts.csv",
    sizeBytes: releaseBomMaxBytes,
  };
  expect(parse(manifest([bom, { ...bom, name: "alternative.csv" }]))).toEqual({
    ok: false,
    issues: [{ code: "duplicateFile", file: "alternative.csv" }],
  });
  expect(parse(manifest([{ ...bom, sizeBytes: releaseBomMaxBytes + 1 }]))).toEqual({
    ok: false,
    issues: [{ code: "fileSize", file: "parts.csv" }],
  });
  for (const invalidSize of [0, -1, 2.5, releaseFixtureMaxFileBytes + 1]) {
    expect(parse(manifest([{ ...source, sizeBytes: invalidSize }]))).toEqual({
      ok: false,
      issues: [{ code: "fileSize", file: name }],
    });
  }
  const fourMax = Array.from({ length: 4 }, (_, index) => ({
    ...source,
    name: `${index}.kicad_pcb`,
    sizeBytes: releaseFixtureMaxFileBytes,
  }));
  expect(parse(manifest(fourMax)).ok).toBe(true);
  expect(parse(manifest([...fourMax, { ...source, sizeBytes: 1 }]))).toEqual({
    ok: false,
    issues: [{ code: "fileSize" }],
  });
  const manyFiles = Array.from({ length: exportIntakeMaxFiles + 1 }, (_, index) => ({
    ...source,
    name: `${index}.kicad_pcb`,
  }));
  expect(parse(manifest(manyFiles)).ok).toBe(false);
});

test("checks exact selected names and all sizes before reading bytes, then hashes actual bytes", async () => {
  const original = new File([content], name);
  const read = vi.spyOn(original, "arrayBuffer");
  const alternate = { ...source, name: "sibling.kicad_sch" };
  expect(
    await validateExportBundle(manifest([source, alternate]), [
      original,
      new File(["bad"], alternate.name),
    ]),
  ).toEqual({ ok: false, issues: [{ code: "fileSize", file: alternate.name }] });
  expect(read).not.toHaveBeenCalled();
  expect(await validateExportBundle(manifest(), [new File([content], name.toUpperCase())])).toEqual(
    {
      ok: false,
      issues: [
        { code: "extraFile", file: name.toUpperCase() },
        { code: "missingFile", file: name },
      ],
    },
  );
  expect(await validateExportBundle(manifest(), [original, original])).toEqual({
    ok: false,
    issues: [{ code: "duplicateFile", file: name }],
  });
  expect(
    await validateExportBundle(manifest(), [new File([content.replace("08", "09")], name)]),
  ).toEqual({
    ok: false,
    issues: [{ code: "hashMismatch", file: name }],
  });
  expect(accept(await validateExportBundle(manifest(), [original]))).toEqual(manifest());
  expect(read).toHaveBeenCalledTimes(1);
});

test("keeps the verified job and exact retry immutable across replays, deduplicated submission and approval", async () => {
  let editable = true;
  const access = deterministicFixture((target) => {
    if (target.itemId !== released.itemId || target.sku !== released.sku) return null;
    if (target.releaseId === released.releaseId && target.revision === released.revision)
      return "approved";
    if (target.releaseId === draft.releaseId && target.revision === draft.revision) {
      return editable ? "draft" : "approved";
    }
    return null;
  });
  const sibling = { ...source, name: "board.kicad_sch" };
  const input = {
    target: draft,
    requestId: "submit",
    manifest: manifest([source, sibling]),
    files: [new File([content], name), new File([content], sibling.name)],
  };
  expect(
    await access.submit({ ...input, target: released, manifest: manifest([source], released) }),
  ).toEqual({
    ok: false,
    issues: [{ code: "draftChanged" }],
  });
  expect(await access.submit({ ...input, files: [] })).toMatchObject({ ok: false });
  const [first, replay] = await Promise.all([access.submit(input), access.submit(input)]);
  const failed = accept(first);
  assert(failed.failedAttemptId !== null);
  expect(failed).toMatchObject({
    state: "failed",
    artifacts: [],
    attempts: [{ outcome: "failed", issue: { code: "temporary" } }],
  });
  expect(accept(replay)).toEqual(failed);
  const reordered = { ...input, requestId: "different", manifest: manifest([sibling, source]) };
  expect(accept(await access.submit(reordered))).toEqual(failed);
  expect(
    await access.submit({ ...input, manifest: manifest(), files: input.files.slice(0, 1) }),
  ).toEqual({
    ok: false,
    issues: [{ code: "conflict" }],
  });
  expect(await access.list({ ...draft, sku: "OTHER" })).toEqual({
    ok: false,
    issues: [{ code: "unavailable" }],
  });
  expect(accept(await access.list(released))).toEqual([]);

  const retry = {
    target: draft,
    requestId: "retry",
    jobId: failed.id,
    failedAttemptId: failed.failedAttemptId,
  };
  expect(await access.retry({ ...retry, failedAttemptId: "stale" })).toEqual({
    ok: false,
    issues: [{ code: "conflict" }],
  });
  const ready = accept(await access.retry(retry));
  expect(ready).toMatchObject({ id: failed.id, state: "ready", failedAttemptId: null });
  expect(ready.attempts[0]).toEqual(failed.attempts[0]);
  expect(ready.attempts[1]).toMatchObject({ outcome: "ready", issue: null });
  expect(ready.artifacts.map(({ name: artifactName }) => artifactName)).toEqual([
    name,
    sibling.name,
  ]);
  expect(accept(await access.retry(retry))).toEqual(ready);
  expect(await access.retry({ ...retry, requestId: "too-late" })).toEqual({
    ok: false,
    issues: [{ code: "conflict" }],
  });
  expect(accept(await access.submit(reordered))).toEqual(ready);
  expect(accept(await access.list(draft))).toEqual([ready]);

  editable = false;
  expect(await access.retry(retry)).toEqual({ ok: false, issues: [{ code: "draftChanged" }] });
  expect(await access.submit(input)).toEqual({ ok: false, issues: [{ code: "draftChanged" }] });
  expect(accept(await access.list(draft))).toEqual([ready]);
  ready.artifacts.length = 0;
  expect(accept(await access.list(draft))[0]?.artifacts).toHaveLength(2);
});

test("rechecks the exact draft after asynchronous validation without consuming the temporary fixture attempt", async () => {
  let editable = true;
  const access = deterministicFixture(() => (editable ? "draft" : "approved"));
  const file = new File([content], name);
  const original = file.arrayBuffer.bind(file);
  vi.spyOn(file, "arrayBuffer").mockImplementationOnce(() => {
    editable = false;
    return original();
  });
  const input = { target: draft, requestId: "submit", manifest: manifest(), files: [file] };
  expect(await access.submit(input)).toEqual({ ok: false, issues: [{ code: "draftChanged" }] });
  expect(accept(await access.list(draft))).toEqual([]);
  editable = true;
  expect(accept(await access.submit(input))).toMatchObject({ state: "failed" });
});
