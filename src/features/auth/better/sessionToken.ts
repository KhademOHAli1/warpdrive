import { createHash } from "node:crypto";

export const AUTH_SESSION_COOKIE = "wd_sid";

export function sessionTokenFromCookie(value: string): string | null {
  try {
    // Better Auth signs its opaque token. The database checks its high-entropy preimage;
    // this is not JWT decoding or a claim-based authentication shortcut.
    const raw = decodeURIComponent(value).split(".")[0] ?? "";
    return /^[A-Za-z0-9_-]{20,256}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function hashSessionCredential(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function readCookie(headers: Headers, name: string): string | null {
  for (const entry of (headers.get("cookie") ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (entry.slice(0, separator).trim() === name) return entry.slice(separator + 1).trim();
  }
  return null;
}
