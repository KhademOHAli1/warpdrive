import type { z } from "zod";
import { privacyIntakeSchema } from "../caseSchemas";
import type { createOwnPrivacyRequestAction } from "../requestActions";

export const ownRequestFormSchema = privacyIntakeSchema.pick({
  intakeKey: true,
  kind: true,
  locale: true,
  summary: true,
});
export type OwnRequestInput = z.infer<typeof ownRequestFormSchema>;
type Outcome = Awaited<ReturnType<typeof createOwnPrivacyRequestAction>>;
export type OwnRequestReceipt = Extract<Outcome, { ok: true }>["value"];
export type OwnRequestError = Extract<Outcome, { ok: false }>["error"] | "transport_interrupted";
export const REQUEST_WAIT_MS = 8000;

// A browser timeout cannot undo a Server Action. Retain the same intent for reconciliation/retry.
export function waitForRequest<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException("The request was interrupted.", "AbortError"),
      );
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    void task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(
          cause instanceof Error
            ? cause
            : new DOMException("The request failed.", "OperationError"),
        );
      },
    );
  });
}
