import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { CoreRuntimeDependencies } from "@/server/trpc/core-runtime";

type BunHttpRuntime = { serve: CoreRuntimeDependencies["serve"] };

async function main(): Promise<void> {
  const host = globalThis as typeof globalThis & { Bun?: BunHttpRuntime };
  if (host.Bun === undefined)
    throw new AppError(ERROR_IDS.RUNTIME_CORE_API_CONFIGURATION_INVALID, "Core requires Bun");
  // Configuration/file-import diagnostics are sanitized before reaching the process log.
  const { startCoreService } = await import("@/server/trpc/core-service");
  const bun = host.Bun;
  const service = startCoreService((options) => bun.serve(options));
  await service.starting.catch(() => service.shutdown.request());
}

void main().catch(() => {
  try {
    console.error("Core startup failed", { id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED });
  } finally {
    process.exit(1);
  }
});
