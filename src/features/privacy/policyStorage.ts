import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyPolicyVersions } from "@/db/schema/privacyPolicies";
import { err, ok, type Result } from "@/types/result";
import { decryptPrivacy } from "./crypto";
import { type PrivacyPolicyProfile, privacyPolicyProfileSchema } from "./policySchemas";

export interface ActivePrivacyPolicy {
  version: number;
  profile: PrivacyPolicyProfile;
  activatedAt: string;
  activatedBy: string;
}

export function decodePolicyProfile(
  value: Buffer,
  contextId: string,
): Result<PrivacyPolicyProfile, "policy_unreadable"> {
  const decrypted = decryptPrivacy(value, { caseId: contextId, purpose: "policy" });
  if (!decrypted.ok) return err("policy_unreadable");
  try {
    const parsed = privacyPolicyProfileSchema.safeParse(JSON.parse(decrypted.value));
    return parsed.success ? ok(parsed.data) : err("policy_unreadable");
  } catch {
    return err("policy_unreadable");
  }
}

// Internal read for services already inside an explicit privacy authority transaction.
export async function readPrivacyPolicyRevision(
  db: Db,
  version: number,
  signal: AbortSignal,
): Promise<Result<ActivePrivacyPolicy, "policy_unreadable" | "policy_unconfigured">> {
  const [row] = await db
    .select()
    .from(privacyPolicyVersions)
    .where(eq(privacyPolicyVersions.version, version));
  signal.throwIfAborted();
  if (row === undefined) return err("policy_unconfigured");
  const profile = decodePolicyProfile(row.profileEnc, `policy:${version}:profile`);
  if (!profile.ok) return profile;
  return ok({
    version,
    profile: profile.value,
    activatedAt: row.activatedAt.toISOString(),
    activatedBy: row.activatedBy,
  });
}
