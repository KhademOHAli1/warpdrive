import { err, ok } from "@/types/result";
import { validatePrivacyArchivePaths } from "./archiveSafety";
import { MAX_DISCLOSURE_CATEGORIES, MAX_DISCLOSURE_FILES } from "./disclosureLimits";
import { encodeDisclosureManifest } from "./disclosureManifest";
import type { DisclosureManifest } from "./disclosureSchemas";
import type { ExpectedArchiveEntry } from "./exportArchiveTypes";

const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

// Copy expectations and encode metadata before any caller-supplied async source can run.
export function prepareExportArchive(manifest: DisclosureManifest, signal: AbortSignal) {
  signal.throwIfAborted();
  if (manifest.state !== "reviewed" || manifest.blockers.length > 0)
    return err("manifest_blocked" as const);
  if (manifest.categories.length > MAX_DISCLOSURE_CATEGORIES)
    return err("invalid_archive_manifest" as const);
  const files = manifest.categories.flatMap((category) =>
    category.disposition === "include" ? category.files : [],
  );
  if (
    files.length > MAX_DISCLOSURE_FILES ||
    manifest.categories.some(
      (category) => !category.reviewed || category.disposition === "unsupported",
    )
  )
    return err("invalid_archive_manifest" as const);
  const paths = validatePrivacyArchivePaths(files.map((file) => file.path));
  if (!paths.ok) return err("invalid_archive_manifest" as const);
  const expected = new Map<string, ExpectedArchiveEntry>();
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    if (
      paths.value[index] !== file.path ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !SHA256.test(file.sha256)
    )
      return err("invalid_archive_manifest" as const);
    expected.set(file.path, { bytes: file.bytes, sha256: file.sha256 });
  }
  try {
    const manifestBytes = Buffer.from(encodeDisclosureManifest(manifest));
    signal.throwIfAborted();
    return manifestBytes.length > MAX_MANIFEST_BYTES
      ? err("invalid_archive_manifest" as const)
      : ok({ expected, manifestBytes });
  } catch {
    signal.throwIfAborted();
    return err("invalid_archive_manifest" as const);
  }
}
