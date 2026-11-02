export async function fixtureIo<T>(run: () => PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const value = await run();
  signal.throwIfAborted();
  return value;
}
