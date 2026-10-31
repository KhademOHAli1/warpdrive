import { z } from "zod";
import type {
  ProviderFailure,
  ProviderOperation,
} from "@/features/integrations/providers/contract";
import { providerOperationNames } from "@/features/integrations/providers/models";
import { err, type Result } from "@/types/result";
import { type FakeProviderFault, fakeProviderFaultSchema } from "./fakeProviderModels";

interface Barrier {
  kind: "barrier";
  start: () => void;
  ready: Promise<void>;
}
type Control = FakeProviderFault | Barrier;
const faultSetup = z
  .strictObject({ operation: z.enum(providerOperationNames), fault: fakeProviderFaultSchema })
  .refine(
    ({ operation, fault }) =>
      fault.kind !== "ambiguous_outcome" ||
      ["exchange", "refresh", "disconnect"].includes(operation),
  );

export class FakeProviderControl {
  private readonly pending = new Map<ProviderOperation, Control[]>();
  private readonly counts = new Map<ProviderOperation, number>();

  calls(operation: ProviderOperation): number {
    return this.counts.get(operation) ?? 0;
  }

  failNext(operation: ProviderOperation, raw: FakeProviderFault): void {
    const { fault } = faultSetup.parse({ operation, fault: raw });
    this.enqueue(operation, fault);
  }

  private enqueue(operation: ProviderOperation, control: Control): void {
    const queue = this.pending.get(operation) ?? [];
    queue.push(control);
    this.pending.set(operation, queue);
  }

  holdNext(operation: ProviderOperation) {
    let release: () => void = () => undefined;
    let start: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    this.enqueue(operation, { kind: "barrier", start, ready });
    return { release, started };
  }

  async invoke<T>(
    operation: ProviderOperation,
    signal: AbortSignal,
    run: () => Result<T, ProviderFailure>,
  ): Promise<Result<T, ProviderFailure>> {
    signal.throwIfAborted();
    this.counts.set(operation, this.calls(operation) + 1);
    const next = this.pending.get(operation)?.shift();
    if (next?.kind === "barrier") {
      next.start();
      await wait(next.ready, signal);
    }
    signal.throwIfAborted();
    if (next?.kind === "rate_limited")
      return err({ code: "rate_limited", retryAfterMs: next.retryAfterMs });
    if (next?.kind === "unavailable") return err({ code: "unavailable" });
    if (next?.kind === "ambiguous_outcome") {
      if (next.apply) {
        const result = run();
        if (!result.ok) return result;
      }
      return err({ code: "ambiguous_outcome", outcome: "unknown" });
    }
    return run();
  }
}

async function wait(ready: Promise<void>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let abort: () => void = () => undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new DOMException("Fixture cancelled", "AbortError"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([ready, stopped]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
