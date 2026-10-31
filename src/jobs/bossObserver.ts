import type { PgBoss } from "pg-boss";

type BossProcess = "worker" | "app";
const observed = new WeakSet<PgBoss>();

/** Observe background failures; pg-boss retains its own polling and job retry semantics. */
export function observeBossErrors(boss: PgBoss, source: BossProcess): void {
  if (observed.has(boss)) return;
  boss.on("error", () => {
    // Error messages, stacks, queue names and payloads can contain credentials
    // or customer data. Do not inspect/serialize the emitted object at all.
    try {
      console.error("pg-boss background error", { code: "queue_background_error", source });
    } catch {
      // A diagnostics-sink failure must not recreate the unhandled-event crash.
      // This does not catch startup rejection or a business handler's failure.
    }
  });
  observed.add(boss);
}
