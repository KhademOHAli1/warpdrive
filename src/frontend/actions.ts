import { revalidatePath } from "next/cache";
import { coreClient } from "./trpc";

export async function invokeAction<T>(name: string, args: unknown[]): Promise<T> {
  const response = await coreClient({ writableCookies: true }).commands.execute.mutate({
    name,
    args,
  });
  for (const path of response.effects.revalidatePaths) revalidatePath(path);
  return response.value as T;
}
