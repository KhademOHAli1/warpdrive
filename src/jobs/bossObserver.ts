import type { PgBoss } from "pg-boss";

export type BossProcess = "worker" | "app" | "core-api";
const observed = new WeakSet<PgBoss>();

/** Observe background failures; pg-boss retains its own polling and job retry semantics. */
export function observeBossErrors(boss: PgBoss, source: BossProcess, onFailure?: () => void): void {
  if (observed.has(boss)) return;
  boss.on("error", () => {
    try {
      onFailure?.();
    } catch {
      // Preserve the error observer even when an owner's failure notification throws.
    }
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
