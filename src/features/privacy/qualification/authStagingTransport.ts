import { createHash } from "node:crypto";
import { request } from "node:https";
import type { TLSSocket } from "node:tls";
import { LOCALE_COOKIE } from "@/features/i18n/preferences";
import { err, ok, type Result } from "@/types/result";
import type { AUTH_STAGING_LOCALES } from "./authStagingSchemas";

type Locale = (typeof AUTH_STAGING_LOCALES)[number];
const MAX_HTML_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 5000;
export interface AuthStagingHttpsCheck {
  locale: Locale;
  language: Locale;
  direction: "rtl" | "ltr";
  httpsVerified: true;
  htmlSha256: string;
}
export type AuthStagingTransportFailure =
  | "tls_or_network_failed"
  | "probe_timeout"
  | "unexpected_response"
  | "response_limit_exceeded"
  | "locale_mismatch";
export interface AuthStagingTrust {
  ca?: Buffer;
}

function localeCheck(
  body: Buffer,
  locale: Locale,
): Result<AuthStagingHttpsCheck, AuthStagingTransportFailure> {
  const tag = body.toString("utf8").match(/<html\b[^>]*>/i)?.[0];
  const language = tag?.match(/\slang\s*=\s*["'](en|fa|de)["']/i)?.[1];
  const direction = tag?.match(/\sdir\s*=\s*["'](rtl|ltr)["']/i)?.[1];
  if (language !== locale || direction !== (locale === "fa" ? "rtl" : "ltr"))
    return err("locale_mismatch");
  return ok({
    locale,
    language: locale,
    direction,
    httpsVerified: true,
    htmlSha256: createHash("sha256").update(body).digest("hex"),
  });
}

// An explicit CA can add a private installation root. Certificate and hostname checks remain enabled.
export async function observeAuthStagingLogin(
  origin: string,
  locale: Locale,
  signal: AbortSignal,
  trust: AuthStagingTrust,
): Promise<Result<AuthStagingHttpsCheck, AuthStagingTransportFailure>> {
  signal.throwIfAborted();
  const result = await new Promise<Result<AuthStagingHttpsCheck, AuthStagingTransportFailure>>(
    (resolve) => {
      let done = false;
      const finish = (value: Result<AuthStagingHttpsCheck, AuthStagingTransportFailure>) => {
        if (!done) {
          done = true;
          clearTimeout(deadline);
          resolve(value);
        }
      };
      const req = request(
        new URL("/login", origin),
        {
          method: "GET",
          agent: false,
          signal,
          rejectUnauthorized: true,
          ...(trust.ca === undefined ? {} : { ca: trust.ca }),
          headers: { accept: "text/html", cookie: `${LOCALE_COOKIE}=${locale}` },
        },
        (response) => {
          const socket = response.socket as TLSSocket;
          if (!socket.authorized) {
            finish(err("tls_or_network_failed"));
            req.destroy();
            return;
          }
          if (
            response.statusCode !== 200 ||
            response.headers["content-type"]?.toLowerCase().startsWith("text/html") !== true
          ) {
            finish(err("unexpected_response"));
            req.destroy();
            return;
          }
          const parts: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            if (done) return;
            bytes += chunk.length;
            if (bytes > MAX_HTML_BYTES) {
              finish(err("response_limit_exceeded"));
              req.destroy();
              return;
            }
            parts.push(chunk);
          });
          response.once("end", () => {
            if (!done) finish(localeCheck(Buffer.concat(parts), locale));
          });
          response.once("error", () => finish(err("tls_or_network_failed")));
        },
      );
      const deadline = setTimeout(() => {
        finish(err("probe_timeout"));
        req.destroy();
      }, PROBE_TIMEOUT_MS);
      req.once("error", () => finish(err("tls_or_network_failed")));
      req.end();
    },
  );
  signal.throwIfAborted();
  return result;
}
