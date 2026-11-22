import { z } from "zod";
import { hasDuplicateJsonKeys } from "@/features/process-templates/duplicateJsonKeys";
import { releaseBomMaxBytes } from "../bomCsv";
import { releaseFixtureMaxFileBytes } from "../contracts";
import {
  type ExportIntakeBinding,
  type ExportIntakeIssue,
  type ExportIntakeKind,
  type ExportIntakeResult,
  type ExportManifest,
  type ExportManifestFile,
  exportIntakeKinds,
  exportIntakeMaxFiles,
  exportIntakeMaxTotalBytes,
  exportManifestMaxBytes,
} from "./contracts";

const fileExtensions: Record<ExportIntakeKind, readonly string[]> = {
  pcbFabrication: ["zip"],
  manufacturingBom: ["csv"],
  placement: ["csv", "pos", "xy", "txt"],
  enclosure: ["stp", "step", "dxf", "pdf", "zip"],
  firmware: ["bin", "hex", "uf2", "zip"],
  labelArtwork: ["pdf", "png", "svg", "zpl"],
  testInstructions: ["pdf", "txt", "md", "csv", "zip"],
  pcbSource: ["kicad_pcb", "kicad_sch", "kicad_pro"],
};

type ManifestTarget = Pick<ExportIntakeBinding, "sku" | "revision">;

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  exporter: z.strictObject({
    name: z.enum(["kicad", "engineering_pipeline"]),
    version: z
      .string()
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._+-]*$/i),
    sourceRevision: z
      .string()
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._+/-]*$/i),
  }),
  target: z.strictObject({
    sku: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
    revision: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/),
  }),
  files: z
    .array(
      z.strictObject({
        kind: z.enum(exportIntakeKinds),
        name: z.string(),
        sizeBytes: z.number(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .toLowerCase(),
      }),
    )
    .min(1)
    .max(exportIntakeMaxFiles),
});

export function exportIntakeFileLimit(kind: ExportIntakeKind): number {
  return kind === "manufacturingBom" ? releaseBomMaxBytes : releaseFixtureMaxFileBytes;
}

function validFilename(name: string): boolean {
  const compatible = name.normalize("NFKC");
  return (
    name.length > 0 &&
    name.length <= 180 &&
    compatible === compatible.trim() &&
    !compatible.startsWith(".") &&
    !/[/\\<>:"|?*\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(compatible)
  );
}

function filenameKey(name: string): string {
  const compatible = name.normalize("NFKC").toLowerCase();
  return compatible.toUpperCase().toLowerCase();
}

function validExtension(name: string, kind: ExportIntakeKind): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && fileExtensions[kind].includes(name.slice(dot + 1).toLowerCase());
}

function validSize(size: number, max: number): boolean {
  return Number.isSafeInteger(size) && size > 0 && size <= max;
}

function manifestFileIssues(files: readonly ExportManifestFile[]): ExportIntakeIssue[] {
  const issues: ExportIntakeIssue[] = [];
  const filenames = new Set<string>();
  let bomCount = 0;
  let bytes = 0;

  for (const file of files) {
    const { kind, name, sizeBytes } = file;
    if (!validFilename(name)) {
      issues.push({ code: "fileType" });
      continue;
    }
    const key = filenameKey(name);
    if (filenames.has(key)) issues.push({ code: "duplicateFile", file: name });
    filenames.add(key);
    if (!validExtension(name, kind)) issues.push({ code: "fileType", file: name });
    if (!validSize(sizeBytes, exportIntakeFileLimit(kind))) {
      issues.push({ code: "fileSize", file: name });
    } else {
      bytes += sizeBytes;
    }
    if (kind === "manufacturingBom" && ++bomCount > 1) {
      issues.push({ code: "duplicateFile", file: name });
    }
  }
  if (bytes > exportIntakeMaxTotalBytes) issues.push({ code: "fileSize" });
  return issues;
}

export function validateExportManifest(
  raw: unknown,
  target?: ManifestTarget,
): ExportIntakeResult<ExportManifest> {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: [{ code: "manifest" }] };
  const manifest = parsed.data;
  if (
    target !== undefined &&
    (manifest.target.sku !== target.sku || manifest.target.revision !== target.revision)
  ) {
    return { ok: false, issues: [{ code: "wrongTarget" }] };
  }
  const issues = manifestFileIssues(manifest.files);
  return issues.length === 0 ? { ok: true, value: manifest } : { ok: false, issues };
}

export function parseExportManifest(
  text: string,
  target: ManifestTarget,
): ExportIntakeResult<ExportManifest> {
  if (
    text.length > exportManifestMaxBytes ||
    new TextEncoder().encode(text).byteLength > exportManifestMaxBytes
  ) {
    return { ok: false, issues: [{ code: "manifest" }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, issues: [{ code: "manifest" }] };
  }
  if (hasDuplicateJsonKeys(text)) return { ok: false, issues: [{ code: "manifest" }] };
  return validateExportManifest(raw, target);
}

function matchSelectedFiles(
  expected: readonly ExportManifestFile[],
  files: readonly File[],
): ExportIntakeResult<{ file: File; entry: ExportManifestFile }[]> {
  if (files.length > exportIntakeMaxFiles) return { ok: false, issues: [{ code: "extraFile" }] };

  const missing = new Map(expected.map((file) => [file.name, file]));
  const matched: { file: File; entry: ExportManifestFile }[] = [];
  const distinctNames = new Set<string>();
  const issues: ExportIntakeIssue[] = [];
  let selectedBytes = 0;

  for (const file of files) {
    if (!validFilename(file.name)) {
      issues.push({ code: "fileType" });
      continue;
    }
    selectedBytes += file.size;
    const key = filenameKey(file.name);
    if (distinctNames.has(key)) {
      issues.push({ code: "duplicateFile", file: file.name });
      continue;
    }
    distinctNames.add(key);
    const entry = missing.get(file.name);
    if (entry === undefined) {
      issues.push({ code: "extraFile", file: file.name });
      continue;
    }
    missing.delete(file.name);
    if (file.size !== entry.sizeBytes) {
      issues.push({ code: "fileSize", file: file.name });
      continue;
    }
    matched.push({ file, entry });
  }
  if (selectedBytes > exportIntakeMaxTotalBytes) issues.push({ code: "fileSize" });
  for (const name of missing.keys()) issues.push({ code: "missingFile", file: name });
  return issues.length === 0 ? { ok: true, value: matched } : { ok: false, issues };
}

async function contentIssue(
  file: File,
  entry: ExportManifestFile,
): Promise<ExportIntakeIssue | null> {
  try {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== entry.sizeBytes) return { code: "fileSize", file: file.name };
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const digest = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return digest === entry.sha256 ? null : { code: "hashMismatch", file: file.name };
  } catch {
    return { code: "temporary", file: file.name };
  }
}

export async function validateExportBundle(
  manifest: ExportManifest,
  files: readonly File[],
  target?: ManifestTarget,
): Promise<ExportIntakeResult<ExportManifest>> {
  const validation = validateExportManifest(manifest, target);
  if (!validation.ok) return validation;
  const matched = matchSelectedFiles(validation.value.files, files);
  if (!matched.ok) return matched;

  // Read one bounded file at a time, after validating the whole package's metadata.
  const issues: ExportIntakeIssue[] = [];
  for (const { file, entry } of matched.value) {
    const issue = await contentIssue(file, entry);
    if (issue !== null) issues.push(issue);
  }
  return issues.length === 0 ? validation : { ok: false, issues };
}
