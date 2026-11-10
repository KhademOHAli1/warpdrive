import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import type { PoolClient } from "pg";
import { expect } from "vitest";
import { AppError } from "@/constants/errorIds";
import { qualificationContainerAbsent, qualificationDeadline } from "./mailMigrationQualificationDeadline";
import { MailMigrationQualificationHarness, qualificationQuery as query } from "./mailMigrationQualification.test-helpers";

export async function assertBlockedQualificationArchive(mode: "deadline" | "abort", signal: AbortSignal): Promise<void> {
  const h = await MailMigrationQualificationHarness.start(signal);
  const controller = new AbortController();
  let lock: PoolClient | undefined;
  let outcome: Promise<{ok:true} | {ok:false;error:unknown}> | undefined;
  try {
    const database = await h.database(signal);
    await query(database.pool,"CREATE TABLE public.qualification_lock(id integer PRIMARY KEY)",[],signal);
    lock = await database.pool.connect();
    signal.throwIfAborted();
    lock.on("error",() => {});
    await query(lock,"BEGIN",[],signal);
    await query(lock,"LOCK TABLE public.qualification_lock IN ACCESS EXCLUSIVE MODE",[],signal);
    const began = Date.now();
    // Both handlers attach immediately, before polling can fail or the watchdog can fire.
    outcome = h.archiveCommand(["pg_dump","--host=127.0.0.1",`--username=${h.container.getUsername()}`,`--dbname=${database.name}`,"--format=custom","--lock-wait-timeout=60000",`--file=/tmp/qualification-blocked-${randomUUID()}.dump`],controller.signal,9000)
      .then(() => ({ok:true as const}), (error: unknown) => ({ok:false as const,error}));
    const observedBefore = Date.now() + 6000;
    let observed = false;
    while (Date.now() < observedBefore) {
      const waiting = await query(database.pool,`SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
        WHERE a.datname=$1 AND a.application_name='pg_dump' AND a.wait_event_type='Lock'
          AND NOT l.granted AND l.relation='public.qualification_lock'::regclass`,[database.name],signal);
      if (waiting.rows.length > 0) { observed = true; break; }
      await pause(25,undefined,{signal});
    }
    expect(observed).toBe(true);
    if (mode === "abort") controller.abort();
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      if (mode === "abort") expect(result.error instanceof DOMException && result.error.name === "AbortError").toBe(true);
      else expect(result.error instanceof AppError && result.error.context?.kind === "timeout").toBe(true);
    }
    expect(h.forcedStopComplete).toBe(true);
    expect(await qualificationContainerAbsent(h.ownedName,h.container.getId())).toBe(true);
    let unavailable = false;
    try {
      await qualificationDeadline(() => database.pool.query("SELECT 1"),{signal,milliseconds:6000,phase:"removed-database-probe"});
    } catch (error) {
      // A hung probe is not evidence that the owned database was terminated.
      unavailable = !signal.aborted && !(error instanceof AppError && error.context?.kind === "timeout");
    }
    expect(unavailable).toBe(true);
    expect(Date.now() - began).toBeLessThan(40_000);
  } finally {
    controller.abort();
    try {
      const pending = outcome;
      if (pending !== undefined) await qualificationDeadline(() => pending,{signal:new AbortController().signal,milliseconds:25_000,phase:"archive-outcome-drain"});
    } finally {
      try { lock?.release(true); }
      finally { await h.close(); }
    }
  }
}
