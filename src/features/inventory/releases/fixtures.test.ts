import { assert, expect, test } from "vitest";
import type { InventoryItem } from "@/features/inventory/contracts";
import {
  type ReleaseFixtureResult,
  type ReleaseFixtureState,
  releaseFixtureMaxFileBytes,
} from "./contracts";
import { applyReleaseFixture, createReleaseFixture, missingReleaseArtifacts } from "./fixtures";

const product: InventoryItem = {
  id: "fixture-item",
  sku: "IO-24-DIN",
  name: "DIN-rail I/O module",
  revision: "A",
  kind: "product",
  onHand: 4,
  reserved: 0,
  bom: [],
  template: null,
};

function accept(result: ReleaseFixtureResult): ReleaseFixtureState {
  assert(result.ok);
  return result.value;
}

test("blocks approval until required files are present and keeps released revisions immutable", () => {
  const initial = createReleaseFixture(product);
  const [released, draft] = initial.releases;
  assert(released && draft);
  expect(missingReleaseArtifacts(released)).toEqual([]);
  expect(missingReleaseArtifacts(draft)).toEqual(["pcbFabrication"]);
  expect(applyReleaseFixture(initial, { type: "approve", revision: "B" })).toEqual({
    ok: false,
    error: "missingRequiredArtifacts",
  });
  expect(
    applyReleaseFixture(initial, {
      type: "removeArtifact",
      revision: "A",
      artifactId: "A-pcbFabrication",
    }),
  ).toEqual({ ok: false, error: "releaseImmutable" });
  expect(
    applyReleaseFixture(initial, {
      type: "addArtifact",
      revision: "A",
      kind: "labelArtwork",
      file: new File(["Fixture label"], "label.txt"),
    }),
  ).toEqual({ ok: false, error: "releaseImmutable" });
});

test("retains uploaded bytes and pins old and new preview builds to their own releases", async () => {
  const initial = createReleaseFixture(product);
  const fabrication = initial.releases[0]?.artifacts.find(({ kind }) => kind === "pcbFabrication");
  assert(fabrication);
  const zipSignature = new Uint8Array(await fabrication.bytes.slice(0, 4).arrayBuffer());
  expect([...zipSignature]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  const payload = new Uint8Array([0x50, 0x4b, 0x00, 0xff, 0x25]);
  const uploaded = accept(
    applyReleaseFixture(initial, {
      type: "addArtifact",
      revision: "B",
      kind: "pcbFabrication",
      file: new File([payload], "Rev-B.ZIP", { type: "application/zip" }),
    }),
  );
  const artifact = uploaded.releases[1]?.artifacts.find(({ kind }) => kind === "pcbFabrication");
  assert(artifact);
  expect(artifact.name).toBe("Rev-B.ZIP");
  expect(artifact.sizeBytes).toBe(payload.byteLength);
  expect(new Uint8Array(await artifact.bytes.arrayBuffer())).toEqual(payload);

  const next = accept(applyReleaseFixture(uploaded, { type: "approve", revision: "B" }));
  expect(next.activeRevision).toBe("B");
  expect(next.releases[1]?.status).toBe("released");
  expect(next.releases[0]).toBe(initial.releases[0]);
  expect(initial.releases[1]?.status).toBe("draft");
  expect(next.builds).toEqual([{ id: "BUILD-001", revision: "A" }]);
  expect(accept(applyReleaseFixture(next, { type: "previewBuild" })).builds).toEqual([
    { id: "BUILD-001", revision: "A" },
    { id: "BUILD-002", revision: "B" },
  ]);
});

test("starts other SKUs empty and validates revisions and file admission", () => {
  const blank = createReleaseFixture({ ...product, sku: "OTHER-SKU" });
  expect(blank).toEqual({ releases: [], activeRevision: null, builds: [] });
  expect(applyReleaseFixture(blank, { type: "previewBuild" })).toEqual({
    ok: false,
    error: "noActiveRelease",
  });
  expect(applyReleaseFixture(blank, { type: "createDraft", revision: "..." })).toEqual({
    ok: false,
    error: "invalidRevision",
  });
  const draft = accept(applyReleaseFixture(blank, { type: "createDraft", revision: " a " }));
  expect(draft.releases[0]?.revision).toBe("A");
  expect(applyReleaseFixture(draft, { type: "createDraft", revision: "a" })).toEqual({
    ok: false,
    error: "revisionExists",
  });

  const addFabrication = {
    type: "addArtifact",
    revision: "A",
    kind: "pcbFabrication",
  } as const;
  expect(
    applyReleaseFixture(draft, { ...addFabrication, file: new File([], "empty.zip") }),
  ).toEqual({ ok: false, error: "emptyFile" });
  expect(
    applyReleaseFixture(draft, { ...addFabrication, file: new File(["Fixture"], "artwork.pdf") }),
  ).toEqual({ ok: false, error: "invalidFileType" });

  const oversized = new File(["Fixture"], "oversized.zip");
  Object.defineProperty(oversized, "size", { value: releaseFixtureMaxFileBytes + 1 });
  expect(applyReleaseFixture(draft, { ...addFabrication, file: oversized })).toEqual({
    ok: false,
    error: "fileTooLarge",
  });
});
