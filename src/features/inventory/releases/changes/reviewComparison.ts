import type { ReleaseArtifactKind } from "../contracts";
import type { ChangeFile, ChangeMaterial, ChangeReview } from "./contracts";

export type ReviewedFile = ChangeFile & {
  id: string;
  kind: ReleaseArtifactKind;
  sizeBytes: number;
};

export function lexical(left: string, right: string): number {
  if (left < right) return -1;
  return left === right ? 0 : 1;
}

export function sortReviewedFiles(files: ReviewedFile[]): ReviewedFile[] {
  return files.sort(
    (left, right) =>
      lexical(left.kind, right.kind) ||
      lexical(left.name, right.name) ||
      lexical(left.sha256, right.sha256) ||
      lexical(left.id, right.id),
  );
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

export function compareDesign(
  before: ReviewedFile[],
  after: ReviewedFile[],
): ChangeReview["design"] {
  const roles = new Set([...before, ...after].map(({ kind }) => kind));
  roles.delete("manufacturingBom");
  return [...roles].sort(lexical).flatMap((kind) => compareDesignKind(kind, before, after));
}

export type ReviewedMaterial = { key: string; sku: string; material: ChangeMaterial };

export function compareMaterials(
  before: ReviewedMaterial[] | null,
  after: ReviewedMaterial[] | null,
) {
  const changes: ChangeReview["materials"] = [];
  if (before === null || after === null) return changes;
  const previous = new Map(before.map((line) => [line.key, line]));
  const proposed = new Map(after.map((line) => [line.key, line]));
  const keys = [...new Set([...previous.keys(), ...proposed.keys()])].sort(lexical);
  for (const key of keys) {
    const earlier = previous.get(key);
    const later = proposed.get(key);
    const prior = earlier?.material ?? null;
    const current = later?.material ?? null;
    const sku = later?.sku ?? earlier?.sku;
    if (sku !== undefined && JSON.stringify(prior) !== JSON.stringify(current))
      changes.push({ key, sku, before: prior, after: current });
  }
  return changes.sort(
    (left, right) => lexical(left.sku, right.sku) || lexical(left.key, right.key),
  );
}
