import { resolveVersion } from "@/features/release/resolveVersion";
import { declareWebIdentity } from "@/features/release/webIdentity";
import packageJson from "../../package.json";

export function parseHttpOrigin(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.href === `${url.origin}/`
    ? url.origin
    : null;
}

/** Presentation needs an HTTP origin, never database or provider credentials. */
export function coreOrigin(): string {
  const value = process.env.CORE_API_ORIGIN;
  if (!value) throw new Error("CORE_API_ORIGIN is required");
  const origin = parseHttpOrigin(value);
  if (origin === null) throw new Error("CORE_API_ORIGIN must be an HTTP origin");
  return origin;
}

/** Compare readiness against the operator-owned public origin when configured. */
export function webPublicOrigin(): string | null {
  const value = process.env.WEB_PUBLIC_ORIGIN;
  if (!value) return null;
  const origin = parseHttpOrigin(value);
  if (origin === null) throw new Error("WEB_PUBLIC_ORIGIN must be an HTTP origin");
  return origin;
}

/** Transport identity only; the backend still authenticates every user's actual session. */
export function coreProxyToken(): string {
  const token = process.env.CORE_PROXY_TOKEN ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token))
    throw new Error("CORE_PROXY_TOKEN must contain 32-256 base64url characters");
  return token;
}

export function frontendTrustedProxyHeader(): "none" | "x-real-ip" | "cf-connecting-ip" {
  const trusted = process.env.FRONTEND_TRUSTED_PROXY_HEADER ?? "none";
  if (trusted === "none" || trusted === "x-real-ip" || trusted === "cf-connecting-ip")
    return trusted;
  throw new Error("Invalid FRONTEND_TRUSTED_PROXY_HEADER");
}

export function frontendClientIp(incoming: Headers): string | null {
  const trusted = frontendTrustedProxyHeader();
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
