import { resolveVersion } from "@/features/release/resolveVersion";
import { declareWebIdentity } from "@/features/release/webIdentity";
import packageJson from "../../package.json";

/** Presentation needs an HTTP origin, never database or provider credentials. */
export function coreOrigin(): string {
  const value = process.env.CORE_API_ORIGIN;
  if (value === undefined || value === "" || !URL.canParse(value))
    throw new Error("CORE_API_ORIGIN is required");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("CORE_API_ORIGIN must be an HTTP origin");
  return url.origin;
}

/** Transport identity only; the backend still authenticates every user's actual session. */
export function coreProxyToken(): string {
  const token = process.env.CORE_PROXY_TOKEN ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token))
    throw new Error("CORE_PROXY_TOKEN must contain 32-256 base64url characters");
  return token;
}

export function frontendClientIp(incoming: Headers): string | null {
  const trusted = process.env.FRONTEND_TRUSTED_PROXY_HEADER ?? "none";
  if (!["none", "x-real-ip", "cf-connecting-ip"].includes(trusted))
    throw new Error("Invalid FRONTEND_TRUSTED_PROXY_HEADER");
  return trusted === "none" ? null : incoming.get(trusted);
}

export function frontendIdentity() {
  return declareWebIdentity(
    resolveVersion({
      appVersionEnv: process.env.APP_VERSION ?? "",
      packageVersion: packageJson.version,
    }),
    process.env.APP_COMMIT ?? "",
  );
}
