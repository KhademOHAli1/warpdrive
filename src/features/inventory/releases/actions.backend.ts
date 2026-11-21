import { guardCsrf } from "@/features/identity/actions/shared";
import { createContext } from "@/server/trpc/context";
import { err } from "@/types/result";
import {
  confirmReleaseArtifactUpload,
  removeReleaseArtifact,
  requestReleaseArtifactUpload,
} from "./artifacts";
import {
  type ReleaseCommandResult,
  releaseFileCommand,
  releaseMetadataCommand,
} from "./liveContracts";
import { executeReleaseMetadata } from "./service";

export async function executeManufacturingReleaseAction(
  raw: unknown,
  csrf: string | null,
): Promise<ReleaseCommandResult> {
  if (typeof csrf !== "string" || !(await guardCsrf(csrf)).ok) return err("Release unavailable.");
  const { db, session } = await createContext();
  if (session === null) return err("Release unavailable.");

  const signal = AbortSignal.timeout(25_000);
  const metadata = releaseMetadataCommand.safeParse(raw);
  if (metadata.success) return executeReleaseMetadata(db, session, metadata.data, signal);
  const file = releaseFileCommand.safeParse(raw);
  if (!file.success) return err("Check the release and file fields.");
  switch (file.data.type) {
    case "requestUpload":
      return requestReleaseArtifactUpload(db, session, file.data, signal);
    case "confirmUpload":
      return confirmReleaseArtifactUpload(db, session, file.data, signal);
    case "removeArtifact":
      return removeReleaseArtifact(db, session, file.data, signal);
  }
}
