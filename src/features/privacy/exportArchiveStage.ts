import { err, ok } from "@/types/result";
import type { DisclosureManifest } from "./disclosureSchemas";
import { writePrivacyExportArchive } from "./exportArchive";
import { prepareExportArchive } from "./exportArchivePlan";
import type { PrivacyArchiveStageResult } from "./exportArchiveStageTypes";
import type { PrivacyArchiveSource } from "./exportArchiveTypes";
import { attemptRefSchema } from "./exportObjectStoreRefs";
import type {
  ExportAttemptRef,
  ExportObjectStore,
  ExportObjectUpload,
} from "./exportObjectStoreTypes";

// The caller durably records the attempt before calling. This stages private bytes only:
// it does not authenticate, seal scope, publish, retry, or reconcile remote residuals.
export async function stagePrivacyExportArchive(
  store: Pick<ExportObjectStore, "begin">,
  inputAttempt: ExportAttemptRef,
  inputManifest: DisclosureManifest,
  entries: AsyncIterable<PrivacyArchiveSource>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<PrivacyArchiveStageResult> {
  signal.throwIfAborted();
  const parsed = attemptRefSchema.safeParse(inputAttempt);
  if (!parsed.success) return err({ phase: "preflight", code: "invalid_object_ref", repair: null });
  const attempt = Object.freeze(parsed.data);
  let manifest: DisclosureManifest;
  try {
    const prepared = prepareExportArchive(inputManifest, signal);
    if (!prepared.ok) return err({ phase: "preflight", code: prepared.error, repair: null });
    // No await may separate validation from the caller-owned metadata snapshot.
    manifest = structuredClone(inputManifest);
  } catch {
    signal.throwIfAborted();
    return err({ phase: "preflight", code: "invalid_archive_manifest", repair: null });
  }
  let phase: "begin" | "archive" | "complete" = "begin";
  let upload: ExportObjectUpload | null = null;
  const repair = () => ({
    attempt,
    upload: upload === null ? null : Object.freeze({ ...upload.ref }),
  });
  try {
    const begun = await store.begin(attempt, { maxBytes }, signal);
    if (begun.ok) upload = begun.value;
    signal.throwIfAborted();
    if (!begun.ok) return err({ phase: "begin", code: begun.error, repair: repair() });
    phase = "archive";
    const archived = await writePrivacyExportArchive(manifest, entries, begun.value.sink, signal);
    signal.throwIfAborted();
    if (!archived.ok) return err({ phase, code: archived.error, repair: repair() });
    phase = "complete";
    const completed = await begun.value.complete(archived.value, signal);
    signal.throwIfAborted();
    return completed.ok
      ? ok({ object: completed.value, receipt: archived.value })
      : err({ phase, code: completed.error, repair: repair() });
  } catch {
    signal.throwIfAborted();
    if (phase === "archive") return err({ phase, code: "archive_write_failed", repair: repair() });
    return err({
      phase,
      code: phase === "begin" ? "begin_uncertain" : "completion_uncertain",
      repair: repair(),
    });
  } finally {
    upload?.sink.destroy();
  }
}
