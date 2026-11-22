import { inspectReleaseBom } from "../bomCsv";
import type { ManufacturingRelease, ReleaseArtifactKind } from "../contracts";
import { missingReleaseArtifacts } from "../fixtures";
import type { ReleaseBomEntry } from "../schema";
import type { ChangeFile, ChangeMaterial, ChangeRelease, ChangeReview } from "./contracts";

type ReviewedFile = ChangeFile & { id: string; kind: ReleaseArtifactKind; sizeBytes: number };

function lexical(left: string, right: string): number {
  if (left < right) return -1;
  return left === right ? 0 : 1;
}

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
  files.sort(
    (left, right) =>
      lexical(left.kind, right.kind) ||
      lexical(left.name, right.name) ||
      lexical(left.sha256, right.sha256) ||
      lexical(left.id, right.id),
  );
  return { files, bom };
}

function fileDetails(file: ReviewedFile | undefined): ChangeFile | null {
  return file === undefined ? null : { name: file.name, sha256: file.sha256 };
}

function takeMatch(files: ReviewedFile[], matches: (file: ReviewedFile) => boolean) {
  const index = files.findIndex(matches);
  return index < 0 ? undefined : files.splice(index, 1)[0];
}

function compareDesignKind(
  kind: ReleaseArtifactKind,
  priorFiles: ReviewedFile[],
  proposedFiles: ReviewedFile[],
): ChangeReview["design"] {
  const before = priorFiles.filter((file) => file.kind === kind);
  const after = proposedFiles.filter((file) => file.kind === kind);
  const changedNames = before.filter(
    (file) =>
      takeMatch(
        after,
        (candidate) => candidate.name === file.name && candidate.sha256 === file.sha256,
      ) === undefined,
  );
  const changed = changedNames.filter(
    (file) => takeMatch(after, (candidate) => candidate.sha256 === file.sha256) === undefined,
  );
  const sameNames: Array<[ReviewedFile, ReviewedFile]> = [];
  const remainingBefore: ReviewedFile[] = [];
  for (const file of changed) {
    const match = takeMatch(after, (candidate) => candidate.name === file.name);
    if (match === undefined) remainingBefore.push(file);
    else sameNames.push([file, match]);
  }

  const pairs: Array<[ReviewedFile | undefined, ReviewedFile | undefined]> = [...sameNames];
  for (let index = 0; index < Math.max(remainingBefore.length, after.length); index++) {
    pairs.push([remainingBefore[index], after[index]]);
  }
  return pairs.map(([earlier, later], index) => ({
    key: `${kind}:${index}`,
    kind,
    before: fileDetails(earlier),
    after: fileDetails(later),
  }));
}

function compareDesign(before: ReviewedFile[], after: ReviewedFile[]): ChangeReview["design"] {
  const roles = new Set([...before, ...after].map(({ kind }) => kind));
  roles.delete("manufacturingBom");
  return [...roles].sort(lexical).flatMap((kind) => compareDesignKind(kind, before, after));
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

function compareMaterials(before: ReleaseBomEntry[] | null, after: ReleaseBomEntry[] | null) {
  const changes: ChangeReview["materials"] = [];
  // An unreadable or ambiguous package cannot establish additions or removals.
  if (before === null || after === null) return changes;
  const previous = new Map(before.map((line) => [line.sku, materialDetails(line)]));
  const proposed = new Map(after.map((line) => [line.sku, materialDetails(line)]));
  const skus = [...new Set([...previous.keys(), ...proposed.keys()])].sort(lexical);
  for (const sku of skus) {
    const earlier = previous.get(sku) ?? null;
    const later = proposed.get(sku) ?? null;
    if (JSON.stringify(earlier) !== JSON.stringify(later))
      changes.push({ key: sku, sku, before: earlier, after: later });
  }
  return changes;
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
  const materials = compareMaterials(before.bom, after.bom);
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
