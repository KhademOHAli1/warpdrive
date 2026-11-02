import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import { err, ok, type Result } from "@/types/result";
import type { TestDb } from "./db";
import { createIntegrationFixtureClient } from "./integrationPlatformFixturesClient";
import { fixtureIo } from "./integrationPlatformFixturesIo";
import type {
  IntegrationFixtureError,
  IntegrationPlatformFixtures,
} from "./integrationPlatformFixturesModels";
import { seedIntegrationPlatformFixtures } from "./integrationPlatformFixturesSeed";

const fixtureOptions = z.strictObject({
  namespace: z.string().regex(/^[a-z0-9]{1,24}$/),
  now: z.date(),
});
const databaseRow = z.object({ name: z.string() });

function fixtureTarget(raw: string): URL | null {
  try {
    const target = new URL(raw);
    return /^t_[a-f0-9]{32}$/.test(target.pathname.slice(1)) &&
      ["postgres:", "postgresql:"].includes(target.protocol) &&
      target.hostname !== "" &&
      target.port !== "" &&
      target.search === "" &&
      target.hash === ""
      ? target
      : null;
  } catch {
    return null;
  }
}

function transportFailure(phase: {
  committed: boolean;
  commitStarted: boolean;
}): IntegrationFixtureError {
  if (phase.committed) return { code: "committed_cleanup_failed" };
  if (phase.commitStarted) return { code: "commit_outcome_unknown" };
  return { code: "write_failed" };
}

export async function createIntegrationPlatformFixtures(
  h: Pick<TestDb, "db" | "url">,
  options: { namespace: string; now: Date },
  signal: AbortSignal,
): Promise<Result<IntegrationPlatformFixtures, IntegrationFixtureError>> {
  signal.throwIfAborted();
  const input = fixtureOptions.safeParse(options);
  if (!input.success) return err({ code: "invalid_input" });
  const target = fixtureTarget(h.url);
  if (target === null) return err({ code: "disposable_database_required" });
  const database = target.pathname.slice(1);
  signal.throwIfAborted();
  const owned = createIntegrationFixtureClient(target.toString());
  const phase = { connected: false, commitStarted: false, committed: false };
  // Cleanup remains mandatory after the commit cutoff, even when the caller's signal is aborted.
  const cleanupSignal = new AbortController().signal;
  const abort = () => {
    // Startup is bounded by the driver's connect timer. end() before connect settles can strand it.
    if (phase.connected && !phase.commitStarted) void owned.close(signal);
  };
  signal.addEventListener("abort", abort, { once: true });
  let outcome: Result<IntegrationPlatformFixtures, IntegrationFixtureError> = err({
    code: "write_failed",
  });
  try {
    await fixtureIo(() => owned.client.connect(), signal);
    phase.connected = true;
    const current = await fixtureIo(
      () => owned.client.query("SELECT current_database() AS name"),
      signal,
    );
    if (owned.health.failed)
      throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "fixture connection failed");
    if (databaseRow.parse(current.rows[0]).name !== database)
      return err({ code: "disposable_database_required" });
    const db = drizzle(owned.client, { schema });
    const value = await db.transaction(async (tx) => {
      const seeded = await seedIntegrationPlatformFixtures(
        tx,
        input.data.namespace,
        input.data.now,
        signal,
      );
      signal.throwIfAborted();
      if (owned.health.failed)
        throw new AppError(ERROR_IDS.DB_WRITE_FAILED, "fixture connection failed");
      // Cancellation before this point prevents COMMIT. After it, await COMMIT without racing it.
      phase.commitStarted = true;
      return seeded;
    });
    phase.committed = true;
    outcome = ok(value);
  } catch (error) {
    if (!phase.commitStarted) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
    }
    outcome = err({ code: phase.commitStarted ? "commit_outcome_unknown" : "write_failed" });
  } finally {
    signal.removeEventListener("abort", abort);
    await owned.close(cleanupSignal);
  }
  // An acknowledged COMMIT is not rolled back by a late abort or a connection cleanup failure.
  if (owned.health.failed) return err(transportFailure(phase));
  return outcome;
}
