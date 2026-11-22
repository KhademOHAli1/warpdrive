import { inspectReleaseBom } from "../bomCsv";
import type { ManufacturingRelease } from "../contracts";
import { missingReleaseArtifacts } from "../fixtures";
import type { ReleaseBomEntry } from "../schema";
import type { ChangeMaterial, ChangeRelease, ChangeReview } from "./contracts";
import {
  compareDesign,
  compareMaterials,
  lexical,
  type ReviewedFile,
  sortReviewedFiles,
} from "./reviewComparison";

async function hash(bytes: BufferSource, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  signal?.throwIfAborted();
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function readPackage(release: ManufacturingRelease, signal?: AbortSignal) {
  const files: ReviewedFile[] = [];
  const bomArtifacts = release.artifacts.filter(({ kind }) => kind === "manufacturingBom");
  const bomArtifact = bomArtifacts.length === 1 ? bomArtifacts[0] : undefined;
  let bom: ReleaseBomEntry[] | null = null;

  for (const artifact of release.artifacts) {
    signal?.throwIfAborted();
    const bytes = await artifact.bytes.arrayBuffer();
    files.push({
      id: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      sizeBytes: bytes.byteLength,
      sha256: await hash(bytes, signal),
    });
    if (artifact === bomArtifact) {
      const parsed = inspectReleaseBom(new Uint8Array(bytes));
      if (parsed.ok) bom = parsed.value;
    }
  }
  sortReviewedFiles(files);
  return { files, bom };
}

function materialDetails({ quantity, details }: ReleaseBomEntry): ChangeMaterial {
  return {
    quantity: details?.enteredQuantity ?? String(quantity),
    unit: details?.unit ?? null,
    childRelease: details?.childRelease ?? null,
    alternatives: [...(details?.alternateSkus ?? [])].sort(lexical),
    optional: details?.optional ?? false,
    consumable: details?.consumable ?? false,
    inherited: details?.inherited ?? false,
    pieces: details?.pieces ?? null,
  };
}

function materialRows(entries: ReleaseBomEntry[] | null) {
  return (
    entries?.map((entry) => ({
      key: entry.sku,
      sku: entry.sku,
      material: materialDetails(entry),
    })) ?? null
  );
}

export async function buildFixtureChangeReview(
  itemId: string,
  sku: string,
  base: ManufacturingRelease,
  candidate: ManufacturingRelease,
  signal?: AbortSignal,
): Promise<ChangeReview> {
  signal?.throwIfAborted();
  const [before, after] = await Promise.all([
    readPackage(base, signal),
    readPackage(candidate, signal),
  ]);
  const reference = ({ revision, status }: ManufacturingRelease): ChangeRelease => ({
    id: `${itemId}:${revision}`,
    revision,
    status,
  });
  const baseRef = reference(base);
  const candidateRef = reference(candidate);
  const fingerprint = await hash(
    new TextEncoder().encode(
      JSON.stringify([
        sku,
        [baseRef, base.releasedAt, before.files],
        [candidateRef, candidate.releasedAt, after.files],
      ]),
    ),
    signal,
  );
  const materials = compareMaterials(materialRows(before.bom), materialRows(after.bom));
  return {
    base: baseRef,
    candidate: candidateRef,
    fingerprint,
    ready:
      base.status === "released" &&
      candidate.status === "draft" &&
      base.revision !== candidate.revision &&
      before.bom !== null &&
      after.bom !== null &&
      missingReleaseArtifacts(candidate).length === 0,
    design: compareDesign(before.files, after.files),
    materials,
    whereUsed: materials.flatMap(({ before, sku: componentSku }) =>
      before === null
        ? []
        : [
            {
              key: `${baseRef.id}:${componentSku}`,
              parentSku: sku,
              revision: baseRef.revision,
              componentSku,
            },
          ],
    ),
  };
}
