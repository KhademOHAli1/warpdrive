"use client";
import type React from "react";
import { useEffect, useSyncExternalStore } from "react";
import { emergencyLocale, emergencyMessages } from "@/features/i18n/emergencyLocale";
import { directionForLocale, type Locale } from "@/features/i18n/registry";
import { forwardBoundaryError } from "@/features/observability/errorForwarding";

export interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const subscribe = () => () => {};
const readLocale = () => emergencyLocale(document.cookie);

/**
 * The last-resort boundary. It is the ONLY thing that catches a throw from the root layout, and
 * React swaps it in for the entire document, so it must supply its own <html>/<body> and cannot use
 * Providers, the nav, fonts, or any other app-shell state.
 *
 * `reset()` re-renders the root. When the root layout is what failed (a bad env var, an unreachable
 * database) that will simply fail again, so the honest affordance is a full reload plus the digest
 * to look up in the server log.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps): React.ReactNode {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, () => "en");
  const copy = emergencyMessages(locale);
  useEffect(() => {
    console.error(error);
    forwardBoundaryError(error, { route: window.location.pathname, digest: error.digest });
  }, [error]);

  return (
    <html lang={locale} dir={directionForLocale(locale)}>
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "2rem" }}>
        <h1>{copy.appCrashTitle}</h1>
        <p>{copy.appCrashBody}</p>
        {error.digest !== undefined && error.digest !== "" ? (
          <p className="font-mono text-xs text-muted-foreground">
            {copy.referenceLabel} <bdi dir="ltr">{error.digest}</bdi>
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="rounded-md border px-3 py-1.5 text-sm font-medium"
        >
          {copy.retry}
        </button>
      </body>
    </html>
  );
}
