// A dependency that cannot cancel its OS/DB call must not hold the HTTP request
// open. Core mutations still receive this signal and check it before committing.
export async function withMailboxRequestSignal<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let remove = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = () => {
      try {
        signal.throwIfAborted();
      } catch (error) {
        reject(error instanceof Error ? error : new DOMException("Request aborted", "AbortError"));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    remove = () => signal.removeEventListener("abort", abort);
  });
  try {
    return await Promise.race([work, cancelled]);
  } finally {
    remove();
  }
}
