import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "@/types/result";
import type { CanonicalMigration } from "./migrationAdmission";
import { verifyWorkflowMigration } from "./migrationAdmissionDatabase";
import { verifyMailMigrations } from "./migrationAdmissionMail";

export async function verifyMigrationIntegrity(
  db: Pick<NodePgDatabase<Record<string, unknown>>, "execute">,
  canonical: readonly CanonicalMigration[],
  signal: AbortSignal,
): Promise<Result<true, string>> {
  const workflow = await verifyWorkflowMigration(db, canonical, signal);
  if (!workflow.ok) return workflow;
  return verifyMailMigrations(db, canonical, signal);
}
