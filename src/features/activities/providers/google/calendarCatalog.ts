import type { Db } from "@/db/client";
import { err, type Result } from "@/types/result";
import { getCalendarAccessGrant } from "./accountTokens";
import type { CalendarOAuthConfig } from "./authorizationConfig";
import { publishGoogleCalendarCatalog } from "./calendarCatalogPublish";
import { listGoogleCalendarCatalog } from "./calendarCatalogQuery";
import {
  beginCalendarCatalogDiscovery,
  type CalendarCatalogRun,
  failCalendarCatalogDiscovery,
} from "./calendarCatalogState";
import { collectGoogleCalendarDiscovery } from "./calendarDiscovery";
import type { CalendarCatalogError, GoogleCalendarCatalog } from "./catalogContracts";
import { createGoogleCalendarClient } from "./client";
import type { GoogleTransport } from "./contracts";
import { rethrowGoogleAbort } from "./errors";

export { listGoogleCalendarCatalog } from "./calendarCatalogQuery";

export async function discoverGoogleCalendarCatalog(
  db: Db,
  userId: string,
  accountId: string,
  config: CalendarOAuthConfig,
  signal: AbortSignal,
  options: { transport?: GoogleTransport; now?: () => Date } = {},
): Promise<Result<GoogleCalendarCatalog, CalendarCatalogError>> {
  signal.throwIfAborted();
  const now = options.now ?? (() => new Date());
  let run: CalendarCatalogRun | undefined;
  try {
    const grant = await getCalendarAccessGrant(db, userId, accountId, config, signal, options);
    if (!grant.ok) return grant;
    const begun = await beginCalendarCatalogDiscovery(db, userId, grant.value, signal, now);
    if (!begun.ok) return begun;
    run = begun.value;
    const collected = await collectGoogleCalendarDiscovery(
      createGoogleCalendarClient(grant.value, options.transport),
      { signal },
    );
    if (!collected.ok) {
      await failCalendarCatalogDiscovery(db, run, collected.error.kind, signal);
      return collected;
    }
    const published = await publishGoogleCalendarCatalog(db, run, collected.value, signal, now);
    if (!published.ok) {
      await failCalendarCatalogDiscovery(db, run, published.error.kind, signal);
      return published;
    }
    return await listGoogleCalendarCatalog(db, userId, accountId, signal);
  } catch (error) {
    if (
      run !== undefined &&
      (signal.aborted || (error instanceof Error && error.name === "AbortError"))
    ) {
      await failCalendarCatalogDiscovery(db, run, "aborted", AbortSignal.timeout(1_000)).catch(
        () => undefined,
      );
    }
    rethrowGoogleAbort(error, signal);
    if (run !== undefined) {
      try {
        await failCalendarCatalogDiscovery(db, run, "storage", signal);
      } catch (cleanupError) {
        rethrowGoogleAbort(cleanupError, signal);
      }
    }
    return err({ kind: "storage" });
  }
}
