import { createHash } from "node:crypto";

// Raw-byte evidence is independent of RFC headers, MIME parsing and semantic receipts.
// Every lookup must additionally qualify the owning account.
export function mailSourceFingerprint(source: Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}
