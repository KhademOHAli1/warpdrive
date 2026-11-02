import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db, pool } from "@/db/client";
import { seedWorkflowBrowserFixture } from "@/features/workflows/browserFixture.test-helpers";

const outputArguments = z.tuple([
  z.string().min(1).refine(isAbsolute, "Output path must be absolute"),
]);

async function seed(): Promise<void> {
  try {
    if (env.NODE_ENV !== "test")
      throw new AppError(ERROR_IDS.DB_INVARIANT, "Test environment required");
    const args = outputArguments.safeParse(process.argv.slice(2));
    if (!args.success)
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "Exactly one absolute private output path required",
      );
    const [outputPath] = args.data;
    const fixture = await seedWorkflowBrowserFixture(db, AbortSignal.timeout(20_000));
    // Caller owns the private directory. Never overwrite an existing file or serialize db/pool.
    await writeFile(outputPath, JSON.stringify(fixture, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.warn("Synthetic browser seed committed and private payload written");
  } finally {
    await pool.end();
  }
}

void seed().catch(() => {
  // Do not print a DSN, generated password, database error/stack or private payload.
  console.error("Synthetic browser seeding failed; owner must inspect the finite setup outcome");
  process.exitCode = 1;
});
