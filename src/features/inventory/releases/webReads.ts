import { TRPCClientError } from "@trpc/client";
import { coreClient } from "@/frontend/trpc";
import { err, type Result } from "@/types/result";

async function readRelease<T>(read: () => Promise<Result<T, string>>): Promise<Result<T, string>> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TRPCClientError) return err("Release unavailable.");
    throw error;
  }
}

export function readManufacturingReleases(itemId: string) {
  return readRelease(() => coreClient().inventory.releases.workspace.query({ itemId }));
}

export function readBuildRelease(orderId: string) {
  return readRelease(() => coreClient().inventory.releases.build.query({ orderId }));
}
