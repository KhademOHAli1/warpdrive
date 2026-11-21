import { createHash, randomUUID } from "node:crypto";
import { assert, expect, it, vi } from "vitest";
import { FakeStorageClient } from "@/features/files/storageFake";
import { maxQualityEvidenceBytes } from "./contracts";
import {
  qualityEvidenceFile,
  readSealedQualityEvidence,
  removeUnusedEvidenceObject,
  sealQualityEvidenceUpload,
} from "./evidenceStorage";

function stage(storage: FakeStorageClient, contentType: string, bytes: Buffer) {
  const id = randomUUID();
  const targetId = randomUUID();
  const stagingKey = `inventory-quality-uploads/${targetId}/${id}`;
  storage.objectsByKey.set(stagingKey, { size: bytes.length, contentType });
  storage.objectBytes.set(stagingKey, bytes);
  return { id, targetId, stagingKey, contentType, sizeBytes: bytes.length };
}

it("derives evidence type from a safe filename and enforces its size cap", () => {
  expect(qualityEvidenceFile(" Pru\u0308fprotokoll.CSV ", 48)).toEqual({
    name: "Prüfprotokoll.CSV",
    contentType: "text/csv",
  });
  for (const invalid of [
    "report.csv.html",
    ".pdf",
    "path/report.pdf",
    "path／report.pdf",
    "report\n.pdf",
    "report\u202e.pdf",
    "report\ud800.pdf",
  ]) {
    expect(qualityEvidenceFile(invalid, 48)).toBeNull();
  }
  expect(qualityEvidenceFile("report.pdf", 0)).toBeNull();
  expect(qualityEvidenceFile("report.pdf", 3.5)).toBeNull();
  expect(qualityEvidenceFile("report.pdf", maxQualityEvidenceBytes + 1)).toBeNull();
});

it("rejects wrong provider size, incompatible type, false file magic and malformed text", async () => {
  const storage = new FakeStorageClient();
  const entries = [
    stage(storage, "application/pdf", Buffer.from("PNG pretending to be a PDF")),
    stage(storage, "image/png", Buffer.from("%PDF-1.4")),
    stage(storage, "image/jpeg", Buffer.from("JPEG pretending to be a photograph")),
    stage(storage, "text/plain", Buffer.from([0xc3, 0x28])),
    stage(storage, "text/csv", Buffer.from("result,\u0000noise\n")),
  ];
  const real = stage(storage, "application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n"));
  entries.push({ ...real, sizeBytes: real.sizeBytes + 1 }, { ...real, contentType: "image/png" });
  for (const entry of entries) {
    expect(await sealQualityEvidenceUpload(storage, entry, AbortSignal.timeout(1000))).toEqual({
      ok: false,
      error: "evidence",
    });
  }
  expect(storage.calls.some(({ method }) => method === "putObjectBytes")).toBe(false);
});

it("isolates concurrent seals and verifies exact stored bytes on download", async () => {
  const storage = new FakeStorageClient();
  const bytes = Buffer.from("station,torque\nStation 1,3.14\n");
  const staged = stage(storage, "text/csv", bytes);
  const signal = AbortSignal.timeout(1000);
  const [first, second] = await Promise.all([
    sealQualityEvidenceUpload(storage, staged, signal),
    sealQualityEvidenceUpload(storage, staged, signal),
  ]);
  assert(first?.ok && second?.ok);
  expect(first.value.objectKey).not.toBe(second.value.objectKey);
  expect(first.value.objectKey).toContain(
    `confirmed/inventory-quality-evidence/${staged.targetId}/`,
  );
  expect(first.value.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  await removeUnusedEvidenceObject(storage, second.value.objectKey);
  await removeUnusedEvidenceObject(storage, staged.stagingKey);
  expect(storage.objectBytes.has(second.value.objectKey)).toBe(false);

  const sealed = { ...staged, ...first.value };
  const read = await readSealedQualityEvidence(storage, sealed, signal);
  assert(read.ok);
  expect(read.value).toEqual(bytes);
  expect(read.value).not.toBe(storage.objectBytes.get(sealed.objectKey));

  // Replacing the body without updating storage metadata must also fail verification.
  storage.objectBytes.set(sealed.objectKey, Buffer.alloc(sealed.sizeBytes, "x"));
  expect(await readSealedQualityEvidence(storage, sealed, signal)).toEqual({
    ok: false,
    error: "evidence",
  });
  expect(storage.calls.some(({ method }) => method === "presignGet")).toBe(false);
});

it("removes a failed seal while keeping the staging file available to retry", async () => {
  const storage = new FakeStorageClient();
  const staged = stage(storage, "text/plain", Buffer.from("Station self-check passed"));
  const signal = AbortSignal.timeout(1000);
  const originalHead = storage.headObject.bind(storage);
  const head = vi.spyOn(storage, "headObject").mockImplementation((key, currentSignal) => {
    if (key !== staged.stagingKey) {
      storage.objectsByKey.set(key, { size: staged.sizeBytes, contentType: "text/html" });
    }
    return originalHead(key, currentSignal);
  });

  expect(await sealQualityEvidenceUpload(storage, staged, signal)).toEqual({
    ok: false,
    error: "evidence",
  });
  expect(storage.deletedKeys).toHaveLength(1);
  expect(storage.deletedKeys[0]).toContain("confirmed/inventory-quality-evidence/");
  expect([...storage.objectBytes.keys()]).toEqual([staged.stagingKey]);

  head.mockRestore();
  expect(await sealQualityEvidenceUpload(storage, staged, signal)).toMatchObject({ ok: true });
});
