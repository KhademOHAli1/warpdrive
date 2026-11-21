import { createHash, randomBytes } from "node:crypto";

const prefix = "wd_project_";

export function projectIntegratorDigest(token: string | null) {
  if (token === null || !/^wd_project_[a-zA-Z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function generateProjectIntegratorCredential() {
  return prefix + randomBytes(32).toString("base64url");
}
