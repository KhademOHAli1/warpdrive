// Keep transport failures on the same recoverable client path as a rejected Result.
// An empty id selects the existing generic error copy; it never impersonates a conflict.
export async function dealClientResult<T>(action: () => Promise<T>): Promise<
  | T
  | {
      ok: false;
      error: { id: string };
    }
> {
  try {
    return await action();
  } catch {
    return { ok: false, error: { id: "" } };
  }
}
