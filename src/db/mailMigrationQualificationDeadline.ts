import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { getContainerRuntimeClient } from "testcontainers";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const missingContainer = z.object({ statusCode: z.literal(404) });
const OWNED_NAME = /^wd-mail-qualification-[a-f0-9-]{36}$/;

export function qualificationTimeout(phase: string): AppError {
  return new AppError(ERROR_IDS.DB_INVARIANT, "Qualification operation exceeded its deadline", {
    phase, kind: "timeout",
  });
}

export async function qualificationDeadline<T>(
  operation: () => Promise<T>,
  args: { signal: AbortSignal; milliseconds: number; phase: string; interrupt?: () => Promise<void> },
): Promise<T> {
  args.signal.throwIfAborted();
  let interrupted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => { interrupted = true; reject(args.signal.reason); };
    args.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      interrupted = true;
      reject(qualificationTimeout(args.phase));
    }, args.milliseconds);
    if (args.signal.aborted) abort();
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => { args.signal.throwIfAborted(); return operation(); }),
      cancelled,
    ]);
  } catch (error) {
    if (interrupted) {
      try { await args.interrupt?.(); }
      catch {
        // Preserve the original AbortError/timeout. Teardown still requires positive
        // removal proof, so this diagnostic cannot turn failed cleanup into success.
        process.stderr.write(`MAIL_MIGRATION_QUALIFICATION_CLEANUP_FAILURE ${args.phase}\n`);
      }
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    args.signal.removeEventListener("abort", abort);
  }
}

export async function qualificationSettles(operation: () => Promise<unknown>, milliseconds: number): Promise<boolean> {
  try {
    await qualificationDeadline(operation, {
      signal: new AbortController().signal, milliseconds, phase: "cleanup",
    });
    return true;
  } catch { return false; }
}

export async function forceRemoveQualificationContainer(
  name: string,
  container?: StartedPostgreSqlContainer,
  createdId?: string,
): Promise<boolean> {
  if (!OWNED_NAME.test(name))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Refusing cleanup of an unowned container name");
  if (createdId !== undefined && !/^[a-f0-9]{12,64}$/.test(createdId))
    throw new AppError(ERROR_IDS.DB_INVARIANT,"Refusing cleanup of an invalid owned container identifier");
  const target = container?.getId() ?? createdId ?? name;
  if (container !== undefined && await qualificationSettles(
    () => container.stop({ timeout: 0, remove: true, removeVolumes: true }), 8000,
  ) && await qualificationContainerAbsent(name,target)) return true;
  // Use the SDK's resolved daemon, never the host CLI's potentially different context.
  try {
    await qualificationDeadline(async () => {
      const runtime = await getContainerRuntimeClient();
      await runtime.container.getById(target).remove({force:true,v:true});
    }, {
      signal:new AbortController().signal,milliseconds:4000,phase:"container-force-remove",
    });
    return await qualificationContainerAbsent(name,target);
  } catch (error) {
    return missingContainer.safeParse(error).success && await qualificationContainerAbsent(name,target);
  }
}

export async function qualificationContainerAbsent(name: string, id?: string): Promise<boolean> {
  if (!OWNED_NAME.test(name) || (id !== undefined && id !== name && !/^[a-f0-9]{12,64}$/.test(id)))
    throw new AppError(ERROR_IDS.DB_INVARIANT,"Refusing inspection of an unowned container identifier");
  try {
    await qualificationDeadline(async () => {
      const runtime = await getContainerRuntimeClient();
      await runtime.container.getById(id ?? name).inspect();
    }, {signal:new AbortController().signal,milliseconds:4000,phase:"container-inspect"});
    return false;
  } catch (error) { return missingContainer.safeParse(error).success; }
}
