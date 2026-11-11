import { TRPCClientError } from "@trpc/client";

export function isOperationsAccessDenied(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const data: unknown = error.data;
  return (
    data !== null &&
    typeof data === "object" &&
    "code" in data &&
    (data.code === "FORBIDDEN" || data.code === "UNAUTHORIZED")
  );
}

/** The slot survives view changes/unmounts. Abort is a request, not proof that a
 * batched transport settled: only actual Promise settlement releases ownership.
 */
export function createOperationsReadSlot() {
  let busy = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    isBusy: () => busy,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run<T>(operation: () => Promise<T>): Promise<T> | null {
      if (busy) return null;
      busy = true;
      notify();
      const promise = Promise.resolve().then(operation);
      const release = () => {
        busy = false;
        notify();
      };
      void promise.then(release, release);
      return promise;
    },
  };
}
export type OperationsReadSlot = ReturnType<typeof createOperationsReadSlot>;

export async function readOperationsPair<A, B>(
  left: () => Promise<A>,
  right: () => Promise<B>,
  denied: () => void,
): Promise<[A, B]> {
  const observe = <T>(operation: () => Promise<T>) =>
    Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        if (isOperationsAccessDenied(error)) denied();
        throw error;
      });
  const [a, b] = await Promise.allSettled([observe(left), observe(right)] as const);
  if (a.status === "rejected") throw a.reason;
  if (b.status === "rejected") throw b.reason;
  return [a.value, b.value];
}
