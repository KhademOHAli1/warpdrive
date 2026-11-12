import { TRPCError } from "@trpc/server";
import { getCurrentVersion } from "./currentVersion";
import { type ReadWebIdentity, webIdentitySchema } from "./webIdentity";

/** Legacy Web stays local; an independent Core never substitutes its own build on lookup failure. */
export async function resolveCurrentWebVersion(
  read: ReadWebIdentity | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (read === undefined) return getCurrentVersion();
  try {
    const identity = await read(signal);
    if (identity.ok) return webIdentitySchema.parse(identity.value).version;
  } catch {
    // A rejected/malformed adapter can contain URLs or credentials. Keep no raw cause.
  }
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Web identity unavailable" });
}
