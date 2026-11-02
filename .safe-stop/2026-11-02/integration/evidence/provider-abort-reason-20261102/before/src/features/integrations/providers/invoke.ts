import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import type { ProviderAdapter, ProviderInput, ProviderOutput } from "./contract";
import { providerInputSchemas } from "./inputSchemas";
import { type ProviderFailure, type ProviderOperation, providerFailureSchema } from "./models";
import { providerOutputSchemas } from "./outputSchemas";

const invocationOptions = z.strictObject({
  signal: z.instanceof(AbortSignal),
  timeoutMs: z.number().int().min(1).max(60_000).default(15_000),
});
const resultEnvelope = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: providerFailureSchema }),
]);
const inputValidators: { [Operation in ProviderOperation]: z.ZodType<ProviderInput<Operation>> } =
  providerInputSchemas;
const outputValidators: { [Operation in ProviderOperation]: z.ZodType<ProviderOutput<Operation>> } =
  providerOutputSchemas;
const uncertainFailures = new Set<ProviderFailure["code"]>([
  "timed_out",
  "unavailable",
  "failed",
  "invalid_response",
  "ambiguous_outcome",
]);

function mayHaveEffect(operation: ProviderOperation): boolean {
  return operation === "exchange" || operation === "refresh" || operation === "disconnect";
}

function failure(code: ProviderFailure["code"], operation: ProviderOperation): ProviderFailure {
  return mayHaveEffect(operation) ? { code, outcome: "unknown" } : { code };
}

function validateResult<Operation extends ProviderOperation>(
  adapter: ProviderAdapter,
  operation: Operation,
  raw: unknown,
): Result<ProviderOutput<Operation>, ProviderFailure> {
  const result = resultEnvelope.safeParse(raw);
  if (!result.success) return err(failure("invalid_response", operation));
  if (!result.data.ok) {
    const error = result.data.error;
    if (
      !mayHaveEffect(operation) &&
      (error.code === "ambiguous_outcome" || error.outcome === "unknown")
    )
      return err({ code: "invalid_response" });
    return err(
      mayHaveEffect(operation) && uncertainFailures.has(error.code)
        ? { ...error, outcome: "unknown" }
        : error,
    );
  }
  const value = outputValidators[operation].safeParse(result.data.value);
  if (!value.success) return err(failure("invalid_response", operation));
  if (operation === "discoverCapabilities") {
    // The keyed validator above already established this operation-specific shape.
    const discovered = value.data as ProviderOutput<"discoverCapabilities">;
    if (discovered.operations.some((name) => adapter.operations[name].mode === "unsupported"))
      return err({ code: "invalid_response" });
  }
  return ok(value.data);
}

export async function invokeProvider<Operation extends ProviderOperation>(
  adapter: ProviderAdapter,
  operation: Operation,
  rawInput: unknown,
  options: { signal: AbortSignal; timeoutMs?: number },
): Promise<Result<ProviderOutput<Operation>, ProviderFailure>> {
  const settings = invocationOptions.safeParse(options);
  if (!settings.success) return err({ code: "invalid_input" });
  const { signal, timeoutMs } = settings.data;
  signal.throwIfAborted();
  const deadlineAt = performance.now() + timeoutMs;
  let input: z.ZodSafeParseResult<ProviderInput<Operation>>;
  try {
    input = inputValidators[operation].safeParse(rawInput);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError")
      throw new DOMException("Provider invocation aborted", "AbortError");
    return err({ code: "invalid_input" });
  }
  signal.throwIfAborted();
  if (!input.success) return err({ code: "invalid_input" });
  if (performance.now() >= deadlineAt) return err({ code: "timed_out" });
  const slot = adapter.operations[operation];
  if (slot.mode === "unsupported") return err({ code: "unsupported" });

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const deadline = { expired: false };
  const expired = () => deadline.expired || performance.now() >= deadlineAt;
  const timeoutResult = (): Result<ProviderOutput<Operation>, ProviderFailure> => {
    deadline.expired = true;
    controller.abort(new DOMException("Provider invocation timed out", "TimeoutError"));
    return err(failure("timed_out", operation));
  };
  const stopped = new Promise<Result<ProviderOutput<Operation>, ProviderFailure>>(
    (resolve, reject) => {
      abort = () => {
        const reason: unknown = signal.reason;
        controller.abort(reason);
        reject(
          reason instanceof Error ? reason : new DOMException("Caller cancelled", "AbortError"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(
        () => {
          resolve(timeoutResult());
        },
        Math.max(0, deadlineAt - performance.now()),
      );
    },
  );

  try {
    // Trusted synchronous code cannot be preempted; reject overdue results once it yields.
    // Both race branches have handlers, so a late noncooperative rejection is still consumed.
    const invoked = (async (): Promise<Result<ProviderOutput<Operation>, ProviderFailure>> => {
      try {
        signal.throwIfAborted();
        if (expired()) return err({ code: "timed_out" });
        const result = await slot.run(input.data, controller.signal);
        signal.throwIfAborted();
        if (expired()) return timeoutResult();
        const validated = validateResult(adapter, operation, result);
        signal.throwIfAborted();
        return expired() ? timeoutResult() : validated;
      } catch (error) {
        signal.throwIfAborted();
        if (expired()) return timeoutResult();
        if (error instanceof Error && error.name === "AbortError")
          throw new DOMException("Provider invocation aborted", "AbortError");
        return err(failure("failed", operation));
      }
    })();
    return await Promise.race([invoked, stopped]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}
