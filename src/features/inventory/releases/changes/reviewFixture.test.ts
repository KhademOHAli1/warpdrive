import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import type { ManufacturingRelease, ReleaseArtifact } from "../contracts";
import { buildFixtureChangeReview } from "./reviewFixture";

function artifact(
  id: string,
  kind: ReleaseArtifact["kind"],
  name: string,
  content: string,
): ReleaseArtifact {
  const bytes = new Blob([content]);
  return { id, kind, name, sizeBytes: bytes.size, bytes };
}

function packageFor(
  revision: string,
  status: ManufacturingRelease["status"],
  artifacts: ReleaseArtifact[],
): ManufacturingRelease {
  return {
    revision,
    status,
    releasedAt: status === "released" ? "2026-11-20T09:00:00.000Z" : null,
    artifacts,
  };
}

const digest = (content: string) => createHash("sha256").update(content).digest("hex");
const simpleBom = (revision: string) =>
  artifact(`bom-${revision}`, "manufacturingBom", "materials.csv", "sku,quantity\nPCB-1,1\n");
const fabrication = (revision: string) =>
  artifact(`gerber-${revision}`, "pcbFabrication", `board-${revision}.zip`, `gerber ${revision}`);
const review = (
  base: ManufacturingRelease,
  candidate: ManufacturingRelease,
  signal?: AbortSignal,
) => buildFixtureChangeReview("item-1", "CTRL-24", base, candidate, signal);

it("compares real file bytes across names and fingerprints the exact package independent of descriptor order", async () => {
  const base = packageFor("A", "released", [
    simpleBom("A"),
    fabrication("A"),
    artifact("label-A", "labelArtwork", "old-label.svg", "identical artwork"),
    artifact("place-A", "placement", "placement.csv", "old placement"),
  ]);
  const candidate = packageFor("B", "draft", [
    artifact("label-B", "labelArtwork", "renamed-label.svg", "identical artwork"),
    simpleBom("B"),
    artifact("fw-B", "firmware", "fw.hex", "new firmware"),
    fabrication("B"),
  ]);
  const snapshot = await review(base, candidate);

  expect(snapshot.ready).toBe(true);
  expect(snapshot.base).toEqual({ id: "item-1:A", revision: "A", status: "released" });
  expect(snapshot.candidate).toEqual({ id: "item-1:B", revision: "B", status: "draft" });
  expect(snapshot.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.materials).toEqual([]);
  expect(snapshot.design.map(({ kind }) => kind)).toEqual([
    "firmware",
    "pcbFabrication",
    "placement",
  ]);
  expect(snapshot.design[1]).toEqual({
    key: "pcbFabrication:0",
    kind: "pcbFabrication",
    before: { name: "board-A.zip", sha256: digest("gerber A") },
    after: { name: "board-B.zip", sha256: digest("gerber B") },
  });
  expect(snapshot.design[0]?.before).toBeNull();
  expect(snapshot.design[2]?.after).toBeNull();

  const reordered = await review(base, {
    ...candidate,
    artifacts: [...candidate.artifacts].reverse(),
  });
  expect(reordered).toEqual(snapshot);
  const renamed = await review(base, {
    ...candidate,
    artifacts: candidate.artifacts.map((file) =>
      file.kind === "labelArtwork" ? { ...file, name: "different-label.svg" } : file,
    ),
  });
  expect(renamed.design).toEqual(snapshot.design);
  expect(renamed.fingerprint).not.toBe(snapshot.fingerprint);

  const changed = await review(base, {
    ...candidate,
    artifacts: candidate.artifacts.map((file) =>
      file.kind === "pcbFabrication" ? { ...file, bytes: new Blob(["gerber C"]) } : file,
    ),
  });
  expect(changed.fingerprint).not.toBe(snapshot.fingerprint);
  expect(changed.design[1]?.after).toEqual({ name: "board-B.zip", sha256: digest("gerber C") });
});

it("compares canonical BOM selectors, quantities, units, subassembly pins and alternatives", async () => {
  const rows = "sku,quantity,unit,child_release,alternates\n";
  const base = packageFor("A", "released", [
    fabrication("A"),
    artifact(
      "bom-A",
      "manufacturingBom",
      "bom-A.csv",
      `${rows}PCB-1,1,each,,BACKUP-A|BACKUP-B\nSUB-1,1,each,A,\nWIRE-OLD,2,m,,\n`,
    ),
  ]);
  const candidate = packageFor("B", "draft", [
    fabrication("B"),
    artifact(
      "bom-B",
      "manufacturingBom",
      "bom-B.csv",
      `${rows}PCB-1,2,each,,BACKUP-C\nSUB-1,1,each,B,\nWIRE-NEW,0.5,m,,\n`,
    ),
  ]);
  const snapshot = await review(base, candidate);

  expect(snapshot.ready).toBe(true);
  expect(snapshot.materials.map(({ sku }) => sku)).toEqual([
    "PCB-1",
    "SUB-1",
    "WIRE-NEW",
    "WIRE-OLD",
  ]);
  expect(snapshot.materials[0]).toEqual({
    key: "PCB-1",
    sku: "PCB-1",
    before: {
      quantity: "1",
      unit: "each",
      childRelease: null,
      alternatives: ["BACKUP-A", "BACKUP-B"],
      optional: false,
      consumable: false,
      inherited: false,
      pieces: null,
    },
    after: {
      quantity: "2",
      unit: "each",
      childRelease: null,
      alternatives: ["BACKUP-C"],
      optional: false,
      consumable: false,
      inherited: false,
      pieces: null,
    },
  });
  expect(snapshot.materials[1]?.before?.childRelease).toBe("A");
  expect(snapshot.materials[1]?.after?.childRelease).toBe("B");
  expect(snapshot.materials[2]?.before).toBeNull();
  expect(snapshot.materials[2]?.after?.quantity).toBe("0.5");
  expect(snapshot.materials[3]?.after).toBeNull();
  expect(snapshot.whereUsed).toEqual(
    ["PCB-1", "SUB-1", "WIRE-OLD"].map((componentSku) => ({
      key: `item-1:A:${componentSku}`,
      parentSku: "CTRL-24",
      revision: "A",
      componentSku,
    })),
  );
  expect(snapshot.design.every(({ kind }) => kind !== "manufacturingBom")).toBe(true);
});

it("reports a change to pieces or material flags when the quantity and pins match", async () => {
  const header = "sku,quantity,unit,child_release,optional,consumable,inherited,pieces\n";
  const before = artifact(
    "bom-A",
    "manufacturingBom",
    "bom-A.csv",
    `${header}SUB-1,1,each,A,false,false,false,\nWIRE-1,2,m,,false,false,false,1\n`,
  );
  const after = artifact(
    "bom-B",
    "manufacturingBom",
    "bom-B.csv",
    `${header}SUB-1,1,each,A,false,false,true,\nWIRE-1,2,m,,true,true,false,3\n`,
  );
  const snapshot = await review(
    packageFor("A", "released", [fabrication("A"), before]),
    packageFor("B", "draft", [fabrication("B"), after]),
  );
  expect(snapshot.ready).toBe(true);
  expect(snapshot.materials).toMatchObject([
    { sku: "SUB-1", before: { inherited: false }, after: { inherited: true } },
    {
      sku: "WIRE-1",
      before: { optional: false, consumable: false, pieces: 1 },
      after: { optional: true, consumable: true, pieces: 3 },
    },
  ]);
});

it("preserves an unchanged filename when another file previously had identical bytes", async () => {
  const base = packageFor("A", "released", [
    fabrication("A"),
    simpleBom("A"),
    artifact("enclosure-A-1", "enclosure", "bracket.step", "identical bodies"),
    artifact("enclosure-A-2", "enclosure", "cover.step", "identical bodies"),
  ]);
  const candidate = packageFor("B", "draft", [
    fabrication("B"),
    simpleBom("B"),
    artifact("enclosure-B-1", "enclosure", "bracket.step", "new bracket body"),
    artifact("enclosure-B-2", "enclosure", "cover.step", "identical bodies"),
  ]);
  const { design } = await review(base, candidate);
  const enclosures = design.filter(({ kind }) => kind === "enclosure");
  expect(enclosures).toEqual([
    {
      key: "enclosure:0",
      kind: "enclosure",
      before: { name: "bracket.step", sha256: digest("identical bodies") },
      after: { name: "bracket.step", sha256: digest("new bracket body") },
    },
  ]);
});

it("marks incomplete packages without claiming materials were removed from an unreadable BOM", async () => {
  const base = packageFor("A", "released", [fabrication("A"), simpleBom("A")]);
  const malformed = artifact("bad", "manufacturingBom", "bad.csv", "sku,quantity\nPCB-1,no\n");
  const cases = [
    packageFor("B", "draft", [fabrication("B"), malformed]),
    packageFor("B", "draft", [fabrication("B"), simpleBom("B"), malformed]),
  ];
  for (const candidate of cases) {
    const snapshot = await review(base, candidate);
    expect(snapshot.ready).toBe(false);
    expect(snapshot.materials).toEqual([]);
    expect(snapshot.whereUsed).toEqual([]);
    expect(snapshot.design).toHaveLength(1);
  }
  const missingGerbers = await review(base, packageFor("B", "draft", [simpleBom("B")]));
  expect(missingGerbers.ready).toBe(false);
  expect(missingGerbers.design[0]?.after).toBeNull();
});

it("aborts before comparing a package after navigation", async () => {
  const base = packageFor("A", "released", [fabrication("A"), simpleBom("A")]);
  const candidate = packageFor("B", "draft", [fabrication("B"), simpleBom("B")]);
  const controller = new AbortController();
  controller.abort();
  await expect(review(base, candidate, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
