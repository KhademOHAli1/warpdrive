import type { QueueOperationObserver, QueueOperationPhase } from "@/jobs/schemaContract";

/** Observe actual promises behind queue deadlines; do not infer cancellation from rejection. */
export function createQueueOperationTracker(onFailure: () => void) {
  const pending = new Set<Promise<void>>();
  let cleanupUnknown = false;
  const observe: QueueOperationObserver = (operation, phase) => {
    let complete: () => void = () => undefined;
    const marker = new Promise<void>((resolve) => {
      complete = resolve;
    });
    pending.add(marker);
    const release = () => {
      pending.delete(marker);
      complete();
    };
    const failed = (current: QueueOperationPhase) => {
      if (current === "reader-close" || current === "producer-stop") {
        cleanupUnknown = true;
        // Retain the barrier until the owner's bounded shutdown fails nonzero.
      } else release();
      try {
        onFailure();
      } catch {
        /* No vendor error or failed sink may escape this observer. */
      }
    };
    void operation.then(release, () => {
      failed(phase);
    });
  };
  return {
    observe,
    async waitForSettled(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending]);
    },
    snapshot: () => ({ pending: pending.size, cleanupUnknown }),
  };
}
